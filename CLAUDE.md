# CLAUDE.md

Developer notes and architecture reference for AI-assisted development.

## Project Overview

This repository contains a Home Assistant custom integration for tracking Norwegian parcels via Posten/Bring, split into two sub-packages:

- **`norwegian-parcel-tracker/`** — Python backend integration (HA custom component)
- **`norwegian-parcel-tracker-card/`** — JavaScript Lovelace frontend card

## Development & Deployment

There is no build system, test suite, or CI/CD pipeline. Development workflow:

- **Backend**: Edit Python files directly in `custom_components/norwegian_parcel_tracker/`. Deploy by copying the directory to `/config/custom_components/` on your HA instance, then restart HA.
- **Frontend**: The card lives as a single pre-compiled file at `norwegian-parcel-tracker-card/dist/norwegian-parcel-tracker-card.js`. Edit it directly. Deploy by copying to `/config/www/` on HA.
- **Testing**: Manual testing against a live Home Assistant instance. No automated tests exist.

## Architecture

### Backend (`norwegian-parcel-tracker/custom_components/norwegian_parcel_tracker/`)

Data flows through three layers:

1. **`api.py` — `PostenTrackingClient`**: Fetches and parses `sporing.posten.no`. The primary strategy decodes React Router Flight stream data embedded in `window.__reactRouterContext` JSON. There is an HTML fallback parser for when that fails. Returns a `ParcelData` dataclass.

2. **`coordinator.py` — `PostenTrackingCoordinator`**: Wraps `DataUpdateCoordinator` (30-min polling). On each update it diffs the new `ParcelData` against saved state to fire notifications and create calendar events — this stateful diffing prevents duplicates across HA restarts.

3. **Entities** — `sensor.py` (10 sensor classes, one per data field) and `button.py` (home delivery button when a URL is available from Posten). All entities read from coordinator data, they do not call the API directly.

`config_flow.py` handles both initial setup (validates tracking number via live API call) and options (notification targets, calendar entity, stale thresholds).

`__init__.py` registers the `add_parcel` service and wires everything together at integration load/unload.

### Frontend (`norwegian-parcel-tracker-card/dist/norwegian-parcel-tracker-card.js`)

A single-file custom Lovelace card (`HTMLElement`-based). It queries all `sensor.*_status` entities to list parcels, color-codes rows by staleness (yellow ≥24 h, red ≥72 h, green = delivered), and has an input field that calls the `norwegian_parcel_tracker.add_parcel` service to add new tracking numbers.

## Key Implementation Notes

- **Posten parsing fragility**: The React Flight decoder in `api.py` is the brittle part of this codebase — Posten's page structure changes will break it. The fallback HTML parser exists for this reason.
- **Calendar deduplication**: The coordinator checks existing calendar events before creating new ones so HA restarts don't produce duplicate entries.
- **No external Python deps**: Only HA-bundled libraries (`aiohttp`, `voluptuous`) are used; `manifest.json` lists no `requirements`.
- **Localization**: Norwegian (`translations/nb.json`) and English (`translations/en.json`) are both maintained. `strings.json` is the source of truth that HA pulls for the config UI.
- **Minimum HA version**: 2025.1.0 (set in `manifest.json`).
