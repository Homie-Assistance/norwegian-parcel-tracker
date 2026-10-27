"""Tests for timed calendar event creation in the coordinator."""
import asyncio
import pytest
from datetime import date
from unittest.mock import AsyncMock, MagicMock

# conftest stubs homeassistant.*; import coordinator after stubs are in place
from custom_components.norwegian_parcel_tracker.coordinator import PostenTrackingCoordinator
from custom_components.norwegian_parcel_tracker.const import (
    CONF_CALENDAR_ENTITY,
    CONF_CREATE_CALENDAR_EVENT,
    DOMAIN,
)


def _make_parcel(tracking="TN001", eta="2026-11-01", delivered=False, sender="ACME"):
    p = MagicMock()
    p.tracking_number = tracking
    p.estimated_delivery_iso = eta
    p.is_delivered = delivered
    p.sender_name = sender
    p.status_description = "In transit"
    p.current_status = "in_transit"
    p.latest_event = None
    p.pickup_name = None
    p.delivery_method = None
    p.product_name = None
    p.weight_kg = None
    p.length_cm = None
    p.width_cm = None
    p.height_cm = None
    return p


def _make_coord(get_events_response=None):
    hass = MagicMock()
    hass.data = {}

    async def _fake_service_call(domain, service, service_data=None, target=None, blocking=False, return_response=False):
        if return_response:
            return get_events_response or {}
        return None

    hass.services.async_call = AsyncMock(side_effect=_fake_service_call)

    coord = object.__new__(PostenTrackingCoordinator)
    coord.hass = hass
    coord._calendar_created_for = None
    return coord


_OPTIONS = {CONF_CREATE_CALENDAR_EVENT: True, CONF_CALENDAR_ENTITY: "calendar.test"}


# ── opt-in guard ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_skipped_when_opt_out():
    coord = _make_coord()
    parcel = _make_parcel()
    await coord._async_create_calendar_event(parcel, {CONF_CREATE_CALENDAR_EVENT: False})
    coord.hass.services.async_call.assert_not_called()


@pytest.mark.asyncio
async def test_skipped_when_delivered():
    coord = _make_coord()
    parcel = _make_parcel(delivered=True)
    await coord._async_create_calendar_event(parcel, _OPTIONS)
    coord.hass.services.async_call.assert_not_called()


@pytest.mark.asyncio
async def test_skipped_when_no_eta():
    coord = _make_coord()
    parcel = _make_parcel(eta=None)
    await coord._async_create_calendar_event(parcel, _OPTIONS)
    coord.hass.services.async_call.assert_not_called()


# ── first parcel → 08:00–09:00 ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_first_parcel_gets_0800_slot():
    coord = _make_coord(get_events_response={})
    parcel = _make_parcel()
    await coord._async_create_calendar_event(parcel, _OPTIONS)

    calls = coord.hass.services.async_call.call_args_list
    create_call = next(c for c in calls if c.args[1] == "create_event")
    data = create_call.kwargs["service_data"]
    assert data["start_date_time"] == "2026-11-01 08:00:00"
    assert data["end_date_time"]   == "2026-11-01 09:00:00"
    assert "TN001" in data["description"]


# ── second parcel on same day → 08:30–09:30 ───────────────────────────────────

@pytest.mark.asyncio
async def test_second_parcel_gets_0830_slot():
    # Simulate one existing NPT event (Tracking number: TN000 already in calendar)
    existing_event = {"description": "Tracking number: TN000\nSender: Other"}
    response = {"calendar.test": {"events": [existing_event]}}
    coord = _make_coord(get_events_response=response)
    parcel = _make_parcel(tracking="TN001")
    await coord._async_create_calendar_event(parcel, _OPTIONS)

    calls = coord.hass.services.async_call.call_args_list
    create_call = next(c for c in calls if c.args[1] == "create_event")
    data = create_call.kwargs["service_data"]
    assert data["start_date_time"] == "2026-11-01 08:30:00"
    assert data["end_date_time"]   == "2026-11-01 09:30:00"


# ── parcel already has event → skip ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_existing_tracking_number_skips_create():
    existing = {"description": "Tracking number: TN001\nSender: ACME"}
    response = {"calendar.test": {"events": [existing]}}
    coord = _make_coord(get_events_response=response)
    parcel = _make_parcel(tracking="TN001")
    await coord._async_create_calendar_event(parcel, _OPTIONS)

    # get_events is called (slot query), but create_event must NOT be called
    calls = [c for c in coord.hass.services.async_call.call_args_list if c.args[1] == "create_event"]
    assert not calls


