// Norwegian Parcel Tracker — Dashboard Panel v2.1

const _NO = {
  "No parcels tracked.": "Ingen pakker spores.",
  "Add one via the integration.": "Legg til via integrasjonen.",
  "No route data": "Ingen rutedata",
  "No location data yet": "Ingen posisjonsdata ennå",
  "parcel positions will appear here as events are tracked.": "pakkenes posisjoner vil vises her etter hvert som de spores.",
  "All parcel routes — click a dot to view details & route": "Alle pakkeruter — klikk på en prikk for detaljer og rute",
  "No location data yet:": "Ingen posisjonsdata ennå:",
  "Event history": "Hendelseslogg",
  "No events": "Ingen hendelser",
  "✏️ Rename": "✏️ Gi nytt navn",
  "📝 Edit note": "📝 Rediger notat",
  "📝 Add note": "📝 Legg til notat",
  "🎨 Set icon": "🎨 Velg ikon",
  "↺ Refresh": "↺ Oppdater",
  "Clear note": "Slett notat",
  "✏️ Rename parcel": "✏️ Gi pakken nytt navn",
  "Display name": "Visningsnavn",
  "Save": "Lagre",
  "Cancel": "Avbryt",
  "📝 Add note": "📝 Legg til notat",
  "📝 Edit note": "📝 Rediger notat",
  "Note — shown in cards and panel instead of status": "Notat — vises i kort og panel i stedet for status",
  "Clear icon": "Fjern ikon",
  "🎨 Set icon": "🎨 Velg ikon",
  "MDI icon": "MDI-ikon",
  "Image URL": "Bilde-URL",
  "Type the icon name (e.g. mdi:gift, mdi:truck-fast) and click Browse to search.": "Skriv inn ikonnavnet (f.eks. mdi:gift, mdi:truck-fast) og klikk Søk.",
  "Browse ↗": "Søk ↗",
  "Emoji": "Emoji",
  "📦 Note": "📦 Notat",
  "📝 Note": "📝 Notat",
};

const _CARTO_TILES = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
const _CARTO_ATTR = "Kartendaten: &copy; <a href='https://openstreetmap.org/copyright'>OpenStreetMap</a>-Mitwirkende, SRTM | Kartendarstellung: &copy; <a href='https://opentopomap.org'>OpenTopoMap</a> (<a href='https://creativecommons.org/licenses/by-sa/3.0/'>CC-BY-SA</a>)";
const _LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const _LEAFLET_JS  = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";

const _TOPOJSON_JS    = "https://cdnjs.cloudflare.com/ajax/libs/topojson/3.0.2/topojson.min.js";
const _WORLD_TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";

