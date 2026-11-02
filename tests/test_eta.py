"""Tests for eta.py — checkpoint classification and ETA prediction."""
from datetime import datetime, timedelta, timezone

import pytest

from custom_components.norwegian_parcel_tracker.eta import checkpoint_type, predict_eta


# ── checkpoint_type ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("desc,expected", [
    ("Arrived at customs clearance Oslo", "customs"),
    ("Toll og grense kontroll", "customs"),
    ("Fortolling pågår", "customs"),
    ("Departed from Oslo Lufthavn", "airport"),
    ("Flyplass terminal avganger", "airport"),
    ("Arrived at Oslo sorting terminal", "warehouse"),
    ("Scanned at Posten sorteringsanlegg", "warehouse"),
    ("Lager Alnabru gods", "warehouse"),
    ("Out for delivery", "delivery"),
    ("Levering pågår", "delivery"),
    ("Arrived at post office", "other"),          # "post" alone does NOT match postal bucket → other
    ("No description", "other"),
    ("", "other"),
])
def test_checkpoint_type(desc, expected):
    assert checkpoint_type(desc) == expected


def test_checkpoint_type_uses_location():
    # location field can push a plain description into a bucket
    assert checkpoint_type("Scanned", "Oslo Lufthavn") == "airport"
    assert checkpoint_type("Scanned", "Customs warehouse") == "customs"


def test_checkpoint_type_toll_free_is_not_customs():
    # "toll-free" should NOT classify as customs
    assert checkpoint_type("Toll-free shopping zone") == "other"


# ── predict_eta ───────────────────────────────────────────────────────────────

_BASE_TIME = datetime(2026, 11, 1, 12, 0, 0, tzinfo=timezone.utc)
_BASE_ISO  = _BASE_TIME.isoformat()


def test_predict_eta_returns_none_for_delivered():
    assert predict_eta("Delivered", None, _BASE_ISO, "posten", "DELIVERED") is None


def test_predict_eta_returns_none_when_no_timestamp():
    assert predict_eta("At warehouse", None, None, "posten", "IN_TRANSIT") is None


def test_predict_eta_returns_none_for_unknown_status():
    assert predict_eta("At warehouse", None, _BASE_ISO, "posten", "REGISTERED") is None


@pytest.mark.parametrize("status", [
    "IN_TRANSIT", "LOADED_FOR_DELIVERY", "CUSTOMS", "AT_CUSTOMS",
    "ATTEMPTED_DELIVERY", "DELAYED",
])
def test_predict_eta_active_for_all_in_transit_statuses(status):
    result = predict_eta("At warehouse", None, _BASE_ISO, "posten", status)
    assert result is not None, f"Expected prediction for status {status}"


def test_predict_eta_domestic_warehouse():
    result = predict_eta("Oslo sorting terminal", None, _BASE_ISO, "posten", "IN_TRANSIT")
    assert result is not None
    assert result["confidence"] == "prior"
    assert result["basis_stop_type"] == "warehouse"
    assert result["basis_carrier_group"] == "domestic"
    assert result["basis_median_hours"] == 12.0
    # median ETA = base + 12 h
    expected_median = _BASE_TIME + timedelta(hours=12)
    assert result["predicted_eta_iso"] == expected_median.isoformat()
    # low < median < high
    low  = datetime.fromisoformat(result["predicted_eta_low"])
    high = datetime.fromisoformat(result["predicted_eta_high"])
    median = datetime.fromisoformat(result["predicted_eta_iso"])
    assert low < median < high


def test_predict_eta_cainiao_customs():
    result = predict_eta("Customs clearance", None, _BASE_ISO, "cainiao", "CUSTOMS")
    assert result is not None
    assert result["basis_carrier_group"] == "cainiao"
    assert result["basis_stop_type"] == "customs"
    assert result["basis_median_hours"] == 72.0


def test_predict_eta_helthjem_is_domestic():
    result = predict_eta("At terminal", None, _BASE_ISO, "helthjem", "IN_TRANSIT")
    assert result is not None
    assert result["basis_carrier_group"] == "domestic"


def test_predict_eta_naive_timestamp_handled():
    naive_iso = "2026-11-01T12:00:00"  # no TZ
    result = predict_eta("At warehouse", None, naive_iso, "posten", "IN_TRANSIT")
    assert result is not None
    # should not raise; result should be valid ISO
    datetime.fromisoformat(result["predicted_eta_iso"])


def test_predict_eta_invalid_timestamp_returns_none():
    assert predict_eta("At warehouse", None, "not-a-date", "posten", "IN_TRANSIT") is None


def test_predict_eta_includes_confirmed_stop_metadata():
    result = predict_eta("Oslo terminal", "Oslo", _BASE_ISO, "posten", "IN_TRANSIT")
    assert result["last_confirmed_stop"] == "Oslo terminal"
    assert result["last_confirmed_time"] == _BASE_ISO


def test_predict_eta_not_overdue_when_now_is_before_high():
    # now = base + 1 h, high = base + 12*2 = base + 24 h → not overdue
    now = _BASE_TIME + timedelta(hours=1)
    result = predict_eta("At warehouse", None, _BASE_ISO, "posten", "IN_TRANSIT", now=now)
    assert result is not None
    assert result["overdue"] is False


def test_predict_eta_overdue_when_now_past_high():
    # now = base + 100 h, high = base + 24 h → overdue
    now = _BASE_TIME + timedelta(hours=100)
    result = predict_eta("At warehouse", None, _BASE_ISO, "posten", "IN_TRANSIT", now=now)
    assert result is not None
    assert result["overdue"] is True


def test_predict_eta_returns_datetime_in_predicted_eta_key():
    result = predict_eta("At warehouse", None, _BASE_ISO, "posten", "IN_TRANSIT")
    assert result is not None
    assert isinstance(result["predicted_eta"], datetime)
    assert result["predicted_eta"].tzinfo is not None  # must be tz-aware
