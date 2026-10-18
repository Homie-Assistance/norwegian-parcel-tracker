import pytest

from custom_components.norwegian_parcel_tracker.api import (
    PostenTrackingError,
    ParcelData,
    _sanitize_estimated_delivery,
    _sanitize_pickup_name,
    _looks_like_internal_key,
    _find_key,
    _parcel_from_router_data,
    _patch_parcel_from_raw_stream,
    parse_tracking_html,
)


# ── _looks_like_internal_key ──────────────────────────────────────────────────

def test_internal_key_rejects_camel_case():
    assert _looks_like_internal_key("estimatedTimeSpanOfDelivery") is True
    assert _looks_like_internal_key("expectedPickupUnitURL") is True
    assert _looks_like_internal_key("parcelLockerInfoBoxType") is True


def test_internal_key_allows_normal_values():
    assert _looks_like_internal_key("Trondheim") is False
    assert _looks_like_internal_key("2026-05-25") is False
    assert _looks_like_internal_key("Nettbutikken") is False
    assert _looks_like_internal_key("Posten Norge AS") is False


def test_internal_key_handles_none():
    assert _looks_like_internal_key(None) is False
    assert _looks_like_internal_key("") is False


# ── _sanitize_estimated_delivery ──────────────────────────────────────────────

def test_sanitize_eta_rejects_internal_keys():
    assert _sanitize_estimated_delivery("estimatedTimeSpanOfDelivery") is None
    assert _sanitize_estimated_delivery("latestSignificantEvent") is None


def test_sanitize_eta_accepts_valid_date():
    assert _sanitize_estimated_delivery("2026-05-25") == "2026-05-25"
    assert _sanitize_estimated_delivery("Mandag 25. mai") == "Mandag 25. mai"


def test_sanitize_eta_iso_rejects_non_date():
    assert _sanitize_estimated_delivery("not-a-date", iso=True) is None
    assert _sanitize_estimated_delivery("2026-05-25", iso=True) == "2026-05-25"


def test_sanitize_eta_none():
    assert _sanitize_estimated_delivery(None) is None
    assert _sanitize_estimated_delivery("") is None


# ── _sanitize_pickup_name ─────────────────────────────────────────────────────

def test_sanitize_pickup_rejects_known_bad():
    assert _sanitize_pickup_name("expectedPickupUnitURL") is None
    assert _sanitize_pickup_name("expectedPickupUnitName") is None
    assert _sanitize_pickup_name("Pickup not available") is None
    assert _sanitize_pickup_name("Unknown") is None


def test_sanitize_pickup_rejects_urls():
    assert _sanitize_pickup_name("https://example.com/pickup") is None
    assert _sanitize_pickup_name("http://example.com") is None


def test_sanitize_pickup_accepts_valid_name():
    assert _sanitize_pickup_name("Kiwi Moholt") == "Kiwi Moholt"
    assert _sanitize_pickup_name("Coop Extra Heimdal") == "Coop Extra Heimdal"


def test_sanitize_pickup_none():
    assert _sanitize_pickup_name(None) is None
    assert _sanitize_pickup_name("") is None


# ── parse_tracking_html ───────────────────────────────────────────────────────

def test_parse_html_raises_on_empty():
    with pytest.raises(PostenTrackingError):
        parse_tracking_html("", "12345")


def test_parse_html_raises_on_garbage():
    with pytest.raises(PostenTrackingError):
        parse_tracking_html("<html><body>Nothing here</body></html>", "12345")


# ── _find_key ─────────────────────────────────────────────────────────────────

def test_find_key_nested_dict():
    data = {"a": {"b": {"ORDER_HOME_DELIVERY": {"url": "https://example.com"}}}}
    assert _find_key(data, "ORDER_HOME_DELIVERY") == {"url": "https://example.com"}


def test_find_key_in_list():
    data = [{"x": 1}, {"ORDER_HOME_DELIVERY": "https://example.com"}]
    assert _find_key(data, "ORDER_HOME_DELIVERY") == "https://example.com"


def test_find_key_missing():
    assert _find_key({"a": 1}, "missing") is None
    assert _find_key([], "missing") is None


