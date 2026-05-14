# Norwegian Parcel Tracker

Track parcels from Posten and Bring directly in Home Assistant.

Reads live tracking data from `sporing.posten.no` and creates a set of sensor entities for each parcel, with optional notifications, calendar events, and a companion Lovelace card.

**Requires Home Assistant 2025.1.0 or later.**

## Entities per parcel

- Status, latest event, estimated delivery, pickup point, sender, delivery method
- Weight, length, width, height
- Home delivery button (when Posten provides a URL)

## Features

- Add parcels from the HA UI or via the `norwegian_parcel_tracker.add_parcel` service
- Optional push notifications on new events or delivery
- Optional all-day calendar event on the estimated delivery date
- Configurable stale/stuck parcel warnings
- Norwegian and English translations

## Companion card

A separate Lovelace dashboard card is available at [norwegian-parcel-tracker-card](https://github.com/Homie-Assistance/norwegian-parcel-tracker-card).
