"""Tests for ParcelEventHistory merge logic."""
import pytest
from custom_components.norwegian_parcel_tracker.api import ParcelEvent
from custom_components.norwegian_parcel_tracker.event_history import (
    ParcelEventHistory,
    _event_key,
)


def _ev(date_iso, status, postal_code=None, city=None, ev_id=None):
    raw = {}
    if ev_id is not None:
        raw["id"] = ev_id
    if postal_code:
        raw["postalCode"] = postal_code
    if city:
        raw["city"] = city
    return ParcelEvent(
        description=f"Event {status}",
        date_iso=date_iso,
        status=status,
        location=f"{postal_code or ''} {city or ''}".strip() or None,
        raw=raw,
    )


class FakeStore:
    def __init__(self):
        self._data = None

    async def async_load(self):
        return self._data

    async def async_delay_save(self, callback, delay):
        self._data = callback()

    async def async_remove(self):
        self._data = None


def _make_history():
    history = ParcelEventHistory.__new__(ParcelEventHistory)
    history._store = FakeStore()
    history._events = []
    history._keys = set()
    return history


# ── Dedup: merging same payload twice adds nothing ─────────────────────────────

def test_merge_same_event_twice_is_idempotent():
    h = _make_history()
    events = [_ev("2024-01-15T10:00:00Z", "DELIVERED", "0150", "Oslo")]
    assert h.merge(events) is True
    assert h.merge(events) is False
    assert len(h._events) == 1


def test_merge_deduplicates_by_helthjem_id():
    h = _make_history()
    e1 = _ev("2024-01-15T10:00:00Z", "IN_TRANSIT", ev_id=42)
    e2 = _ev("2024-01-15T10:00:00Z", "IN_TRANSIT", ev_id=42)
    h.merge([e1])
    h.merge([e2])
    assert len(h._events) == 1


# ── Language: switching translated description adds nothing ───────────────────

def test_merge_language_change_does_not_duplicate():
    """Dedup key uses raw status/location, not translated description text."""
    h = _make_history()
    e_nb = ParcelEvent(
        description="Pakken er levert",
        date_iso="2024-01-15T10:00:00Z",
        status="DELIVERED",
        location="0150 Oslo",
        raw={"postalCode": "0150", "city": "Oslo"},
    )
    e_en = ParcelEvent(
        description="The parcel has been delivered",
        date_iso="2024-01-15T10:00:00Z",
        status="DELIVERED",
        location="0150 Oslo",
        raw={"postalCode": "0150", "city": "Oslo"},
    )
    h.merge([e_nb])
    result = h.merge([e_en])
    assert result is False
    assert len(h._events) == 1


# ── Load before first refresh: merge builds on stored history ────────────────

@pytest.mark.asyncio
async def test_history_loaded_before_merge():
    h = _make_history()
    existing = _ev("2024-01-10T08:00:00Z", "IN_TRANSIT", "5005", "Bergen")
    h._events = [{"key": _event_key(existing), "date_iso": existing.date_iso,
                  "description": existing.description, "status": existing.status,
                  "location": existing.location, "postal_code": "5005", "city": "Bergen",
                  "country": None}]
    h._keys = {_event_key(existing)}
    h._store._data = {"version": 1, "events": h._events[:]}

    new_history = _make_history()
    new_history._store = h._store
    await new_history.async_load()

    new_event = _ev("2024-01-15T10:00:00Z", "DELIVERED", "0150", "Oslo")
    new_history.merge([new_event])
    assert len(new_history._events) == 2
    assert new_history.merge([existing]) is False


# ── arrival_time ──────────────────────────────────────────────────────────────

def test_arrival_time_returns_ready_for_pickup_before_picked_up():
    h = _make_history()
    # Events stored newest-first
    h._events = [
        {"key": "k1", "date_iso": "2026-11-03T10:00:00+00:00", "status": "PICKED_UP", "description": "Picked up"},
        {"key": "k2", "date_iso": "2026-11-01T12:00:00+00:00", "status": "READY_FOR_PICKUP", "description": "Ready"},
        {"key": "k3", "date_iso": "2026-10-30T08:00:00+00:00", "status": "IN_TRANSIT", "description": "In transit"},
    ]
    assert h.arrival_time() == "2026-11-01T12:00:00+00:00"