# ── in-memory dedup key prevents double creation on second refresh ─────────────

@pytest.mark.asyncio
async def test_calendar_key_prevents_double_creation():
    coord = _make_coord(get_events_response={})
    parcel = _make_parcel()
    await coord._async_create_calendar_event(parcel, _OPTIONS)
    first_call_count = coord.hass.services.async_call.call_count

    # Second call with same parcel + same ETA must return early without any service call
    await coord._async_create_calendar_event(parcel, _OPTIONS)
    assert coord.hass.services.async_call.call_count == first_call_count


# ── asyncio.Lock is created once per calendar entity ──────────────────────────

@pytest.mark.asyncio
async def test_lock_created_in_hass_data():
    coord = _make_coord(get_events_response={})
    await coord._async_create_calendar_event(_make_parcel(), _OPTIONS)
    locks = coord.hass.data.get(f"{DOMAIN}_calendar_locks", {})
    assert "calendar.test" in locks
    assert isinstance(locks["calendar.test"], asyncio.Lock)


# ── service data uses start_date_time, not start_date ─────────────────────────

@pytest.mark.asyncio
async def test_service_data_uses_timed_fields():
    coord = _make_coord(get_events_response={})
    await coord._async_create_calendar_event(_make_parcel(), _OPTIONS)
    calls = coord.hass.services.async_call.call_args_list
    create_call = next(c for c in calls if c.args[1] == "create_event")
    data = create_call.kwargs["service_data"]
    assert "start_date_time" in data
    assert "end_date_time"   in data
    assert "start_date" not in data
    assert "end_date"   not in data


# ── _async_count_calendar_slots unit tests ────────────────────────────────────

@pytest.mark.asyncio
async def test_count_slots_returns_zero_when_no_events():
    coord = _make_coord(get_events_response={})
    slot = await coord._async_count_calendar_slots("calendar.test", date(2026, 11, 1), "TN001")
    assert slot == 0


@pytest.mark.asyncio
async def test_count_slots_returns_none_when_tracking_already_present():
    response = {"calendar.test": {"events": [
        {"description": "Tracking number: TN001\nSender: X"}
    ]}}
    coord = _make_coord(get_events_response=response)
    slot = await coord._async_count_calendar_slots("calendar.test", date(2026, 11, 1), "TN001")
    assert slot is None


@pytest.mark.asyncio
async def test_count_slots_counts_npt_events_correctly():
    response = {"calendar.test": {"events": [
        {"description": "Tracking number: TN000\n"},
        {"description": "Tracking number: TN002\n"},
        {"description": "Birthday party", "summary": "Party"},  # non-NPT event, not counted
    ]}}
    coord = _make_coord(get_events_response=response)
    slot = await coord._async_count_calendar_slots("calendar.test", date(2026, 11, 1), "TN001")
    assert slot == 2


@pytest.mark.asyncio
async def test_count_slots_handles_service_error_gracefully():
    coord = _make_coord()
    coord.hass.services.async_call = AsyncMock(side_effect=Exception("calendar not available"))
    slot = await coord._async_count_calendar_slots("calendar.test", date(2026, 11, 1), "TN001")
    assert slot == 0  # falls back to slot 0 so creation can still proceed


@pytest.mark.asyncio
async def test_slot_overflow_clamped_to_valid_time():
    # 29 existing NPT events would push the raw slot to 29, giving start=08:00+14:30=22:30, end=23:30 (OK)
    # 30 existing events → raw start=23:00, end=24:00 — this must be clamped
    many_events = [
        {"description": f"Tracking number: TN{i:03d}\n"} for i in range(30)
    ]
    response = {"calendar.test": {"events": many_events}}
    coord = _make_coord(get_events_response=response)
    await coord._async_create_calendar_event(_make_parcel(tracking="TN999"), _OPTIONS)

    calls = [c for c in coord.hass.services.async_call.call_args_list if c.args[1] == "create_event"]
    assert calls, "create_event should still be called even with overflow"
    data = calls[0].kwargs["service_data"]
    # End time must be parsable and before midnight
    end_h, end_m, _ = data["end_date_time"].split(" ")[1].split(":")
    assert int(end_h) <= 23, f"end time {data['end_date_time']} exceeds midnight"
