# ETA Prediction for Upcoming Stops — Design Note

**Issue:** [#21](https://github.com/Homie-Assistance/norwegian-parcel-tracker/issues/21)
**Status:** Phase 1 shipped in v2.5.0 — priors only, final delivery prediction only, per-leg learned durations not yet used
**Date:** 2026-11-02

---

## Goal

Predict, for a parcel currently in transit, *when* it will reach each remaining stop on its
route — most importantly, the home delivery or pickup point.

---

## What we have today

The `route_coords` attribute on the status sensor carries a list of stops, each with:
- `lat`, `lng` — geocoded coordinates
- `description` — event text (e.g. "Arrived at Oslo terminal")
- `timestamp` — ISO-8601 string of when the event occurred

The `DeliveryStatsStore` (introduced in `stats.py`) already accumulates per-parcel delivery
data (arrival time, departure time, carrier) across sessions.

---

## Approach: per-stop timing model

### 1. Data collection (already happening)

`DeliveryStatsStore` logs each completed delivery. Extend it to also log **leg durations**:
time from `route_coords[i].timestamp` to `route_coords[i-1].timestamp` for every leg on every
parcel that reaches delivery. Bucket by:

- **carrier** (posten, helthjem, cainiao)
- **checkpoint type** (customs, airport, warehouse, delivery — same taxonomy as `_checkpointInfo`)
- **country pair** (optional; derived from the coordinate's country reverse-geocoded by Nominatim)

Over time this builds a distribution of how long each leg type takes per carrier.

### 2. Prediction at query time

For a parcel with `N` remaining stops:

```
ETA_stop_k = last_known_timestamp + sum(median_leg_duration(type_i, carrier) for i in 1..k)
```

Where `type_i` is the checkpoint type of the *destination* stop for that leg.

Confidence: report a range using the 25th–75th percentile of the observed distribution
(IQR), not just the median. With fewer than 5 samples for a bucket, fall back to the global
median for that carrier, then to a hard-coded prior (see below).

### 3. Hard-coded priors (cold start)

| Leg type | Carrier | Prior (median) | P25–P75 range |
|---|---|---|---|
| Warehouse → warehouse (domestic) | posten/helthjem | 8 h | 4–16 h |
| Customs clearance | any | 48 h | 24–96 h |
| Airport hub departure | any | 6 h | 3–12 h |
| Last-mile → home | posten/helthjem | 18 h | 12–36 h |
| International leg (Cainiao) | cainiao | 72 h | 48–120 h |

These are conservative; real Posten domestic legs are often 4–12 h, but the priors err toward
under-promising.

### 4. Deduplication

`DeliveryStatsStore` already keys by tracking number + event hash. Leg-duration entries are
keyed by `(tracking_number, leg_index)` so coordinator restarts don't double-count.

---

## Norwegian / English term mapping

`_checkpointInfo` classifies description text. ETA prediction uses the same classification,
so the Norwegian terms added in the v2.4.0 follow-up commit (`toll/grense`, `flyplass`,
`sorter/lager/terminal`, `levering/bud`) feed directly into the bucket key.

---

## Where to store the learned distribution

In `DeliveryStatsStore` (`.storage/norwegian_parcel_tracker.stats.json`), add a top-level
`leg_durations` key:

```json
{
  "leg_durations": {
    "posten:warehouse": [28800, 43200, 36000, ...],
    "cainiao:customs": [172800, 86400, ...]
  }
}
```

Values are seconds. Median and IQR are computed in-process on each read; no pre-aggregation
needed at the small volumes involved.

---

## Sensor / UI surface

Two options:

**Option A — attribute only:** Add `eta_next_stop` and `eta_delivery` attributes to the
existing status sensor. No new entity. Simplest; visible in the panel detail pane immediately.

**Option B — dedicated sensor:** A new `ETA` sensor entity per parcel. State = ISO date of
predicted delivery. Attribute = per-stop breakdown. Enables HA automations ("notify me 2 h
before predicted delivery").

Recommendation: **Option B** — it lets users build automations and matches the existing
`Estimated delivery` sensor pattern. The predicted ETA supplements (and eventually may
cross-check) the carrier-provided ETA.

---

## What this does NOT do

- It does not call any external service or API for weather, traffic, or logistics data.
- It does not expose personal data outside the local HA instance.
- It does not modify any existing sensor schema; the new sensor is additive.
- It does not guarantee accuracy — it is a statistical estimate, clearly labeled as such.

---

## Open questions before implementation

1. **Privacy (Issue #16):** If per-user parcel isolation lands first (v3.x), leg-duration
   stats should be stored per-user, not globally. Coordinate with #16 before writing the
   storage schema.
2. **Minimum sample threshold:** How many legs of a type before we trust learned stats over
   priors? Suggest 5, but this is a tuning parameter.
3. **UI wording:** "Predicted delivery: ~Thursday ±6 h" vs. "Expected by Thursday" — the
   former is honest about uncertainty; the latter matches carrier language. Decide before
   shipping.
