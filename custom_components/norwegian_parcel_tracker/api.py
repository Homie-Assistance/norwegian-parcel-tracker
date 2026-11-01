from __future__ import annotations

import html
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import aiohttp


_LOGGER = logging.getLogger(__name__)


class PostenTrackingError(Exception):
    """Raised when tracking data cannot be fetched or parsed."""


class HelthjemTrackingError(Exception):
    """Raised when Helthjem tracking data cannot be fetched or parsed."""


class CaiNiaoTrackingError(Exception):
    """Raised when Cainiao tracking data cannot be fetched or parsed."""


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
    status_authoritative: bool = False

    @property
    def latest_event(self) -> ParcelEvent | None:
        return self.events[0] if self.events else None

    @property
    def is_delivered(self) -> bool:
        if self.status_authoritative:
            return self.current_status in {"DELIVERED", "PICKED_UP"}
        text = " ".join(
            str(x or "")
            for x in [
                self.status_description,
                self.current_status,
                self.latest_event.description if self.latest_event else None,
            ]
        ).lower()
        return (
            "pakken er levert" in text
            or ("delivered" in text and "undelivered" not in text)
            or "hentet pakken" in text
            or self.current_status in {"DELIVERED", "PICKED_UP"}
        )

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


_HELTHJEM_GRAPHQL_URL = "https://services.helthjem.no/graphql"
_HELTHJEM_QUERY = """
query GetParcelTracking($ref: String!) {
  getParcelTrackingDetails(parcelReference: $ref) {
    parcelReference
    status
    estimatedDelivery { date }
    deliveryPoint { postalCode type }
    sender { postalCode }
    events {
      id
      createdAt
      status
      location
      message { description content }
    }
  }
}
"""


class HelthjemTrackingClient:
    def __init__(self, session: aiohttp.ClientSession) -> None:
        self._session = session

    async def async_get_tracking(self, tracking_number: str) -> ParcelData:
        headers = {
            "Content-Type": "application/json",
            "Origin": "https://helthjem.no",
            "Referer": "https://helthjem.no/sporing/",
        }
        payload = {"query": _HELTHJEM_QUERY, "variables": {"ref": tracking_number}}
        async with self._session.post(
            _HELTHJEM_GRAPHQL_URL,
            json=payload,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=25),
        ) as resp:
            if resp.status >= 400:
                raise HelthjemTrackingError(f"Helthjem returned HTTP {resp.status}")
            body = await resp.json()

        if "errors" in body:
            raise HelthjemTrackingError(f"Helthjem GraphQL error: {body['errors']}")

        data = (body.get("data") or {}).get("getParcelTrackingDetails")
        if not data:
            raise HelthjemTrackingError("No tracking data returned from Helthjem")

        return _parcel_from_helthjem(data, tracking_number)


