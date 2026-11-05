"""Tests for owner_user_id tagging in the add_parcel service."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.norwegian_parcel_tracker import _async_register_services
from custom_components.norwegian_parcel_tracker.const import DOMAIN
from homeassistant.data_entry_flow import FlowResultType


async def _make_handler(flow_result_type: str):
    """Register services against a mock hass and return the add_parcel handler."""
    hass = MagicMock()
    hass.services.has_service.return_value = False
    hass.config_entries.flow.async_init = AsyncMock(
        return_value={"type": flow_result_type, "result": MagicMock(unique_id="JD123")}
    )
    meta = MagicMock()
    meta.async_set = AsyncMock()
    hass.data = {DOMAIN: {"_meta": meta}}
    hass.services.async_register = MagicMock()

    await _async_register_services(hass)

    # Extract the handler registered for "add_parcel"
    handler = None
    for call in hass.services.async_register.call_args_list:
        if call.args[1] == "add_parcel":
            handler = call.args[2]
            break
    assert handler is not None, "add_parcel handler was not registered"
    return handler, meta


@pytest.mark.asyncio
async def test_create_entry_tags_owner():
    """When the flow creates a new entry, the caller's user_id is stored."""
    handler, meta = await _make_handler(FlowResultType.CREATE_ENTRY)
    call = SimpleNamespace(
        data={"tracking_number": " jd123 "},
        context=SimpleNamespace(user_id="user-abc"),
    )
    await handler(call)
    meta.async_set.assert_awaited_once_with("JD123", owner_user_id="user-abc")


@pytest.mark.asyncio
async def test_abort_does_not_tag_owner():
    """When the flow aborts (duplicate tracking number), no owner is stored."""
    handler, meta = await _make_handler(FlowResultType.ABORT)
    call = SimpleNamespace(
        data={"tracking_number": "jd123"},
        context=SimpleNamespace(user_id="user-abc"),
    )
    await handler(call)
    meta.async_set.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_user_context_does_not_tag():
    """Service calls with no user context (e.g. automation) do not set an owner."""
    handler, meta = await _make_handler(FlowResultType.CREATE_ENTRY)
    call = SimpleNamespace(
        data={"tracking_number": "jd123"},
        context=SimpleNamespace(user_id=None),
    )
    await handler(call)
    meta.async_set.assert_not_awaited()
