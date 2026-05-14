from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CONF_ENTRY_TYPE, DOMAIN, ENTRY_TYPE_GLOBAL, GLOBAL_ENTRY_UNIQUE_ID
from .coordinator import PostenTrackingCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS = ["sensor", "button"]


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

    if entry.data.get(CONF_ENTRY_TYPE) == ENTRY_TYPE_GLOBAL:
        return True

    coordinator = PostenTrackingCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    hass.data[DOMAIN][entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await _async_register_services(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if entry.data.get(CONF_ENTRY_TYPE) == ENTRY_TYPE_GLOBAL:
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

    hass.services.async_register(DOMAIN, "add_parcel", add_parcel)
