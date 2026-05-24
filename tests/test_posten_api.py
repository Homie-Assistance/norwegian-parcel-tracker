import pytest

from custom_components.norwegian_parcel_tracker.api import (
    PostenTrackingError,
    _sanitize_estimated_delivery,
    _sanitize_pickup_name,
    _looks_like_internal_key,
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
