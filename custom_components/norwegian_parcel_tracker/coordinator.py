from __future__ import annotations

from datetime import date, datetime, timedelta
import logging
from typing import Any

from aiohttp import ClientSession
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import PostenTrackingClient, PostenTrackingError, ParcelData
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
    CONF_LANGUAGE,
    CONF_MAILBOX_ENABLED, CONF_MAILBOX_H, CONF_MAILBOX_L, CONF_MAILBOX_W,
    CONF_NOTIFY_ALL_EVENTS,
    CONF_NOTIFY_DELIVERED,
    CONF_NOTIFY_TARGET,
    CONF_STALE_CRITICAL_HOURS,
    CONF_STALE_WARNING_HOURS,
    CONF_TRACKING_NUMBER,
    DEFAULT_SCAN_INTERVAL_MINUTES,
    DOMAIN,
    GLOBAL_ENTRY_UNIQUE_ID,
    LANGUAGE_ENGLISH,
    LANGUAGE_NORWEGIAN,
)
from .posten_translations import translate_parcel_data
from .runtime_strings import _t

_LOGGER = logging.getLogger(__name__)


class PostenTrackingCoordinator(DataUpdateCoordinator[ParcelData]):
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.entry = entry
        self.tracking_number = entry.data[CONF_TRACKING_NUMBER]
        session: ClientSession = async_get_clientsession(hass)
        self.client = PostenTrackingClient(session)
        self._last_event_key: tuple[str | None, str | None] | None = None
        self._last_status: str | None = None
        self._delivered_notified = False
        self._calendar_created_for: str | None = None
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{self.tracking_number}",
            update_interval=timedelta(minutes=DEFAULT_SCAN_INTERVAL_MINUTES),
            config_entry=entry,
        )

    def _get_global_options(self) -> dict[str, Any]:
        for entry in self.hass.config_entries.async_entries(DOMAIN):
            if entry.unique_id == GLOBAL_ENTRY_UNIQUE_ID:
                return dict(entry.options or {})
        return {}

    def _get_effective_options(self) -> dict[str, Any]:
        g = self._get_global_options()
        per_parcel = dict(self.entry.options or {})
        defaults: dict[str, Any] = {
            CONF_NOTIFY_TARGET: g.get(CONF_DEFAULT_NOTIFY_TARGET, ""),
            CONF_CALENDAR_ENTITY: g.get(CONF_DEFAULT_CALENDAR_ENTITY, ""),
            CONF_NOTIFY_ALL_EVENTS: g.get(CONF_DEFAULT_NOTIFY_ALL_EVENTS, False),
            CONF_NOTIFY_DELIVERED: g.get(CONF_DEFAULT_NOTIFY_DELIVERED, True),
            CONF_CREATE_CALENDAR_EVENT: g.get(CONF_DEFAULT_CREATE_CALENDAR_EVENT, False),
            CONF_STALE_WARNING_HOURS: g.get(CONF_DEFAULT_STALE_WARNING_HOURS, 24),
            CONF_STALE_CRITICAL_HOURS: g.get(CONF_DEFAULT_STALE_CRITICAL_HOURS, 72),
        }
        return {**defaults, **per_parcel}

    @property
    def fits_attributes(self) -> dict[str, Any]:
        global_opts = self._get_global_options()
        data = self.data
        if not data:
            return {}

        result: dict[str, Any] = {}
        parcel_dims = [data.length_cm, data.width_cm, data.height_cm]

        for ctx_name, enabled_key, l_key, w_key, h_key in [
            ("mailbox", CONF_MAILBOX_ENABLED, CONF_MAILBOX_L, CONF_MAILBOX_W, CONF_MAILBOX_H),
            ("car", CONF_CAR_ENABLED, CONF_CAR_L, CONF_CAR_W, CONF_CAR_H),
            ("carry", CONF_CARRY_ENABLED, CONF_CARRY_L, CONF_CARRY_W, CONF_CARRY_H),
        ]:
            if not global_opts.get(enabled_key):
                continue

            ctx_dims = [global_opts.get(l_key), global_opts.get(w_key), global_opts.get(h_key)]

            if None in parcel_dims or None in ctx_dims:
                result[f"fits_{ctx_name}"] = None
            else:
                p_sorted = sorted(float(d) for d in parcel_dims)  # type: ignore[arg-type]
                c_sorted = sorted(float(d) for d in ctx_dims)  # type: ignore[arg-type]
                result[f"fits_{ctx_name}"] = all(p <= c for p, c in zip(p_sorted, c_sorted))

        return result

    def _get_effective_language(self) -> str:
        """Return the language for Posten data, falling back to the HA system language."""
        global_opts = self._get_global_options()
        if CONF_LANGUAGE in global_opts:
            return global_opts[CONF_LANGUAGE]
        ha_lang = (self.hass.config.language or "nb")[:2].lower()
        return LANGUAGE_ENGLISH if ha_lang == "en" else LANGUAGE_NORWEGIAN

    async def _async_update_data(self) -> ParcelData:
        try:
            parcel = await self.client.async_get_tracking(self.tracking_number)
        except PostenTrackingError as err:
            raise UpdateFailed(str(err)) from err

        if self._get_effective_language() == LANGUAGE_ENGLISH:
            translate_parcel_data(parcel)

        await self._async_handle_side_effects(parcel)
        return parcel

    async def _async_handle_side_effects(self, parcel: ParcelData) -> None:
        options = self._get_effective_options()
        await self._async_create_calendar_event(parcel, options)
        await self._async_send_notifications(parcel, options)

    async def _async_create_calendar_event(self, parcel: ParcelData, options: dict) -> None:
        if not options.get(CONF_CREATE_CALENDAR_EVENT):
            return

        calendar_entity = options.get(CONF_CALENDAR_ENTITY)
        eta = parcel.estimated_delivery_iso
        if not calendar_entity or not eta:
            return

        calendar_key = f"{calendar_entity}:{eta}:{parcel.tracking_number}"
        if self._calendar_created_for == calendar_key:
            return

        try:
            start = date.fromisoformat(str(eta)[:10])
        except ValueError:
            _LOGGER.debug("Cannot create calendar event; invalid ETA %s for %s", eta, parcel.tracking_number)
            return

        end = start + timedelta(days=1)
        unk = _t(self.hass, "calendar_unknown")
        sender = parcel.sender_name or unk
        summary = _t(self.hass, "calendar_summary", sender=sender)
        pickup = parcel.pickup_name or _t(self.hass, "pickup_not_available")
        latest = parcel.latest_event.description if parcel.latest_event else unk
        location = parcel.latest_event.location if parcel.latest_event else unk

        description = "\n".join([
            f"{_t(self.hass, 'calendar_field_tracking')}: {parcel.tracking_number}",
            f"{_t(self.hass, 'calendar_field_sender')}: {parcel.sender_name or unk}",
            f"{_t(self.hass, 'calendar_field_status')}: {parcel.status_description or parcel.current_status or unk}",
            f"{_t(self.hass, 'calendar_field_latest_event')}: {latest}",
            f"{_t(self.hass, 'calendar_field_last_seen')}: {location}",
            f"{_t(self.hass, 'calendar_field_pickup')}: {pickup}",
            f"{_t(self.hass, 'calendar_field_delivery_method')}: {parcel.delivery_method or parcel.product_name or unk}",
            f"{_t(self.hass, 'calendar_field_weight')}: {parcel.weight_kg if parcel.weight_kg is not None else unk} kg",
            f"{_t(self.hass, 'calendar_field_dimensions')}: {parcel.length_cm or unk} × {parcel.width_cm or unk} × {parcel.height_cm or unk} cm",
        ])

        if await self._async_calendar_event_exists(calendar_entity, start, end, parcel.tracking_number, summary):
            self._calendar_created_for = calendar_key
            return

        try:
            await self.hass.services.async_call(
                "calendar",
                "create_event",
                service_data={
                    "summary": summary,
                    "description": description,
                    "start_date": start.isoformat(),
                    "end_date": end.isoformat(),
                },
                target={"entity_id": calendar_entity},
                blocking=True,
            )
        except Exception:
            _LOGGER.exception("Failed creating calendar event for %s in %s", parcel.tracking_number, calendar_entity)
            return

        self._calendar_created_for = calendar_key

    async def _async_calendar_event_exists(self, calendar_entity: str, start: date, end: date, tracking_number: str, summary: str) -> bool:
        try:
            response = await self.hass.services.async_call(
                "calendar",
                "get_events",
                service_data={
                    "start_date_time": f"{start.isoformat()} 00:00:00",
                    "end_date_time": f"{end.isoformat()} 00:00:00",
                },
                target={"entity_id": calendar_entity},
                blocking=True,
                return_response=True,
            )
        except Exception:
            _LOGGER.debug("Could not check existing calendar events for %s", calendar_entity, exc_info=True)
            return False

        candidates = []
        if isinstance(response, dict):
            entity_response = response.get(calendar_entity)
            if isinstance(entity_response, dict):
                candidates = entity_response.get("events") or []
            elif isinstance(entity_response, list):
                candidates = entity_response
            elif "events" in response:
                candidates = response.get("events") or []

        for event in candidates:
            if not isinstance(event, dict):
                continue
            event_summary = str(event.get("summary") or event.get("title") or "")
            event_description = str(event.get("description") or "")
            if tracking_number in event_description:
                return True
            if event_summary == summary and tracking_number in event_description:
                return True
        return False

    async def _async_send_notifications(self, parcel: ParcelData, options: dict) -> None:
        target = options.get(CONF_NOTIFY_TARGET)
        if not target or "." not in str(target):
            self._remember_state(parcel)
            return

        latest = parcel.latest_event
        latest_key = (latest.description if latest else None, latest.date_iso if latest else None)
        status = parcel.status_description or parcel.current_status or parcel.status

        first_run = self._last_event_key is None and self._last_status is None
        if first_run and parcel.is_delivered:
            self._delivered_notified = True

        notify_all = bool(options.get(CONF_NOTIFY_ALL_EVENTS))
        notify_delivered = bool(options.get(CONF_NOTIFY_DELIVERED, True))

        if not first_run and notify_all and (latest_key != self._last_event_key or status != self._last_status):
            await self._async_notify(
                target,
                _t(self.hass, "notify_event_title"),
                _t(self.hass, "notify_event_msg",
                   sender=parcel.sender_name or parcel.tracking_number,
                   event=latest.description if latest else status or _t(self.hass, "notify_event_title")),
            )

        if notify_delivered and parcel.is_delivered and not self._delivered_notified:
            destination = parcel.pickup_name or _t(self.hass, "pickup_not_available")
            await self._async_notify(
                target,
                _t(self.hass, "notify_delivered_title"),
                _t(self.hass, "notify_delivered_msg",
                   sender=parcel.sender_name or _t(self.hass, "calendar_unknown"),
                   destination=destination),
            )
            self._delivered_notified = True

        self._remember_state(parcel)

    def _remember_state(self, parcel: ParcelData) -> None:
        latest = parcel.latest_event
        self._last_event_key = (latest.description if latest else None, latest.date_iso if latest else None)
        self._last_status = parcel.status_description or parcel.current_status or parcel.status
        if parcel.is_delivered:
            self._delivered_notified = True

    async def _async_notify(self, target: str, title: str, message: str) -> None:
        try:
            domain, service = str(target).split(".", 1)
            await self.hass.services.async_call(
                domain,
                service,
                service_data={"title": title, "message": message},
                blocking=False,
            )
        except Exception:
            _LOGGER.exception("Failed sending notification through %s", target)
