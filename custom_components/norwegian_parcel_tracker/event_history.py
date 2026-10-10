from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .api import ParcelEvent

_STORE_VERSION = 1
_HISTORY_KEY_PREFIX = "norwegian_parcel_tracker_history_"
_STATS_KEY = "norwegian_parcel_tracker_delivery_stats"
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

    async def async_save(self) -> None:
        await self._store.async_delay_save(
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
    ) -> None:
        if not self._loaded:
            await self.async_load()
        if any(r["tracking_number"] == tracking_number for r in self._records):
            return
        self._records.append(
            {
                "tracking_number": tracking_number,
                "carrier": carrier,
                "first_event_time": first_event_time,
                "delivered_time": delivered_time,
            }
        )
        await self._store.async_delay_save(
            lambda: {"version": _STORE_VERSION, "records": list(self._records)}, _SAVE_DELAY
        )

    def get_records(self) -> list[dict[str, Any]]:
        return list(self._records)
