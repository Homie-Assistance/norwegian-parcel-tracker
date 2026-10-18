# Norwegian Parcel Tracker

Track parcels from Posten, Bring, and Helthjem directly in Home Assistant.

**Requires Home Assistant 2025.1.0 or later.**

## Entities per parcel

- Status, latest event, estimated delivery, pickup point, sender, delivery method
- Weight, length, width, height
- Geocoded device tracker (shows last known parcel location on the HA map)
- Home delivery button (when Posten provides a URL)

## Features

- Add parcels from the HA UI or via the `add_parcel` service
- Optional push notifications on new events or delivery
- Optional all-day calendar event on the estimated delivery date
- Configurable stale/stuck parcel warnings
- Norwegian and English translations
- Email watcher: auto-discovers tracking numbers from an IMAP mailbox

## v2.0 features

- **Sidebar panel** — "Parcels" entry in the HA left menu with an all-parcels map and detail pane
- **Per-parcel notes** — `set_note` / `clear_note`: attach notes stored across restarts
- **Custom icons** — `set_icon` / `clear_icon`: assign `mdi:icon-name`, an emoji, or a URL
- **Rename** — `rename_parcel`: set a friendly display name
- **Route map** — event history geocoded in the background and shown as an animated SVG route

## Lovelace cards (bundled)

Three dashboard cards are served directly by the integration. Add them as resources in Settings → Dashboards → Resources:

| URL | Card type |
|---|---|
| `/norwegian_parcel_tracker/card.js` | `custom:norwegian-parcel-tracker-card` |
| `/norwegian_parcel_tracker/compact_card.js` | `custom:norwegian-parcel-tracker-compact` |
| `/norwegian_parcel_tracker/map_card.js` | `custom:norwegian-parcel-tracker-map-card` |
