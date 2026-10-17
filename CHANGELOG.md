# Changelog

## 1.3.1

- Re-release of 1.3.0 under a new tag. No code changes.

## 1.3.0

### New features

- **Email watcher**: a new entry type polls an IMAP mailbox (SSL/TLS, port 993) for order confirmation emails and discovers tracking numbers. Supports Bring/Posten JD/JVNO prefixes, international UPU codes, and GS1/EAN-128 codes. No external dependencies — uses Python `imaplib`. Works with Gmail, Outlook, and any IMAP provider via app passwords. Two modes: auto-add (adds immediately) and approval mode (default — shows numbers in Settings → Integrations for user review). Seen UIDs and pending numbers are persisted in HA storage across restarts.
- **Full event history**: tracking events are now stored persistently in HA `.storage/` (per entry, up to 500 events). The status sensor exposes the 10 most recent events as `recent_events` attribute. Full history is available via the new `get_parcel_history` service.
- **Parcel location tracking**: each parcel entry now creates a `device_tracker` entity that shows the parcel's last known geocoded position on the HA map. Postal codes are geocoded via Nominatim (OpenStreetMap) with a module-level rate limiter (≤1 req/s) and a persistent coordinate cache. Note: postal codes are sent to OpenStreetMap's servers.
- **Delivery statistics**: the global settings entry now creates 8 statistics sensors — average, minimum, maximum, and count of transit days, split by carrier (Posten and Helthjem). Statistics persist across entry removals.
- **Map card** (card repo): a new `custom:norwegian-parcel-tracker-map-card` Lovelace card shows the parcel location on a map using HA's built-in `ha-map` element (no CDN dependencies), with recent event history below. Configured by pointing at the `device_tracker` entity.

### Other changes

- Added `remove_parcel` service to remove a parcel entry by tracking number.
- `refresh` service now accepts an optional `tracking_number` to refresh a single parcel; omit it to refresh all.
- `get_parcel_history` service returns the full stored event history for a parcel.
- Calendar event creation is now skipped for parcels that are already delivered when added.
- Fixed `SupportsResponse` import path (`homeassistant.core`, not `homeassistant.helpers.service`).
- Pinned `aiohttp<3.14` in test requirements (aiohttp 3.14.0 broke `aioresponses 0.7.9`).

### Known limitations

- The map card's auto-discovery of the status sensor (`device_tracker.X_location` → `sensor.X_status`) relies on English entity IDs. Norwegian (`nb`) locale uses "Posisjon" for the device_tracker entity name, which breaks the lookup. Workaround: set the integration language to English in global settings, or configure the card manually.

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
