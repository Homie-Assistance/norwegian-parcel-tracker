"""Tests for the direct Cainiao / AliExpress tracking implementation."""
import json
import pathlib
import pytest

from custom_components.norwegian_parcel_tracker.api import (
    ParcelData,
    _cainiao_action_to_status,
    _parcel_from_cainiao,
)
from custom_components.norwegian_parcel_tracker.config_flow import (
    _guess_carrier_from_format,
)

# ── Live fixture (AP00100116480005 response, 2026-11-01) ──────────────────────

_AP_FIXTURE = {
    "mailNo": "AP00100116480005",
    "originCountry": "Mainland China",
    "destCountry": "Norway",
    "status": "DELIVERING",
    "statusDesc": "Delivering",
    "mailNoSource": "AE",
    "latestTrace": {
        "time": 1793552141000,
        "timeStr": "2026-11-02 00:55:41",
        "desc": "Arrived at departure transport hub",
        "standerdDesc": "Arrived at departure transport hub",
        "timeZone": "GMT+8",
        "actionCode": "LH_HO_IN_SUCCESS",
    },
    "detailList": [
        {
            "time": 1793552141000,
            "timeStr": "2026-11-02 00:55:41",
            "desc": "Arrived at departure transport hub",
            "standerdDesc": "Arrived at departure transport hub",
            "timeZone": "GMT+8",
            "actionCode": "LH_HO_IN_SUCCESS",
        },
        {
            "time": 1793491343000,
            "timeStr": "2026-11-01 08:02:23",
            "desc": "Outbound in sorting center",
            "standerdDesc": "[Shatian Town] Departed from sorting center",
            "timeZone": "GMT+8",
            "actionCode": "SC_OUTBOUND_SUCCESS",
        },
        {
            "time": 1793449282000,
            "timeStr": "2026-10-31 20:21:22",
            "desc": "Inbound in sorting center",
            "standerdDesc": "[Shatian Town] Processing at sorting center",
            "timeZone": "GMT+8",
            "actionCode": "SC_INBOUND_SUCCESS",
        },
        {
            "time": 1793449045000,
            "timeStr": "2026-10-31 20:17:25",
            "desc": "Leave the warehouse",
            "standerdDesc": "Package shipped out from warehouse",
            "timeZone": "GMT+0800",
            "actionCode": "GWMS_OUTBOUND",
        },
        {
            "time": 1793448821684,
            "timeStr": "2026-10-31 20:13:41",
            "desc": "Package finished",
            "standerdDesc": "Package ready for shipping from warehouse",
            "timeZone": "GMT+0800",
            "actionCode": "GWMS_PACKAGE",
        },
        {
            "time": 1793421941337,
            "timeStr": "2026-10-31 12:45:41",
            "desc": "Order received successfully",
            "standerdDesc": "Shipment information received by warehouse electronically",
            "timeZone": "GMT+0800",
            "actionCode": "GWMS_ACCEPT",
        },
    ],
    "daysNumber": "2\tday(s)",
}


# ── _cainiao_action_to_status ─────────────────────────────────────────────────

def test_action_to_status_known_codes():
    assert _cainiao_action_to_status("GWMS_ACCEPT") == "REGISTERED"
    assert _cainiao_action_to_status("GWMS_PACKAGE") == "REGISTERED"
    assert _cainiao_action_to_status("LH_HO_IN_SUCCESS") == "IN_TRANSIT"
    assert _cainiao_action_to_status("SC_OUTBOUND_SUCCESS") == "IN_TRANSIT"
    assert _cainiao_action_to_status("CC_IM_FAILURE") == "CUSTOMS"
    assert _cainiao_action_to_status("GTMS_SIGNED") == "DELIVERED"
    assert _cainiao_action_to_status("GTMS_STA_SIGNED") == "READY_FOR_PICKUP"
    assert _cainiao_action_to_status("GSTA_INFORM_BUYER") == "READY_FOR_PICKUP"
    assert _cainiao_action_to_status("GTMS_STA_SIGN_FAILURE") == "ATTEMPTED_DELIVERY"


def test_action_to_status_unknown_returns_unknown():
    assert _cainiao_action_to_status("TOTALLY_MADE_UP_CODE") == "UNKNOWN"


def test_action_to_status_none_returns_unknown():
    assert _cainiao_action_to_status(None) == "UNKNOWN"