def test_arrival_time_returns_delivered_for_direct_delivery():
    h = _make_history()
    h._events = [
        {"key": "k1", "date_iso": "2026-11-02T14:00:00+00:00", "status": "DELIVERED", "description": "Delivered"},
        {"key": "k2", "date_iso": "2026-11-01T08:00:00+00:00", "status": "IN_TRANSIT", "description": "In transit"},
    ]
    assert h.arrival_time() == "2026-11-02T14:00:00+00:00"


def test_arrival_time_returns_none_when_no_arrival_event():
    h = _make_history()
    h._events = [
        {"key": "k1", "date_iso": "2026-11-01T08:00:00+00:00", "status": "IN_TRANSIT", "description": "In transit"},
    ]
    assert h.arrival_time() is None


# ── DeliveryStatsStore learned priors ────────────────────────────────────────

class FakeDeliveryStore:
    def __init__(self):
        self._data = None

    async def async_load(self):
        return self._data

    def async_delay_save(self, callback, delay):
        self._data = callback()


def _make_stats_store():
    from custom_components.norwegian_parcel_tracker.event_history import DeliveryStatsStore
    store = DeliveryStatsStore.__new__(DeliveryStatsStore)
    store._store = FakeDeliveryStore()
    store._records = []
    store._loaded = True
    return store


@pytest.mark.asyncio
async def test_record_delivery_stores_actual_hours():
    s = _make_stats_store()
    recorded = await s.record_delivery(
        tracking_number="TEST001",
        carrier="posten",
        first_event_time="2026-11-01T08:00:00+00:00",
        delivered_time="2026-11-02T08:00:00+00:00",
        carrier_group="domestic",
        stop_type="warehouse",
        last_stop_time="2026-11-01T08:00:00+00:00",
    )
    assert recorded is True
    assert len(s._records) == 1
    assert s._records[0]["actual_hours"] == 24.0
    assert s._records[0]["carrier_group"] == "domestic"
    assert s._records[0]["stop_type"] == "warehouse"


@pytest.mark.asyncio
async def test_record_delivery_duplicate_ignored():
    s = _make_stats_store()
    await s.record_delivery("TEST001", "posten", None, "2026-11-01T12:00:00+00:00")
    recorded = await s.record_delivery("TEST001", "posten", None, "2026-11-01T13:00:00+00:00")
    assert recorded is False
    assert len(s._records) == 1


@pytest.mark.asyncio
async def test_get_learned_prior_insufficient_samples_returns_none():
    s = _make_stats_store()
    for i in range(4):
        s._records.append({
            "tracking_number": f"TEST{i:03d}",
            "carrier": "posten",
            "carrier_group": "domestic",
            "stop_type": "warehouse",
            "actual_hours": 24.0,
            "first_event_time": None,
            "delivered_time": "2026-11-02T08:00:00+00:00",
        })
    assert s.get_learned_prior("domestic", "warehouse") is None


@pytest.mark.asyncio
async def test_get_learned_prior_returns_tuple_with_enough_samples():
    s = _make_stats_store()
    for i, h in enumerate([10.0, 12.0, 14.0, 16.0, 18.0]):
        s._records.append({
            "tracking_number": f"TEST{i:03d}",
            "carrier": "posten",
            "carrier_group": "domestic",
            "stop_type": "warehouse",
            "actual_hours": h,
            "first_event_time": None,
            "delivered_time": "2026-11-02T08:00:00+00:00",
        })
    result = s.get_learned_prior("domestic", "warehouse")
    assert result is not None
    median_h, p25_factor, p75_factor = result
    # n=5: n//2=2→14, n//4=1→12, 3*n//4=3→16
    assert median_h == 14.0
    assert p25_factor == pytest.approx(12.0 / 14.0, rel=1e-3)
    assert p75_factor == pytest.approx(16.0 / 14.0, rel=1e-3)


@pytest.mark.asyncio
async def test_get_learned_prior_ignores_other_carrier_group():
    s = _make_stats_store()
    for i in range(5):
        s._records.append({
            "tracking_number": f"C{i}",
            "carrier": "cainiao",
            "carrier_group": "cainiao",
            "stop_type": "warehouse",
            "actual_hours": 72.0,
            "first_event_time": None,
            "delivered_time": "2026-11-02T08:00:00+00:00",
        })
    assert s.get_learned_prior("domestic", "warehouse") is None
    assert s.get_learned_prior("cainiao", "warehouse") is not None
