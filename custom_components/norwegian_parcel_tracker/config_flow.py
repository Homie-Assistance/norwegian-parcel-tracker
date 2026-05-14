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
    CONF_CAR_ENABLED, CONF_CAR_H, CONF_CAR_L, CONF_CAR_W,
    CONF_CARRY_ENABLED, CONF_CARRY_H, CONF_CARRY_L, CONF_CARRY_W,
    CONF_CREATE_CALENDAR_EVENT,
    CONF_DEFAULT_CALENDAR_ENTITY,
    CONF_DEFAULT_CREATE_CALENDAR_EVENT,
    CONF_DEFAULT_NOTIFY_ALL_EVENTS,
    CONF_DEFAULT_NOTIFY_DELIVERED,
    CONF_DEFAULT_NOTIFY_TARGET,
    CONF_DEFAULT_STALE_CRITICAL_HOURS,
    CONF_DEFAULT_STALE_WARNING_HOURS,
    CONF_DISPLAY_NAME,
    CONF_ENTRY_TYPE,
    CONF_LANGUAGE,
    CONF_MAILBOX_ENABLED, CONF_MAILBOX_H, CONF_MAILBOX_L, CONF_MAILBOX_W,
    CONF_NOTIFY_ALL_EVENTS,
    CONF_NOTIFY_DELIVERED,
    CONF_NOTIFY_TARGET,
    CONF_STALE_CRITICAL_HOURS,
    CONF_STALE_WARNING_HOURS,
    CONF_TRACKING_NUMBER,
    DEFAULT_CAR_H, DEFAULT_CAR_L, DEFAULT_CAR_W,
    DEFAULT_CARRY_H, DEFAULT_CARRY_L, DEFAULT_CARRY_W,
    DEFAULT_MAILBOX_H, DEFAULT_MAILBOX_L, DEFAULT_MAILBOX_W,
    DOMAIN,
    ENTRY_TYPE_GLOBAL,
    ENTRY_TYPE_PARCEL,
    GLOBAL_ENTRY_UNIQUE_ID,
    LANGUAGE_ENGLISH,
    LANGUAGE_NORWEGIAN,
)

_LOGGER = logging.getLogger(__name__)


def _optional_with_default(key: str, default: Any, validator: Any) -> tuple[Any, Any]:
    if default is None:
        return vol.Optional(key), validator
    return vol.Optional(key, default=default), validator


def _number_cm(max_val: int) -> selector.NumberSelector:
    return selector.NumberSelector(
        selector.NumberSelectorConfig(
            min=0, max=max_val, step=1,
            unit_of_measurement="cm",
            mode=selector.NumberSelectorMode.BOX,
        )
    )


def _number_hours(max_val: int) -> selector.NumberSelector:
    return selector.NumberSelector(
        selector.NumberSelectorConfig(
            min=0, max=max_val, step=1,
            unit_of_measurement="h",
            mode=selector.NumberSelectorMode.BOX,
        )
    )


def _notify_service_selector(hass) -> selector.SelectSelector:
    services = hass.services.async_services().get("notify", {})
    options = [
        selector.SelectOptionDict(value=f"notify.{svc}", label=f"notify.{svc}")
        for svc in sorted(services)
    ]
    return selector.SelectSelector(
        selector.SelectSelectorConfig(
            options=options,
            mode=selector.SelectSelectorMode.DROPDOWN,
            custom_value=True,
        )
    )


