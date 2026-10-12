# Norwegian Parcel Tracker

Track parcels from Posten, Bring, and Helthjem directly in Home Assistant.

Creates a set of sensor entities for each parcel, with optional notifications, calendar events, and a companion Lovelace card.

**Requires Home Assistant 2025.1.0 or later.**

---

## Entities

Each parcel gets the following entities:

| Entity | Type | Carriers | Description |
|---|---|---|---|
| Status | Sensor | All | Current parcel status text |
| Latest event | Sensor | All | Most recent tracking event description |
| Estimated delivery | Sensor | All | Estimated delivery date |
| Pickup point | Sensor | All | Name of pickup location |
| Delivery method | Sensor | All | Carrier product name (e.g. Pakke i postkassen, Helthjem) |
| Sender | Sensor | Posten/Bring | Sender name |
| Weight | Sensor | Posten/Bring | Package weight (kg) |
| Length / Width / Height | Sensor | Posten/Bring | Package dimensions (cm) |
| Order home delivery | Button | Posten/Bring | Fires a persistent notification with a link to order home delivery (only shown when Posten provides a redirect URL) |

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

## Global settings

The **Settings** integration entry (created automatically) holds options that apply to all parcels. Open it via **Configure** in the integration list:

| Option | Description | Default |
|---|---|---|
| Language | Language for Posten/Bring data (Norwegian or English) | Norwegian |
| Mailbox fit check | Report whether the parcel fits through your mailbox slot | Off |
| Car boot fit check | Report whether the parcel fits in your car boot | Off |
| Carry-by-hand check | Report whether the parcel is small enough to carry | Off |
| Default notify service | Fallback notification service for all parcels | — |
| Default calendar | Fallback calendar for estimated delivery events | — |
| Default stale warning (h) | Hours without movement before flagging as stuck | 24 |
| Default stale critical (h) | Hours without movement before flagging as critically stuck | 72 |
| **Auto-remove after delivery (h)** | **Remove delivered parcel entries automatically after this many hours. 0 = never.** | **0** |

## Per-parcel options

Each parcel entry has its own options, accessible via **Configure** in the integration list:

| Option | Description | Default |
|---|---|---|
| Notify target | HA notify service for parcel updates (e.g. `notify.mobile_app_myphone`) | — |
| Notify on all events | Send a notification on every new tracking event | Off |
| Notify on delivery | Send a notification when the parcel is delivered | On |
| Calendar entity | Create an all-day event on the estimated delivery date | — |
| Stale warning (hours) | Hours without a new event before flagging the parcel as stuck | 24 |
| Stale critical (hours) | Hours without a new event before flagging as critically stuck | 72 |

---

## Email watcher

The email watcher automatically scans an IMAP mailbox for order confirmation emails and adds recognised tracking numbers without any manual input.

### Setup

1. Go to **Settings → Devices & services → Add integration → Norwegian Parcel Tracker**.
2. If you already have the integration installed, click **Add entry** (or add the integration again) — you will see a menu.
3. Choose **Set up email watcher**.
4. Enter your IMAP credentials. For Gmail and Microsoft/Outlook accounts you **must** use an [app password](https://support.google.com/accounts/answer/185833) — your normal account password will not work.

| Provider | IMAP server | Port |
|---|---|---|
| Gmail | `imap.gmail.com` | 993 |
| Outlook / Microsoft 365 | `outlook.office365.com` | 993 |
| iCloud | `imap.mail.me.com` | 993 |

### What gets extracted

The watcher looks for these tracking number formats:

| Pattern | Example | Carrier |
|---|---|---|
| `JD` + 10–18 digits | `JD00004123456789` | Bring / Posten |
| `JVNO` + 6–14 digits | `JVNO01234567` | Bring / Posten |
| `JV` + 6–14 digits | `JV01234567` | Bring / Posten |
| 2 letters + 8–9 digits + 2 letters | `RR123456789NO` | International postal (UPU) |
| 20 digits starting with `0037` or `0033` | `00370000000000000000` | Posten / PostNord GS1 |

Numbers are validated via the carrier API before being added. Invalid or unsupported numbers are silently skipped and will not be retried.

### Privacy note

Credentials (including the password) are stored in Home Assistant's internal `.storage/core.config_entries` file, which is protected by your HA instance's access controls. Use a dedicated app password and a restricted mailbox if you want to limit exposure.

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
- This integration is not affiliated with Posten, Bring, Posten Bring AS, or Helthjem.

---

## Roadmap

Planned features in rough priority order:

| Feature | Status | Notes |
|---|---|---|
| **Autonomous email discovery** | Released (v1.3.0) | Integration polls an IMAP mailbox for order confirmation emails and automatically extracts and adds tracking numbers. No manual entry required. Works with any email provider via IMAP (Gmail, Outlook, etc.). Uses an app password — no external dependencies. |
| **Auto-remove delivered parcels** | Released (v1.2.2) | Configurable timer in global settings removes entries automatically after delivery. |
| **Parcel location map** | Planned | Create `device_tracker` entities with geocoded coordinates (Nominatim/OpenStreetMap) so parcels appear on the native HA map. Route history will be stored in `.storage/`. |
| **Custom route map card** | Planned | Companion Lovelace card with a Leaflet.js map showing the full delivery route — built on top of the location history above. |
| **Full event history storage** | Planned | Persist all tracking events (including geocoded coordinates) in HA `.storage/` for map routes and future delivery-time statistics. |
| **PostNord support** | Blocked | `feature/postnord` branch exists. Blocked on obtaining a PostNord Partner API agreement. |
| **Delivery statistics** | Future | Charts for typical delivery times per carrier, based on accumulated history. |

---

## Support

[Open an issue on GitHub](https://github.com/Homie-Assistance/norwegian-parcel-tracker/issues)
