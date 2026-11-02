"""ETA prediction for in-transit parcels.

Predicts delivery time from the last confirmed stop using hard-coded priors
per carrier group and checkpoint type. When learned leg-duration data becomes
available in DeliveryStatsStore this module will use it instead of the priors.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

# All status codes where the parcel is still moving and an ETA makes sense.
# Matches the in-transit set from _parcelStatusColor() in panel.js.
_IN_TRANSIT_STATUSES = frozenset({
    "IN_TRANSIT",
    "LOADED_FOR_DELIVERY",  # on the van, last mile
    "CUSTOMS",
    "AT_CUSTOMS",
    "ATTEMPTED_DELIVERY",   # will be re-tried
    "DELAYED",              # generic delay flag
})


def checkpoint_type(description: str, location: str = "") -> str:
    """Classify a stop description to a checkpoint-type bucket.

    Mirrors the _checkpointInfo() logic in panel.js (same regex terms, same buckets).
    """
    desc = (description + " " + location).lower()
    if re.search(
        r"customs|border|import|export|clearance|toll(?!.{0,3}free)|grense|fortoll|klarering",
        desc,
    ):
        return "customs"
    if re.search(r"airport|air.?hub|departure|arrival|airline|flyplass|lufthavn", desc):
        return "airport"
    if re.search(
        r"sort|warehouse|center|hub|facility|depot|logistics|sorter|lager|senter|terminal|gods",
        desc,
    ):
        return "warehouse"
    if re.search(r"deliver|courier|local|final|last.?mile|levering|utlevering|bud(?!kk)", desc):
        return "delivery"
    return "other"


# (carrier_group, current_stop_type) → (median_hours, p25_factor, p75_factor)
# carrier_group: "cainiao" for Cainiao/AliExpress, "domestic" for Posten/Helthjem.
# The p25/p75 factors are multiplied against median_hours to give the range.
_PRIOR: dict[tuple[str, str], tuple[float, float, float]] = {
    ("domestic", "customs"):   (48.0, 0.5, 2.0),
    ("domestic", "airport"):   (18.0, 0.6, 1.8),
    ("domestic", "warehouse"): (12.0, 0.5, 2.0),
    ("domestic", "delivery"):  (6.0,  0.5, 1.5),
    ("domestic", "other"):     (18.0, 0.5, 2.0),
    ("cainiao",  "customs"):   (72.0, 0.4, 2.5),
    ("cainiao",  "airport"):   (48.0, 0.5, 2.0),
    ("cainiao",  "warehouse"): (72.0, 0.4, 2.5),
    ("cainiao",  "delivery"):  (24.0, 0.5, 2.0),
    ("cainiao",  "other"):     (96.0, 0.4, 2.5),
}


def predict_eta(
    last_stop_desc: str | None,
    last_stop_location: str | None,
    last_stop_time_iso: str | None,
    carrier: str,
    current_status: str | None,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """Predict delivery ETA from the last confirmed stop.

    Returns a dict with predicted_eta, low/high bounds, and metadata,
    or None if prediction is not applicable (not in transit, no timestamp).

    `now` may be injected by callers for deterministic testing; defaults to UTC now.
    """
    if current_status not in _IN_TRANSIT_STATUSES:
        return None
    if not last_stop_time_iso:
        return None

    try:
        last_time = datetime.fromisoformat(last_stop_time_iso)
        if last_time.tzinfo is None:
            last_time = last_time.replace(tzinfo=timezone.utc)
    except ValueError:
        return None

    ctype = checkpoint_type(last_stop_desc or "", last_stop_location or "")
    carrier_group = "cainiao" if carrier == "cainiao" else "domestic"
    median_h, p25_factor, p75_factor = _PRIOR.get(
        (carrier_group, ctype),
        _PRIOR[(carrier_group, "other")],
    )

    median_eta = last_time + timedelta(hours=median_h)
    low_eta    = last_time + timedelta(hours=median_h * p25_factor)
    high_eta   = last_time + timedelta(hours=median_h * p75_factor)

    ref = now if now is not None else datetime.now(timezone.utc)
    overdue = ref > high_eta

    return {
        "predicted_eta":        median_eta,          # TZ-aware datetime for the sensor state
        "predicted_eta_iso":    median_eta.isoformat(),
        "predicted_eta_low":    low_eta.isoformat(),
        "predicted_eta_high":   high_eta.isoformat(),
        "overdue":              overdue,
        "confidence":           "prior",
        "basis_stop_type":      ctype,
        "basis_carrier_group":  carrier_group,
        "basis_median_hours":   median_h,
        "last_confirmed_stop":  last_stop_desc,
        "last_confirmed_time":  last_stop_time_iso,
    }
