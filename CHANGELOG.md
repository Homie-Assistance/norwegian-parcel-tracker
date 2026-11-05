# Changelog

## 2.6.0 (unreleased)

- **Per-user parcel privacy** (issue #16): when a logged-in user adds a parcel via the `add_parcel` service (panel, Lovelace card, or automation), their HA user ID is stored as the unrecorded `owner_user_id` sensor attribute. Each user sees only their own parcels in the panel and in Lovelace cards (auto-discovery and explicitly configured); parcels without an owner (added before this version, via email watcher, or via Settings → Integrations) remain visible to everyone. The `remove_parcel`, `rename_parcel`, `set_note`, `add_note`, `clear_note`, `delete_note`, `set_icon`, `clear_icon` and `get_parcel_history` services raise `ServiceValidationError` when called by a user who is not the owner; automations and scripts with no user context are always permitted. **This integration gives admins no special override over ownership** — but Home Assistant itself does not enforce per-entity read permissions. An admin (or any user with Developer Tools access) can still see all parcel states in Developer Tools → States, history, logbook, the REST API and the websocket API. An admin can also delete any parcel entry from Settings → Integrations, which bypasses the service guard entirely. The HA native map (device_tracker entities), shared calendar events, and delivery notifications also remain unfiltered. Issue #16 stays open for those leaks.

- **Board game map**: the 3D Globe.gl route map is replaced with a flat illustrated world map in the Ticket to Ride style. Features: parchment background (#E8D9BC), warm sand continents, deep maroon dashed routes, animated paper-plane icon travelling the journey, animated dashed future-leg for in-transit parcels. The map uses an equirectangular projection zoomed to the route's bounding box so domestic routes (Oslo → Bergen) and international routes (Shanghai → Oslo) both frame correctly. Continent and country shapes from world-atlas 110m (topojson-client 3.0.2 via cdnjs, SRI-verified). Compass rose and cartouche always visible in the bottom corners. Pulsing dot on the current stop uses the parcel status colour. Screenshot button saves PNG via SVG→canvas serialisation.

## 2.5.1

- **Globe arc rendering**: arc tube thickness now scales proportionally with camera altitude so the arc appears approximately the same width on screen at any zoom level. `arcStroke` is set to 0.25 at the route's stop pose and decreases proportionally as the user zooms in — preventing the "huge wall" effect at close range while keeping the arc clearly visible at the default view. `arcsTransitionDuration` set to 0 to prevent 1-second animation stutter on each zoom step. Historical legs use 80% opacity (was 60%). Altitude floor reverted to 1.0 (span / 28): the previous 1.8 floor caused domestic Norway routes to frame all of Europe.
- **Globe zoom**: reduced intro wait from 3.0 s to 2.7 s; fly-in animation from 2.5 s to 1.5 s. Total intro time cut from 5.5 s to 4.2 s.
- **AliExpress / Cainiao map**: fixed geocoding failure for non-Norwegian event city names (e.g. "Shatian Town"). The coordinator was defaulting `country="NO"` for all events without an explicit `countryCode`, so every Chinese city lookup returned no results. Now: when a city name comes directly from the carrier's raw event dict and there is no postal code or explicit country, Nominatim is queried without a country constraint (worldwide search). Posten and Helthjem geocoding are unchanged.
- **Tests**: replaced `aioresponses` with stdlib `unittest.mock.AsyncMock`. `aioresponses 0.7.9` is incompatible with `aiohttp 3.14+` (`ClientResponse.__init__` gained a required argument). Test pin bumped to `aiohttp>=3.14.4` (fixes all 8 Dependabot CVEs — server-side vulnerabilities, not affecting this integration at runtime).

## 2.5.0

- **Predicted delivery sensor**: new `predicted_eta` sensor entity per parcel. Uses the last confirmed stop type (customs, airport, warehouse, last-mile) and carrier-specific timing priors (Posten/Helthjem vs. Cainiao) to estimate delivery time. State = TZ-aware ISO datetime usable in HA time-based automations. Attributes: `predicted_eta_low`, `predicted_eta_high`, `overdue`, `confidence`, `basis_stop_type`, `basis_carrier_group`, `basis_median_hours`, `last_confirmed_stop`, `last_confirmed_time`. Only active while the parcel is in transit; shows unavailable for delivered or pre-shipment parcels. Issue #21.

## 2.4.0

- **3D Globe route map**: flat Leaflet map replaced with a Globe.gl 3D globe for the selected-parcel detail view. Features: 3-second auto-rotating intro, camera flies to frame the route, checkpoint markers (customs 🛃, airport ✈️, warehouse 🏭, delivery 🚚, etc.), animated dashed arc from last confirmed stop to HA home for in-transit/delayed parcels, night-lights Earth texture. SRI integrity hash on Globe.gl CDN script (`sha384-…`).
- **Norwegian checkpoint terms**: `_checkpointInfo()` in `panel.js` now recognises Norwegian keywords (`toll`, `grense`, `fortoll`, `klarering`, `flyplass`, `lufthavn`, `sorter`, `lager`, `senter`, `gods`, `levering`, `utlevering`, `bud`).

## 2.3.0

- **Transit slide-in animation**: for in-transit and delayed parcels the route map shows an animated dashed arc from the last confirmed stop toward the HA home location, indicating the parcel is somewhere along that path. Fixed detail pane not updating after manual Refresh.

## 2.2.0

- **AliExpress / Cainiao tracking**: direct call to Cainiao's public endpoint (`global.cainiao.com`) — no API key, no sign-up. Auto-detects `LP…`, `LX…`, `RX…`, and `AP…` tracking number formats. Status codes mapped to the same semantic set as Posten/Helthjem. Email watcher extended to extract Cainiao numbers.

## 2.1.18

- Map toolbar: zoom in/out, fit-to-route, PNG screenshot, and full-window expand buttons above every map.

## 2.1.17

- Timed calendar events: creates a 1-hour event on the estimated delivery date. Events start at 08:00 and stagger by 30 min when multiple parcels share a day. Deduplicated by tracking number across restarts.

## 2.1.16

- Semantic map route colors keyed to delivery status. Tile-only filter in the parcel list.

## 2.1.15

- Truck emoji 🚚 for in-transit parcels in the panel table. Carrier ETA estimate shown in the detail pane.

## 2.1.14

- Selectable route stop count (5 / 10 / 20 / all). Map controls toolbar above the route map.

## 2.1.13

- Color-coded route line and parcel list rows by delivery status (blue = in transit, grey = delivered, amber = ready for pickup, etc.).

## 2.1.12

- Full settings panel (language, mailbox/car-boot/carry-by-hand fit checks, notify service, calendar, stale thresholds, auto-remove timer). Parcel list filter toolbar (search, status filter, show/hide delivered).

## 2.1.11

- Fixed map flickering on every HA state push. Map now only re-renders when the selected parcel's route coordinates actually change.

## 2.1.10

- Switched route map tiles to OpenTopoMap (no Referer header requirement, CC-BY-SA).

## 2.1.6 – 2.1.9

- Various panel and map fixes: route map with directional arrows and checkpoint icons; carrier tracking links and smart disruption search; Norwegian i18n; animated plane on route; time-at-location column; pirate map easter egg removed; add-parcel from the panel; tile provider migrations (CartoDB → OSM → OpenTopoMap).

## 2.0.0

### New features

- **Sidebar panel**: a "Parcels" entry now appears in the HA left sidebar (like Energy or History). The panel shows a two-column layout — parcel table on the left; SVG route map + detail pane on the right. Clicking a row opens full event history, inline note/rename/icon editors, a carrier phone link (`tel:`), and a DuckDuckGo delay-search shortcut. Requires `frontend/panel.js` (shipped in the integration directory).
- **Per-parcel notes** (`set_note` / `clear_note`): attach a free-text note (up to 2000 chars) to any parcel. While a note is set it is exposed as the `note` sensor attribute and displayed in place of the live status in cards and the panel. Stored in HA `.storage` (`norwegian_parcel_tracker_meta`) and survives HA restarts.
- **Custom icons** (`set_icon` / `clear_icon`): assign an `mdi:icon-name`, an emoji (≤10 chars), or an `https://` image URL. Stored alongside the note in `.storage`, exposed as `npt_icon` sensor attribute, rendered in all card views and in the panel table.
- **Rename** (`rename_parcel`): set a friendly display name for a parcel. Writes to the config entry title, `entry.data["name"]`, and the device registry. Exposed as `display_name` sensor attribute.
- **Route coordinates**: after each update the integration geocodes all event locations in the background (via the existing Nominatim cache, rate-limited to 1 req/s, capped at 50 stops). Results are stored on the coordinator and exposed as the `route_coords` sensor attribute — a list of `{lat, lng, description, date_iso, location}` objects ordered most-recent-first. Not recorded by the HA recorder (`_unrecorded_attributes`).

### New services

| Service | Required fields | Description |
|---|---|---|
| `set_note` | `tracking_number`, `text` | Attach a note (max 2000 chars) |
| `clear_note` | `tracking_number` | Remove the note |
| `set_icon` | `tracking_number`, `icon` | Set icon (`mdi:`, emoji, or `https://` URL) |
| `clear_icon` | `tracking_number` | Remove the custom icon |
| `rename_parcel` | `tracking_number`, `name` | Set a display name (1–100 chars) |

### Card files now bundled

The Lovelace cards are now shipped inside the integration — no separate HACS frontend repo needed. After installing the integration, add three Lovelace resources in Settings → Dashboards → Resources:

| Resource URL | Card type |
|---|---|
| `/norwegian_parcel_tracker/card.js` | `custom:norwegian-parcel-tracker-card` |
| `/norwegian_parcel_tracker/compact_card.js` | `custom:norwegian-parcel-tracker-compact` |
| `/norwegian_parcel_tracker/map_card.js` | `custom:norwegian-parcel-tracker-map-card` |

### Other changes

- `manifest.json` version bumped to `2.0.0`; added `after_dependencies: ["frontend", "http", "panel_custom"]`.
- Panel and card JS served as static paths — all registered together on first HA start.
- Services and panel are guard-registered (safe to reload without duplicate registration).
- Meta store entries are cleaned up when a parcel entry is removed.
- `async_update_listeners()` (not `async_request_refresh()`) is used after meta changes — propagates to the UI immediately without triggering a carrier API call.

## 1.3.2

- Fixed critical bug: `'NoneType' object can't be awaited` on all parcel entries. `Store.async_delay_save` is a synchronous HA callback, not a coroutine; awaiting it returned `None` which crashed every parcel entry setup.

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
