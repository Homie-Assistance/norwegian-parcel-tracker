from __future__ import annotations

import html
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import aiohttp

from .const import PICKUP_NOT_AVAILABLE_NO

_LOGGER = logging.getLogger(__name__)


class PostenTrackingError(Exception):
    """Raised when tracking data cannot be fetched or parsed."""


@dataclass
class ParcelEvent:
    description: str | None = None
    date_iso: str | None = None
    location: str | None = None
    status: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class ParcelData:
    tracking_number: str
    consignment_id: str | None = None
    sender_name: str | None = None
    sender_reference: str | None = None
    status: str | None = None
    status_description: str | None = None
    current_status: str | None = None
    product_name: str | None = None
    product_code: str | None = None
    estimated_delivery: str | None = None
    estimated_delivery_iso: str | None = None
    pickup_name: str | None = None
    pickup_url: str | None = None
    delivery_address: str | None = None
    delivery_method: str | None = None
    weight_kg: float | None = None
    length_cm: float | None = None
    width_cm: float | None = None
    height_cm: float | None = None
    home_delivery_url: str | None = None
    events: list[ParcelEvent] = field(default_factory=list)

    @property
    def latest_event(self) -> ParcelEvent | None:
        return self.events[0] if self.events else None

    @property
    def is_delivered(self) -> bool:
        text = " ".join(
            str(x or "")
            for x in [
                self.status_description,
                self.current_status,
                self.latest_event.description if self.latest_event else None,
            ]
        ).lower()
        return "pakken er levert" in text or "delivered" in text or self.current_status == "DELIVERED"

    @property
    def pickup_display(self) -> str:
        return self.pickup_name or PICKUP_NOT_AVAILABLE_NO

    def as_dict(self) -> dict[str, Any]:
        latest = self.latest_event
        return {
            "tracking_number": self.tracking_number,
            "consignment_id": self.consignment_id,
            "sender_name": self.sender_name,
            "sender_reference": self.sender_reference,
            "status": self.status_description or self.current_status or self.status,
            "status_code": self.current_status,
            "product_name": self.product_name,
            "product_code": self.product_code,
            "estimated_delivery": self.estimated_delivery,
            "estimated_delivery_iso": self.estimated_delivery_iso,
            "pickup_name": self.pickup_name,
            "pickup_display": self.pickup_display,
            "pickup_url": self.pickup_url,
            "delivery_address": self.delivery_address,
            "delivery_method": self.delivery_method,
            "weight_kg": self.weight_kg,
            "length_cm": self.length_cm,
            "width_cm": self.width_cm,
            "height_cm": self.height_cm,
            "home_delivery_url": self.home_delivery_url,
            "latest_event": latest.description if latest else None,
            "latest_event_time": latest.date_iso if latest else None,
            "latest_event_location": latest.location if latest else None,
            "is_delivered": self.is_delivered,
            "events": [
                {
                    "description": e.description,
                    "date_iso": e.date_iso,
                    "location": e.location,
                    "status": e.status,
                }
                for e in self.events
            ],
        }


class PostenTrackingClient:
    def __init__(self, session: aiohttp.ClientSession) -> None:
        self._session = session

    async def async_get_tracking(self, tracking_number: str) -> ParcelData:
        url = f"https://sporing.posten.no/sporing/{tracking_number}"
        headers = {
            "User-Agent": "Mozilla/5.0 HomeAssistant NorwegianParcelTracker/0.1.3",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "no,en;q=0.8",
        }
        async with self._session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=25)) as resp:
            text = await resp.text()
            if resp.status >= 400:
                raise PostenTrackingError(f"Posten returned HTTP {resp.status}")
        return parse_tracking_html(text, tracking_number)


def parse_tracking_html(text: str, tracking_number: str) -> ParcelData:
    data = _parse_react_router_stream(text)
    if data:
        parcel = _parcel_from_router_data(data, tracking_number)
        if parcel:
            _patch_parcel_from_raw_stream(parcel, text)
            return parcel
    parcel = _parcel_from_html_fallback(text, tracking_number)
    if parcel:
        _patch_parcel_from_raw_stream(parcel, text)
        return parcel
    raise PostenTrackingError("Could not fetch tracking data")