# ── _parcel_from_router_data — home_delivery_url ──────────────────────────────

def _minimal_router_data(order_home_delivery=None, pickup_url=None, pickup_name=None):
    """Build a minimal router data dict as Posten's React Router format."""
    package = {
        "currentStatus": "IN_TRANSIT",
        "statusDescription": "Pakken er på vei",
        "productName": "Servicepakke",
        "eventSet": [],
    }
    if pickup_url:
        package["expectedPickupUnitURL"] = pickup_url
    if pickup_name:
        package["expectedPickupUnitName"] = pickup_name
    data = {
        "consignment": {
            "consignmentId": "123456789",
            "senderName": "Nettbutikken AS",
            "packageSet": [package],
        }
    }
    if order_home_delivery is not None:
        data["ORDER_HOME_DELIVERY"] = order_home_delivery
    return data


def test_router_data_home_delivery_url_from_dict():
    data = _minimal_router_data(order_home_delivery={"url": "https://sending.posten.no/hjemlevering/abc123"})
    parcel = _parcel_from_router_data(data, "tracking123")
    assert parcel is not None
    assert parcel.home_delivery_url == "https://sending.posten.no/hjemlevering/abc123"


def test_router_data_home_delivery_url_from_link_information():
    data = _minimal_router_data(order_home_delivery={"linkInformation": "https://sending.posten.no/hjemlevering/xyz"})
    parcel = _parcel_from_router_data(data, "tracking123")
    assert parcel is not None
    assert parcel.home_delivery_url == "https://sending.posten.no/hjemlevering/xyz"


def test_router_data_home_delivery_url_from_string():
    data = _minimal_router_data(order_home_delivery="https://sending.posten.no/hjemlevering/direct")
    parcel = _parcel_from_router_data(data, "tracking123")
    assert parcel is not None
    assert parcel.home_delivery_url == "https://sending.posten.no/hjemlevering/direct"


def test_router_data_home_delivery_url_absent():
    data = _minimal_router_data()
    parcel = _parcel_from_router_data(data, "tracking123")
    assert parcel is not None
    assert parcel.home_delivery_url is None


def test_router_data_pickup_url_and_name():
    data = _minimal_router_data(
        pickup_url="https://www.posten.no/hentested/kiwi-moholt",
        pickup_name="Kiwi Moholt",
    )
    parcel = _parcel_from_router_data(data, "tracking123")
    assert parcel is not None
    assert parcel.pickup_url == "https://www.posten.no/hentested/kiwi-moholt"
    assert parcel.pickup_name == "Kiwi Moholt"


def test_router_data_no_consignment_returns_none():
    assert _parcel_from_router_data({"nothing": "here"}, "123") is None
    assert _parcel_from_router_data([], "123") is None


# ── _patch_parcel_from_raw_stream — home_delivery_url ─────────────────────────

def test_patch_picks_up_hjemlevering_url():
    stream_text = (
        'streamController.enqueue("{\\"senderName\\":\\"Test AS\\"}'
        ',\\"https://sending.posten.no/hjemlevering/TOKEN123abc\\"'
        '")'
    )
    parcel = ParcelData(tracking_number="abc")
    _patch_parcel_from_raw_stream(parcel, stream_text)
    assert parcel.home_delivery_url == "https://sending.posten.no/hjemlevering/TOKEN123abc"


def test_patch_does_not_overwrite_existing_home_delivery_url():
    existing = "https://sending.posten.no/hjemlevering/EXISTING"
    stream_text = (
        'streamController.enqueue("'
        'https://sending.posten.no/hjemlevering/NEW'
        '")'
    )
    parcel = ParcelData(tracking_number="abc", home_delivery_url=existing)
    _patch_parcel_from_raw_stream(parcel, stream_text)
    assert parcel.home_delivery_url == existing


def test_patch_handles_empty_stream():
    parcel = ParcelData(tracking_number="abc")
    _patch_parcel_from_raw_stream(parcel, "")
    assert parcel.home_delivery_url is None
    assert parcel.sender_name is None
