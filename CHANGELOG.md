# Changelog

## 1.3.0

- Added autonomous email tracking number discovery: a new "Email watcher" entry type polls an IMAP mailbox (SSL, port 993) for order confirmation emails and automatically adds recognised tracking numbers via the existing `add_parcel` flow. No external dependencies — uses Python's built-in `imaplib`. Supports Gmail, Outlook, and any IMAP provider via app passwords. Seen email UIDs and attempted tracking numbers are persisted in HA storage so the integration survives restarts without re-processing old emails.
- The integration now shows a menu when adding a second entry ("Add parcel" vs "Set up email watcher").
- Email watcher credentials and settings (server, port, username, password, folder, poll interval, days-back) are editable via the Configure button.

## 1.2.2

- Added auto-remove delivered parcels: global settings now include an optional timer (hours) to automatically remove a parcel entry after it has been delivered. Set to 0 to disable (the default — existing behaviour is unchanged).
- Tightened tracking-number format detection: the error shown when a number is unrecognised now defaults to the generic "unsupported carrier" message instead of confidently mis-naming Posten/Bring. Only the Bring-specific JD/JVNO letter prefixes are still classified as Posten.

## 1.1.0

- Added Helthjem carrier support via GraphQL API (no authentication required).
- Carrier is auto-detected during parcel setup; existing Posten entries are unaffected.

## 1.0.1

- Added HACS and hassfest validation workflows.
- Fixed manifest key ordering and removed invalid `domains` field from hacs.json.
- Added brand assets for HACS validation.

## 1.0.0

- Switch to independent semantic versioning (previously coupled to card repo build numbers).

## 0.1.6

- Fixed sensor attribute bloat: only the status sensor now carries the full ParcelData payload (including event history); the other 9 sensors expose only their own field. Reduces HA recorder storage on busy parcels.
- Fixed delivery notification re-firing after HA restart: `_delivered_notified` was in-memory only, causing a second "pakken er levert" notification on every restart for already-delivered parcels.
- Fixed `add_parcel` service disappearing after removing all parcels and restarting HA: service is now registered in `async_setup` so it is available as soon as the component loads.
- Fixed home delivery button being a no-op: pressing it now fires a persistent notification with a clickable link to the Posten home delivery URL.
- Fixed pickup/ETA sanitization blocklist drift between backend and Lovelace card.

## 0.1.5

- Fixed Lovelace add-tracker input losing focus during Home Assistant state updates.

## 0.1.4

- Fixed pickup fallback so internal Posten field names (e.g. `expectedPickupUnitURL`) are never shown to users.
- Prevented duplicate ETA calendar events across Home Assistant restarts and reloads.

## 0.1.3

- Fixed bogus `estimatedTimeSpanOfDelivery` ETA placeholder appearing after delivery.
- Added visible success/error feedback when adding a parcel from the Lovelace card.

## 0.1.2

- Fixed Posten stream scalar parsing for dimensions and weight.
- Added runtime calendar all-day event creation.
- Added notify service dropdown in options.
- Tightened card filtering to only render master parcel status entities.

## 0.1.1

- Fixed options/configure flow 500 error on newer Home Assistant versions.
- Renamed Lovelace custom card type to `custom:norwegian-parcel-tracking`.
- Fixed card entity discovery so only parcel status entities are shown by default.

## 0.1.0

Initial public release.

- Sensors for status, latest event, estimated delivery, pickup point, sender, delivery method, weight, and dimensions.
- Full parcel event history as entity attributes on the status sensor.
- Options flow for notifications, calendar events, stale thresholds, and dimension limits.
- `norwegian_parcel_tracker.add_parcel` service.
- Optional home delivery button entity when Posten provides a URL.
- Norwegian (`nb`) and English (`en`) translations.
