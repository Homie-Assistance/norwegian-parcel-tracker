import pytest
from unittest.mock import MagicMock
from custom_components.norwegian_parcel_tracker.config_flow import _guess_carrier_from_format


# ── _guess_carrier_from_format ────────────────────────────────────────────────

def test_bring_jd_prefix():
    assert _guess_carrier_from_format("JD01234567890123") == "posten"


def test_bring_jvno_prefix():
    assert _guess_carrier_from_format("JVNO0123456789") == "posten"


def test_bring_jv_prefix():
    assert _guess_carrier_from_format("JV0123456789") == "posten"


def test_bring_with_spaces_stripped():
    assert _guess_carrier_from_format("JD 0123 4567 8901 23") == "posten"


def test_international_postal_returns_none():
    # UPU format (RR...XX) is shared by PostNord, Deutsche Post, and all UPU members
    assert _guess_carrier_from_format("RR123456789NO") is None


def test_gs1_returns_none():
    # GS1/EAN-128 20-digit codes are used by PostNord too
    assert _guess_carrier_from_format("00370000000000000000") is None


def test_helthjem_short_numeric_returns_none():
    assert _guess_carrier_from_format("12345678") is None


def test_empty_returns_none():
    assert _guess_carrier_from_format("") is None


def test_random_letters_returns_none():
    assert _guess_carrier_from_format("XYZABC123") is None
