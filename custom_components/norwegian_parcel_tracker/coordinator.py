from __future__ import annotations

from datetime import date, datetime, timedelta
import logging

from aiohttp import ClientSession
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import PostenTrackingClient, PostenTrackingError, ParcelData
from .const import (
    CONF_CALENDAR_ENTITY,
    CONF_CREATE_CALENDAR_EVENT,
    CONF_NOTIFY_ALL_EVENTS,
    CONF_NOTIFY_DELIVERED,
    CONF_NOTIFY_TARGET,
    CONF_TRACKING_NUMBER,
    DEFAULT_SCAN_INTERVAL_MINUTES,
    DOMAIN,
    PICKUP_NOT_AVAILABLE_NO,
)

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

    async def _async_update_data(self) -> ParcelData:
        try:
            parcel = await self.client.async_get_tracking(self.tracking_number)
        except PostenTrackingError as err:
            raise UpdateFailed(str(err)) from err

        await self._async_handle_side_effects(parcel)
        return parcel

    async def _async_handle_side_effects(self, parcel: ParcelData) -> None:
        """Create configured calendar events and notifications.

        This intentionally runs inside the coordinator so it also works for
        parcels added before the user configured global options.
        """
        options = self.entry.options or {}

        await self._async_create_calendar_event(parcel, options)
        await self._async_send_notifications(parcel, options)

    async def _async_create_calendar_event(self, parcel: ParcelData, options: dict) -> None:
        if not options.get(CONF_CREATE_CALENDAR_EVENT):
            return

        calendar_entity = options.get(CONF_CALENDAR_ENTITY)
        eta = parcel.estimated_delivery_iso
        if not calendar_entity or not eta:
            return

        # Avoid duplicate creates in the same runtime.
        calendar_key = f"{calendar_entity}:{eta}:{parcel.tracking_number}"
        if self._calendar_created_for == calendar_key:
            return

        try:
            start = date.fromisoformat(str(eta)[:10])
        except ValueError:
            _LOGGER.debug("Cannot create calendar event; invalid ETA %s for %s", eta, parcel.tracking_number)
            return

        end = start + timedelta(days=1)
        sender = parcel.sender_name or "pakke"
        summary = f"Pakke fra {sender}"
        pickup = parcel.pickup_name or PICKUP_NOT_AVAILABLE_NO
        latest = parcel.latest_event.description if parcel.latest_event else "Ukjent"
        location = parcel.latest_event.location if parcel.latest_event else "Ukjent"
        description = (
            f"Sporingsnummer: {parcel.tracking_number}\n"
            f"Avsender: {parcel.sender_name or 'Ukjent'}\n"
            f"Status: {parcel.status_description or parcel.current_status or 'Ukjent'}\n"
            f"Siste hendelse: {latest}\n"
            f"Sist sett: {location}\n"
            f"Hentested: {pickup}\n"
            f"Leveringsmetode: {parcel.delivery_method or parcel.product_name or 'Ukjent'}\n"
            f"Vekt: {parcel.weight_kg if parcel.weight_kg is not None else 'Ukjent'} kg\n"
            f"Mål: {parcel.length_cm or 'Ukjent'} × {parcel.width_cm or 'Ukjent'} × {parcel.height_cm or 'Ukjent'} cm"
        )

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
        """Return True if the configured calendar already contains this parcel ETA event.

        This prevents duplicate all-day events after Home Assistant restarts or
        integration reloads. Different calendar providers return slightly different
        response shapes, so the check is intentionally defensive.
        """
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
        notify_all = bool(options.get(CONF_NOTIFY_ALL_EVENTS))
        notify_delivered = bool(options.get(CONF_NOTIFY_DELIVERED, True))

        if not first_run and notify_all and (latest_key != self._last_event_key or status != self._last_status):
            await self._async_notify(
                target,
                "Pakkeoppdatering",
                f"{parcel.sender_name or parcel.tracking_number}: {latest.description if latest else status or 'Ny oppdatering'}",
            )

        if notify_delivered and parcel.is_delivered and not self._delivered_notified:
            destination = parcel.pickup_name or "postkassen eller døren"
            await self._async_notify(
                target,
                "Pakken er levert",
                f"Your package from {parcel.sender_name or 'unknown sender'} has arrived at {destination}.",
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
