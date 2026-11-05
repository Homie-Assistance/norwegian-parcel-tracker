from __future__ import annotations

import logging
import re
from os import path as ospath

from homeassistant.components import panel_custom
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, SupportsResponse
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import ServiceValidationError
import homeassistant.helpers.config_validation as cv
import homeassistant.helpers.device_registry as dr
import voluptuous as vol

from .const import CONF_DISPLAY_NAME, CONF_ENTRY_TYPE, CONF_TRACKING_NUMBER, DOMAIN, ENTRY_TYPE_EMAIL_WATCHER, ENTRY_TYPE_GLOBAL, GLOBAL_ENTRY_UNIQUE_ID, VERSION
from .coordinator import PostenTrackingCoordinator
from .email_watcher import EmailWatcherCoordinator
from .event_history import ParcelEventHistory, ParcelMetaStore
from .geocoder import NominatimGeocoder

_LOGGER = logging.getLogger(__name__)

PLATFORMS = ["sensor", "button", "device_tracker"]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

_PANEL_URL = "/norwegian_parcel_tracker_panel"
_CARD_URL = "/norwegian_parcel_tracker/card.js"
_COMPACT_CARD_URL = "/norwegian_parcel_tracker/compact_card.js"
_MAP_CARD_URL = "/norwegian_parcel_tracker/map_card.js"
_PANEL_FRONTEND_DIR = ospath.join(ospath.dirname(__file__), "frontend")
_NOTE_MAX_LEN = 2000


def _validate_npt_icon(value: str) -> str:
    if re.match(r"^mdi:[a-z0-9-]+$", value):
        return value
    if re.match(r"^https?://", value):
        return value
    if len(value) <= 10:
        return value
    raise vol.Invalid("Icon must be an mdi:icon-name, an emoji (≤10 chars), or an https:// URL")


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    if "_geocoder" not in hass.data[DOMAIN]:
        geocoder = NominatimGeocoder(hass)
        await geocoder.async_load()
        hass.data[DOMAIN]["_geocoder"] = geocoder
    if "_meta" not in hass.data[DOMAIN]:
        meta = ParcelMetaStore(hass)
        await meta.async_load()
        hass.data[DOMAIN]["_meta"] = meta
    await _async_register_services(hass)
    await _async_register_panel(hass)
    _async_maybe_create_global_entry(hass)
    return True