def _parse_react_router_stream(text: str) -> Any | None:
    # React Router stream data arrives in script calls like:
    # window.__reactRouterContext.streamController.enqueue("...[escaped JSON]...")
    chunks: list[str] = []
    for match in re.finditer(r'streamController\.enqueue\("((?:\\.|[^"\\])*)"\)', text, re.S):
        try:
            chunks.append(bytes(match.group(1), "utf-8").decode("unicode_escape"))
        except Exception:
            continue

    if not chunks:
        return None

    for chunk in chunks:
        first = chunk.strip()
        if not first.startswith("["):
            continue
        try:
            encoded = json.loads(first)
            return _decode_react_flight(encoded)
        except Exception as err:
            _LOGGER.debug("Failed decoding React Router stream chunk: %s", err)
            continue
    return None


def _decode_react_flight(value: Any) -> Any:
    # Posten currently serializes loader data as a React Flight array with string refs.
    # This decoder resolves references like "_1" to array positions and supports dict pairs.
    if not isinstance(value, list):
        return value

    memo = {}

    def resolve(v: Any) -> Any:
        if isinstance(v, str) and re.fullmatch(r"_\d+", v):
            idx = int(v[1:])
            if idx in memo:
                return memo[idx]
            if 0 <= idx < len(value):
                memo[idx] = None
                memo[idx] = resolve(value[idx])
                return memo[idx]
        if isinstance(v, list):
            return [resolve(x) for x in v]
        if isinstance(v, dict):
            return {resolve(k): resolve(val) for k, val in v.items()}
        return v

    decoded = resolve(value)

    # Some objects are encoded as ["key", value, "key2", value2]. Convert obvious top-level pairs.
    def pairs_to_dict(obj: Any) -> Any:
        if isinstance(obj, list):
            if len(obj) % 2 == 0 and all(isinstance(obj[i], str) for i in range(0, len(obj), 2)):
                return {obj[i]: pairs_to_dict(obj[i + 1]) for i in range(0, len(obj), 2)}
            return [pairs_to_dict(x) for x in obj]
        if isinstance(obj, dict):
            return {k: pairs_to_dict(v) for k, v in obj.items()}
        return obj

    return pairs_to_dict(decoded)


