"""Best-effort Norwegian → English lookup tables for Posten/Bring data fields.

Posten does not provide an English API. This module maps the finite set of
machine-readable status codes and the most common human-readable Norwegian
strings to English equivalents. Unknown strings pass through unchanged.
"""
from __future__ import annotations

from .api import ParcelData

# currentStatus codes are already English-ish identifiers from Posten's API.
# Map them to clean English sentences.
_STATUS_CODES: dict[str, str] = {
    "DELIVERED": "Delivered",
    "IN_TRANSIT": "In transit",
    "NOTIFICATION_SENT": "Ready for pickup — notification sent",
    "READY_FOR_PICKUP": "Ready for pickup",
    "ATTEMPTED_DELIVERY": "Delivery attempted",
    "LOADED_FOR_DELIVERY": "Out for delivery",
    "CUSTOMS": "In customs",
    "AT_CUSTOMS": "In customs",
    "RETURNED": "Returned to sender",
    "RETURN_IN_TRANSIT": "Return in transit",
    "EXPIRED": "Pickup deadline expired",
    "CANCELLED": "Cancelled",
    "AWAITING_SENDER": "Waiting for sender",
    "UNKNOWN": "Status unknown",
}

# statusDescription — human-readable Norwegian prose from Posten.
_STATUS_DESCRIPTIONS: dict[str, str] = {
    "Pakken er levert": "The parcel has been delivered",
    "Pakke levert i postkassen": "Parcel delivered to mailbox",
    "Pakken er klar til henting": "The parcel is ready for pickup",
    "Klar til henting": "Ready for pickup",
    "Pakken er på vei": "The parcel is on its way",
    "Pakken er i transit": "The parcel is in transit",
    "I transit": "In transit",
    "Pakken er i tollen": "The parcel is in customs",
    "Tollbehandling pågår": "Customs clearance in progress",
    "Tollbehandling fullført": "Customs clearance completed",
    "Pakken er returnert til avsender": "The parcel has been returned to sender",
    "Pakken er returnert": "Parcel returned",
    "Pakken er ikke hentet i tide": "The parcel was not picked up in time",
    "Pakken er ikke hentet": "The parcel was not picked up",
    "Leveringsforsøk": "Delivery attempted",
    "Forsøkt levert": "Delivery attempted",
    "Varsel sendt": "Notification sent",
    "Varsel sendt, klar til henting": "Notification sent — ready for pickup",
    "Pakken er lastet for levering": "Loaded for delivery",
    "Pakken er hos tollvesenet": "The parcel is with customs",
}

# eventSet[].description — free-form per-event Norwegian text from Posten.
_EVENT_DESCRIPTIONS: dict[str, str] = {
    "Pakken er levert": "Parcel delivered",
    "Pakke levert i postkassen": "Delivered to mailbox",
    "Utlevert til mottaker": "Delivered to recipient",
    "Pakken er sortert": "Parcel sorted",
    "Pakken er mottatt": "Parcel received",
    "Pakken er registrert": "Parcel registered",
    "Pakken er innlevert": "Parcel handed in",
    "Pakken er ankommet til utleveringssted": "Arrived at pickup location",
    "Pakken er klar til henting": "Ready for pickup",
    "Varsel sendt til mottaker": "Notification sent to recipient",
    "Pakken er i transit": "In transit",
    "Pakken er lastet for levering": "Loaded for delivery",
    "Pakken forlater landet": "Parcel leaving the country",
    "Pakken har ankommet landet": "Parcel arrived in the country",
    "Tollbehandling pågår": "Customs clearance in progress",
    "Tollbehandling fullført": "Customs clearance completed",
    "Pakken er returnert": "Parcel returned",
    "Pakken er returnert til avsender": "Returned to sender",
    "Forsøkt levert": "Delivery attempted",
    "Pakken er videresendt": "Parcel forwarded",
    "Pakken er skadet": "Parcel damaged",
    "Pakken er ikke funnet": "Parcel not found",
    "Lagt i postkassen": "Left in mailbox",
}


def translate_parcel_data(parcel: ParcelData) -> None:
    """Translate Norwegian Posten data fields to English in-place.

    Fields that have no mapping pass through unchanged (they are still
    Norwegian — this is expected and documented behaviour).
    """
    if parcel.status_description:
        parcel.status_description = _STATUS_DESCRIPTIONS.get(
            parcel.status_description, parcel.status_description
        )
    elif parcel.current_status and parcel.current_status in _STATUS_CODES:
        parcel.status_description = _STATUS_CODES[parcel.current_status]

    for event in parcel.events:
        if event.description:
            event.description = _EVENT_DESCRIPTIONS.get(
                event.description, event.description
            )
