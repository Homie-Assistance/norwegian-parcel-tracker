from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .api import ParcelEvent

_STORE_VERSION = 1
_HISTORY_KEY_PREFIX = "norwegian_parcel_tracker_history_"
_STATS_KEY = "norwegian_parcel_tracker_delivery_stats"
_META_KEY = "norwegian_parcel_tracker_meta"
_MAX_EVENTS = 500
_SAVE_DELAY = 30


def _event_key(event: ParcelEvent) -> str:
    raw = event.raw or {}
    if raw.get("id"):
        return f"id:{raw['id']}"
    return f"{event.date_iso or ''}|{event.status or ''}|{raw.get('postalCode', '')}|{raw.get('city', '')}"


def _event_to_dict(event: ParcelEvent) -> dict[str, Any]:
    raw = event.raw or {}
    return {
        "key": _event_key(event),
        "date_iso": event.date_iso,
        "description": event.description,
        "status": event.status,
        "location": event.location,
        "postal_code": raw.get("postalCode"),
        "city": raw.get("city"),
        "country": raw.get("countryCode"),
    }


class ParcelEventHistory:
    """Per-entry event history, backed by HA storage."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store: Store = Store(
            hass, _STORE_VERSION, f"{_HISTORY_KEY_PREFIX}{entry_id}", atomic_writes=True
        )
        self._events: list[dict[str, Any]] = []
        self._keys: set[str] = set()

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self._events = data.get("events", [])
        self._keys = {e["key"] for e in self._events if e.get("key")}

    def merge(self, new_events: list[ParcelEvent]) -> bool:
        """Merge events from a poll; return True if any were new."""
        added = False
        for event in new_events:
            key = _event_key(event)
            if not key or key in self._keys:
                continue
            self._keys.add(key)
            self._events.append(_event_to_dict(event))
            added = True

        if added:
            self._events.sort(key=lambda e: e.get("date_iso") or "", reverse=True)
            if len(self._events) > _MAX_EVENTS:
                removed = self._events[_MAX_EVENTS:]
                self._events = self._events[:_MAX_EVENTS]
                self._keys -= {e["key"] for e in removed if e.get("key")}

        return added

    def recent(self, n: int = 10) -> list[dict[str, Any]]:
        return self._events[:n]

    def all_events(self) -> list[dict[str, Any]]:
        return list(self._events)

    def first_event_time(self) -> str | None:
        return self._events[-1].get("date_iso") if self._events else None

    def arrival_time(self) -> str | None:
        """Return the ISO time of the first READY_FOR_PICKUP or DELIVERED event.

        Excludes PICKED_UP so that user pickup delay is not counted when computing
        actual carrier transit time.  Events are stored newest-first, so a linear
        scan finds the most recent qualifying event.
        """
        for event in self._events:
            if event.get("status") in ("READY_FOR_PICKUP", "DELIVERED"):
                return event.get("date_iso")
        return None

    async def async_save(self) -> None:
        self._store.async_delay_save(
            lambda: {"version": _STORE_VERSION, "events": self._events}, _SAVE_DELAY
        )

    async def async_remove(self) -> None:
        await self._store.async_remove()


class DeliveryStatsStore:
    """Global store for delivery timing records, survives entry removal."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store = Store(
            hass, _STORE_VERSION, _STATS_KEY, atomic_writes=True
        )
        self._records: list[dict[str, Any]] = []
        self._loaded = False

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self._records = data.get("records", [])
        self._loaded = True

    async def record_delivery(
        self,
        tracking_number: str,
        carrier: str,
        first_event_time: str | None,
        delivered_time: str,
        carrier_group: str | None = None,
        stop_type: str | None = None,
        last_stop_time: str | None = None,
    ) -> bool:
        """Record a completed delivery.

        When carrier_group, stop_type, and last_stop_time are supplied the actual
        hours from last in-transit stop to delivery are computed and stored so that
        get_learned_prior() can replace hardcoded ETA priors for that (carrier_group,
        stop_type) pair once enough samples have accumulated.
        """
        if not self._loaded:
            await self.async_load()
        if any(r["tracking_number"] == tracking_number for r in self._records):
            return False

        record: dict[str, Any] = {
            "tracking_number": tracking_number,
            "carrier": carrier,
            "first_event_time": first_event_time,
            "delivered_time": delivered_time,
        }
        if carrier_group and stop_type and last_stop_time:
            try:
                t0 = datetime.fromisoformat(last_stop_time)
                t1 = datetime.fromisoformat(delivered_time)
                if t0.tzinfo is None:
                    t0 = t0.replace(tzinfo=timezone.utc)
                if t1.tzinfo is None:
                    t1 = t1.replace(tzinfo=timezone.utc)
                actual_hours = (t1 - t0).total_seconds() / 3600
                if actual_hours >= 0:
                    record["carrier_group"] = carrier_group
                    record["stop_type"] = stop_type
                    record["last_stop_time"] = last_stop_time
                    record["actual_hours"] = round(actual_hours, 2)
            except (ValueError, TypeError):
                pass

        self._records.append(record)
        self._store.async_delay_save(
            lambda: {"version": _STORE_VERSION, "records": list(self._records)}, _SAVE_DELAY
        )
        return True

    def get_learned_prior(
        self,
        carrier_group: str,
        stop_type: str,
        min_samples: int = 5,
    ) -> tuple[float, float, float] | None:
        """Return (median_h, p25_factor, p75_factor) derived from recorded deliveries.

        Uses actual hours from the last in-transit stop to delivery for the given
        (carrier_group, stop_type) pair.  Returns None when fewer than min_samples
        qualifying records exist so callers can fall back to hardcoded priors.
        """
        samples = [
            r["actual_hours"]
            for r in self._records
            if r.get("carrier_group") == carrier_group
            and r.get("stop_type") == stop_type
            and isinstance(r.get("actual_hours"), (int, float))
            and r["actual_hours"] > 0
        ]
        if len(samples) < min_samples:
            return None

        sorted_h = sorted(samples)
        n = len(sorted_h)
        median_h = sorted_h[n // 2]
        p25_h = sorted_h[n // 4]
        p75_h = sorted_h[min(3 * n // 4, n - 1)]

        if median_h <= 0:
            return None
        return (median_h, p25_h / median_h, p75_h / median_h)

    def get_records(self) -> list[dict[str, Any]]:
        return list(self._records)


class ParcelMetaStore:
    """Stores user-set note, npt_icon, and display_name per tracking number."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store = Store(hass, _STORE_VERSION, _META_KEY, atomic_writes=True)
        self._data: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> None:
        raw = await self._store.async_load() or {}
        self._data = raw.get("parcels", {})
        for entry in self._data.values():
            if entry.get("note") and not entry.get("notes"):
                entry["notes"] = [{"text": entry["note"], "ts": "migrated", "idx": 0}]

    def get(self, tracking_number: str) -> dict[str, Any]:
        return dict(self._data.get(tracking_number.upper(), {}))

    async def async_set(self, tracking_number: str, **fields: Any) -> None:
        key = tracking_number.upper()
        entry = dict(self._data.get(key, {}))
        for k, v in fields.items():
            if v is None:
                entry.pop(k, None)
            else:
                entry[k] = v
        self._data[key] = entry
        self._store.async_delay_save(
            lambda: {"version": _STORE_VERSION, "parcels": dict(self._data)}, _SAVE_DELAY
        )

    async def async_clear_field(self, tracking_number: str, field: str) -> None:
        key = tracking_number.upper()
        entry = dict(self._data.get(key, {}))
        entry.pop(field, None)
        self._data[key] = entry
        self._store.async_delay_save(
            lambda: {"version": _STORE_VERSION, "parcels": dict(self._data)}, _SAVE_DELAY
        )

    async def async_add_note(self, tracking_number: str, text: str) -> None:
        from datetime import datetime, timezone
        key = tracking_number.upper()
        entry = dict(self._data.get(key, {}))
        notes = list(entry.get("notes", []))
        next_idx = max((n["idx"] for n in notes), default=-1) + 1
        notes.append({"text": text, "ts": datetime.now(timezone.utc).isoformat(), "idx": next_idx})
        entry["notes"] = notes
        entry["note"] = text
        self._data[key] = entry
        self._store.async_delay_save(
            lambda: {"version": _STORE_VERSION, "parcels": dict(self._data)}, _SAVE_DELAY
        )

    async def async_delete_note(self, tracking_number: str, idx: int) -> None:
        key = tracking_number.upper()
        entry = dict(self._data.get(key, {}))
        notes = [n for n in entry.get("notes", []) if n["idx"] != idx]
        entry["notes"] = notes
        if notes:
            entry["note"] = notes[-1]["text"]
        else:
            entry.pop("note", None)
        self._data[key] = entry
        self._store.async_delay_save(
            lambda: {"version": _STORE_VERSION, "parcels": dict(self._data)}, _SAVE_DELAY
        )

    async def async_clear(self, tracking_number: str) -> None:
        key = tracking_number.upper()
        self._data.pop(key, None)
        self._store.async_delay_save(
            lambda: {"version": _STORE_VERSION, "parcels": dict(self._data)}, _SAVE_DELAY
        )
