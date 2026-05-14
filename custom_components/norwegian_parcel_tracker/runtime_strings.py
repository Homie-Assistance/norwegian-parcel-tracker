from __future__ import annotations

from homeassistant.core import HomeAssistant

_STRINGS: dict[str, dict[str, str]] = {
    "nb": {
        "pickup_not_available": "Hentested er ikke tilgjengelig for denne pakken",
        "notify_event_title": "Pakkeoppdatering",
        "notify_event_msg": "{sender}: {event}",
        "notify_delivered_title": "Pakken er levert",
        "notify_delivered_msg": "Pakken fra {sender} har ankommet {destination}.",
        "home_delivery_title": "Bestill hjemlevering",
        "home_delivery_msg": "[Klikk her for å bestille hjemlevering]({url})",
        "calendar_summary": "Pakke fra {sender}",
        "calendar_unknown": "Ukjent",
        "calendar_field_tracking": "Sporingsnummer",
        "calendar_field_sender": "Avsender",
        "calendar_field_status": "Status",
        "calendar_field_latest_event": "Siste hendelse",
        "calendar_field_last_seen": "Sist sett",
        "calendar_field_pickup": "Hentested",
        "calendar_field_delivery_method": "Leveringsmetode",
        "calendar_field_weight": "Vekt",
        "calendar_field_dimensions": "Mål",
    },
    "en": {
        "pickup_not_available": "Pickup not available for this parcel",
        "notify_event_title": "Parcel update",
        "notify_event_msg": "{sender}: {event}",
        "notify_delivered_title": "Parcel delivered",
        "notify_delivered_msg": "Your parcel from {sender} has arrived at {destination}.",
        "home_delivery_title": "Order home delivery",
        "home_delivery_msg": "[Click here to order home delivery]({url})",
        "calendar_summary": "Parcel from {sender}",
        "calendar_unknown": "Unknown",
        "calendar_field_tracking": "Tracking number",
        "calendar_field_sender": "Sender",
        "calendar_field_status": "Status",
        "calendar_field_latest_event": "Latest event",
        "calendar_field_last_seen": "Last seen",
        "calendar_field_pickup": "Pickup point",
        "calendar_field_delivery_method": "Delivery method",
        "calendar_field_weight": "Weight",
        "calendar_field_dimensions": "Dimensions",
    },
}


def _t(hass: HomeAssistant, key: str, **kwargs: object) -> str:
    """Return a translated runtime string for the HA system language, falling back to English."""
    lang = (hass.config.language or "en")[:2].lower()
    strings = _STRINGS.get(lang, _STRINGS["en"])
    template = strings.get(key, _STRINGS["en"].get(key, key))
    return template.format(**kwargs) if kwargs else template
