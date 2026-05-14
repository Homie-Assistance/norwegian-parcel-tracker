from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import PostenTrackingClient, PostenTrackingError
from .const import (
    CONF_CALENDAR_ENTITY,
    CONF_CREATE_CALENDAR_EVENT,
    CONF_DISPLAY_NAME,
    CONF_MAX_HEIGHT_CM,
    CONF_MAX_LENGTH_CM,
    CONF_MAX_WEIGHT_KG,
    CONF_MAX_WIDTH_CM,
    CONF_NOTIFY_ALL_EVENTS,
    CONF_NOTIFY_DELIVERED,
    CONF_NOTIFY_TARGET,
    CONF_STALE_CRITICAL_HOURS,
    CONF_STALE_WARNING_HOURS,
    CONF_TRACKING_NUMBER,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)


def _optional_with_default(key: str, default: Any, validator: Any) -> tuple[Any, Any]:
    """Return a voluptuous optional key without using invalid None defaults."""
    if default is None:
        return vol.Optional(key), validator
    return vol.Optional(key, default=default), validator


class NorwegianParcelTrackerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Norwegian parcel tracker."""

    VERSION = 1
    MINOR_VERSION = 4

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        """Handle the initial config step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            tracking_number = str(user_input[CONF_TRACKING_NUMBER]).strip()
            await self.async_set_unique_id(tracking_number.upper())
            self._abort_if_unique_id_configured()

            client = PostenTrackingClient(async_get_clientsession(self.hass))
            try:
                parcel = await client.async_get_tracking(tracking_number)
            except PostenTrackingError:
                errors["base"] = "cannot_connect"
            except Exception:
                _LOGGER.exception("Unexpected error validating tracking number")
                errors["base"] = "unknown"
            else:
                display_name = str(user_input.get(CONF_DISPLAY_NAME) or "").strip()
                title = display_name or parcel.sender_name or f"Posten {tracking_number}"
                return self.async_create_entry(
                    title=title,
                    data={
                        CONF_TRACKING_NUMBER: tracking_number,
                        CONF_DISPLAY_NAME: display_name,
                    },
                )

        schema = vol.Schema(
            {
                vol.Required(CONF_TRACKING_NUMBER): str,
                vol.Optional(CONF_DISPLAY_NAME): str,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry):
        """Create the options flow."""
        return NorwegianParcelTrackerOptionsFlow(config_entry)




def _notify_service_selector(hass) -> selector.SelectSelector:
    """Build a dropdown of available notify services.

    notify targets are services, not entities, so EntitySelector cannot be used.
    We still allow custom values because some notify integrations register late.
    """
    services = hass.services.async_services().get("notify", {})
    options = [
        selector.SelectOptionDict(value=f"notify.{service}", label=f"notify.{service}")
        for service in sorted(services)
    ]
    return selector.SelectSelector(
        selector.SelectSelectorConfig(
            options=options,
            mode=selector.SelectSelectorMode.DROPDOWN,
            custom_value=True,
        )
    )

class NorwegianParcelTrackerOptionsFlow(config_entries.OptionsFlow):
    """Handle options for Norwegian parcel tracker."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        # Do not assign to self.config_entry. In newer Home Assistant versions it is
        # a read-only property and assigning to it causes the 500 "config flow could
        # not be loaded" error.
        self._config_entry = config_entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        """Manage integration-wide options."""
        if user_input is not None:
            # Empty strings from optional text/entity fields should be stored as empty
            # values, not crash the flow. Numeric zero means "disabled/no threshold".
            return self.async_create_entry(title="", data=user_input)

        opts = dict(self._config_entry.options)

        schema_items: dict[Any, Any] = {}

        key, val = _optional_with_default(
            CONF_NOTIFY_TARGET,
            opts.get(CONF_NOTIFY_TARGET, ""),
            _notify_service_selector(self.hass),
        )
        schema_items[key] = val

        key, val = _optional_with_default(
            CONF_CALENDAR_ENTITY,
            opts.get(CONF_CALENDAR_ENTITY, ""),
            selector.EntitySelector(selector.EntitySelectorConfig(domain="calendar", multiple=False)),
        )
        schema_items[key] = val

        schema_items[vol.Optional(CONF_NOTIFY_ALL_EVENTS, default=opts.get(CONF_NOTIFY_ALL_EVENTS, False))] = bool
        schema_items[vol.Optional(CONF_NOTIFY_DELIVERED, default=opts.get(CONF_NOTIFY_DELIVERED, True))] = bool
        schema_items[vol.Optional(CONF_CREATE_CALENDAR_EVENT, default=opts.get(CONF_CREATE_CALENDAR_EVENT, False))] = bool

        number_box_hours = lambda max_value: selector.NumberSelector(
            selector.NumberSelectorConfig(
                min=0,
                max=max_value,
                step=1,
                unit_of_measurement="h",
                mode=selector.NumberSelectorMode.BOX,
            )
        )
        number_box_kg = selector.NumberSelector(
            selector.NumberSelectorConfig(
                min=0,
                max=100,
                step=0.1,
                unit_of_measurement="kg",
                mode=selector.NumberSelectorMode.BOX,
            )
        )
        number_box_cm = selector.NumberSelector(
            selector.NumberSelectorConfig(
                min=0,
                max=300,
                step=1,
                unit_of_measurement="cm",
                mode=selector.NumberSelectorMode.BOX,
            )
        )

        schema_items[vol.Optional(CONF_STALE_WARNING_HOURS, default=opts.get(CONF_STALE_WARNING_HOURS, 24))] = number_box_hours(240)
        schema_items[vol.Optional(CONF_STALE_CRITICAL_HOURS, default=opts.get(CONF_STALE_CRITICAL_HOURS, 72))] = number_box_hours(720)
        schema_items[vol.Optional(CONF_MAX_WEIGHT_KG, default=opts.get(CONF_MAX_WEIGHT_KG, 0))] = number_box_kg
        schema_items[vol.Optional(CONF_MAX_LENGTH_CM, default=opts.get(CONF_MAX_LENGTH_CM, 0))] = number_box_cm
        schema_items[vol.Optional(CONF_MAX_WIDTH_CM, default=opts.get(CONF_MAX_WIDTH_CM, 0))] = number_box_cm
        schema_items[vol.Optional(CONF_MAX_HEIGHT_CM, default=opts.get(CONF_MAX_HEIGHT_CM, 0))] = number_box_cm

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(schema_items),
            description_placeholders={
                "restart_note": (
                    "After changing notification or calendar settings, reload the "
                    "integration or restart Home Assistant if existing entities do "
                    "not update immediately."
                )
            },
        )