def _async_maybe_create_global_entry(hass: HomeAssistant) -> None:
    """Auto-create a global settings entry with defaults for users upgrading from pre-global versions."""
    entries = hass.config_entries.async_entries(DOMAIN)
    has_global = any(e.unique_id == GLOBAL_ENTRY_UNIQUE_ID for e in entries)
    has_parcel = any(e.unique_id != GLOBAL_ENTRY_UNIQUE_ID for e in entries)
    if has_parcel and not has_global:
        hass.async_create_task(
            hass.config_entries.flow.async_init(
                DOMAIN,
                context={"source": "create_global"},
                data={},
            )
        )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})

    entry_type = entry.data.get(CONF_ENTRY_TYPE)

    if entry_type == ENTRY_TYPE_GLOBAL:
        await hass.config_entries.async_forward_entry_setups(entry, ["sensor"])
        return True

    if entry_type == ENTRY_TYPE_EMAIL_WATCHER:
        coordinator = EmailWatcherCoordinator(hass, entry)
        await coordinator.async_config_entry_first_refresh()
        hass.data[DOMAIN][entry.entry_id] = coordinator
        return True

    coordinator = PostenTrackingCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    hass.data[DOMAIN][entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await _async_register_services(hass)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    history = ParcelEventHistory(hass, entry.entry_id)
    await history.async_remove()
    tracking_number = entry.data.get(CONF_TRACKING_NUMBER, "")
    if tracking_number:
        meta: ParcelMetaStore | None = hass.data.get(DOMAIN, {}).get("_meta")
        if meta:
            await meta.async_clear(tracking_number)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    entry_type = entry.data.get(CONF_ENTRY_TYPE)

    if entry_type == ENTRY_TYPE_GLOBAL:
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
        return await hass.config_entries.async_unload_platforms(entry, ["sensor"])
    if entry_type == ENTRY_TYPE_EMAIL_WATCHER:
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
        return True

    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return unload_ok


def _caller_may_access(hass: HomeAssistant, call, tracking_number: str) -> bool:
    """Return True if the caller may read or modify this parcel.

    Rules:
    - No user context (automation, script, CLI) → always allowed.
    - Parcel has no owner → allowed to everyone.
    - Caller's user_id matches the owner → allowed.
    - Any other case (including admins) → denied.
    """
    if not call.context or not call.context.user_id:
        return True
    meta: ParcelMetaStore | None = hass.data.get(DOMAIN, {}).get("_meta")
    if not meta:
        return True
    owner_id = meta.get(tracking_number).get("owner_user_id")
    if not owner_id:
        return True
    return call.context.user_id == owner_id


def _async_refresh_coordinator_listeners(hass: HomeAssistant, tracking_number: str) -> None:
    for coordinator in hass.data.get(DOMAIN, {}).values():
        if (
            hasattr(coordinator, "async_update_listeners")
            and getattr(coordinator, "tracking_number", "").upper() == tracking_number
        ):
            coordinator.async_update_listeners()


async def _async_register_panel(hass: HomeAssistant) -> None:
    if hass.data[DOMAIN].get("_panel_registered"):
        return
    panel_js = ospath.join(_PANEL_FRONTEND_DIR, "panel.js")
    if not ospath.isfile(panel_js):
        return

    static_paths = [StaticPathConfig(_PANEL_URL, panel_js, cache_headers=False)]
    for url, filename in (
        (_CARD_URL, "card.js"),
        (_COMPACT_CARD_URL, "compact_card.js"),
        (_MAP_CARD_URL, "map_card.js"),
    ):
        fpath = ospath.join(_PANEL_FRONTEND_DIR, filename)
        if ospath.isfile(fpath):
            static_paths.append(StaticPathConfig(url, fpath, cache_headers=False))

    await hass.http.async_register_static_paths(static_paths)
    for card_url in (_CARD_URL, _COMPACT_CARD_URL, _MAP_CARD_URL):
        add_extra_js_url(hass, f"{card_url}?v={VERSION}")
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path="norwegian-parcel-tracker",
        webcomponent_name="norwegian-parcel-tracker-panel",
        sidebar_title="Parcels",
        sidebar_icon="mdi:package-variant-closed",
        module_url=f"{_PANEL_URL}?v={VERSION}",
        require_admin=False,
    )
    hass.data[DOMAIN]["_panel_registered"] = True