def _build_global_schema(hass, opts: dict) -> vol.Schema:
    lang_selector = selector.SelectSelector(
        selector.SelectSelectorConfig(
            options=[
                selector.SelectOptionDict(value=LANGUAGE_NORWEGIAN, label="Norsk (Bokmål)"),
                selector.SelectOptionDict(value=LANGUAGE_ENGLISH, label="English"),
            ],
            mode=selector.SelectSelectorMode.DROPDOWN,
        )
    )
    entity_sel = selector.EntitySelector(
        selector.EntitySelectorConfig(domain="calendar", multiple=False)
    )
    notify_sel = _notify_service_selector(hass)

    schema_items: dict[Any, Any] = {
        vol.Optional(CONF_LANGUAGE, default=opts.get(CONF_LANGUAGE, LANGUAGE_NORWEGIAN)): lang_selector,
        # Mailbox
        vol.Optional(CONF_MAILBOX_ENABLED, default=bool(opts.get(CONF_MAILBOX_ENABLED, False))): bool,
        vol.Optional(CONF_MAILBOX_L, default=float(opts.get(CONF_MAILBOX_L, DEFAULT_MAILBOX_L))): _number_cm(100),
        vol.Optional(CONF_MAILBOX_W, default=float(opts.get(CONF_MAILBOX_W, DEFAULT_MAILBOX_W))): _number_cm(100),
        vol.Optional(CONF_MAILBOX_H, default=float(opts.get(CONF_MAILBOX_H, DEFAULT_MAILBOX_H))): _number_cm(100),
        # Car boot
        vol.Optional(CONF_CAR_ENABLED, default=bool(opts.get(CONF_CAR_ENABLED, False))): bool,
        vol.Optional(CONF_CAR_L, default=float(opts.get(CONF_CAR_L, DEFAULT_CAR_L))): _number_cm(300),
        vol.Optional(CONF_CAR_W, default=float(opts.get(CONF_CAR_W, DEFAULT_CAR_W))): _number_cm(300),
        vol.Optional(CONF_CAR_H, default=float(opts.get(CONF_CAR_H, DEFAULT_CAR_H))): _number_cm(300),
        # Carry by hand
        vol.Optional(CONF_CARRY_ENABLED, default=bool(opts.get(CONF_CARRY_ENABLED, False))): bool,
        vol.Optional(CONF_CARRY_L, default=float(opts.get(CONF_CARRY_L, DEFAULT_CARRY_L))): _number_cm(150),
        vol.Optional(CONF_CARRY_W, default=float(opts.get(CONF_CARRY_W, DEFAULT_CARRY_W))): _number_cm(150),
        vol.Optional(CONF_CARRY_H, default=float(opts.get(CONF_CARRY_H, DEFAULT_CARRY_H))): _number_cm(150),
        # Default notification/calendar settings
        vol.Optional(CONF_DEFAULT_NOTIFY_ALL_EVENTS, default=bool(opts.get(CONF_DEFAULT_NOTIFY_ALL_EVENTS, False))): bool,
        vol.Optional(CONF_DEFAULT_NOTIFY_DELIVERED, default=bool(opts.get(CONF_DEFAULT_NOTIFY_DELIVERED, True))): bool,
        vol.Optional(CONF_DEFAULT_CREATE_CALENDAR_EVENT, default=bool(opts.get(CONF_DEFAULT_CREATE_CALENDAR_EVENT, False))): bool,
        vol.Optional(CONF_DEFAULT_STALE_WARNING_HOURS, default=float(opts.get(CONF_DEFAULT_STALE_WARNING_HOURS, 24))): _number_hours(240),
        vol.Optional(CONF_DEFAULT_STALE_CRITICAL_HOURS, default=float(opts.get(CONF_DEFAULT_STALE_CRITICAL_HOURS, 72))): _number_hours(720),
    }

    notify_key, notify_val = _optional_with_default(
        CONF_DEFAULT_NOTIFY_TARGET, opts.get(CONF_DEFAULT_NOTIFY_TARGET) or None, notify_sel
    )
    schema_items[notify_key] = notify_val

    cal_key, cal_val = _optional_with_default(
        CONF_DEFAULT_CALENDAR_ENTITY, opts.get(CONF_DEFAULT_CALENDAR_ENTITY) or None, entity_sel
    )
    schema_items[cal_key] = cal_val

    return vol.Schema(schema_items)


class NorwegianParcelTrackerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1
    MINOR_VERSION = 4

    def __init__(self) -> None:
        super().__init__()
        self._global_setup_done = False

    def _has_global_entry(self) -> bool:
        return any(
            e.unique_id == GLOBAL_ENTRY_UNIQUE_ID
            for e in self.hass.config_entries.async_entries(DOMAIN)
        )

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        # Programmatic call from add_parcel service passes tracking data directly
        if user_input and CONF_TRACKING_NUMBER in user_input:
            return await self._async_validate_parcel(user_input)
        # First-time setup: show global settings before the parcel form
        if not self._global_setup_done and not self._has_global_entry():
            return await self.async_step_global()
        return await self._async_show_parcel_form()

    async def async_step_global(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            self._global_setup_done = True
            self.hass.async_create_task(
                self.hass.config_entries.flow.async_init(
                    DOMAIN,
                    context={"source": "create_global"},
                    data=user_input,
                )
            )
            return await self._async_show_parcel_form()

        # Auto-detect a sensible default language from the HA system language
        default_lang = (
            LANGUAGE_ENGLISH
            if (self.hass.config.language or "nb")[:2].lower() == "en"
            else LANGUAGE_NORWEGIAN
        )
        schema = _build_global_schema(self.hass, {CONF_LANGUAGE: default_lang})
        return self.async_show_form(step_id="global", data_schema=schema)

    async def async_step_create_global(self, user_input: dict[str, Any] | None = None):
        await self.async_set_unique_id(GLOBAL_ENTRY_UNIQUE_ID)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(
            title="Norwegian Parcel Tracker — Settings",
            data={CONF_ENTRY_TYPE: ENTRY_TYPE_GLOBAL},
            options=user_input or {},
        )

    async def _async_show_parcel_form(self, errors: dict | None = None):
        schema = vol.Schema({
            vol.Required(CONF_TRACKING_NUMBER): str,
            vol.Optional(CONF_DISPLAY_NAME): str,
        })
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors or {})

    async def _async_validate_parcel(self, user_input: dict[str, Any]):
        errors: dict[str, str] = {}
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
                    CONF_ENTRY_TYPE: ENTRY_TYPE_PARCEL,
                },
            )

        return await self._async_show_parcel_form(errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry):
        if config_entry.data.get(CONF_ENTRY_TYPE) == ENTRY_TYPE_GLOBAL:
            return NorwegianParcelTrackerGlobalOptionsFlow(config_entry)
        return NorwegianParcelTrackerOptionsFlow(config_entry)


class NorwegianParcelTrackerGlobalOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        self._config_entry = config_entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        return await self.async_step_global_settings(user_input)

    async def async_step_global_settings(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)
        opts = dict(self._config_entry.options)
        schema = _build_global_schema(self.hass, opts)
        return self.async_show_form(step_id="global_settings", data_schema=schema)


class NorwegianParcelTrackerOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        self._config_entry = config_entry

    def _get_global_options(self) -> dict:
        for entry in self.hass.config_entries.async_entries(DOMAIN):
            if entry.unique_id == GLOBAL_ENTRY_UNIQUE_ID:
                return dict(entry.options or {})
        return {}

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        opts = dict(self._config_entry.options)
        g = self._get_global_options()

        # Pre-fill with per-parcel saved values, falling back to global defaults
        eff_notify = opts.get(CONF_NOTIFY_TARGET) or g.get(CONF_DEFAULT_NOTIFY_TARGET)
        eff_calendar = opts.get(CONF_CALENDAR_ENTITY) or g.get(CONF_DEFAULT_CALENDAR_ENTITY)
        eff_notify_all = opts.get(CONF_NOTIFY_ALL_EVENTS, g.get(CONF_DEFAULT_NOTIFY_ALL_EVENTS, False))
        eff_notify_del = opts.get(CONF_NOTIFY_DELIVERED, g.get(CONF_DEFAULT_NOTIFY_DELIVERED, True))
        eff_create_cal = opts.get(CONF_CREATE_CALENDAR_EVENT, g.get(CONF_DEFAULT_CREATE_CALENDAR_EVENT, False))
        eff_warn = opts.get(CONF_STALE_WARNING_HOURS, g.get(CONF_DEFAULT_STALE_WARNING_HOURS, 24))
        eff_crit = opts.get(CONF_STALE_CRITICAL_HOURS, g.get(CONF_DEFAULT_STALE_CRITICAL_HOURS, 72))

        schema_items: dict[Any, Any] = {}

        notify_key, notify_val = _optional_with_default(
            CONF_NOTIFY_TARGET, eff_notify or None, _notify_service_selector(self.hass)
        )
        schema_items[notify_key] = notify_val

        cal_key, cal_val = _optional_with_default(
            CONF_CALENDAR_ENTITY, eff_calendar or None,
            selector.EntitySelector(selector.EntitySelectorConfig(domain="calendar", multiple=False)),
        )
        schema_items[cal_key] = cal_val

        schema_items[vol.Optional(CONF_NOTIFY_ALL_EVENTS, default=bool(eff_notify_all))] = bool
        schema_items[vol.Optional(CONF_NOTIFY_DELIVERED, default=bool(eff_notify_del))] = bool
        schema_items[vol.Optional(CONF_CREATE_CALENDAR_EVENT, default=bool(eff_create_cal))] = bool
        schema_items[vol.Optional(CONF_STALE_WARNING_HOURS, default=float(eff_warn))] = _number_hours(240)
        schema_items[vol.Optional(CONF_STALE_CRITICAL_HOURS, default=float(eff_crit))] = _number_hours(720)

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