def _parcel_from_helthjem(data: dict[str, Any], tracking_number: str) -> ParcelData:
    events: list[ParcelEvent] = []
    for ev in (data.get("events") or []):
        msg = ev.get("message") or {}
        description = msg.get("content") or msg.get("description") or ev.get("status")
        events.append(ParcelEvent(
            description=description,
            date_iso=ev.get("createdAt"),
            location=ev.get("location"),
            status=ev.get("status"),
            raw=ev,
        ))
    events.sort(key=lambda e: e.date_iso or "", reverse=True)

    delivery_point = data.get("deliveryPoint") or {}
    estimated = (data.get("estimatedDelivery") or {}).get("date")

    pickup_name = None
    if delivery_point.get("postalCode"):
        pickup_name = delivery_point["postalCode"]

    latest = events[0] if events else None

    return ParcelData(
        tracking_number=tracking_number,
        current_status=data.get("status"),
        status_description=latest.description if latest else data.get("status"),
        estimated_delivery=estimated,
        estimated_delivery_iso=estimated,
        pickup_name=pickup_name,
        delivery_method="Helthjem",
        events=events,
    )


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
    # Require a camelCase transition (lowercase→uppercase) to distinguish field names
    # from ordinary Title-case words like city names (e.g. "Trondheim").
    return bool(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", text)) and bool(re.search(r"[a-z][A-Z]", text))


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


# ── Cainiao / AliExpress direct tracking ────────────────────────────────────────

_CAINIAO_API = "https://global.cainiao.com/global/detail.json"

# Cainiao action code → internal status string (same vocabulary as Posten statuses)
# Source: cross-checked against ha-parcel-integrations/ha-cainiao and live endpoint responses.
_CAINIAO_ACTION_STATUS: dict[str, str] = {
    # Pre-shipment
    "GWMS_ACCEPT": "REGISTERED",
    "GWMS_PACKAGE": "REGISTERED",
    "PRE_READY_TO_SHIP": "REGISTERED",
    "CONSIGN": "REGISTERED",
    # In transit — warehouse, sorting, line haul, transit depots
    "CW_INBOUND": "IN_TRANSIT",
    "CW_OUTBOUND": "IN_TRANSIT",
    "CW_COMMON_PROCESSING1": "IN_TRANSIT",
    "PU_PICKUP_SUCCESS": "IN_TRANSIT",
    "GWMS_OUTBOUND": "IN_TRANSIT",
    "SC_INBOUND_SUCCESS": "IN_TRANSIT",
    "SC_OUTBOUND_SUCCESS": "IN_TRANSIT",
    "SC_TRANS_INBOUND_SUCCESS": "IN_TRANSIT",
    "SC_TRANS_OUTBOUND_SUCCESS": "IN_TRANSIT",
    "CC_EX_START": "IN_TRANSIT",
    "CC_EX_SUCCESS": "IN_TRANSIT",
    "LH_HO_IN_SUCCESS": "IN_TRANSIT",
    "LH_HO_AIRLINE": "IN_TRANSIT",
    "LH_DEPART": "IN_TRANSIT",
    "LH_ARRIVE": "IN_TRANSIT",
    "LH_POST_COLLECTION": "IN_TRANSIT",
    "COMMON_INTRANSIT": "IN_TRANSIT",
    "TD_TRANS_DEPART": "IN_TRANSIT",
    "TD_TRANS_ARRIVE": "IN_TRANSIT",
    "TD_TRANS_ARRIVE_C": "IN_TRANSIT",
    "CC_HO_IN_SUCCESS": "IN_TRANSIT",
    "CC_IM_START": "IN_TRANSIT",
    "CC_IM_SUCCESS": "IN_TRANSIT",
    "CC_HO_OUT_SUCCESS": "IN_TRANSIT",
    "GTMS_ACCEPT": "IN_TRANSIT",
    "GTMS_SC_ARRIVE": "IN_TRANSIT",
    "GTMS_SC_DEPART": "IN_TRANSIT",
    "GTMS_OE_DEPART": "IN_TRANSIT",
    "GTMS_DO_DEPART": "IN_TRANSIT",
    "LAST_MILE_ASN_NOTIFY": "IN_TRANSIT",
    # Import customs problems (not a failed delivery — held at customs)
    "CC_IM_FAILURE": "CUSTOMS",
    "CC_IM_EXCEPTION": "CUSTOMS",
    # At pickup point (station signed for the parcel, not recipient)
    "GSTA_INFORM_BUYER": "READY_FOR_PICKUP",
    "GTMS_WAIT_SELF_PICK": "READY_FOR_PICKUP",
    "GTMS_STA_SIGNED": "READY_FOR_PICKUP",
    # Terminal states
    "GTMS_SIGNED": "DELIVERED",
    "GTMS_STA_SIGN_FAILURE": "ATTEMPTED_DELIVERY",
    "EXCEPTION": "ATTEMPTED_DELIVERY",
}

_CAINIAO_LOGGED_UNKNOWN: set[str] = set()

# Regex for extracting a tracking number from Cainiao's "PostNL 3SDFC0123456789" display string.
_EMBEDDED_NUMBER_RE = re.compile(r"(?<![A-Z0-9])(?=[A-Z0-9]*[0-9])[A-Z0-9]{8,30}(?![A-Z0-9])")


def _cainiao_action_to_status(action_code: str | None) -> str:
    """Map a Cainiao action code to an internal status string."""
    if not action_code:
        return "UNKNOWN"
    key = action_code.strip().upper()
    mapped = _CAINIAO_ACTION_STATUS.get(key)
    if mapped is None and key not in _CAINIAO_LOGGED_UNKNOWN:
        _CAINIAO_LOGGED_UNKNOWN.add(key)
        _LOGGER.warning("Unknown Cainiao action code %s — please report via GitHub", key)
    return mapped or "UNKNOWN"


def _cainiao_ms_to_iso(ms: Any) -> str | None:
    """Convert Cainiao epoch-millisecond timestamp to ISO 8601 UTC string."""
    if ms is None:
        return None
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).isoformat()
    except (ValueError, OSError, OverflowError):
        return None


