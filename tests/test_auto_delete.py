"""Tests for the auto-delete-delivered-parcels logic in the coordinator."""
import pytest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

# conftest stubs homeassistant.*; import coordinator after stubs are in place
from custom_components.norwegian_parcel_tracker.coordinator import PostenTrackingCoordinator
from custom_components.norwegian_parcel_tracker.const import (
    CONF_AUTO_DELETE_DELIVERED_HOURS,
    GLOBAL_ENTRY_UNIQUE_ID,
    DOMAIN,
)


def _make_parcel(is_delivered: bool):
    p = MagicMock()
    p.is_delivered = is_delivered
    return p


def _make_global_entry(auto_delete_hours: int):
    e = MagicMock()
    e.unique_id = GLOBAL_ENTRY_UNIQUE_ID
    e.options = {CONF_AUTO_DELETE_DELIVERED_HOURS: auto_delete_hours}
    return e


def _make_coord(entry_data: dict, global_opts: dict):
    """Build a PostenTrackingCoordinator-like object without calling __init__."""
    hass = MagicMock()
    hass.config_entries.async_entries.return_value = [
        _make_global_entry(global_opts.get(CONF_AUTO_DELETE_DELIVERED_HOURS, 0))
    ]
    hass.config_entries.async_update_entry = MagicMock()
    hass.async_create_task = MagicMock()

    entry = MagicMock()
    entry.data = dict(entry_data)
    entry.entry_id = "test_entry_id"

    coord = object.__new__(PostenTrackingCoordinator)
    coord.hass = hass
    coord.entry = entry
    coord.tracking_number = "JD01234567890123"
    return coord


# ── disabled (auto_delete_hours == 0) ────────────────────────────────────────

@pytest.mark.asyncio
async def test_auto_delete_disabled_no_write():
    coord = _make_coord({}, {CONF_AUTO_DELETE_DELIVERED_HOURS: 0})
    parcel = _make_parcel(is_delivered=True)
    await coord._async_handle_auto_delete(parcel)
    coord.hass.config_entries.async_update_entry.assert_not_called()
    coord.hass.async_create_task.assert_not_called()


# ── not yet delivered ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_auto_delete_not_delivered_no_write():
    coord = _make_coord({}, {CONF_AUTO_DELETE_DELIVERED_HOURS: 48})
    parcel = _make_parcel(is_delivered=False)
    await coord._async_handle_auto_delete(parcel)
    coord.hass.config_entries.async_update_entry.assert_not_called()
    coord.hass.async_create_task.assert_not_called()


# ── first delivery detection: stamp the timestamp ─────────────────────────────

@pytest.mark.asyncio
async def test_auto_delete_stamps_timestamp_on_first_detection():
    coord = _make_coord({}, {CONF_AUTO_DELETE_DELIVERED_HOURS: 48})
    parcel = _make_parcel(is_delivered=True)

    with patch(
        "custom_components.norwegian_parcel_tracker.coordinator.dt_util.utcnow",
        return_value=datetime(2026, 8, 9, 12, 0, 0, tzinfo=timezone.utc),
    ):
        await coord._async_handle_auto_delete(parcel)

    coord.hass.config_entries.async_update_entry.assert_called_once()
    call_kwargs = coord.hass.config_entries.async_update_entry.call_args
    written_data = call_kwargs.kwargs["data"]
    assert "delivered_at" in written_data
    assert written_data["delivered_at"] == "2026-08-09T12:00:00+00:00"
    coord.hass.async_create_task.assert_not_called()


# ── threshold not yet reached ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_auto_delete_threshold_not_yet_reached():
    delivered_at = datetime(2026, 8, 9, 10, 0, 0, tzinfo=timezone.utc)
    coord = _make_coord(
        {"delivered_at": delivered_at.isoformat()},
        {CONF_AUTO_DELETE_DELIVERED_HOURS: 48},
    )
    parcel = _make_parcel(is_delivered=True)
    # only 1 hour has elapsed
    now = delivered_at + timedelta(hours=1)
    with patch(
        "custom_components.norwegian_parcel_tracker.coordinator.dt_util.utcnow",
        return_value=now,
    ):
        await coord._async_handle_auto_delete(parcel)

    coord.hass.async_create_task.assert_not_called()


# ── threshold reached: schedule removal ──────────────────────────────────────

@pytest.mark.asyncio
async def test_auto_delete_schedules_removal_when_threshold_reached():
    delivered_at = datetime(2026, 8, 7, 10, 0, 0, tzinfo=timezone.utc)
    coord = _make_coord(
        {"delivered_at": delivered_at.isoformat()},
        {CONF_AUTO_DELETE_DELIVERED_HOURS: 48},
    )
    parcel = _make_parcel(is_delivered=True)
    # 49 hours have elapsed (> 48h threshold)
    now = delivered_at + timedelta(hours=49)
    with patch(
        "custom_components.norwegian_parcel_tracker.coordinator.dt_util.utcnow",
        return_value=now,
    ):
        await coord._async_handle_auto_delete(parcel)

    coord.hass.async_create_task.assert_called_once()


# ── existing timestamp already set: no second write ──────────────────────────

@pytest.mark.asyncio
async def test_auto_delete_does_not_overwrite_existing_timestamp():
    delivered_at = datetime(2026, 8, 9, 10, 0, 0, tzinfo=timezone.utc)
    coord = _make_coord(
        {"delivered_at": delivered_at.isoformat()},
        {CONF_AUTO_DELETE_DELIVERED_HOURS: 48},
    )
    parcel = _make_parcel(is_delivered=True)
    now = delivered_at + timedelta(hours=1)
    with patch(
        "custom_components.norwegian_parcel_tracker.coordinator.dt_util.utcnow",
        return_value=now,
    ):
        await coord._async_handle_auto_delete(parcel)

    coord.hass.config_entries.async_update_entry.assert_not_called()


# ── naive datetime in stored value is treated as UTC ─────────────────────────

@pytest.mark.asyncio
async def test_auto_delete_naive_datetime_treated_as_utc():
    naive_ts = "2026-08-07T10:00:00"  # no tzinfo suffix
    coord = _make_coord(
        {"delivered_at": naive_ts},
        {CONF_AUTO_DELETE_DELIVERED_HOURS: 48},
    )
    parcel = _make_parcel(is_delivered=True)
    now = datetime(2026, 8, 9, 11, 0, 0, tzinfo=timezone.utc)  # 49h later
    with patch(
        "custom_components.norwegian_parcel_tracker.coordinator.dt_util.utcnow",
        return_value=now,
    ):
        await coord._async_handle_auto_delete(parcel)

    coord.hass.async_create_task.assert_called_once()
