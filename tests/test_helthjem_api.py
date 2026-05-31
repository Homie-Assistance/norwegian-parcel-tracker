import pytest
from aioresponses import aioresponses
import aiohttp

from custom_components.norwegian_parcel_tracker.api import (
    HelthjemTrackingClient,
    HelthjemTrackingError,
    _parcel_from_helthjem,
)
from helpers import load_fixture

TRACKING_NUMBER = "000000000000000000"
GRAPHQL_URL = "https://services.helthjem.no/graphql"


# ── _parcel_from_helthjem (pure unit tests, no HTTP) ──────────────────────────

def test_parcel_from_helthjem_registered():
    data = load_fixture("helthjem_registered.json")
    raw = data["data"]["getParcelTrackingDetails"]
    parcel = _parcel_from_helthjem(raw, TRACKING_NUMBER)

    assert parcel.tracking_number == TRACKING_NUMBER
    assert parcel.current_status == "REGISTERED"
    assert parcel.estimated_delivery is None
    assert parcel.pickup_name == "7160"
    assert parcel.delivery_method == "Helthjem"
    assert len(parcel.events) == 1
    assert parcel.events[0].status == "REGISTERED"
    assert parcel.events[0].description == "Nettbutikken har meldt at en pakke er på vei!"
    assert parcel.events[0].date_iso == "2026-05-23T17:59:56+02:00"
    assert parcel.events[0].location is None
    assert not parcel.is_delivered


def test_parcel_from_helthjem_delivered():
    data = load_fixture("helthjem_delivered.json")
    raw = data["data"]["getParcelTrackingDetails"]
    parcel = _parcel_from_helthjem(raw, TRACKING_NUMBER)

    assert parcel.current_status == "DELIVERED"
    assert parcel.estimated_delivery == "2026-05-25"
    assert parcel.is_delivered
    assert len(parcel.events) == 2
    # Events sorted newest first
    assert parcel.events[0].date_iso == "2026-05-25T11:00:00+02:00"
    assert parcel.events[0].location == "Trondheim"
    assert parcel.latest_event.description == "Pakken er levert til hentested."


def test_parcel_from_helthjem_no_events():
    raw = {
        "parcelReference": TRACKING_NUMBER,
        "status": "REGISTERED",
        "estimatedDelivery": {"date": None},
        "deliveryPoint": None,
        "sender": {"postalCode": "0001"},
        "events": [],
    }
    parcel = _parcel_from_helthjem(raw, TRACKING_NUMBER)
    assert parcel.events == []
    assert parcel.latest_event is None
    assert parcel.pickup_name is None


# ── HelthjemTrackingClient (mocked HTTP) ─────────────────────────────────────

@pytest.mark.asyncio
async def test_client_success():
    fixture = load_fixture("helthjem_registered.json")
    async with aiohttp.ClientSession() as session:
        with aioresponses() as mock:
            mock.post(GRAPHQL_URL, payload=fixture)
            client = HelthjemTrackingClient(session)
            parcel = await client.async_get_tracking(TRACKING_NUMBER)

    assert parcel.tracking_number == TRACKING_NUMBER
    assert parcel.current_status == "REGISTERED"


@pytest.mark.asyncio
async def test_client_http_error():
    async with aiohttp.ClientSession() as session:
        with aioresponses() as mock:
            mock.post(GRAPHQL_URL, status=500)
            client = HelthjemTrackingClient(session)
            with pytest.raises(HelthjemTrackingError, match="HTTP 500"):
                await client.async_get_tracking(TRACKING_NUMBER)


@pytest.mark.asyncio
async def test_client_graphql_error():
    fixture = load_fixture("helthjem_graphql_error.json")
    async with aiohttp.ClientSession() as session:
        with aioresponses() as mock:
            mock.post(GRAPHQL_URL, payload=fixture)
            client = HelthjemTrackingClient(session)
            with pytest.raises(HelthjemTrackingError, match="GraphQL error"):
                await client.async_get_tracking(TRACKING_NUMBER)


@pytest.mark.asyncio
async def test_client_empty_data():
    async with aiohttp.ClientSession() as session:
        with aioresponses() as mock:
            mock.post(GRAPHQL_URL, payload={"data": {"getParcelTrackingDetails": None}})
            client = HelthjemTrackingClient(session)
            with pytest.raises(HelthjemTrackingError, match="No tracking data"):
                await client.async_get_tracking(TRACKING_NUMBER)