class CaiNiaoTrackingClient:
    """Fetch AliExpress / Cainiao parcel data via Cainiao's public tracking endpoint.

    No authentication required. Endpoint: https://global.cainiao.com/global/detail.json
    """

    def __init__(self, session: aiohttp.ClientSession) -> None:
        self._session = session

    async def async_get_tracking(self, tracking_number: str) -> ParcelData:
        """Return tracking data for a Cainiao / AliExpress parcel."""
        params = {"mailNos": tracking_number, "lang": "en-US"}
        try:
            async with self._session.get(
                _CAINIAO_API,
                params=params,
                headers={"User-Agent": "Mozilla/5.0 HomeAssistant NorwegianParcelTracker/2.2"},
                timeout=aiohttp.ClientTimeout(total=20),
            ) as resp:
                if resp.status != 200:
                    raise CaiNiaoTrackingError(f"Cainiao returned HTTP {resp.status}")
                try:
                    payload = await resp.json(content_type=None)
                except ValueError as err:
                    raise CaiNiaoTrackingError(f"Cainiao returned unparseable body: {err}") from err
        except CaiNiaoTrackingError:
            raise
        except Exception as err:
            raise CaiNiaoTrackingError(f"Cainiao request failed: {err}") from err

        if not payload.get("success"):
            raise CaiNiaoTrackingError(
                f"Cainiao response not successful: {payload.get('errorMsg') or payload}"
            )

        module: list = payload.get("module") or []
        for entry in module:
            if isinstance(entry, dict) and entry.get("mailNo", "").upper() == tracking_number.upper():
                return _parcel_from_cainiao(entry, tracking_number)

        # Tracking number not found yet — still being processed by seller
        return ParcelData(
            tracking_number=tracking_number,
            product_name="AliExpress / Cainiao",
            sender_name="AliExpress",
            current_status="REGISTERED",
            status_description="Tracking information not yet available",
            events=[],
            status_authoritative=True,
        )


def _parcel_from_cainiao(entry: dict, tracking_number: str) -> ParcelData:
    """Build a ParcelData from a single Cainiao module entry."""
    latest_trace: dict = entry.get("latestTrace") or {}
    detail_list: list[dict] = [e for e in (entry.get("detailList") or []) if isinstance(e, dict)]

    # Current status from latest trace action code; fall back to newest detail entry
    current_action = latest_trace.get("actionCode")
    if not current_action and detail_list:
        current_action = max(detail_list, key=lambda e: e.get("time") or 0).get("actionCode")
    current_status = _cainiao_action_to_status(current_action)

    # When tracking has been submitted but no scans exist yet, use REGISTERED not UNKNOWN
    if current_status == "UNKNOWN" and not detail_list and not latest_trace:
        current_status = "REGISTERED"
        status_description = "Tracking information not yet available"
    else:
        status_description = (
            latest_trace.get("standerdDesc")  # Cainiao's own spelling
            or latest_trace.get("desc")
            or entry.get("statusDesc")
            or entry.get("status")
            or current_status
        )

    # Build event list sorted newest-first by epoch ms (avoids TZ-aware/naive datetime mixing)
    events: list[ParcelEvent] = []
    for ev in detail_list:
        date_iso = _cainiao_ms_to_iso(ev.get("time")) or str(ev.get("timeStr") or "")
        desc = ev.get("standerdDesc") or ev.get("desc") or ev.get("actionCode") or ""
        events.append(ParcelEvent(
            description=desc,
            date_iso=date_iso or None,
            location=ev.get("city") or None,
            status=_cainiao_action_to_status(ev.get("actionCode")),
            raw=ev,
        ))

    events.sort(key=lambda e: e.raw.get("time") or 0, reverse=True)

    # ETA from globalEtaInfo (max time gives the outer bound)
    eta = entry.get("globalEtaInfo") or {}
    eta_ms = eta.get("deliveryMaxTime") or eta.get("deliveryMinTime")
    estimated_delivery_iso = _cainiao_ms_to_iso(eta_ms)
    estimated_delivery = estimated_delivery_iso[:10] if estimated_delivery_iso else None

    # Local carrier's tracking number (e.g. Posten/PostNord number for Norway)
    local_number: str | None = entry.get("copyRealMailNo")
    if not local_number:
        display = entry.get("realMailNo") or ""
        m = _EMBEDDED_NUMBER_RE.search(display.upper())
        local_number = m.group(0) if m else None

    origin = (entry.get("originCountry") or "").upper()
    return ParcelData(
        tracking_number=tracking_number,
        product_name="AliExpress / Cainiao",
        sender_name=f"AliExpress ({origin})" if origin else "AliExpress",
        current_status=current_status,
        status_description=status_description,
        estimated_delivery=estimated_delivery,
        estimated_delivery_iso=estimated_delivery_iso,
        delivery_method=f"Cainiao{f' → {local_number}' if local_number else ''}",
        events=events,
        status_authoritative=current_status != "UNKNOWN",
    )
