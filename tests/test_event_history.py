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
