## 0.1.4

- Fixed pickup fallback so internal Posten keys such as `expectedPickupUnitURL` are never shown to users.
- Prevented duplicate ETA calendar events across Home Assistant restarts/reloads by checking existing calendar events before creating a new one.

## 0.1.2

- Fixed Posten stream scalar parsing for dimensions and weight.
- Added runtime calendar all-day event creation.
- Added notify service dropdown in options.
- Tightened card filtering to only render master parcel status entities.


# Changelog

## 0.1.5

- Fixed Lovelace add-tracker input losing focus during Home Assistant state updates.

## 0.1.3
- Fix bogus `estimatedTimeSpanOfDelivery` ETA placeholder after delivery.
- Keep Lovelace add-tracker input focused while Home Assistant updates.
- Add visible success/error feedback when adding a parcel from the card.

## 0.1.1

- Fixed options/configure flow 500 error on newer Home Assistant versions.
- Renamed Lovelace custom card type to `custom:norwegian-parcel-tracking`.
- Fixed card entity discovery so only parcel status entities are shown by default.
- Kept delivered/stale highlighting and show/hide delivered options working with the renamed card.


## 0.1.0 - Initial public test release

### Added
- Renamed integration to Norwegian parcel tracker.
- Renamed domain to `norwegian_parcel_tracker`.
- Reset versioning to `0.1.0`.
- Added HACS metadata.
- Added GitHub/README release metadata for Homie Assistance.
- Added branding assets under `brands/norwegian_parcel_tracker`.
- Added sensors for status, latest event, ETA, pickup point, sender, delivery method, weight and dimensions.
- Added event history attributes.
- Added global options flow.
- Added `norwegian_parcel_tracker.add_parcel` service.
- Added optional home-delivery button entity when a URL is available.

### Changed
- Pickup fallback text is now Norwegian:
  `Hentested er ikke tilgjengelig for denne pakken`.
- Lovelace card moved out to a separate frontend package.

### Known limitations
- Recorder history is not backfilled.
- Map/geocoding support is not included yet.
- Calendar and notification helpers are experimental.
