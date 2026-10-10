from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
import homeassistant.helpers.config_validation as cv

from .const import CONF_ENTRY_TYPE, DOMAIN, ENTRY_TYPE_EMAIL_WATCHER, ENTRY_TYPE_GLOBAL, GLOBAL_ENTRY_UNIQUE_ID
from .coordinator import PostenTrackingCoordinator
from .email_watcher import EmailWatcherCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS = ["sensor", "button"]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    await _async_register_services(hass)
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


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    entry_type = entry.data.get(CONF_ENTRY_TYPE)

    if entry_type in (ENTRY_TYPE_GLOBAL, ENTRY_TYPE_EMAIL_WATCHER):
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
        return True

    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return unload_ok


async def _async_register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, "add_parcel"):
        return

    async def add_parcel(call):
        tracking_number = call.data["tracking_number"].strip()
        name = call.data.get("name") or tracking_number
        await hass.config_entries.flow.async_init(
            DOMAIN,
            context={"source": "user"},
            data={"tracking_number": tracking_number, "name": name},
        )

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

    async def remove_parcel(call):
        tracking_number = str(call.data.get("tracking_number") or "").strip().upper()
        if not tracking_number:
            return
        for entry in hass.config_entries.async_entries(DOMAIN):
            if (entry.unique_id or "").upper() == tracking_number:
                await hass.config_entries.async_remove(entry.entry_id)
                return
        _LOGGER.warning("remove_parcel: no entry found for tracking number %s", tracking_number)

    hass.services.async_register(DOMAIN, "add_parcel", add_parcel)
    hass.services.async_register(DOMAIN, "refresh", refresh)
    hass.services.async_register(DOMAIN, "remove_parcel", remove_parcel)