def _find_key(obj: Any, key: str) -> Any:
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            found = _find_key(v, key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = _find_key(v, key)
            if found is not None:
                return found
    return None


def _parcel_from_router_data(data: Any, tracking_number: str) -> ParcelData | None:
    consignment = _find_key(data, "consignment")
    if not isinstance(consignment, dict):
        return None

    packages = consignment.get("packageSet") or []
    package = packages[0] if packages and isinstance(packages[0], dict) else {}

    latest = package.get("latestSignificantEvent") or {}
    events_raw = package.get("eventSet") or []
    events: list[ParcelEvent] = []
    for ev in events_raw:
        if not isinstance(ev, dict):
            continue
        loc = _format_location(ev)
        events.append(ParcelEvent(
            description=ev.get("description"),
            date_iso=ev.get("dateIso"),
            location=loc,
            status=ev.get("status"),
            raw=ev,
        ))

    if latest and not any(e.date_iso == latest.get("dateIso") and e.description == latest.get("description") for e in events):
        events.insert(0, ParcelEvent(
            description=latest.get("description"),
            date_iso=latest.get("dateIso"),
            location=_format_location(latest),
            status=latest.get("status"),
            raw=latest,
        ))

    events.sort(key=lambda e: e.date_iso or "", reverse=True)

    actions = _find_key(data, "ORDER_HOME_DELIVERY")
    home_delivery_url = None
    if isinstance(actions, dict):
        home_delivery_url = actions.get("url") or actions.get("linkInformation")
    elif isinstance(actions, str) and actions.startswith("http"):
        home_delivery_url = actions

    return ParcelData(
        tracking_number=tracking_number,
        consignment_id=consignment.get("consignmentId"),
        sender_name=consignment.get("senderName"),
        sender_reference=consignment.get("senderReference"),
        status_description=package.get("statusDescription"),
        current_status=package.get("currentStatus"),
        product_name=package.get("productName"),
        product_code=package.get("productCode"),
        estimated_delivery=_sanitize_estimated_delivery(package.get("dateOfEstimatedDelivery")),
        estimated_delivery_iso=_sanitize_estimated_delivery(package.get("dateOfEstimatedDeliveryIso"), iso=True),
        pickup_name=_sanitize_pickup_name(package.get("expectedPickupUnitName")),
        pickup_url=package.get("expectedPickupUnitURL"),
        delivery_address=_address_text(package.get("recipientAddress") or consignment.get("recipientAddress")),
        delivery_method=package.get("productName"),
        weight_kg=_to_float(package.get("weightInKgs")),
        length_cm=_to_float(package.get("lengthInCm")),
        width_cm=_to_float(package.get("widthInCm")),
        height_cm=_to_float(package.get("heightInCm")),
        home_delivery_url=home_delivery_url,
        events=events,
    )


def _format_location(ev: dict[str, Any]) -> str | None:
    parts = [ev.get("postalCode"), ev.get("city")]
    text = " ".join(str(p).strip() for p in parts if p)
    return text.title() if text else None


def _address_text(address: Any) -> str | None:
    if not isinstance(address, dict):
        return None
    parts = [address.get("postalCode"), address.get("city"), address.get("countryCode")]
    text = " ".join(str(p).strip() for p in parts if p)
    return text or None


def _to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", "."))
    except ValueError:
        return None




def _looks_like_internal_key(value: Any) -> bool:
    """Return True for React/Transmodel field names that are not user-facing values."""
    if value in (None, ""):
        return False
    text = str(value).strip()
    known_bad = {
        "estimatedTimeSpanOfDelivery",
        "EstimatedTimeSpanOfDelivery",
        "parcelLockerInfoBoxType",
        "fossilFreeType",
        "latestSignificantEvent",
    }
    if text in known_bad:
        return True
    # Values such as "estimatedTimeSpanOfDelivery" are field names accidentally
    # captured as values when a parcel no longer has an ETA. They are usually
    # camelCase identifiers with no spaces, punctuation or digits.
    return bool(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", text)) and not any(ch.isdigit() for ch in text)


def _sanitize_estimated_delivery(value: Any, *, iso: bool = False) -> str | None:
    """Normalize ETA values and reject internal field-name placeholders."""
    if value in (None, ""):
        return None
    text = str(value).strip()
    if _looks_like_internal_key(text):
        return None
    if iso and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text[:10]):
        return None
    return text





def _sanitize_pickup_name(value: Any) -> str | None:
    """Normalize pickup point names and reject internal field-name placeholders."""
    if value in (None, ""):
        return None
    text = html.unescape(str(value)).strip()
    if not text:
        return None
    # Keep in sync with _cleanPickup in norwegian-parcel-tracker-card
    known_bad = {
        "expectedPickupUnitURL",
        "expectedPickupUnitUrl",
        "expectedPickupUnitId",
        "expectedPickupUnitName",
        "pickupPointInfo",
        "pickup-point",
        "Pickup not available",
        "Unknown",
        "unknown",
    }
    if text in known_bad:
        return None
    if text.startswith("http://") or text.startswith("https://"):
        return None
    if _looks_like_internal_key(text):
        return None
    return text


def _extract_stream_text(text: str) -> str:
    """Return decoded React Router stream chunks as plain text.

    We use this as a safety net for numeric values like dimensions/weight.
    Posten's React Flight payload mixes references and real numbers, so a full
    generic decoder can accidentally treat dimensions as references. Regexing the
    decoded stream for known keys is safer for these scalar fields.
    """
    chunks = re.findall(r'streamController\.enqueue\("((?:\\.|[^"\\])*)"\)', text, re.S)
    out: list[str] = []
    for chunk in chunks:
        try:
            out.append(json.loads(f'"{chunk}"'))
        except Exception:
            try:
                out.append(bytes(chunk, "utf-8").decode("unicode_escape", "ignore"))
            except Exception:
                out.append(chunk)
    return "\n".join(out)


def _stream_string(stream: str, key: str) -> str | None:
    if not stream:
        return None
    m = re.search(rf'"{re.escape(key)}"\s*,\s*"([^"]*)"', stream)
    if not m:
        return None
    return html.unescape(m.group(1)).strip() or None


def _stream_number(stream: str, key: str) -> float | None:
    if not stream:
        return None
    m = re.search(rf'"{re.escape(key)}"\s*,\s*(-?\d+(?:\.\d+)?)', stream)
    if not m:
        return None
    return _to_float(m.group(1))


def _patch_parcel_from_raw_stream(parcel: ParcelData, text: str) -> None:
    """Patch fields that are known to be present in Posten's raw stream.

    This restores dimensions/weight and other scalar fields even if the generic
    React Flight decoder cannot safely distinguish numeric references from real
    numeric values.
    """
    stream = _extract_stream_text(text)
    if not stream:
        return

    parcel.sender_name = parcel.sender_name or _stream_string(stream, "senderName")
    parcel.sender_reference = parcel.sender_reference or _stream_string(stream, "senderReference")
    parcel.consignment_id = parcel.consignment_id or _stream_string(stream, "consignmentId")
    parcel.current_status = parcel.current_status or _stream_string(stream, "currentStatus")
    parcel.status_description = parcel.status_description or _stream_string(stream, "statusDescription")
    parcel.product_name = parcel.product_name or _stream_string(stream, "productName")
    parcel.product_code = parcel.product_code or _stream_string(stream, "productCode")
    parcel.estimated_delivery = parcel.estimated_delivery or _sanitize_estimated_delivery(_stream_string(stream, "dateOfEstimatedDelivery"))
    parcel.estimated_delivery_iso = parcel.estimated_delivery_iso or _sanitize_estimated_delivery(_stream_string(stream, "dateOfEstimatedDeliveryIso"), iso=True)
    parcel.pickup_name = parcel.pickup_name or _sanitize_pickup_name(_stream_string(stream, "expectedPickupUnitName"))
    parcel.pickup_url = parcel.pickup_url or _stream_string(stream, "expectedPickupUnitURL")
    parcel.delivery_method = parcel.delivery_method or parcel.product_name

    if parcel.weight_kg is None:
        parcel.weight_kg = _stream_number(stream, "weightInKgs")
    if parcel.length_cm is None:
        parcel.length_cm = _stream_number(stream, "lengthInCm")
    if parcel.width_cm is None:
        parcel.width_cm = _stream_number(stream, "widthInCm")
    if parcel.height_cm is None:
        parcel.height_cm = _stream_number(stream, "heightInCm")

    parcel.estimated_delivery = _sanitize_estimated_delivery(parcel.estimated_delivery)
    parcel.estimated_delivery_iso = _sanitize_estimated_delivery(parcel.estimated_delivery_iso, iso=True)
    parcel.pickup_name = _sanitize_pickup_name(parcel.pickup_name)

    if not parcel.home_delivery_url:
        m = re.search(r'https://sending\.posten\.no/hjemlevering/[^"\\\s]+', stream)
        if m:
            parcel.home_delivery_url = m.group(0)


def _parcel_from_html_fallback(text: str, tracking_number: str) -> ParcelData | None:
    def tid(testid: str) -> str | None:
        m = re.search(rf'data-testid="{re.escape(testid)}"[^>]*>(.*?)</', text, re.S)
        if not m:
            return None
        clean = re.sub(r"<[^>]+>", " ", m.group(1))
        return html.unescape(re.sub(r"\s+", " ", clean)).strip() or None

    sender = tid("trackingnumber-sender-summary")
    status = tid("parcel-status-heading")
    latest = None
    m = re.search(r'<div class="hds-styled-html !text-body-title">(.*?)</div>\s*<p[^>]*>(.*?)</p>(?:\s*<p[^>]*data-testid="parcel-history-event-location">(.*?)</p>)?', text, re.S)
    if m:
        latest = ParcelEvent(
            description=html.unescape(re.sub(r"<[^>]+>", " ", m.group(1))).strip(),
            date_iso=None,
            location=html.unescape(re.sub(r"<[^>]+>", " ", m.group(3) or "")).strip() or None,
        )

    if not any([sender, status, latest]):
        return None

    return ParcelData(
        tracking_number=tracking_number,
        sender_name=sender,
        status_description=status,
        events=[latest] if latest else [],
        estimated_delivery=_sanitize_estimated_delivery(tid("parcel-estimated-delivery-info")),
        pickup_name=_sanitize_pickup_name(tid("pickup-point-link")),
        delivery_address=tid("parcel-details-delivery-address"),
        delivery_method=tid("parcel-details-delivery-method"),
    )
