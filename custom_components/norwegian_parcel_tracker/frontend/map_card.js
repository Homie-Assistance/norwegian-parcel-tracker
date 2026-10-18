/**
 * Norwegian Parcel Tracker — Map Card
 *
 * Shows the current geocoded location of a tracked parcel on a map,
 * plus the recent event history list below it.
 *
 * Config:
 *   type: custom:norwegian-parcel-tracker-map-card
 *   entity: device_tracker.parcel_abc123_location   (device_tracker entity)
 *   title: "My parcel"                              (optional)
 *   history_rows: 5                                 (event rows shown, default 5)
 *
 * The card automatically finds the matching status sensor (same device)
 * to pull the recent_events list.
 */

const CARD_VERSION = "2.0.0";
const DEFAULT_HISTORY_ROWS = 5;
const DEFAULT_ZOOM = 11;
const DEFAULT_MAX_STOPS = 20;

// ── Styles ────────────────────────────────────────────────────────────────────

const CARD_CSS = `
  :host {
    display: block;
  }
  ha-card {
    overflow: hidden;
  }
  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px 4px;
    font-size: 1.1em;
    font-weight: 500;
    color: var(--primary-text-color);
  }
  .card-header ha-icon {
    --mdi-icon-size: 20px;
    color: var(--state-active-color, var(--primary-color));
  }
  .map-wrapper {
    width: 100%;
    height: 260px;
    position: relative;
  }
  .ha-map-container > div {
    width: 100%;
    height: 100%;
  }
  .no-location {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 260px;
    color: var(--secondary-text-color);
    font-size: 0.9em;
    text-align: center;
    padding: 16px;
  }
  .events {
    padding: 8px 0 4px;
    border-top: 1px solid var(--divider-color);
  }
  .event-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 16px;
    font-size: 0.85em;
    line-height: 1.3;
  }
  .event-date {
    color: var(--secondary-text-color);
    white-space: nowrap;
    flex-shrink: 0;
    min-width: 100px;
  }
  .event-desc {
    color: var(--primary-text-color);
  }
  .event-loc {
    color: var(--secondary-text-color);
    margin-left: auto;
    white-space: nowrap;
  }
  .no-events {
    padding: 8px 16px 12px;
    color: var(--secondary-text-color);
    font-size: 0.85em;
  }
  .route-section {
    padding: 8px 0 0;
    border-top: 1px solid var(--divider-color);
  }
  .route-heading {
    padding: 4px 16px 6px;
    font-size: 0.75em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--secondary-text-color);
  }
  .route-svg-wrap {
    padding: 0 12px 12px;
  }
  .route-svg {
    width: 100%;
    background: var(--secondary-background-color, #1e1e1e);
    border-radius: 8px;
    display: block;
  }
  .route-polyline {
    stroke: var(--primary-color, #1976d2);
    stroke-width: 2;
    stroke-dasharray: 6 3;
    fill: none;
  }
  .route-stop {
    fill: var(--primary-color, #1976d2);
    opacity: 0.8;
  }
  .route-stop-current {
    fill: #f50057;
  }
  @keyframes npt-route-pulse {
    0%, 100% { r: 7; opacity: 1; }
    50%       { r: 10; opacity: 0.55; }
  }
  .route-stop-current { animation: npt-route-pulse 1.6s ease-in-out infinite; }
  .route-stop-label {
    fill: var(--secondary-text-color, #aaa);
    font-size: 9px;
  }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return iso.slice(0, 16).replace("T", " ");
  }
}

// ── Card element ──────────────────────────────────────────────────────────────

const _MC_CARTO_TILES = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const _MC_CARTO_ATTR = "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors &copy; <a href='https://carto.com/attributions'>CARTO</a>";
const _MC_LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const _MC_LEAFLET_JS  = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";

class NorwegianParcelTrackerMapCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._rendered = false;
    this._leafletMap = null;
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("norwegian-parcel-tracker-map-card: 'entity' is required");
    }
    this._config = {
      history_rows: DEFAULT_HISTORY_ROWS,
      show_route: true,
      max_stops: DEFAULT_MAX_STOPS,
      ...config,
    };
    this._rendered = false;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _findStatusSensorEntity() {
    const dtId = this._config.entity;
    const states = this._hass.states;
    const entities = this._hass.entities;

    // Prefer entity-registry lookup: find the sensor on the same device that has recent_events.
    // This is locale-agnostic — works regardless of HA language setting.
    if (entities && entities[dtId]?.device_id) {
      const deviceId = entities[dtId].device_id;
      for (const [eid, einfo] of Object.entries(entities)) {
        if (
          eid.startsWith("sensor.") &&
          einfo.device_id === deviceId &&
          states[eid]?.attributes?.recent_events !== undefined
        ) {
          return states[eid];
        }
      }
    }

    // Fallback for older HA or missing registry: strip the locale suffix from the
    // device_tracker slug and scan sensors for one sharing the base slug that has recent_events.
    const base = dtId.replace(/^device_tracker\./, "").replace(/_[^_]+$/, "");
    for (const [eid, estate] of Object.entries(states)) {
      if (
        eid.startsWith("sensor.") &&
        eid.includes(base) &&
        estate.attributes?.recent_events !== undefined
      ) {
        return estate;
      }
    }

    return null;
  }

  _render() {
    if (!this._hass || !this._config.entity) return;

    const hass = this._hass;
    const dtState = hass.states[this._config.entity];
    const sensorState = this._findStatusSensorEntity();

    const lat = dtState?.attributes?.latitude ?? null;
    const lon = dtState?.attributes?.longitude ?? null;
    const hasLocation = lat !== null && lon !== null;
    const locationName = dtState?.attributes?.friendly_name || this._config.entity;
    const latestLoc = dtState?.attributes?.location_name || "";

    const recentEvents = sensorState?.attributes?.recent_events || [];
    const rows = recentEvents.slice(0, this._config.history_rows);
    const routeCoords = sensorState?.attributes?.route_coords || [];

    const title = this._config.title ||
      (sensorState?.attributes?.friendly_name?.replace(/ Status$/, "") ?? "Parcel");

    // Avoid full re-render if only data changed (map stays mounted)
    if (!this._rendered) {
      this._buildShadow();
      this._rendered = true;
    }
    this._update(hasLocation, lat, lon, locationName, latestLoc, rows, title, routeCoords);
  }

  _buildShadow() {
    const root = this.shadowRoot;
    if (this._leafletMap) { try { this._leafletMap.remove(); } catch(e){} this._leafletMap = null; }
    root.innerHTML = "";

    const leafletLink = document.createElement("link");
    leafletLink.rel = "stylesheet";
    leafletLink.href = _MC_LEAFLET_CSS;

    const style = document.createElement("style");
    style.textContent = CARD_CSS;

    const card = document.createElement("ha-card");
    card.innerHTML = `
      <div class="card-header">
        <ha-icon icon="mdi:map-marker-path"></ha-icon>
        <span class="card-title"></span>
      </div>
      <div class="map-wrapper">
        <div class="no-location" style="display:none"></div>
        <div class="ha-map-container" style="width:100%;height:100%"></div>
      </div>
      <div class="events"></div>
      <div class="route-section" style="display:none"></div>
    `;

    root.appendChild(leafletLink);
    root.appendChild(style);
    root.appendChild(card);
  }

  _update(hasLocation, lat, lon, locationName, latestLoc, rows, title, routeCoords) {
    const root = this.shadowRoot;

    const titleEl = root.querySelector(".card-title");
    if (titleEl) titleEl.textContent = title;

    const noLocEl = root.querySelector(".no-location");
    const mapContainer = root.querySelector(".ha-map-container");

    if (!hasLocation) {
      if (noLocEl) {
        noLocEl.style.display = "flex";
        noLocEl.textContent = "Location not available yet — waiting for the first geocoded event.";
      }
      if (mapContainer) mapContainer.style.display = "none";
    } else {
      if (noLocEl) noLocEl.style.display = "none";
      if (mapContainer) {
        mapContainer.style.display = "";
        this._updateMap(mapContainer, lat, lon, locationName, latestLoc);
      }
    }

    const eventsEl = root.querySelector(".events");
    if (eventsEl) this._updateEvents(eventsEl, rows);

    const routeSection = root.querySelector(".route-section");
    if (routeSection) {
      const cfg = this._config;
      if (cfg.show_route !== false && routeCoords && routeCoords.length >= 2) {
        routeSection.style.display = "";
        this._renderRoute(routeSection, routeCoords, cfg.max_stops);
      } else {
        routeSection.style.display = "none";
        routeSection.innerHTML = "";
      }
    }
  }

  _renderRoute(container, coords, maxStops) {
    const stops = coords.slice(0, maxStops || DEFAULT_MAX_STOPS);
    if (stops.length < 2) {
      container.innerHTML = "";
      return;
    }

    const lats = stops.map(c => c.lat);
    const lngs = stops.map(c => c.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const dLat = (maxLat - minLat) || 0.05;
    const dLng = (maxLng - minLng) || 0.05;
    const pad = 0.12;
    const vMinLat = minLat - dLat * pad, vMaxLat = maxLat + dLat * pad;
    const vMinLng = minLng - dLng * pad, vMaxLng = maxLng + dLng * pad;

    const W = 480, H = 260;
    const toX = lng => ((lng - vMinLng) / (vMaxLng - vMinLng)) * W;
    const toY = lat => H - ((lat - vMinLat) / (vMaxLat - vMinLat)) * H;

    const pointsStr = stops.map(c => `${toX(c.lng).toFixed(1)},${toY(c.lat).toFixed(1)}`).join(" ");

    const esc = s => String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const dots = stops.map((c, i) => {
      const x = toX(c.lng), y = toY(c.lat);
      const isCurrent = i === 0;
      const shortLabel = (c.location || "").split(",")[0].trim().slice(0, 18);
      const tooltip = `${esc(c.date_iso ? c.date_iso.slice(0, 16).replace("T", " ") : "")} — ${esc(c.description || "")}`;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isCurrent ? 7 : 4}" class="${isCurrent ? "route-stop-current" : "route-stop"}"><title>${tooltip}</title></circle>${shortLabel ? `<text x="${(x + 9).toFixed(1)}" y="${(y + 4).toFixed(1)}" class="route-stop-label">${esc(shortLabel)}</text>` : ""}`;
    }).join("");

    container.innerHTML = `
      <div class="route-heading">Route (${stops.length} stop${stops.length !== 1 ? "s" : ""})</div>
      <div class="route-svg-wrap">
        <svg class="route-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
          <polyline points="${pointsStr}" class="route-polyline"/>
          ${dots}
        </svg>
      </div>`;
  }

  _updateMap(container, lat, lon, locationName, latestLoc) {
    this._initLeafletMap(container, lat, lon, latestLoc || locationName).catch(() => {});
  }

  async _ensureLeafletMC() {
    if (window.L && window.L.map) return;
    if (!document.getElementById("npt-leaflet-js")) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.id = "npt-leaflet-js";
        s.src = _MC_LEAFLET_JS;
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    } else {
      await new Promise((res) => {
        const t = setInterval(() => { if (window.L) { clearInterval(t); res(); } }, 40);
        setTimeout(() => { clearInterval(t); res(); }, 5000);
      });
    }
  }

  async _initLeafletMap(container, lat, lon, label) {
    try { await this._ensureLeafletMC(); } catch(e) { return; }
    const L = window.L;

    if (this._leafletMap) {
      this._leafletMap.setView([lat, lon], DEFAULT_ZOOM);
      if (this._leafletMapMarker) {
        this._leafletMapMarker.setLatLng([lat, lon]);
        this._leafletMapMarker.setTooltipContent(label || "");
      }
      return;
    }

    container.innerHTML = "";
    const mapDiv = document.createElement("div");
    mapDiv.style.cssText = "width:100%;height:100%";
    container.appendChild(mapDiv);

    const map = L.map(mapDiv, { zoomControl: true, scrollWheelZoom: false });
    L.tileLayer(_MC_CARTO_TILES, { attribution: _MC_CARTO_ATTR, subdomains: "abcd", maxZoom: 19 }).addTo(map);
    map.setView([lat, lon], DEFAULT_ZOOM);

    const marker = L.circleMarker([lat, lon], {
      radius: 10, color: "#1976d2", fillColor: "#42a5f5", fillOpacity: 0.85, weight: 2,
    }).bindTooltip(label || "").addTo(map);

    this._leafletMap = map;
    this._leafletMapMarker = marker;
  }

  _updateEvents(container, rows) {
    container.innerHTML = "";
    if (rows.length === 0) {
      const noEv = document.createElement("div");
      noEv.className = "no-events";
      noEv.textContent = "No events recorded yet.";
      container.appendChild(noEv);
      return;
    }
    for (const ev of rows) {
      const row = document.createElement("div");
      row.className = "event-row";

      const date = document.createElement("span");
      date.className = "event-date";
      date.textContent = _formatDate(ev.date_iso);

      const desc = document.createElement("span");
      desc.className = "event-desc";
      desc.textContent = ev.description || ev.status || "";

      row.appendChild(date);
      row.appendChild(desc);

      if (ev.location) {
        const loc = document.createElement("span");
        loc.className = "event-loc";
        loc.textContent = ev.location;
        row.appendChild(loc);
      }
      container.appendChild(row);
    }
  }

  static getConfigElement() {
    // Visual editor not implemented — use YAML config
    return null;
  }

  static getStubConfig() {
    return { entity: "device_tracker.parcel_TRACKINGNUMBER_location" };
  }

  getCardSize() {
    return 5;
  }
}

customElements.define("norwegian-parcel-tracker-map-card", NorwegianParcelTrackerMapCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "norwegian-parcel-tracker-map-card",
  name: "Norwegian Parcel Tracker — Map",
  description: "Shows the current parcel location on a map with recent event history.",
  preview: false,
  documentationURL: "https://github.com/Homie-Assistance/norwegian-parcel-tracker",
});