async def _async_register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, "add_parcel"):
        return

    async def add_parcel(call):
        tracking_number = call.data["tracking_number"].strip()
        name = call.data.get("name") or tracking_number
        result = await hass.config_entries.flow.async_init(
            DOMAIN,
            context={"source": "user"},
            data={"tracking_number": tracking_number, "name": name},
        )
        # Tag the parcel with the calling user's ID so the panel can filter by owner.
        # Only tag when the flow actually created a new entry — do not overwrite the
        # owner when a duplicate tracking number is added (the flow aborts, type != create_entry).
        # Parcels added via email watcher have no user_id and remain unowned (visible to all).
        user_id = call.context.user_id if call.context else None
        if user_id and result.get("type") == FlowResultType.CREATE_ENTRY:
            meta: ParcelMetaStore | None = hass.data.get(DOMAIN, {}).get("_meta")
            if meta:
                await meta.async_set(tracking_number.upper(), owner_user_id=user_id)
                _async_refresh_coordinator_listeners(hass, tracking_number.upper())

    async def refresh(call):
        tracking_filter = str(call.data.get("tracking_number") or "").strip().upper()
        coordinators = [
            v for v in hass.data.get(DOMAIN, {}).values()
            if hasattr(v, "_refreshing")
        ]
        if tracking_filter:
            coordinators = [
                c for c in coordinators
                if getattr(c, "tracking_number", "").upper() == tracking_filter
            ]
        for coordinator in coordinators:
            coordinator._refreshing = True
            coordinator.async_update_listeners()
        for coordinator in coordinators:
            await coordinator.async_request_refresh()

    def _not_owner_error(service: str, tracking_number: str) -> ServiceValidationError:
        """Return a ServiceValidationError for a non-owner access attempt."""
        return ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="not_owner",
            translation_placeholders={"service": service, "tracking_number": tracking_number},
        )

    async def remove_parcel(call):
        tracking_number = str(call.data.get("tracking_number") or "").strip().upper()
        if not tracking_number:
            return
        if not _caller_may_access(hass, call, tracking_number):
            raise _not_owner_error("remove_parcel", tracking_number)
        for entry in hass.config_entries.async_entries(DOMAIN):
            if (entry.unique_id or "").upper() == tracking_number:
                await hass.config_entries.async_remove(entry.entry_id)
                return
        _LOGGER.warning("remove_parcel: no entry found for tracking number %s", tracking_number)

    async def get_parcel_history(call):
        tracking_number = str(call.data.get("tracking_number") or "").strip().upper()
        if not _caller_may_access(hass, call, tracking_number):
            raise _not_owner_error("get_parcel_history", tracking_number)
        for coordinator in hass.data.get(DOMAIN, {}).values():
            if (
                hasattr(coordinator, "_history")
                and getattr(coordinator, "tracking_number", "").upper() == tracking_number
            ):
                return {"events": coordinator._history.all_events()}
        return {"events": []}

    async def set_note(call):
        tracking_number = str(call.data["tracking_number"]).strip().upper()
        if not _caller_may_access(hass, call, tracking_number):
            raise _not_owner_error("set_note", tracking_number)
        text = str(call.data["text"]).strip()
        meta: ParcelMetaStore | None = hass.data.get(DOMAIN, {}).get("_meta")
        if meta:
            await meta.async_set(tracking_number, note=text)
            _async_refresh_coordinator_listeners(hass, tracking_number)

    async def clear_note(call):
        tracking_number = str(call.data["tracking_number"]).strip().upper()
        if not _caller_may_access(hass, call, tracking_number):
            raise _not_owner_error("clear_note", tracking_number)
        meta: ParcelMetaStore | None = hass.data.get(DOMAIN, {}).get("_meta")
        if meta:
            await meta.async_clear_field(tracking_number, "note")
            await meta.async_clear_field(tracking_number, "notes")
            _async_refresh_coordinator_listeners(hass, tracking_number)

    async def add_note(call):
        tracking_number = str(call.data["tracking_number"]).strip().upper()
        if not _caller_may_access(hass, call, tracking_number):
            raise _not_owner_error("add_note", tracking_number)
        text = str(call.data["text"]).strip()
        meta: ParcelMetaStore | None = hass.data.get(DOMAIN, {}).get("_meta")
        if meta and text:
            await meta.async_add_note(tracking_number, text)
            _async_refresh_coordinator_listeners(hass, tracking_number)

    async def delete_note(call):
        tracking_number = str(call.data["tracking_number"]).strip().upper()
        if not _caller_may_access(hass, call, tracking_number):
            raise _not_owner_error("delete_note", tracking_number)
        idx = int(call.data["idx"])
        meta: ParcelMetaStore | None = hass.data.get(DOMAIN, {}).get("_meta")
        if meta:
            await meta.async_delete_note(tracking_number, idx)
            _async_refresh_coordinator_listeners(hass, tracking_number)

    async def set_icon(call):
        tracking_number = str(call.data["tracking_number"]).strip().upper()
        if not _caller_may_access(hass, call, tracking_number):
            raise _not_owner_error("set_icon", tracking_number)
        icon = str(call.data["icon"]).strip()
        meta: ParcelMetaStore | None = hass.data.get(DOMAIN, {}).get("_meta")
        if meta:
            await meta.async_set(tracking_number, npt_icon=icon)
            _async_refresh_coordinator_listeners(hass, tracking_number)

    async def clear_icon(call):
        tracking_number = str(call.data["tracking_number"]).strip().upper()
        if not _caller_may_access(hass, call, tracking_number):
            raise _not_owner_error("clear_icon", tracking_number)
        meta: ParcelMetaStore | None = hass.data.get(DOMAIN, {}).get("_meta")
        if meta:
            await meta.async_clear_field(tracking_number, "npt_icon")
            _async_refresh_coordinator_listeners(hass, tracking_number)

    async def rename_parcel(call):
        tracking_number = str(call.data["tracking_number"]).strip().upper()
        if not _caller_may_access(hass, call, tracking_number):
            raise _not_owner_error("rename_parcel", tracking_number)
        new_name = str(call.data["name"]).strip()
        dev_reg = dr.async_get(hass)
        for entry in hass.config_entries.async_entries(DOMAIN):
            if (entry.unique_id or "").upper() == tracking_number:
                hass.config_entries.async_update_entry(
                    entry,
                    data={**entry.data, CONF_DISPLAY_NAME: new_name},
                    title=new_name,
                )
                device = dev_reg.async_get_device(identifiers={(DOMAIN, entry.entry_id)})
                if device:
                    dev_reg.async_update_device(device.id, name_by_user=new_name)
                _async_refresh_coordinator_listeners(hass, tracking_number)
                return
        _LOGGER.warning("rename_parcel: no entry found for tracking number %s", tracking_number)

    hass.services.async_register(DOMAIN, "add_parcel", add_parcel)
    hass.services.async_register(DOMAIN, "refresh", refresh)
    hass.services.async_register(DOMAIN, "remove_parcel", remove_parcel)
    hass.services.async_register(
        DOMAIN,
        "get_parcel_history",
        get_parcel_history,
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN, "set_note", set_note,
        schema=vol.Schema({
            vol.Required("tracking_number"): cv.string,
            vol.Required("text"): vol.All(cv.string, vol.Length(max=_NOTE_MAX_LEN)),
        }),
    )
    hass.services.async_register(
        DOMAIN, "clear_note", clear_note,
        schema=vol.Schema({vol.Required("tracking_number"): cv.string}),
    )
    hass.services.async_register(
        DOMAIN, "add_note", add_note,
        schema=vol.Schema({
            vol.Required("tracking_number"): cv.string,
            vol.Required("text"): vol.All(cv.string, vol.Length(max=_NOTE_MAX_LEN)),
        }),
    )
    hass.services.async_register(
        DOMAIN, "delete_note", delete_note,
        schema=vol.Schema({
            vol.Required("tracking_number"): cv.string,
            vol.Required("idx"): vol.Coerce(int),
        }),
    )
    hass.services.async_register(
        DOMAIN, "set_icon", set_icon,
        schema=vol.Schema({
            vol.Required("tracking_number"): cv.string,
            vol.Required("icon"): vol.All(cv.string, _validate_npt_icon),
        }),
    )
    hass.services.async_register(
        DOMAIN, "clear_icon", clear_icon,
        schema=vol.Schema({vol.Required("tracking_number"): cv.string}),
    )
    hass.services.async_register(
        DOMAIN, "rename_parcel", rename_parcel,
        schema=vol.Schema({
            vol.Required("tracking_number"): cv.string,
            vol.Required("name"): vol.All(cv.string, vol.Length(min=1, max=100)),
        }),
    )