# ── _parcel_from_cainiao — live AP fixture ────────────────────────────────────

def test_parcel_from_cainiao_live_fixture():
    parcel = _parcel_from_cainiao(_AP_FIXTURE, "AP00100116480005")

    assert parcel.tracking_number == "AP00100116480005"
    assert parcel.current_status == "IN_TRANSIT"
    assert parcel.status_authoritative is True
    assert len(parcel.events) == 6
    assert parcel.events[0].description == "Arrived at departure transport hub"
    assert parcel.events[0].status == "IN_TRANSIT"
    # Oldest event is the warehouse accept
    assert parcel.events[-1].status == "REGISTERED"
    # Sender reflects origin country
    assert "China" in parcel.sender_name or "MAINLAND" in parcel.sender_name.upper()


def test_parcel_from_cainiao_events_sorted_newest_first():
    parcel = _parcel_from_cainiao(_AP_FIXTURE, "AP00100116480005")
    times = [e.raw.get("time") for e in parcel.events]
    assert times == sorted(times, reverse=True)


def test_parcel_from_cainiao_no_eta_when_missing():
    parcel = _parcel_from_cainiao(_AP_FIXTURE, "AP00100116480005")
    assert parcel.estimated_delivery is None
    assert parcel.estimated_delivery_iso is None


# ── _parcel_from_cainiao — empty detailList ───────────────────────────────────

def test_parcel_from_cainiao_empty_detail_list():
    entry = {
        "mailNo": "LP000000001CN",
        "status": "UNKNOWN",
        "statusDesc": "",
        "latestTrace": {},
        "detailList": [],
    }
    parcel = _parcel_from_cainiao(entry, "LP000000001CN")
    assert parcel.current_status == "REGISTERED"
    assert parcel.status_description == "Tracking information not yet available"
    assert parcel.status_authoritative is True
    assert parcel.events == []


# ── is_delivered with status_authoritative ───────────────────────────────────

def test_is_delivered_authoritative_blocks_text_match():
    """When status_authoritative is True, text 'delivered' must not trigger is_delivered."""
    parcel = ParcelData(
        tracking_number="AP00100116480005",
        current_status="IN_TRANSIT",
        status_description="Package will be delivered by local courier",
        status_authoritative=True,
    )
    assert parcel.is_delivered is False


def test_is_delivered_authoritative_delivered_status():
    parcel = ParcelData(
        tracking_number="AP00100116480005",
        current_status="DELIVERED",
        status_authoritative=True,
    )
    assert parcel.is_delivered is True


def test_is_delivered_non_authoritative_uses_text():
    """Without status_authoritative, the Norwegian text check still works for Posten."""
    parcel = ParcelData(
        tracking_number="00370000000000000000",
        status_description="Pakken er levert",
        current_status="SOME_UNKNOWN_STATUS",
        status_authoritative=False,
    )
    assert parcel.is_delivered is True


# ── Carrier detection — AP prefix ────────────────────────────────────────────

def test_guess_carrier_ap_prefix():
    assert _guess_carrier_from_format("AP00100116480005") == "cainiao"


def test_guess_carrier_lp_with_cn_suffix():
    assert _guess_carrier_from_format("LP001234567CN") == "cainiao"


def test_guess_carrier_lx_with_cn_suffix():
    assert _guess_carrier_from_format("LX001234567CN") == "cainiao"


def test_guess_carrier_rx_with_cn_suffix():
    assert _guess_carrier_from_format("RX001234567CN") == "cainiao"


def test_guess_carrier_rx_non_cn_suffix_is_not_cainiao():
    # RX…NO etc. match UPU S10 postal format — return None so Posten fallback can match it
    assert _guess_carrier_from_format("RX001234567NO") is None


def test_guess_carrier_non_cainiao_returns_none():
    assert _guess_carrier_from_format("RR123456789NO") is None
    assert _guess_carrier_from_format("00370000000000000000") is None


# ── Translation file validity ─────────────────────────────────────────────────

def test_translation_files_are_valid_json():
    """Ensure no trailing commas or other syntax errors in translation files."""
    tr_dir = pathlib.Path(__file__).parent.parent / "custom_components" / "norwegian_parcel_tracker" / "translations"
    for path in tr_dir.glob("*.json"):
        with open(path) as f:
            json.load(f)  # raises on invalid JSON
