# Norwegian Parcel Tracker

Track parcels from Posten and Bring directly in Home Assistant.

Reads live tracking data from `sporing.posten.no` and creates a set of sensor entities for each parcel, with optional notifications, calendar events, and a companion Lovelace card.

**Requires Home Assistant 2025.1.0 or later.**

---

## Entities

Each parcel gets the following entities:

| Entity | Type | Description |
|---|---|---|
| Status | Sensor | Current parcel status text |
| Latest event | Sensor | Most recent tracking event description |
| Estimated delivery | Sensor | Estimated delivery date |
| Pickup point | Sensor | Name of pickup location |
| Sender | Sensor | Sender name |
| Delivery method | Sensor | Product/service name (e.g. Pakke i postkassen) |
| Weight | Sensor | Package weight (kg) |
| Length / Width / Height | Sensor | Package dimensions (cm) |
| Order home delivery | Button | Fires a persistent notification with a link to order home delivery (only available when Posten provides a URL) |

The **Status** sensor carries the full event history and all parcel details as entity attributes.

Parcels are polled every 30 minutes.

---

## Installation

### HACS (recommended)

1. Open HACS → Integrations.
2. Click the three-dot menu → **Custom repositories**.
3. Add `https://github.com/Homie-Assistance/norwegian-parcel-tracker` — category: **Integration**.
4. Install **Norwegian Parcel Tracker** and restart Home Assistant.
5. Go to **Settings → Devices & services → Add integration**, search for **Norwegian Parcel Tracker**, and enter a tracking number.

### Manual

Copy `custom_components/norwegian_parcel_tracker` into your HA config directory:

```
/config/custom_components/norwegian_parcel_tracker
```

Restart Home Assistant, then add the integration from **Settings → Devices & services**.

---

## Adding parcels

Parcels can be added two ways:

**Via the UI** — Settings → Devices & services → Add integration → Norwegian Parcel Tracker. Enter a tracking number and an optional display name.

**Via service call** — useful from automations or the companion Lovelace card:

```yaml
service: norwegian_parcel_tracker.add_parcel
data:
  tracking_number: "00370000000000000000"
  name: "Optional display name"
```

---

## Options

Each parcel entry has its own options, accessible via **Configure** in the integration list:

| Option | Description | Default |
|---|---|---|
| Notify target | HA notify service for parcel updates (e.g. `notify.mobile_app_myphone`) | — |
| Notify on all events | Send a notification on every new tracking event | Off |
| Notify on delivery | Send a notification when the parcel is delivered | On |
| Calendar entity | Create an all-day event on the estimated delivery date | — |
| Stale warning (hours) | Hours without a new event before flagging the parcel as stuck | 24 |
| Stale critical (hours) | Hours without a new event before flagging as critically stuck | 72 |
| Max weight / dimensions | Alert thresholds for oversized parcels — set to 0 to disable | 0 |

---

## Lovelace card

The companion dashboard card is a separate HACS frontend package:

**[norwegian-parcel-tracker-card](https://github.com/Homie-Assistance/norwegian-parcel-tracker-card)**

It lists all tracked parcels, colour-codes them by staleness, and lets you add new tracking numbers directly from the dashboard.

```yaml
type: custom:norwegian-parcel-tracking
title: Pakker
show_delivered: false
highlight_stuck: true
```

---

## Limitations

- Parcel event history is shown in entity attributes but is not backfilled into the HA recorder.
- Location names are not geocoded to map coordinates.
- This integration is not affiliated with Posten, Bring, or Posten Bring AS.

---

## Support

[Open an issue on GitHub](https://github.com/Homie-Assistance/norwegian-parcel-tracker/issues)
