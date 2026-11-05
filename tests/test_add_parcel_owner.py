"""Tests for owner_user_id tagging and modification guards."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.norwegian_parcel_tracker import (
    _caller_may_access,
    _async_register_services,
)
from custom_components.norwegian_parcel_tracker.const import DOMAIN
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import ServiceValidationError


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


# ── _caller_may_access tests ─────────────────────────────────────────────────

def _meta_with_owner(owner_id):
    meta = MagicMock()
    meta.get = MagicMock(return_value={"owner_user_id": owner_id} if owner_id else {})
    return meta


def _hass_with_meta(owner_id):
    hass = MagicMock()
    hass.data = {DOMAIN: {"_meta": _meta_with_owner(owner_id)}}
    return hass


def test_may_access_no_context():
    """No user context (automation/script) is always allowed."""
    hass = _hass_with_meta("user-owner")
    call = SimpleNamespace(context=None)
    assert _caller_may_access(hass, call, "JD123") is True


def test_may_access_owner():
    """The owning user may access their parcel."""
    hass = _hass_with_meta("user-owner")
    call = SimpleNamespace(context=SimpleNamespace(user_id="user-owner"))
    assert _caller_may_access(hass, call, "JD123") is True


def test_may_not_access_non_owner():
    """A different user (including an admin) may not access someone else's parcel."""
    hass = _hass_with_meta("user-owner")
    call = SimpleNamespace(context=SimpleNamespace(user_id="user-other"))
    assert _caller_may_access(hass, call, "JD123") is False


def test_may_access_unowned_parcel():
    """Unowned parcels (no owner_user_id) can be accessed by anyone."""
    hass = _hass_with_meta(None)
    call = SimpleNamespace(context=SimpleNamespace(user_id="user-anyone"))
    assert _caller_may_access(hass, call, "JD123") is True


@pytest.mark.asyncio
async def test_remove_parcel_denied_for_non_owner():
    """remove_parcel raises ServiceValidationError when caller is not the owner."""
    hass = MagicMock()
    hass.services.has_service.return_value = False
    hass.config_entries.flow.async_init = AsyncMock(
        return_value={"type": "create_entry", "result": MagicMock(unique_id="JD123")}
    )
    meta = MagicMock()
    meta.async_set = AsyncMock()
    meta.get = MagicMock(return_value={"owner_user_id": "user-owner"})
    hass.data = {DOMAIN: {"_meta": meta}}
    hass.services.async_register = MagicMock()
    hass.config_entries.async_remove = AsyncMock()

    await _async_register_services(hass)
    handler = next(
        c.args[2] for c in hass.services.async_register.call_args_list if c.args[1] == "remove_parcel"
    )

    call = SimpleNamespace(
        data={"tracking_number": "jd123"},
        context=SimpleNamespace(user_id="user-other"),
    )
    with pytest.raises(ServiceValidationError):
        await handler(call)
    hass.config_entries.async_remove.assert_not_awaited()