class NorwegianParcelTrackerPanel extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._parcels = [];
    this._selected = null;
    this._filterText = "";
    this._shadow = this.attachShadow({ mode: "open" });
    this._leafletMap = null;
    this._planeAnimId = null;
    this._animTimeout = null;
    const nav = (navigator.language || "").toLowerCase();
    const navIsNo = nav.startsWith("nb") || nav.startsWith("no") || nav.startsWith("nn");
    let savedLang = "auto";
    try { savedLang = localStorage.getItem("npt-language") || "auto"; } catch {}
    if (savedLang === "nb") this._isNo = true;
    else if (savedLang === "en") this._isNo = false;
    else this._isNo = navIsNo;
  }

  _t(k) { return (this._isNo && _NO[k]) ? _NO[k] : k; }

  _escapeHtml(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  set hass(hass) {
    this._hass = hass;
    this._parcels = Object.values(hass.states).filter(
      (s) => s.attributes && s.attributes.npt_master_entity === true
    );
    // Panel already rendered — update only the table rows, never the map
    if (this._shadow.getElementById("npt-panel-body")) {
      this._patchParcelRows();
      return;
    }
    this._render();
  }

  _buildParcelRows() {
    const parcels = this._parcels;
    return parcels.map((s) => {
      const a = s.attributes;
      const icon = this._renderIcon(a.npt_icon, a.status_code);
      const name = a.display_name || a.sender_name || a.tracking_number || s.entity_id;
      const status = s.state || "";
      const isActive = s.entity_id === this._selected;
      const curCoord = a.route_coords && a.route_coords[0];
      const loc = (curCoord && curCoord.location || "").split(",")[0].trim();
      const locTime = curCoord && curCoord.date_iso ? curCoord.date_iso.slice(0, 16).replace("T", " ") : "";
      const notePreview = a.note ? a.note.slice(0, 45) + (a.note.length > 45 ? "…" : "") : "";
      const tn = a.tracking_number || s.entity_id;
      const statusKey = this._parcelStatusColor(s);
      return `
        <tr class="parcel-row status-${statusKey} ${isActive ? "selected" : ""}" data-id="${s.entity_id}">
          <td class="col-icon">${icon}</td>
          <td class="col-name">${this._escHtml(name)}</td>
          <td class="col-status">${this._escHtml(status)}</td>
          <td class="col-loc">${this._escHtml(loc)}${locTime ? `<br><span class="col-loc-time">${this._escHtml(locTime)}</span>` : ""}</td>
          <td class="col-eta">${this._escHtml(a.estimated_delivery_iso ? a.estimated_delivery_iso.slice(0,10) : "")}</td>
          ${notePreview ? `<td class="col-note" data-tn="${this._escHtml(tn)}" data-note="${this._escHtml(a.note || "")}">📝 ${this._escHtml(notePreview)}</td>` : "<td></td>"}
        </tr>`;
    }).join("");
  }

  _patchParcelRows() {
    const tbody = this._shadow.querySelector(".parcel-table tbody");
    if (!tbody) return;
    tbody.innerHTML = this._buildParcelRows();
    this._shadow.querySelectorAll(".parcel-row").forEach((row) => {
      row.addEventListener("click", () => this._selectParcel(row.dataset.id));
    });
    this._shadow.querySelectorAll(".col-note[data-tn]").forEach((cell) => {
      cell.addEventListener("click", (e) => {
        e.stopPropagation();
        this._showNoteDialog(cell.dataset.tn, cell.dataset.note || "");
      });
    });
    if (this._filterText) this._filterParcels(this._filterText);

    // Also refresh the detail pane text (status, events, ETA) when a parcel is selected,
    // without touching the Leaflet map.  This is what makes the Refresh button visibly work.
    if (this._selected) {
      const selected = this._parcels.find((s) => s.entity_id === this._selected);
      const pane = this._shadow.querySelector(".detail-pane");
      if (selected && pane) {
        const tmp = document.createElement("div");
        tmp.innerHTML = this._renderDetailPane(selected);
        const newPane = tmp.firstElementChild;
        if (newPane) {
          pane.replaceWith(newPane);
          this._attachDetailPaneListeners(selected);
        }
      }
    }
  }

  set panel(panel) {
    this._panel = panel;
  }

  _escHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  _statusToMdi(code) {
    if (!code) return "mdi:package-variant-closed";
    switch (code) {
      case "DELIVERED":
      case "PICKED_UP":           return "mdi:check-circle";
      case "LOADED_FOR_DELIVERY": return "mdi:truck-delivery";
      case "IN_TRANSIT":          return "mdi:truck-fast";
      case "NOTIFICATION_SENT":
      case "READY_FOR_PICKUP":    return "mdi:store";
      case "ATTEMPTED_DELIVERY":  return "mdi:alert-circle";
      case "CUSTOMS":
      case "AT_CUSTOMS":          return "mdi:shield-check";
      case "RETURN_IN_TRANSIT":
      case "RETURNED":            return "mdi:package-variant-remove";
      case "EXPIRED":
      case "CANCELLED":           return "mdi:close-circle";
      case "AWAITING_SENDER":
      case "REGISTERED":          return "mdi:clock-outline";
      default:                    return "mdi:package-variant-closed";
    }
  }

  _renderIcon(icon, statusCode) {
    const fallback = this._statusToMdi(statusCode);
    if (!icon) return `<ha-icon icon="${fallback}"></ha-icon>`;
    if (icon.startsWith("mdi:")) return `<ha-icon icon="${this._escHtml(icon)}"></ha-icon>`;
    if (icon.startsWith("http://") || icon.startsWith("https://"))
      return `<img class="parcel-icon-img" src="${this._escHtml(icon)}" alt="">`;
    return `<span class="parcel-icon-emoji">${this._escHtml(icon)}</span>`;
  }

  _carrierPhone(carrier) {
    if (!carrier) return null;
    const c = String(carrier).toLowerCase();
    if (c === "posten" || c === "bring") return { num: "04040", label: "Posten 04040" };
    if (c === "helthjem") return { num: "22006400", label: "Helthjem 22 00 64 00" };
    return null;
  }

  _carrierLinks(carrier, trackingNumber) {
    const c = String(carrier || "").toLowerCase();
    const tn = encodeURIComponent(trackingNumber || "");
    const CARRIERS = {
      helthjem:  { url: `https://www.helthjem.no/sporing/${tn}`,          label: "Spor på Helthjem" },
      posten:    { url: `https://sporing.posten.no/tracking/${tn}`,        label: "Spor på Posten" },
      bring:     { url: `https://tracking.bring.com/tracking/${tn}`,       label: "Spor på Bring" },
      postnord:  { url: `https://www.postnord.no/mottaker/sporing?shipmentId=${tn}`, label: "Spor på PostNord" },
      dhl:       { url: `https://www.dhl.com/no-en/home/tracking.html?tracking-id=${tn}`, label: "Spor på DHL" },
      ups:       { url: `https://www.ups.com/track?tracknum=${tn}`,        label: "Spor på UPS" },
      fedex:     { url: `https://www.fedex.com/fedextrack/?trknbr=${tn}`,  label: "Spor på FedEx" },
    };
    const match = Object.entries(CARRIERS).find(([key]) => c.includes(key));
    if (match) return { tracking: match[1].url, trackingLabel: match[1].label };
    if (c) return { tracking: null, trackingLabel: `Carrier: ${carrier}` };
    return { tracking: null, trackingLabel: null };
  }

  _getSetting(key, def) {
    try { const v = localStorage.getItem(key); return v !== null ? v : def; } catch { return def; }
  }

  _setSetting(key, val) {
    try { localStorage.setItem(key, String(val)); } catch {}
  }

  _applyLangSetting(lang) {
    if (lang === "nb") this._isNo = true;
    else if (lang === "en") this._isNo = false;
    else {
      const nav = (navigator.language || "").toLowerCase();
      this._isNo = nav.startsWith("nb") || nav.startsWith("no") || nav.startsWith("nn");
    }
  }

  _searchEngine()    { return this._getSetting("npt-search-engine", "google"); }
  _possiblyLostDays(){ return parseInt(this._getSetting("npt-possibly-lost-days", "3"), 10); }
  _lostDays()        { return parseInt(this._getSetting("npt-lost-days", "5"), 10); }

  // Returns a status key string used for both row CSS classes and map polyline color.
  _parcelStatusColor(state) {
    const code = (state.attributes.status_code || "").toUpperCase();
    if (["DELIVERED", "PICKED_UP"].includes(code))           return "delivered";
    if (["READY_FOR_PICKUP", "NOTIFICATION_SENT"].includes(code)) return "pickup-ready";
    if (["CANCELLED", "EXPIRED"].includes(code))             return "cancelled";
    if (["RETURNED", "RETURN_IN_TRANSIT"].includes(code))    return "returned";
    if (["CUSTOMS", "AT_CUSTOMS"].includes(code))            return "parked";
    if (code === "ATTEMPTED_DELIVERY")                        return "delayed";
    // Stale check — uses user-configurable thresholds from settings
    const lastDate = state.attributes.route_coords
      && state.attributes.route_coords[0]
      && state.attributes.route_coords[0].date_iso;
    if (lastDate) {
      const daysSince = (Date.now() - new Date(lastDate).getTime()) / 864e5;
      if (daysSince >= this._lostDays())         return "lost";
      if (daysSince >= this._possiblyLostDays()) return "possibly-lost";
    }
    if (["IN_TRANSIT", "LOADED_FOR_DELIVERY"].includes(code)) return "in-transit";
    return "default";
  }

  _statusLineColor(key) {
    const MAP = {
      "in-transit":    "#2196f3",  // vivid blue  — actively moving
      "pickup-ready":  "#ff9800",  // amber        — human action required
      "delivered":     "#9e9e9e",  // mid grey     — done, visually recedes
      "parked":        "#3f51b5",  // indigo       — held/waiting
      "delayed":       "#ff5722",  // deep orange  — retry needed
      "possibly-lost": "#e53935",  // red          — warning
      "lost":          "#b71c1c",  // dark red     — alarm
      "cancelled":     "#607d8b",  // blue-grey    — dead/inactive
      "returned":      "#9c27b0",  // purple       — reversed flow
    };
    return MAP[key] || "#2196f3";
  }

  // Returns a Leaflet dashArray string for terminal/warning states; null for active (solid line).
  _statusLineDash(key) {
    if (["delivered", "cancelled", "returned"].includes(key)) return "6 10";
    if (["lost", "possibly-lost"].includes(key))              return "4 4";
    return null;
  }

  _statusMarkerEmoji(key, customIcon) {
    if (customIcon && !customIcon.startsWith("mdi:") && !customIcon.startsWith("http")) return customIcon;
    const MAP = {
      "delivered":     "✅",
      "pickup-ready":  "📬",
      "in-transit":    "🚚",
      "lost":          "❓",
      "possibly-lost": "⚠️",
      "parked":        "⏸️",
      "returned":      "↩️",
      "cancelled":     "✖️",
    };
    return MAP[key] || "✈️";
  }

  // Computes a simple next-update ETA from the spacing between recent route stops.
  _estimateNextUpdate(state) {
    const coords = (state.attributes.route_coords || []);
    if (coords.length < 2) return null;
    const intervals = [];
    for (let i = 0; i < Math.min(coords.length - 1, 6); i++) {
      const t1 = new Date(coords[i].date_iso).getTime();
      const t2 = new Date(coords[i + 1].date_iso).getTime();
      if (!isNaN(t1) && !isNaN(t2) && t1 > t2) intervals.push(t1 - t2);
    }
    if (intervals.length === 0) return null;
    intervals.sort((a, b) => a - b);
    const medianMs = intervals[Math.floor(intervals.length / 2)];
    const msSinceLast = Date.now() - new Date(coords[0].date_iso).getTime();
    return {
      nextInHours: Math.max(0, medianMs - msSinceLast) / 3600000,
      medianHours: medianMs / 3600000,
      sampleCount: intervals.length,
    };
  }

  _filterParcels(query) {
    this._filterText = (query || "").toLowerCase().trim();
    this._shadow.querySelectorAll(".parcel-row").forEach((row) => {
      const visible = !this._filterText || row.textContent.toLowerCase().includes(this._filterText);
      row.style.display = visible ? "" : "none";
    });
  }

  _disruptionSearchUrl(routeCoords) {
    const recent = (routeCoords || []).slice(0, 6);
    const places = [...new Set(
      recent
        .map((c) => (c.location || "").split(",")[0].trim())
        .filter((l) => l.length > 2)
    )].slice(0, 3);
    const locationPart = places.join(" ");
    const terms = locationPart
      ? `${locationPart} forsinkelse streik havn flyplass stengt`
      : "frakt forsinkelse streik";
    const q = encodeURIComponent(terms);
    const ENGINE = {
      google: `https://www.google.com/search?q=${q}&tbm=nws`,
      bing:   `https://www.bing.com/news/search?q=${q}`,
      ddg:    `https://duckduckgo.com/?q=${q}&ia=news`,
      brave:  `https://search.brave.com/news?q=${q}`,
    };
    return ENGINE[this._searchEngine()] || ENGINE.google;
  }

  _showSettingsDialog() {
    const engine    = this._searchEngine();
    const posLost = this._possiblyLostDays();
    const lost    = this._lostDays();
    const lang    = this._getSetting("npt-language", "auto");

    const no = this._isNo;

    const _row = (label, val, name, checked) =>
      `<label style="display:flex;align-items:center;gap:8px;margin:5px 0;cursor:pointer;font-size:0.9em">
         <input type="radio" name="${name}" value="${val}" ${checked ? "checked" : ""} style="accent-color:var(--primary-color,#1976d2)">${label}
       </label>`;

    const _sec = (title, body) =>
      `<div style="margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--divider-color,#333)">
         <div style="font-size:0.68em;text-transform:uppercase;letter-spacing:.09em;opacity:.5;margin-bottom:8px">${title}</div>
         ${body}
       </div>`;

    const langSection = _sec(no ? "Språk" : "Language", [
      _row(no ? "Automatisk (nettleser)" : "Auto-detect (browser)", "auto", "npt-lang", lang === "auto"),
      _row("Norsk",   "nb", "npt-lang", lang === "nb"),
      _row("English", "en", "npt-lang", lang === "en"),
    ].join(""));

    const threshSection = _sec(no ? "Statusterskel (dager uten oppdatering)" : "Status thresholds (days without update)",
      `<div style="display:flex;flex-direction:column;gap:8px">
         <div style="display:flex;align-items:center;gap:10px">
           <span style="flex:1;font-size:0.88em">${no ? "⚠️ Mulig tapt etter" : "⚠️ Possibly lost after"}</span>
           <input type="number" id="npt-possibly-lost" value="${posLost}" min="1" max="30" class="npt-input" style="width:52px;text-align:center" autocomplete="off">
           <span style="font-size:0.82em;opacity:.65">${no ? "dager" : "days"}</span>
         </div>
         <div style="display:flex;align-items:center;gap:10px">
           <span style="flex:1;font-size:0.88em">${no ? "🔴 Tapt etter" : "🔴 Lost after"}</span>
           <input type="number" id="npt-lost" value="${lost}" min="1" max="90" class="npt-input" style="width:52px;text-align:center" autocomplete="off">
           <span style="font-size:0.82em;opacity:.65">${no ? "dager" : "days"}</span>
         </div>
       </div>`);

    const engineSection = _sec(no ? "Søkemotor (forstyrrelsessøk)" : "Search engine (disruption search)", [
      _row("Google",     "google", "npt-engine", engine === "google"),
      _row("Bing",       "bing",   "npt-engine", engine === "bing"),
      _row("DuckDuckGo", "ddg",    "npt-engine", engine === "ddg"),
      _row("Brave",      "brave",  "npt-engine", engine === "brave"),
    ].join(""));

    const overlay = this._showModal(`
      <div class="npt-dialog" style="max-height:82vh;overflow-y:auto;max-width:400px">
        <h3>⚙️ ${no ? "Innstillinger" : "Settings"}</h3>
        ${langSection}${threshSection}${engineSection}
        <div class="npt-actions">
          <button class="npt-btn npt-btn-secondary" id="npt-cancel">${this._t("Cancel")}</button>
          <button class="npt-btn npt-btn-primary" id="npt-settings-save">${this._t("Save")}</button>
        </div>
      </div>`);

    overlay.querySelector("#npt-cancel").addEventListener("click", () => this._closeModal());
    overlay.querySelector("#npt-settings-save").addEventListener("click", () => {
      const chosenEngine = overlay.querySelector("input[name='npt-engine']:checked")?.value;
      if (chosenEngine) this._setSetting("npt-search-engine", chosenEngine);

      const posLostVal = parseInt(overlay.querySelector("#npt-possibly-lost")?.value || "3", 10);
      const lostVal    = parseInt(overlay.querySelector("#npt-lost")?.value || "5", 10);
      if (posLostVal >= 1) this._setSetting("npt-possibly-lost-days", posLostVal);
      if (lostVal >= 1)    this._setSetting("npt-lost-days", lostVal);

      const chosenLang = overlay.querySelector("input[name='npt-lang']:checked")?.value;
      const prevLang   = this._getSetting("npt-language", "auto");
      if (chosenLang) this._setSetting("npt-language", chosenLang);

      this._closeModal();

      if (chosenLang && chosenLang !== prevLang) {
        this._applyLangSetting(chosenLang);
        this._render();
      }
    });
  }

  _selectParcel(entityId) {
    this._selected = entityId === this._selected ? null : entityId;
    this._render();
  }

  _callService(domain, service, data) {
    if (this._hass) this._hass.callService(domain, service, data);
  }

  // ── Modal system ──────────────────────────────────────────────────────────

  _showModal(innerHtml) {
    const existing = this._shadow.getElementById("npt-overlay");
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.id = "npt-overlay";
    overlay.innerHTML = `
      <style>
        #npt-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.65);
          z-index: 9999; display: flex; align-items: center; justify-content: center;
        }
        .npt-dialog {
          background: var(--card-background-color, #1e1e1e);
          color: var(--primary-text-color, #eee);
          border-radius: 10px; padding: 22px 24px;
          min-width: 340px; max-width: 460px; width: 90vw;
          box-shadow: 0 8px 40px rgba(0,0,0,0.6);
        }
        .npt-dialog h3 { margin: 0 0 16px; font-size: 1.05em; font-weight: 600; }
        .npt-label { display: block; font-size: 0.78em; opacity: 0.65; margin: 12px 0 4px; }
        .npt-input {
          width: 100%; box-sizing: border-box;
          background: var(--secondary-background-color, #111);
          color: var(--primary-text-color, #eee);
          border: 1px solid var(--divider-color, #444);
          border-radius: 5px; padding: 8px 10px; font-size: 0.9em;
          font-family: inherit;
        }
        .npt-input:focus { outline: none; border-color: var(--primary-color, #1976d2); }
        textarea.npt-input { resize: vertical; min-height: 90px; }
        .npt-row { display: flex; gap: 6px; align-items: center; }
        .npt-row .npt-input { flex: 1; }
        .npt-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; flex-wrap: wrap; }
        .npt-btn { border: none; border-radius: 5px; padding: 7px 16px; cursor: pointer; font-size: 0.85em; font-family: inherit; }
        .npt-btn-primary { background: var(--primary-color, #1976d2); color: #fff; }
        .npt-btn-secondary { background: transparent; border: 1px solid var(--divider-color, #555); color: var(--primary-text-color, #eee); }
        .npt-btn-danger { background: var(--error-color, #b00020); color: #fff; margin-right: auto; }
        .npt-btn-browse { background: transparent; border: 1px solid var(--divider-color, #555); color: var(--primary-text-color, #eee); text-decoration: none; white-space: nowrap; display: inline-flex; align-items: center; border-radius: 5px; padding: 7px 12px; font-size: 0.85em; cursor: pointer; }
        .icon-tabs { display: flex; gap: 4px; margin-bottom: 14px; }
        .icon-tab {
          background: transparent; border: 1px solid var(--divider-color, #444);
          color: var(--primary-text-color, #eee); border-radius: 5px;
          padding: 5px 14px; cursor: pointer; font-size: 0.85em; font-family: inherit;
        }
        .icon-tab.active { background: var(--primary-color, #1976d2); color: #fff; border-color: transparent; }
        .icon-panel { display: none; }
        .icon-panel.visible { display: block; }
        .emoji-grid { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
        .emoji-btn {
          background: var(--secondary-background-color, #2a2a2a);
          border: 1px solid var(--divider-color, #444); border-radius: 5px;
          padding: 5px 7px; cursor: pointer; font-size: 1.25em; line-height: 1;
        }
        .emoji-btn:hover { background: var(--primary-color, #1976d2); border-color: transparent; }
      </style>
      ${innerHtml}`;
    this._shadow.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) this._closeModal(); });
    return overlay;
  }

  _closeModal() {
    const overlay = this._shadow.getElementById("npt-overlay");
    if (overlay) overlay.remove();
  }

  _showRenameDialog(tn, current) {
    const overlay = this._showModal(`
      <div class="npt-dialog">
        <h3>${this._t("✏️ Rename parcel")}</h3>
        <span class="npt-label">${this._t("Display name")}</span>
        <input class="npt-input" id="npt-rename-inp" type="text" value="${this._escHtml(current)}" maxlength="100">
        <div class="npt-actions">
          <button class="npt-btn npt-btn-secondary" id="npt-cancel">${this._t("Cancel")}</button>
          <button class="npt-btn npt-btn-primary" id="npt-save">${this._t("Save")}</button>
        </div>
      </div>`);
    const inp = overlay.querySelector("#npt-rename-inp");
    inp.focus(); inp.select();
    overlay.querySelector("#npt-cancel").addEventListener("click", () => this._closeModal());
    overlay.querySelector("#npt-save").addEventListener("click", () => {
      const name = inp.value.trim();
      if (name) { this._callService("norwegian_parcel_tracker", "rename_parcel", { tracking_number: tn, name }); this._closeModal(); }
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") overlay.querySelector("#npt-save").click();
      if (e.key === "Escape") this._closeModal();
    });
  }

  _showAddParcelDialog() {
    const overlay = this._showModal(`
      <div class="npt-dialog">
        <h3>${this._isNo ? "📦 Legg til pakke" : "📦 Add parcel"}</h3>
        <span class="npt-label">${this._isNo ? "Sporingsnummer" : "Tracking number"}</span>
        <input class="npt-input" id="npt-tn-inp" type="text" placeholder="e.g. 00370726600123456789" maxlength="60" autocomplete="off" spellcheck="false">
        <span class="npt-label" style="margin-top:10px">${this._isNo ? "Visningsnavn (valgfritt)" : "Display name (optional)"}</span>
        <input class="npt-input" id="npt-name-inp" type="text" placeholder="${this._isNo ? "f.eks. Ny laptop" : "e.g. New laptop"}" maxlength="100">
        <div class="npt-actions">
          <button class="npt-btn npt-btn-secondary" id="npt-cancel">${this._t("Cancel")}</button>
          <button class="npt-btn npt-btn-primary" id="npt-save">${this._isNo ? "Legg til" : "Add"}</button>
        </div>
      </div>`);
    const tnInp = overlay.querySelector("#npt-tn-inp");
    const nameInp = overlay.querySelector("#npt-name-inp");
    tnInp.focus();
    overlay.querySelector("#npt-cancel").addEventListener("click", () => this._closeModal());
    const doAdd = () => {
      const tracking_number = tnInp.value.trim().replace(/\s+/g, "");
      if (!tracking_number) { tnInp.style.borderColor = "var(--error-color, #cf6679)"; tnInp.focus(); return; }
      const data = { tracking_number };
      const name = nameInp.value.trim();
      if (name) data.name = name;
      this._callService("norwegian_parcel_tracker", "add_parcel", data);
      this._closeModal();
    };
    overlay.querySelector("#npt-save").addEventListener("click", doAdd);
    tnInp.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInp.focus(); if (e.key === "Escape") this._closeModal(); });
    nameInp.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); if (e.key === "Escape") this._closeModal(); });
  }

  _showNoteDialog(tn, current) {
    const overlay = this._showModal(`
      <div class="npt-dialog">
        <h3>${current ? this._t("📝 Edit note") : this._t("📝 Add note")}</h3>
        <span class="npt-label">${this._t("Note — shown in cards and panel instead of status")}</span>
        <textarea class="npt-input" id="npt-note-inp" maxlength="2000">${this._escHtml(current)}</textarea>
        <div class="npt-actions">
          ${current ? `<button class="npt-btn npt-btn-danger" id="npt-clear-note">${this._t("Clear note")}</button>` : ""}
          <button class="npt-btn npt-btn-secondary" id="npt-cancel">${this._t("Cancel")}</button>
          <button class="npt-btn npt-btn-primary" id="npt-save">${this._t("Save")}</button>
        </div>
      </div>`);
    const ta = overlay.querySelector("#npt-note-inp");
    ta.focus();
    overlay.querySelector("#npt-cancel").addEventListener("click", () => this._closeModal());
    overlay.querySelector("#npt-save").addEventListener("click", () => {
      const text = ta.value.trim();
      if (text) this._callService("norwegian_parcel_tracker", "set_note", { tracking_number: tn, text });
      else this._callService("norwegian_parcel_tracker", "clear_note", { tracking_number: tn });
      this._closeModal();
    });
    const clearBtn = overlay.querySelector("#npt-clear-note");
    if (clearBtn) clearBtn.addEventListener("click", () => {
      this._callService("norwegian_parcel_tracker", "clear_note", { tracking_number: tn });
      this._closeModal();
    });
  }

  _showAddNoteDialog(tn) {
    const overlay = this._showModal(`
      <div class="npt-dialog">
        <h3>${this._isNo ? "📝 Legg til notat" : "📝 Add note"}</h3>
        <span class="npt-label">${this._t("Note — shown in cards and panel instead of status")}</span>
        <textarea class="npt-input" id="npt-note-inp" maxlength="2000" placeholder="${this._isNo ? "Skriv notat…" : "Write note…"}"></textarea>
        <div class="npt-actions">
          <button class="npt-btn npt-btn-secondary" id="npt-cancel">${this._t("Cancel")}</button>
          <button class="npt-btn npt-btn-primary" id="npt-save">${this._t("Save")}</button>
        </div>
      </div>`);
    const ta = overlay.querySelector("#npt-note-inp");
    ta.focus();
    overlay.querySelector("#npt-cancel").addEventListener("click", () => this._closeModal());
    overlay.querySelector("#npt-save").addEventListener("click", () => {
      const text = ta.value.trim();
      if (text) this._callService("norwegian_parcel_tracker", "add_note", { tracking_number: tn, text });
      this._closeModal();
    });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this._closeModal();
    });
  }

  _showIconDialog(tn, current) {
    let activeTab = "mdi";
    if (current && (current.startsWith("http://") || current.startsWith("https://"))) activeTab = "url";
    else if (current && !current.startsWith("mdi:")) activeTab = "emoji";

    const EMOJIS = ["📦","🎁","📮","🏠","🛒","🚚","✈️","🛳️","📫","🏷️","🎀","💊","📱","👕","👟","🖥️","📚","🛍️","🎮","⌚"];
    const emojiGrid = EMOJIS.map((e) => `<button class="emoji-btn" data-emoji="${e}">${e}</button>`).join("");

    const mdiVal = current && current.startsWith("mdi:") ? this._escHtml(current) : "";
    const urlVal = current && current.startsWith("http") ? this._escHtml(current) : "";
    const emojiVal = current && !current.startsWith("mdi:") && !current.startsWith("http") ? this._escHtml(current) : "";

    const overlay = this._showModal(`
      <div class="npt-dialog">
        <h3>${this._t("🎨 Set icon")}</h3>
        <div class="icon-tabs">
          <button class="icon-tab${activeTab === "mdi" ? " active" : ""}" data-tab="mdi">${this._t("MDI icon")}</button>
          <button class="icon-tab${activeTab === "url" ? " active" : ""}" data-tab="url">${this._t("Image URL")}</button>
          <button class="icon-tab${activeTab === "emoji" ? " active" : ""}" data-tab="emoji">${this._t("Emoji")}</button>
        </div>

        <div class="icon-panel${activeTab === "mdi" ? " visible" : ""}" id="tab-mdi">
          <span class="npt-label">MDI icon</span>
          <div class="npt-row">
            <input class="npt-input" id="mdi-inp" type="text" placeholder="mdi:package-variant-closed" value="${mdiVal}">
            <a class="npt-btn-browse" href="https://pictogrammers.com/library/mdi/" target="_blank" rel="noopener">${this._t("Browse ↗")}</a>
          </div>
          <span class="npt-label" style="opacity:0.45">${this._t("Type the icon name (e.g. mdi:gift, mdi:truck-fast) and click Browse to search.")}</span>
        </div>

        <div class="icon-panel${activeTab === "url" ? " visible" : ""}" id="tab-url">
          <span class="npt-label">${this._t("Image URL")} (https://)</span>
          <input class="npt-input" id="url-inp" type="url" placeholder="https://example.com/icon.png" value="${urlVal}">
        </div>

        <div class="icon-panel${activeTab === "emoji" ? " visible" : ""}" id="tab-emoji">
          <span class="npt-label">${this._t("Emoji")}</span>
          <input class="npt-input" id="emoji-inp" type="text" placeholder="📦" maxlength="10" value="${emojiVal}" style="font-size:1.4em">
          <div class="emoji-grid">${emojiGrid}</div>
        </div>

        <div class="npt-actions">
          ${current ? `<button class="npt-btn npt-btn-danger" id="npt-clear-icon">${this._t("Clear icon")}</button>` : ""}
          <button class="npt-btn npt-btn-secondary" id="npt-cancel">${this._t("Cancel")}</button>
          <button class="npt-btn npt-btn-primary" id="npt-save-icon">${this._t("Save")}</button>
        </div>
      </div>`);

    overlay.querySelectorAll(".icon-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        overlay.querySelectorAll(".icon-tab").forEach((t) => t.classList.remove("active"));
        overlay.querySelectorAll(".icon-panel").forEach((p) => p.classList.remove("visible"));
        tab.classList.add("active");
        overlay.querySelector(`#tab-${tab.dataset.tab}`).classList.add("visible");
        overlay.querySelector(`#${tab.dataset.tab}-inp`)?.focus();
      });
    });

    overlay.querySelectorAll(".emoji-btn").forEach((btn) => {
      btn.addEventListener("click", () => { overlay.querySelector("#emoji-inp").value = btn.dataset.emoji; });
    });

    overlay.querySelector("#npt-cancel").addEventListener("click", () => this._closeModal());

    const clearBtn = overlay.querySelector("#npt-clear-icon");
    if (clearBtn) clearBtn.addEventListener("click", () => {
      this._callService("norwegian_parcel_tracker", "clear_icon", { tracking_number: tn });
      this._closeModal();
    });

    overlay.querySelector("#npt-save-icon").addEventListener("click", () => {
      const activeTabEl = overlay.querySelector(".icon-tab.active");
      const tabName = activeTabEl ? activeTabEl.dataset.tab : "mdi";
      const icon = (overlay.querySelector(`#${tabName}-inp`)?.value || "").trim();
      if (icon) this._callService("norwegian_parcel_tracker", "set_icon", { tracking_number: tn, icon });
      this._closeModal();
    });

    overlay.querySelector(`#${activeTab}-inp`)?.focus();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  _renderDetailPane(state) {
    const a = state.attributes;
    const events = a.recent_events || [];
    const notes = a.notes || (a.note ? [{ text: a.note, ts: "", idx: 0 }] : []);
    const phone = this._carrierPhone(a.carrier);
    const trackingNum = a.tracking_number || state.entity_id;
    const carrierLinks = this._carrierLinks(a.carrier, trackingNum);
    const disruptionUrl = this._disruptionSearchUrl(a.route_coords);
    const homeDeliveryUrl = a.home_delivery_url || null;
    const pickupUrl = a.pickup_url || null;
    const pickupName = a.pickup_name || null;

    const eventsHtml = events
      .slice(0, 20)
      .map((e) => {
        const loc = (e.location || "").trim();
        const locHtml = loc
          ? `<a href="https://www.openstreetmap.org/search?query=${encodeURIComponent(loc)}" target="_blank" rel="noopener" class="event-loc-link">${this._escHtml(loc)}</a>`
          : "";
        return `
        <div class="event-row">
          <span class="event-date">${this._escHtml(e.date_iso ? e.date_iso.slice(0, 16).replace("T", " ") : "")}</span>
          <span class="event-desc">${this._escHtml(e.description)}</span>
          <span class="event-loc">${locHtml}</span>
        </div>`;
      })
      .join("");

    const notesHtml = notes.length === 0
      ? `<div class="notes-empty">${this._isNo ? "Ingen notater ennå" : "No notes yet"}</div>`
      : notes.map((n) => {
          const tsDisplay = n.ts && n.ts !== "migrated"
            ? n.ts.slice(0, 16).replace("T", " ")
            : "";
          return `<div class="note-entry" data-idx="${n.idx}">
            ${tsDisplay ? `<div class="note-meta">${this._escHtml(tsDisplay)}</div>` : ""}
            <div class="note-text">${this._escHtml(n.text)}</div>
            <button class="note-delete" data-idx="${n.idx}" title="${this._isNo ? "Slett notat" : "Delete note"}">🗑</button>
          </div>`;
        }).join("");

    const terminalStates = ["DELIVERED", "PICKED_UP", "CANCELLED", "EXPIRED", "RETURNED"];
    const isTerminal = terminalStates.includes((a.status_code || "").toUpperCase());
    const eta = !isTerminal ? this._estimateNextUpdate(state) : null;
    const no = this._isNo;
    let etaHtml = "";
    if (eta) {
      const hours = eta.nextInHours;
      const valStr = hours < 0.5
        ? (no ? "Innen kort tid" : "Soon")
        : hours < 24
          ? `~${hours.toFixed(0)}h`
          : `~${(hours / 24).toFixed(1)}${no ? "d" : "d"}`;
      const noteStr = `(${no ? "basert på " + eta.sampleCount + " stopp" : eta.sampleCount + " stops"})`;
      etaHtml = `<div class="detail-eta">
        <span class="eta-label">${no ? "Estimert neste oppdatering" : "Est. next update"}:</span>
        <span class="eta-val">${this._escHtml(valStr)}</span>
        <span class="eta-note">${this._escHtml(noteStr)}</span>
      </div>`;
    }

    return `
      <div class="detail-pane">
        <h2>${this._escHtml(a.display_name || a.sender_name || trackingNum)}</h2>
        <div class="detail-tracking">${this._escHtml(trackingNum)}</div>
        ${etaHtml}

        <div class="detail-actions">
          <button class="btn" id="btn-rename">${this._t("✏️ Rename")}</button>
          <button class="btn btn-icon" id="btn-icon">${this._t("🎨 Set icon")}</button>
          <button class="btn btn-refresh" id="btn-refresh">${this._t("↺ Refresh")}</button>
        </div>

        <div class="notes-section">
          <div class="notes-header">
            <span>📝 ${this._isNo ? "Notater" : "Notes"}</span>
            <button class="btn btn-note" id="btn-add-note">${this._isNo ? "+ Legg til notat" : "+ Add note"}</button>
          </div>
          ${notesHtml}
        </div>

        <div class="carrier-links">
          ${carrierLinks.tracking ? `<a href="${this._escHtml(carrierLinks.tracking)}" target="_blank" rel="noopener noreferrer" class="carrier-link">🔗 ${this._escHtml(carrierLinks.trackingLabel)}</a>` : (carrierLinks.trackingLabel ? `<span class="carrier-link-text">📦 ${this._escHtml(carrierLinks.trackingLabel)}</span>` : "")}
          ${homeDeliveryUrl ? `<a href="${this._escHtml(homeDeliveryUrl)}" target="_blank" rel="noopener noreferrer" class="carrier-link">🏠 ${this._isNo ? "Bestill hjemlevering" : "Order home delivery"}</a>` : ""}
          ${pickupUrl ? `<a href="${this._escHtml(pickupUrl)}" target="_blank" rel="noopener noreferrer" class="carrier-link">📍 ${this._escHtml(pickupName || (this._isNo ? "Hentested" : "Pickup point"))}</a>` : ""}
          <a href="${this._escHtml(disruptionUrl)}" target="_blank" rel="noopener noreferrer" class="carrier-link">🌐 Søk etter forstyrrelser</a>
          ${phone ? `<a href="tel:${this._escHtml(phone.num)}" class="carrier-link">📞 ${this._escHtml(phone.label)}</a>` : ""}
        </div>

        <h3>${this._t("Event history")}</h3>
        <div class="events-list">${eventsHtml || `<p>${this._t("No events")}</p>`}</div>
      </div>`;
  }

  _renderAllParcelsMap(parcels) {
    const hasRoutes = parcels.some((s) => s.attributes.route_coords && s.attributes.route_coords.length > 0);
    if (!hasRoutes) {
      const msg = this._isNo
        ? "Ingen posisjonsdata ennå — pakkeposisjonene vises her etter hvert som de spores."
        : "No location data yet — parcel positions will appear here as events are tracked.";
      return `<div class="map-empty" style="padding-top:40px">${msg}</div>`;
    }
    const noDataParcels = parcels.filter((s) => !s.attributes.route_coords || s.attributes.route_coords.length === 0);
    const noDataHtml = noDataParcels.length > 0
      ? `<div style="font-size:0.8em;opacity:0.5;margin-top:8px">${this._isNo ? "Ingen rutedata ennå:" : "No location data yet:"} ${noDataParcels.map((s) => this._escHtml(s.attributes.display_name || s.attributes.sender_name || s.attributes.tracking_number || s.entity_id)).join(", ")}</div>`
      : "";
    const no = this._isNo;
    return `
      <div style="font-size:0.78em;opacity:0.55;padding:0 0 6px">${this._t("All parcel routes — click a dot to view details & route")}</div>
      <div class="map-block">
        <div class="map-controls">
          <span class="map-ctrl-label">${no ? "Alle ruter" : "All routes"}</span>
          <div style="flex:1"></div>
          <button class="map-act-btn" data-map-action="zoomin"    title="${no ? "Zoom inn" : "Zoom in"}">+</button>
          <button class="map-act-btn" data-map-action="zoomout"   title="${no ? "Zoom ut" : "Zoom out"}">&minus;</button>
          <button class="map-act-btn" data-map-action="fit"       title="${no ? "Tilpass kart" : "Fit to routes"}">&#x229B;</button>
          <button class="map-act-btn" data-map-action="screenshot" title="${no ? "Skjermbilde" : "Screenshot"}">&#x1F4F7;</button>
          <button class="map-act-btn" data-map-action="expand"    title="${no ? "Fullvindu" : "Full window"}">&#x26F6;</button>
        </div>
        <div class="map-frame-overview"><div id="npt-overview-map" class="leaflet-map-overview"></div></div>
      </div>
      ${noDataHtml}`;
  }

  _renderRouteMap(state) {
    const coords = (state && state.attributes && state.attributes.route_coords) || [];
    if (coords.length === 0) return `<div class="map-empty">${this._t("No route data")}</div>`;
    const no = this._isNo;
    return `
      <div class="map-block">
        <div class="map-controls">
          <span class="map-ctrl-label" style="opacity:0.45">🗺️ ${no ? "Kart" : "Route map"}</span>
          <div style="flex:1"></div>
          <button class="map-act-btn" data-map-action="zoomin"     title="${no ? "Zoom inn" : "Zoom in"}">+</button>
          <button class="map-act-btn" data-map-action="zoomout"    title="${no ? "Zoom ut" : "Zoom out"}">&minus;</button>
          <button class="map-act-btn" data-map-action="fit"        title="${no ? "Tilpass visning" : "Fit to route"}">&#x229B;</button>
          <button class="map-act-btn" data-map-action="screenshot" title="${no ? "Skjermbilde" : "Screenshot"}">&#x1F4F7;</button>
          <button class="map-act-btn" data-map-action="expand"     title="${no ? "Fullvindu" : "Full window"}">&#x26F6;</button>
        </div>
        <div class="board-map-frame"><div id="npt-route-map" class="board-map-div"></div></div>
      </div>`;
  }

  _render() {
    if (!this._hass) return;
    const parcels = this._parcels;
    const selected = this._selected
      ? parcels.find((s) => s.entity_id === this._selected)
      : null;

    const rows = this._buildParcelRows();

    if (this._animTimeout) { clearTimeout(this._animTimeout); this._animTimeout = null; }
    if (this._planeAnimId) { cancelAnimationFrame(this._planeAnimId); this._planeAnimId = null; }
    if (this._leafletMap) { try { this._leafletMap.remove(); } catch(e){} this._leafletMap = null; }
    if (this._mapEscHandler) { document.removeEventListener("keydown", this._mapEscHandler); this._mapEscHandler = null; }

    this._shadow.innerHTML = `
      <link rel="stylesheet" href="${_LEAFLET_CSS}">
      <style>
        :host { display: flex; flex-direction: column; height: 100%; background: var(--primary-background-color, #111); color: var(--primary-text-color, #eee); font-family: var(--paper-font-body1_-_font-family, sans-serif); }
        .panel-header { display: flex; align-items: center; padding: 12px 16px; background: var(--app-header-background-color, #1976d2); color: var(--app-header-text-color, #fff); font-size: 1.2em; font-weight: 600; }
        .panel-header ha-icon { margin-right: 8px; }
        .panel-header-title { flex: 1; }
        .btn-settings { background: transparent; border: none; color: var(--app-header-text-color,#fff); cursor: pointer; font-size: 1.1em; padding: 4px 8px; border-radius: 4px; opacity: 0.8; }
        .btn-settings:hover { opacity: 1; background: rgba(255,255,255,0.12); }
        .btn-add-parcel { background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.4); color: var(--app-header-text-color,#fff); cursor: pointer; font-size: 0.82em; padding: 4px 12px; border-radius: 4px; font-family: inherit; margin-right: 6px; }
        .btn-add-parcel:hover { background: rgba(255,255,255,0.25); }
        .panel-body { display: flex; flex: 1; overflow: hidden; }
        .left-pane { width: 44%; min-width: 280px; display: flex; flex-direction: column; border-right: 1px solid var(--divider-color, #333); overflow: hidden; }
        .no-selected .left-pane { width: 100%; border-right: none; }
        .right-pane { flex: 1; overflow: auto; padding: 12px; }
        .left-toolbar { display:flex; align-items:center; gap:5px; padding:7px 8px 6px; border-bottom:1px solid var(--divider-color,#333); }
        .left-filter { flex:1; background:var(--secondary-background-color,#1e1e1e); color:var(--primary-text-color,#eee); border:1px solid var(--divider-color,#444); border-radius:4px; padding:5px 8px; font-size:0.82em; font-family:inherit; outline:none; }
        .left-filter:focus { border-color:var(--primary-color,#1976d2); }
        .btn-left-settings { background:transparent; border:none; color:var(--primary-text-color,#eee); cursor:pointer; font-size:1em; padding:3px 6px; border-radius:4px; opacity:0.6; line-height:1; }
        .btn-left-settings:hover { opacity:1; background:rgba(255,255,255,0.07); }
        .parcel-table { width: 100%; border-collapse: collapse; overflow-y: auto; }
        .parcel-table th { text-align: left; padding: 6px 8px; font-size: 0.75em; text-transform: uppercase; opacity: 0.6; border-bottom: 1px solid var(--divider-color, #333); }
        .parcel-row { cursor: pointer; }
        .parcel-row:hover { background: var(--secondary-background-color, #1e1e1e); }
        .parcel-row.selected { background: var(--primary-color-light, #1a3a5c); }
        .parcel-row td { padding: 8px; border-bottom: 1px solid var(--divider-color, #222); vertical-align: middle; }
        .col-icon { width: 32px; }
        .parcel-icon-img { width: 24px; height: 24px; border-radius: 4px; object-fit: contain; }
        .parcel-icon-emoji { font-size: 20px; }
        .col-status { font-size: 0.85em; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .col-eta { font-size: 0.75em; opacity: 0.6; white-space: nowrap; }
        .col-loc { font-size: 0.78em; opacity: 0.8; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }
        .col-loc-time { font-size: 0.85em; opacity: 0.5; display: block; }
        .col-note { font-size: 0.78em; color: #ffd740; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
        .col-note:hover { text-decoration: underline; }
        .map-controls { display:flex; align-items:center; gap:5px; padding:5px 0 6px; }
        .map-ctrl-label { font-size:0.74em; opacity:0.5; margin-right:2px; }
        .map-ctrl-btn { background:transparent; border:1px solid var(--divider-color,#444); color:var(--primary-text-color,#eee); border-radius:4px; padding:3px 9px; cursor:pointer; font-size:0.78em; font-family:inherit; }
        .map-ctrl-btn:hover { background:rgba(255,255,255,0.07); }
        .map-ctrl-btn.active { background:var(--primary-color,#1976d2); border-color:transparent; color:#fff; }
        .map-act-btn { background:transparent; border:1px solid var(--divider-color,#444); color:var(--primary-text-color,#eee); border-radius:4px; padding:3px 7px; cursor:pointer; font-size:0.82em; font-family:inherit; line-height:1; }
        .map-act-btn:hover { background:rgba(255,255,255,0.07); }
        .map-controls { flex-wrap:wrap; }
        .map-block { position:relative; }
        .map-block.map-expanded { position:fixed; inset:0; z-index:9999; display:flex; flex-direction:column; background:var(--primary-background-color,#111); }
        .map-block.map-expanded .map-controls { flex-shrink:0; padding:6px 10px; border-bottom:1px solid var(--divider-color,#333); }
        .map-block.map-expanded .map-frame-overview { flex:1; min-height:0; border:none; border-radius:0; box-shadow:none; margin:0; display:flex; flex-direction:column; }
        .map-block.map-expanded .leaflet-map-overview { flex:1; height:auto !important; min-height:0; }
        .map-frame-overview { border: 4px solid #5c3a1e; border-radius: 2px; box-shadow: inset 0 0 30px rgba(100,60,20,0.3), 0 4px 20px rgba(0,0,0,0.6); overflow: hidden; background: #c8a96e; }
        .leaflet-map-overview { height: calc(100vh - 198px); min-height: 260px; width: 100%; display: block; }
        .leaflet-map-overview .leaflet-tile-pane { filter: sepia(0.55) contrast(0.92) brightness(1.06) saturate(0.5) hue-rotate(6deg); }
        .leaflet-container { background: #c8a96e !important; }
        .leaflet-tile-pane { z-index: 2 !important; }
        .leaflet-overlay-pane { z-index: 4 !important; }
        .leaflet-marker-pane { z-index: 6 !important; }
        .map-empty { padding: 20px; opacity: 0.5; text-align: center; }
        .detail-pane { max-width: 720px; }
        .detail-pane h2 { margin: 0 0 4px; font-size: 1.1em; }
        .detail-tracking { font-size: 0.8em; opacity: 0.6; margin-bottom: 4px; }
        .detail-eta { display:flex; align-items:baseline; gap:7px; font-size:0.8em; padding:4px 0 10px; }
        .eta-label { opacity:0.6; }
        .eta-val { font-weight:600; color:var(--primary-color,#42a5f5); }
        .eta-note { opacity:0.4; font-size:0.88em; }
        .note-box {
          background: var(--secondary-background-color, #1e1e1e);
          border-left: 3px solid #ffd740;
          border-radius: 0 6px 6px 0;
          padding: 10px 14px; margin: 8px 0 12px;
          color: var(--primary-text-color, #eee);
        }
        .note-label { font-weight: 600; font-size: 0.85em; display: block; margin-bottom: 4px; opacity: 0.75; }
        .note-text { white-space: pre-wrap; word-break: break-word; font-size: 0.95em; line-height: 1.5; }
        .detail-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 12px; }
        .btn { background: transparent; border: 1px solid var(--divider-color, #444); color: var(--primary-text-color, #eee); border-radius: 6px; padding: 6px 13px; cursor: pointer; font-size: 0.83em; font-family: inherit; transition: background 0.15s, border-color 0.15s; }
        .btn:hover { background: rgba(255,255,255,0.06); }
        .btn-note { border-color: rgba(255,215,64,0.45); color: #ffd740; }
        .btn-note:hover { background: rgba(255,215,64,0.09); }
        .btn-icon { border-color: rgba(179,136,255,0.45); color: #b388ff; }
        .btn-icon:hover { background: rgba(179,136,255,0.09); }
        .btn-refresh { border-color: rgba(100,221,23,0.35); color: #76ff03; }
        .btn-refresh:hover { background: rgba(100,221,23,0.08); }
        .notes-section { margin: 14px 0 10px; }
        .notes-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 0.85em; font-weight: 600; opacity: 0.8; }
        .note-entry { background: var(--secondary-background-color, #1e1e1e); border-left: 3px solid #ffd740; border-radius: 0 6px 6px 0; padding: 8px 36px 8px 12px; margin-bottom: 6px; position: relative; }
        .note-meta { font-size: 0.72em; opacity: 0.5; margin-bottom: 3px; }
        .note-text { white-space: pre-wrap; word-break: break-word; font-size: 0.92em; line-height: 1.5; }
        .note-delete { position: absolute; top: 6px; right: 8px; background: transparent; border: none; color: var(--error-color, #cf6679); cursor: pointer; opacity: 0.6; font-size: 0.85em; padding: 2px 4px; }
        .note-delete:hover { opacity: 1; }
        .notes-empty { font-size: 0.82em; opacity: 0.4; padding: 6px 0; }
        .carrier-links { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 14px; }
        .carrier-link { color: var(--primary-color, #42a5f5); text-decoration: none; font-size: 0.88em; padding: 4px 10px; border: 1px solid rgba(66,165,245,0.3); border-radius: 4px; }
        .carrier-link:hover { background: rgba(66,165,245,0.1); text-decoration: none; }
        .events-list { font-size: 0.92em; }
        .event-row { display: grid; grid-template-columns: 140px 1fr 130px; gap: 6px; padding: 6px 0; border-bottom: 1px solid var(--divider-color, #222); line-height: 1.4; }
        .event-date { opacity: 0.6; }
        .event-loc { text-align: right; }
        .event-loc-link { color: var(--primary-color, #42a5f5); text-decoration: none; font-size: 0.88em; }
        .event-loc-link:hover { text-decoration: underline; }
        .carrier-link-text { font-size: 0.88em; opacity: 0.7; }
        .no-parcels { padding: 32px; text-align: center; opacity: 0.5; }
        table { table-layout: fixed; width: 100%; }
        .col-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .parcel-row.status-in-transit    { box-shadow: inset 4px 0 0 #2196f3; }
        .parcel-row.status-delivered     { box-shadow: inset 4px 0 0 #9e9e9e; }
        .parcel-row.status-pickup-ready  { box-shadow: inset 4px 0 0 #ff9800; animation: npt-blink-pickup 1.6s ease-in-out infinite; }
        .parcel-row.status-parked        { box-shadow: inset 4px 0 0 #3f51b5; }
        .parcel-row.status-delayed       { box-shadow: inset 4px 0 0 #ff5722; }
        .parcel-row.status-possibly-lost { box-shadow: inset 4px 0 0 #e53935; }
        .parcel-row.status-lost          { box-shadow: inset 4px 0 0 #b71c1c; background: rgba(183,28,28,0.10); }
        .parcel-row.status-cancelled     { box-shadow: inset 4px 0 0 #607d8b; }
        .parcel-row.status-returned      { box-shadow: inset 4px 0 0 #9c27b0; }
        @keyframes npt-blink-pickup {
          0%,100% { background: rgba(255,152,0,0.07); }
          50%     { background: rgba(255,152,0,0.25); }
        }
        @media (prefers-reduced-motion: reduce) {
          .parcel-row.status-pickup-ready { animation: none; background: rgba(255,152,0,0.14); }
        }
        .board-map-frame { border:3px solid #7A5020; border-radius:4px; box-shadow:0 2px 20px rgba(0,0,0,0.6); overflow:hidden; margin-bottom:12px; background:#E8D9BC; position:relative; }
        .board-map-div { width:100%; display:block; }
        .board-map-div svg { display:block; width:100%; height:auto; }
        .map-block.map-expanded .board-map-div { flex:1; min-height:0; display:flex; flex-direction:column; }
        .map-block.map-expanded .board-map-frame { flex:1; min-height:0; border:none; border-radius:0; margin:0; display:flex; flex-direction:column; }
        .map-block.map-expanded .board-map-div svg { flex:1; height:100% !important; width:100%; }
      </style>

      <div class="panel-header">
        <ha-icon icon="mdi:package-variant-closed"></ha-icon>
        <span class="panel-header-title">Pakker</span>
        <button class="btn-add-parcel" id="btn-add-parcel">+ ${this._isNo ? "Legg til pakke" : "Add parcel"}</button>
        <button class="btn-settings" id="btn-settings" title="Innstillinger">⚙️</button>
      </div>
      <div class="panel-body ${selected ? "" : "no-selected"}" id="npt-panel-body">
        <div class="left-pane">
          <div class="left-toolbar">
            <input class="left-filter" id="npt-filter" type="search" placeholder="${this._isNo ? "Filtrer pakker…" : "Filter parcels…"}">
            <button class="btn-left-settings" id="btn-left-settings" title="${this._isNo ? "Innstillinger" : "Settings"}">⚙️</button>
          </div>
          ${parcels.length === 0
            ? `<div class="no-parcels">${this._t("No parcels tracked.")}<br>${this._t("Add one via the integration.")}</div>`
            : `<table class="parcel-table">
                <colgroup>
                  <col style="width:36px"><col style="width:22%"><col><col style="width:18%"><col style="width:88px"><col style="width:22%">
                </colgroup>
                <thead><tr>
                  <th></th><th>${this._isNo ? "Pakke" : "Package"}</th><th>Status</th><th>${this._isNo ? "Sted" : "Location"}</th><th>ETA</th><th>${this._isNo ? "Notat" : "Note"}</th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>`
          }
        </div>
        <div class="right-pane">
          ${selected
            ? this._renderRouteMap(selected) + this._renderDetailPane(selected)
            : this._renderAllParcelsMap(parcels)
          }
        </div>
      </div>`;

    this._shadow.getElementById("btn-add-parcel")?.addEventListener("click", () => this._showAddParcelDialog());
    this._shadow.getElementById("btn-settings")?.addEventListener("click", () => this._showSettingsDialog());
    this._shadow.getElementById("btn-left-settings")?.addEventListener("click", () => this._showSettingsDialog());

    const filterInp = this._shadow.getElementById("npt-filter");
    if (filterInp) {
      if (this._filterText) { filterInp.value = this._filterText; this._filterParcels(this._filterText); }
      filterInp.addEventListener("input", () => this._filterParcels(filterInp.value));
    }

    // Map action toolbar — branches on board map (selected parcel) vs Leaflet overview
    this._shadow.querySelectorAll("[data-map-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const a = btn.dataset.mapAction;
        const hasBoardMap = !!this._selected;
        if (hasBoardMap) {
          if (a === "screenshot") this._takeBoardMapScreenshot();
          if (a === "expand")     this._toggleBoardMapExpanded();
          // zoom/fit not applicable to flat SVG map
        } else {
          if (a === "zoomin")     this._leafletMap?.zoomIn();
          if (a === "zoomout")    this._leafletMap?.zoomOut();
          if (a === "fit")        { const m = this._leafletMap; if (m?._nptFitBounds) m.fitBounds(m._nptFitBounds, { padding: [30, 30] }); }
          if (a === "screenshot") this._takeMapScreenshot();
          if (a === "expand")     this._toggleMapExpanded();
        }
      });
    });

    this._shadow.querySelectorAll(".col-note[data-tn]").forEach((cell) => {
      cell.addEventListener("click", (e) => {
        e.stopPropagation();
        this._showNoteDialog(cell.dataset.tn, cell.dataset.note || "");
      });
    });

    this._shadow.querySelectorAll(".parcel-row").forEach((row) => {
      row.addEventListener("click", () => this._selectParcel(row.dataset.id));
    });

    if (selected) this._attachDetailPaneListeners(selected);

    this._initLeafletMaps().catch(e => console.warn("NPT map init failed:", e));
  }

  /** Wire click listeners on the detail pane buttons (rename, icon, refresh, notes). */
  _attachDetailPaneListeners(selected) {
    const tn = selected.attributes.tracking_number || selected.entity_id;
    this._shadow.getElementById("btn-rename")?.addEventListener("click", () =>
      this._showRenameDialog(tn, selected.attributes.display_name || selected.attributes.sender_name || ""));
    this._shadow.getElementById("btn-add-note")?.addEventListener("click", () =>
      this._showAddNoteDialog(tn));
    this._shadow.getElementById("btn-icon")?.addEventListener("click", () =>
      this._showIconDialog(tn, selected.attributes.npt_icon || ""));
    this._shadow.getElementById("btn-refresh")?.addEventListener("click", () =>
      this._callService("norwegian_parcel_tracker", "refresh", { tracking_number: tn }));
    this._shadow.querySelectorAll(".note-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        this._callService("norwegian_parcel_tracker", "delete_note", { tracking_number: tn, idx });
      });
    });
  }

  connectedCallback() { this._render(); }

  /** Clean up map instances and global event listeners when element is removed from the DOM. */
  disconnectedCallback() {
    if (this._animTimeout) { clearTimeout(this._animTimeout); this._animTimeout = null; }
    if (this._planeAnimId) { cancelAnimationFrame(this._planeAnimId); this._planeAnimId = null; }
    if (this._leafletMap) { try { this._leafletMap.remove(); } catch(e){} this._leafletMap = null; }
    if (this._mapEscHandler) { document.removeEventListener("keydown", this._mapEscHandler); this._mapEscHandler = null; }
  }

  async _ensureLeaflet() {
    if (window.L && window.L.map) return;
    if (document.getElementById("npt-leaflet-js")) {
      await new Promise((res) => {
        const t = setInterval(() => { if (window.L) { clearInterval(t); res(); } }, 40);
        setTimeout(() => { clearInterval(t); res(); }, 5000);
      });
      return;
    }
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.id = "npt-leaflet-js";
      s.src = _LEAFLET_JS;
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    if (!document.getElementById("npt-map-icon-styles")) {
      const st = document.createElement("style");
      st.id = "npt-map-icon-styles";
      st.textContent = [
        ".npt-plane-wrap{background:none!important;border:none!important;box-shadow:none!important;}",
        ".npt-plane{font-size:22px;line-height:1;display:block;animation:npt-glow 2.5s ease-in-out infinite;}",
        "@keyframes npt-glow{0%,100%{filter:drop-shadow(0 0 3px rgba(200,169,110,.5))}50%{filter:drop-shadow(0 0 10px rgba(200,169,110,1))}}",
        ".npt-stop-label{background:rgba(74,40,0,.7);color:#f5e6c8;padding:2px 5px;border-radius:3px;font-size:11px;white-space:nowrap;}",
        ".leaflet-popup-content-wrapper{background:#f5e6c8!important;color:#3b1f00!important;border:1px solid #5c3a1e!important;border-radius:4px!important;box-shadow:0 2px 10px rgba(0,0,0,.4)!important;}",
        ".leaflet-popup-tip{background:#f5e6c8!important;}",
        ".leaflet-popup-content{color:#3b1f00!important;font-size:12px!important;}",
        ".leaflet-tooltip{background:#f5e6c8!important;border:1px solid #5c3a1e!important;color:#3b1f00!important;border-radius:3px!important;font-size:11px!important;}",
        ".leaflet-tooltip::before{border-top-color:#5c3a1e!important;}",
      ].join("");
      document.head.appendChild(st);
    }
  }

  /** Load topojson-client and world-atlas topology; both cached on window. */
  async _ensureBoardMapDeps() {
    if (!window.topojson) {
      if (!document.getElementById("npt-topojson-js")) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.id = "npt-topojson-js";
          s.src = _TOPOJSON_JS;
          s.integrity = "sha384-9dCJK6nh7skY14HrcvlLYlFga9/MehJjL9ONWRflmiXNRuf8p2jiF4Y5PR881PTq";
          s.crossOrigin = "anonymous";
          s.onload = resolve;
          s.onerror = (e) => { console.warn("NPT: topojson load error", e); reject(e); };
          document.head.appendChild(s);
        });
      } else {
        await new Promise((res) => {
          const t = setInterval(() => { if (window.topojson) { clearInterval(t); res(); } }, 50);
          setTimeout(() => { clearInterval(t); res(); }, 8000);
        });
      }
    }
    if (!window._nptWorldTopo) {
      const resp = await fetch(_WORLD_TOPO_URL);
      if (!resp.ok) throw new Error(`NPT: world topo ${resp.status}`);
      window._nptWorldTopo = await resp.json();
    }
    return window._nptWorldTopo;
  }

  async _initLeafletMaps() {
    const selected = this._selected ? this._parcels.find((s) => s.entity_id === this._selected) : null;
    if (selected) {
      await this._initRouteMap(selected);
    } else {
      await this._initOverviewMap(this._parcels);
    }
  }

  /**
   * Render the board-game-style flat world route map for a single parcel.
   * Uses a zoomed equirectangular SVG projection fitted to the route bounding box,
   * topojson world shapes, Ticket-to-Ride-style thick dashed routes, and an
   * animated paper-plane icon travelling along the journey.
   */
  async _initRouteMap(state) {
    const mapDiv = this._shadow.getElementById("npt-route-map");
    if (!mapDiv) return;
    const coords = (state.attributes && state.attributes.route_coords) || [];
    if (coords.length === 0) return;

    const statusKey    = this._parcelStatusColor(state);
    const arcColor     = this._statusLineColor(statusKey);
    const curEmoji     = this._statusMarkerEmoji(statusKey, state.attributes.npt_icon || "");
    const activeSt     = ["in-transit", "delayed"].includes(statusKey);
    const homeLat      = this._hass?.config?.latitude;
    const homeLng      = this._hass?.config?.longitude;
    const hasFutureArc = activeSt && homeLat != null && homeLng != null;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Route points oldest-first; optionally append home as destination
    const routePts = [...coords].reverse();
    if (hasFutureArc) routePts.push({ lat: homeLat, lng: homeLng, description: this._isNo ? "Hjem" : "Home", isHome: true });

    let world = null;
    try { world = await this._ensureBoardMapDeps(); } catch(e) { console.warn("NPT board map deps:", e); }
    if (!mapDiv.isConnected) return;

    const W = 1000, H = 500;

    // --- Zoomed equirectangular projection fitted to route bounding box ---
    const allLats = routePts.map(p => p.lat);
    const allLngs = routePts.map(p => p.lng);
    let latMin = Math.min(...allLats), latMax = Math.max(...allLats);
    let lonMin = Math.min(...allLngs), lonMax = Math.max(...allLngs);
    // Enforce a minimum 15° window so domestic routes show regional context
    const minSpan = 15;
    if (latMax - latMin < minSpan) { const c = (latMax+latMin)/2; latMin = c-minSpan/2; latMax = c+minSpan/2; }
    if (lonMax - lonMin < minSpan) { const c = (lonMax+lonMin)/2; lonMin = c-minSpan/2; lonMax = c+minSpan/2; }
    // 25% padding
    const latPad = (latMax-latMin)*0.25, lonPad = (lonMax-lonMin)*0.25;
    latMin = Math.max(-85, latMin-latPad); latMax = Math.min(85,  latMax+latPad);
    lonMin = Math.max(-180, lonMin-lonPad); lonMax = Math.min(180, lonMax+lonPad);
    const latRange = latMax-latMin, lonRange = lonMax-lonMin;
    const proj = (lat, lng) => ({
      x: (lng - lonMin) / lonRange * W,
      y: (latMax - lat) / latRange * H,
    });

    // Build SVG continent paths using the zoomed projection
    let landD = "", borderD = "";
    if (world && window.topojson) {
      try {
        const landFeat = window.topojson.feature(world, world.objects.land);
        landD   = this._geoToSvgPath(landFeat.geometry || landFeat, proj);
        const borders = window.topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
        borderD = this._geoToSvgPath(borders, proj);
      } catch(e) { console.warn("NPT board map topo:", e); }
    }

    // Route path strings
    const svgPts       = routePts.map(pt => proj(pt.lat, pt.lng));
    const confirmedPts = [...coords].reverse().map(c => proj(c.lat, c.lng));
    const confirmedD   = confirmedPts.map((p, i) => `${i===0?"M":"L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    let futureD = "";
    if (hasFutureArc && coords.length > 0) {
      const cp = proj(coords[0].lat, coords[0].lng);
      const hp = proj(homeLat, homeLng);
      futureD = `M${cp.x.toFixed(1)},${cp.y.toFixed(1)} L${hp.x.toFixed(1)},${hp.y.toFixed(1)}`;
    }

    // Deduplicate consecutive markers at the same projected position
    const confirmedCount = coords.length;
    const seenPts = new Set();
    const markerSvg = routePts.map((pt, i) => {
      const p   = proj(pt.lat, pt.lng);
      const key = `${p.x.toFixed(0)},${p.y.toFixed(0)}`;
      if (seenPts.has(key)) return "";
      seenPts.add(key);
      const ci  = this._checkpointInfo(pt);
      const isCurrentStop = !pt.isHome && i === confirmedCount - 1;
      const isOrigin = i === 0;
      const fill   = pt.isHome ? "#66bb6a" : (isCurrentStop ? arcColor : "#F4E4C1");
      const stroke = pt.isHome ? "#388e3c" : "#7A5020";
      const r      = isCurrentStop || pt.isHome ? 8 : 6;
      const labelY = p.y > H * 0.85 ? p.y - 12 : p.y + 18;
      const rawLabel = pt.isHome
        ? (this._isNo ? "Hjem" : "Home")
        : (pt.location || pt.description || "").slice(0, 22);
      const label = this._escapeHtml(rawLabel);
      const pulse = (isCurrentStop && !reducedMotion)
        ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${arcColor}" opacity="0.3"><animate attributeName="r" values="${r};${r+7};${r}" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0;0.5" dur="1.6s" repeatCount="indefinite"/></circle>`
        : "";
      const iconText = isCurrentStop ? curEmoji : ci.icon;
      const iconColor = isCurrentStop ? "#F4E4C1" : "#7A5020";
      const icon = (isCurrentStop || isOrigin || pt.isHome)
        ? `<text x="${p.x.toFixed(1)}" y="${(p.y+3.5).toFixed(1)}" text-anchor="middle" font-size="9" fill="${iconColor}">${iconText}</text>`
        : "";
      return `<g class="bm-city">
        <title>${label}</title>
        ${pulse}
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r+3}" fill="none" stroke="#7A5020" stroke-width="1.2" opacity="0.6"/>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.8"/>
        ${icon}
        <text x="${p.x.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" class="bm-label">${label}</text>
      </g>`;
    }).join("");

    const svgHtml = `<svg id="npt-board-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto;">
      <defs>
        <style>
          .bm-label{font-family:Georgia,'Times New Roman',serif;font-size:9px;fill:#2C1A07;paint-order:stroke;stroke:#E8D9BC;stroke-width:3;stroke-linejoin:round;}
          @keyframes bm-dash{to{stroke-dashoffset:-36}}
          .bm-future{animation:bm-dash 1.8s linear infinite;}
          @media(prefers-reduced-motion:reduce){.bm-future{animation:none}}
        </style>
      </defs>
      <rect width="${W}" height="${H}" fill="#8CAEBF"/>
      <g stroke="#6B94A8" stroke-width="0.5" opacity="0.35" fill="none">
        ${Array.from({length:8},(_,i)=>`<line x1="0" y1="${62+i*52}" x2="${W}" y2="${62+i*52}"/>`).join("")}
      </g>
      ${landD?`<path d="${landD}" fill="#C8A97D" stroke="#7A6040" stroke-width="0.9" stroke-linejoin="round"/>`:""}
      ${borderD?`<path d="${borderD}" fill="none" stroke="#A88050" stroke-width="0.4" opacity="0.45"/>`:""}
      ${confirmedD?`
        <path d="${confirmedD}" fill="none" stroke="rgba(60,0,0,0.2)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${confirmedD}" fill="none" stroke="#8B1A1A" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="14 10"/>
      `:""}
      ${futureD?`
        <path d="${futureD}" fill="none" stroke="rgba(60,0,0,0.15)" stroke-width="7" stroke-linecap="round"/>
        <path d="${futureD}" fill="none" stroke="${arcColor}" stroke-width="4" stroke-linecap="round" stroke-dasharray="10 8" class="bm-future"/>
      `:""}
      ${markerSvg}
      <g transform="translate(958,448)">
        <circle r="20" fill="#F4E4C1" stroke="#7A5020" stroke-width="1.5" opacity="0.9"/>
        <polygon points="0,-17 3,-7 -3,-7" fill="#8B1A1A"/>
        <polygon points="0,17 3,7 -3,7" fill="#7A6040"/>
        <polygon points="17,0 7,3 7,-3" fill="#7A6040"/>
        <polygon points="-17,0 -7,3 -7,-3" fill="#7A6040"/>
        <circle r="3" fill="#8B1A1A"/>
        <text x="0" y="-21" text-anchor="middle" font-family="serif" font-size="8" fill="#2C1A07" font-weight="700">N</text>
      </g>
      <rect x="6" y="468" width="186" height="24" rx="2" fill="#F4E4C1" opacity="0.85"/>
      <text x="99" y="484" text-anchor="middle" font-family="Georgia,serif" font-size="10" font-weight="700" fill="#2C1A07" letter-spacing="0.08em">NORWEGIAN PARCEL TRACKER</text>
    </svg>`;

    mapDiv.innerHTML = svgHtml;

    // Animate paper plane along route
    const svg = mapDiv.querySelector("#npt-board-svg");
    if (svg && svgPts.length >= 2 && !reducedMotion) {
      this._animatePlane(svg, svgPts);
    }
  }

  /** Convert GeoJSON geometry to an SVG path d-string using the given projection. */
  _geoToSvgPath(geom, proj) {
    if (!geom) return "";
    const ptToStr = ([lon, lat]) => {
      const {x, y} = proj(lat, lon);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    };
    const ringToPath = (ring) => ring.map((pt, i) => (i===0?"M":"L") + ptToStr(pt)).join("") + "Z";
    const t = geom.type;
    if (t === "Polygon")        return geom.coordinates.map(ringToPath).join(" ");
    if (t === "MultiPolygon")   return geom.coordinates.flatMap(p => p.map(ringToPath)).join(" ");
    if (t === "MultiLineString") return geom.coordinates.map(ln => ln.map((pt,i)=>(i===0?"M":"L")+ptToStr(pt)).join("")).join(" ");
    if (t === "FeatureCollection") return geom.features.map(f => this._geoToSvgPath(f.geometry, proj)).join(" ");
    if (t === "Feature")        return this._geoToSvgPath(geom.geometry, proj);
    return "";
  }

  /** Animate a paper-plane SVG element along a route. */
  _animatePlane(svg, pts) {
    if (this._planeAnimId) { cancelAnimationFrame(this._planeAnimId); this._planeAnimId = null; }
    const ns = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(ns, "g");
    g.id = "npt-plane";
    const path = document.createElementNS(ns, "path");
    // Paper-plane shape pointing right
    path.setAttribute("d", "M11,0 L-7,-5 L-4,0 L-7,5 Z");
    path.setAttribute("fill", "#8B1A1A");
    path.setAttribute("stroke", "#F4E4C1");
    path.setAttribute("stroke-width", "1");
    g.appendChild(path);
    // Position at start so it doesn't sit at (0,0) during the initial delay
    g.setAttribute("transform", `translate(${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}) rotate(0)`);
    svg.appendChild(g);

    // Pre-compute cumulative distances for constant-speed traversal
    const dists = [0];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y;
      dists.push(dists[i-1] + Math.sqrt(dx*dx + dy*dy));
    }
    const total = dists[dists.length - 1];

    const dur   = 5000;
    const delay = 2200; // ms — after bm-draw animation
    let start   = null;

    const tick = (ts) => {
      if (!g.isConnected) return;
      if (!start) start = ts;
      const t = Math.max(0, Math.min(1, (ts - start - delay) / dur));
      if (t > 0) {
        const d = t * total;
        let seg = pts.length - 2;
        for (let i = 1; i < dists.length; i++) { if (dists[i] >= d) { seg = i - 1; break; } }
        const segT  = dists[seg+1] > dists[seg] ? (d - dists[seg]) / (dists[seg+1] - dists[seg]) : 0;
        const p1 = pts[seg], p2 = pts[seg+1];
        const x = p1.x + (p2.x - p1.x) * segT;
        const y = p1.y + (p2.y - p1.y) * segT;
        const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
        g.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${ang.toFixed(1)})`);
      }
      if (t < 1) {
        this._planeAnimId = requestAnimationFrame(tick);
      } else {
        // Loop
        start = null;
        this._planeAnimId = requestAnimationFrame(tick);
      }
    };
    this._planeAnimId = requestAnimationFrame(tick);
  }

  /** Classify a route coordinate into a checkpoint type for board map marker styling. */
  _checkpointInfo(c) {
    const desc = ((c.description || "") + " " + (c.location || "")).toLowerCase();
    // Norwegian: toll, grense, fortolling, tollklarering, import; English: customs, border, clearance
    if (/customs|border|import|export|clearance|toll(?!.{0,3}free)|grense|fortoll|klarering/.test(desc)) return { icon: "🛃", color: "#ff9800" };
    // Norwegian: flyplass, lufthavn; English: airport, airline, departure, arrival
    if (/airport|air.?hub|departure|arrival|airline|flyplass|lufthavn/.test(desc)) return { icon: "✈️", color: "#4fc3f7" };
    // Norwegian: sortering, lager, senter, terminal, godsterminal, mellomlager; English: sort, warehouse, hub, depot
    if (/sort|warehouse|center|hub|facility|depot|logistics|sorter|lager|senter|terminal|gods/.test(desc)) return { icon: "🏭", color: "#80cbc4" };
    // Norwegian: levering, utlevering, bud, lokal; English: deliver, courier, local, last mile
    if (/deliver|courier|local|final|last.?mile|levering|utlevering|bud(?!kk)/.test(desc)) return { icon: "🚚", color: "#a5d6a7" };
    // Norwegian: postkontor, postkasse, brevhus; English: postal, mail — but NOT "Posten" alone (too broad)
    if (/postal|mail(?!box)|postkontor|postkasse|brevhus/.test(desc)) return { icon: "📮", color: "#ce93d8" };
    return { icon: "📍", color: "#90a4ae" };
  }

  async _initOverviewMap(parcels) {
    const mapDiv = this._shadow.getElementById("npt-overview-map");
    if (!mapDiv) return;
    const parcelRoutes = parcels
      .filter((s) => s.attributes.route_coords && s.attributes.route_coords.length > 0)
      .map((s) => ({
        entityId: s.entity_id,
        name: (s.attributes.display_name || s.attributes.sender_name || s.attributes.tracking_number || "").slice(0, 24),
        icon: s.attributes.npt_icon || "",
        statusKey: this._parcelStatusColor(s),
        coords: s.attributes.route_coords,
      }));
    if (parcelRoutes.length === 0) return;
    try { await this._ensureLeaflet(); } catch (e) { return; }
    const L = window.L;

    const allLatLngs = parcelRoutes.flatMap((p) => p.coords.map((c) => [c.lat, c.lng]));
    const map = L.map(mapDiv, { zoomControl: false, scrollWheelZoom: false });
    L.tileLayer(_CARTO_TILES, { attribution: _CARTO_ATTR, subdomains: "abc", maxZoom: 17, crossOrigin: "anonymous" }).addTo(map);
    const fitBounds = L.latLngBounds(allLatLngs);
    map.fitBounds(fitBounds, { padding: [24, 24] });
    map._nptFitBounds = fitBounds;
    this._leafletMap = map;

    parcelRoutes.forEach((p) => {
      const ordered = [...p.coords].reverse();
      const latLngs = ordered.map((c) => [c.lat, c.lng]);
      const pColor = this._statusLineColor(p.statusKey);
      const pDash  = this._statusLineDash(p.statusKey);
      const pActive = ["in-transit", "pickup-ready", "delayed"].includes(p.statusKey);
      const pOpts = { color: pColor, weight: pActive ? 3 : 2, opacity: pActive ? 0.88 : 0.6 };
      if (pDash) pOpts.dashArray = pDash;
      L.polyline(latLngs, pOpts).addTo(map);

      ordered.slice(0, -1).forEach((c) => {
        L.circleMarker([c.lat, c.lng], { radius: 4, color: pColor, fillColor: pColor, fillOpacity: 0.5, weight: 1 })
          .bindTooltip(`${(c.date_iso || "").slice(0, 16).replace("T", " ")} — ${c.description || ""}`)
          .addTo(map);
      });

      const cur = p.coords[0];
      const label = this._statusMarkerEmoji(p.statusKey, p.icon);
      let bearing = 0;
      if (p.coords.length >= 2) {
        const dLat = p.coords[0].lat - p.coords[1].lat;
        const dLng = p.coords[0].lng - p.coords[1].lng;
        bearing = Math.atan2(dLng, dLat) * (180 / Math.PI);
      }
      const safeLabel = label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const icon = L.divIcon({
        html: `<div style="transform:rotate(${bearing.toFixed(0)}deg);font-size:20px;line-height:1">${safeLabel}</div>`,
        className: "npt-plane-wrap",
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      L.marker([cur.lat, cur.lng], { icon })
        .bindTooltip(p.name || cur.description || "")
        .on("click", () => this._selectParcel(p.entityId))
        .addTo(map);
    });
  }

  /** Download a PNG of the current route or overview map using native canvas compositing. */
  async _takeMapScreenshot() {
    const map = this._leafletMap;
    if (!map) return;
    const container = map.getContainer();
    const dpr = window.devicePixelRatio || 1;
    const w = container.offsetWidth;
    const h = container.offsetHeight;
    const out = document.createElement("canvas");
    out.width  = Math.round(w * dpr);
    out.height = Math.round(h * dpr);
    const ctx = out.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#c8a96e";
    ctx.fillRect(0, 0, w, h);
    const cRect = container.getBoundingClientRect();
    // Tiles — read the live CSS filter so the PNG matches the screen exactly
    const tilePaneFilter = getComputedStyle(container.querySelector(".leaflet-tile-pane")).filter;
    ctx.filter = tilePaneFilter && tilePaneFilter !== "none" ? tilePaneFilter : "none";
    container.querySelectorAll(".leaflet-tile-pane img, .leaflet-tile-pane canvas").forEach((el) => {
      if (el.tagName === "IMG" && !el.complete) return;
      const r = el.getBoundingClientRect();
      try { ctx.drawImage(el, r.left - cRect.left, r.top - cRect.top, r.width, r.height); } catch (e) {}
    });
    ctx.filter = "none";
    // SVG overlay — strip Leaflet's inline transform so drawImage positions it correctly via getBoundingClientRect
    const svg = container.querySelector(".leaflet-overlay-pane svg");
    if (svg) {
      const svgClone = svg.cloneNode(true);
      svgClone.style.transform = "";
      const svgRect = svg.getBoundingClientRect();
      const blob = new Blob([new XMLSerializer().serializeToString(svgClone)], { type: "image/svg+xml" });
      const url  = URL.createObjectURL(blob);
      await new Promise((res) => {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, svgRect.left - cRect.left, svgRect.top - cRect.top, svgRect.width, svgRect.height);
          URL.revokeObjectURL(url);
          res();
        };
        img.onerror = () => { URL.revokeObjectURL(url); res(); };
        img.src = url;
      });
    }
    // Current-position markers
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    container.querySelectorAll(".npt-plane-wrap").forEach((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left - cRect.left + r.width / 2;
      const cy = r.top  - cRect.top  + r.height / 2;
      const size = Math.max(16, Math.round(r.height * 0.85));
      ctx.font = `${size}px sans-serif`;
      try { ctx.fillText(el.textContent.trim() || "📦", cx, cy); } catch (e) {}
    });
    // Attribution strip (CC-BY-SA requirement for OpenTopoMap tiles)
    const attrText = container.querySelector(".leaflet-control-attribution")?.textContent?.trim();
    if (attrText) {
      const pad = 4, fh = 10;
      ctx.font = `${fh}px sans-serif`;
      const tw = ctx.measureText(attrText).width;
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillRect(w - tw - pad * 2, h - fh - pad * 2, tw + pad * 2, fh + pad * 2);
      ctx.fillStyle = "#111";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(attrText, w - pad, h - pad);
    }
    try {
      out.toBlob((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "parcel-map.png";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 2000);
      });
    } catch (e) {
      console.warn("NPT map screenshot blocked by browser:", e);
    }
  }

  /** Toggle the map block (toolbar + frame) between normal size and a fixed full-viewport overlay. */
  _toggleMapExpanded() {
    const map = this._leafletMap;
    if (!map) return;
    const block = map.getContainer().closest(".map-block");
    if (!block) return;
    const expanding = !block.classList.contains("map-expanded");
    block.classList.toggle("map-expanded", expanding);
    // Flip the ⛶ button label to ✕ (and back)
    block.querySelectorAll("[data-map-action='expand']").forEach((btn) => {
      btn.textContent = expanding ? "✕" : "⛶";
      btn.title = expanding ? (this._isNo ? "Lukk" : "Close") : (this._isNo ? "Fullvindu" : "Full window");
    });
    if (expanding) {
      map.scrollWheelZoom.enable();
      this._mapEscHandler = (e) => { if (e.key === "Escape") this._toggleMapExpanded(); };
      document.addEventListener("keydown", this._mapEscHandler);
    } else {
      map.scrollWheelZoom.disable();
      if (this._mapEscHandler) { document.removeEventListener("keydown", this._mapEscHandler); this._mapEscHandler = null; }
    }
    requestAnimationFrame(() => map.invalidateSize());
  }

  /** Download a PNG of the board map route view by serialising SVG → canvas → blob. */
  _takeBoardMapScreenshot() {
    const svg = this._shadow.getElementById("npt-board-svg");
    if (!svg) return;
    try {
      const xml  = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
      const url  = URL.createObjectURL(blob);
      const img  = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1000; canvas.height = 500;
        canvas.getContext("2d").drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((pngBlob) => {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(pngBlob);
          a.download = "parcel-map.png";
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 2000);
        });
      };
      img.onerror = () => { URL.revokeObjectURL(url); console.warn("NPT board map screenshot: SVG load failed"); };
      img.src = url;
    } catch(e) { console.warn("NPT board map screenshot:", e); }
  }

  /** Toggle the board map container between normal and full-viewport. */
  _toggleBoardMapExpanded() {
    const mapDiv = this._shadow.getElementById("npt-route-map");
    if (!mapDiv) return;
    const block = mapDiv.closest(".map-block");
    if (!block) return;
    const expanding = !block.classList.contains("map-expanded");
    block.classList.toggle("map-expanded", expanding);
    block.querySelectorAll("[data-map-action='expand']").forEach((btn) => {
      btn.textContent = expanding ? "✕" : "⛶";
      btn.title = expanding ? (this._isNo ? "Lukk" : "Close") : (this._isNo ? "Fullvindu" : "Full window");
    });
    if (expanding) {
      this._mapEscHandler = (e) => { if (e.key === "Escape") this._toggleBoardMapExpanded(); };
      document.addEventListener("keydown", this._mapEscHandler);
    } else {
      if (this._mapEscHandler) { document.removeEventListener("keydown", this._mapEscHandler); this._mapEscHandler = null; }
    }
  }
}

customElements.define("norwegian-parcel-tracker-panel", NorwegianParcelTrackerPanel);
