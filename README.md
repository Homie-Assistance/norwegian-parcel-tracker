# Norwegian parcel tracker

Track parcels from Posten and Bring in Home Assistant.

This custom integration reads parcel information from `sporing.posten.no` and exposes package status, latest event, estimated delivery, pickup point, dimensions and event history as Home Assistant entities.

> Initial public test release: **v0.1.0**

## Features in v0.1.0

- Add parcels from the Home Assistant UI.
- Tracks Posten/Bring parcel status.
- Sensors for:
  - status
  - latest event
  - estimated delivery
  - pickup point
  - sender
  - delivery method
  - weight
  - dimensions
- Full parcel event history as entity attributes.
- Global options for notification/calendar related settings.
- Service for adding parcels later:
  - `norwegian_parcel_tracker.add_parcel`
- Optional home-delivery button entity when Posten exposes a home-delivery URL.

## Installation with HACS

1. Open HACS.
2. Add this repository as a custom repository:
   `https://github.com/Homie-Assistance/norwegian-parcel-tracker`
3. Category: **Integration**
4. Install **Norwegian parcel tracker**.
5. Restart Home Assistant.
6. Go to **Settings → Devices & services → Add integration**.
7. Search for **Norwegian parcel tracker**.
8. Add your tracking number.

## Manual installation

Copy this folder:

```text
custom_components/norwegian_parcel_tracker
```

to:

```text
/config/custom_components/norwegian_parcel_tracker
```

or, on some installations:

```text
/homeassistant/custom_components/norwegian_parcel_tracker
```

Then restart Home Assistant.

## Lovelace card

The dashboard card is intentionally separated into its own HACS frontend package:

```text
https://github.com/Homie-Assistance/norwegian-parcel-tracker-card
```

Planned HACS frontend resource:

```text
/hacsfiles/norwegian-parcel-tracker-card/norwegian-parcel-tracker-card.js
```

Example dashboard card:

```yaml
type: custom:norwegian-parcel-tracking
title: Pakker
show_delivered: false
highlight_stuck: true
```

## Screenshots

Screenshots will be added before the stable launch release.

<!-- TODO: Add screenshot of Devices & Services entry -->
<!-- TODO: Add screenshot of generated parcel sensors -->
<!-- TODO: Add screenshot of Lovelace card -->

## Notes and limitations

- Historical events from Posten are shown in attributes, but Home Assistant recorder history is not backfilled.
- Location names are not yet geocoded to coordinates.
- Calendar and notification helper features are still considered experimental in this test release.
- This integration is not affiliated with Posten, Bring or Posten Bring AS.

## Support

Report issues here:

https://github.com/Homie-Assistance/norwegian-parcel-tracker/issues
