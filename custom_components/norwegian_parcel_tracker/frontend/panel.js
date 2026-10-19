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

const _CARTO_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const _CARTO_ATTR = "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors";
const _LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const _LEAFLET_JS  = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";

class NorwegianParcelTrackerPanel extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._parcels = [];
    this._selected = null;
    this._shadow = this.attachShadow({ mode: "open" });
    this._leafletMap = null;
    const lang = (navigator.language || "").toLowerCase();
    this._isNo = lang.startsWith("nb") || lang.startsWith("no") || lang.startsWith("nn");
  }

  _t(k) { return (this._isNo && _NO[k]) ? _NO[k] : k; }

  set hass(hass) {
    this._hass = hass;
    this._parcels = Object.values(hass.states).filter(
      (s) => s.attributes && s.attributes.npt_master_entity === true
    );
    if (this._shadow.getElementById("npt-overlay")) return;
    this._render();
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

  _searchEngine() {
    try { return localStorage.getItem("npt-search-engine") || "google"; } catch { return "google"; }
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
    const cur = this._searchEngine();
    const opts = [
      { key: "google", label: "Google Nyheter" },
      { key: "bing",   label: "Bing Nyheter" },
      { key: "ddg",    label: "DuckDuckGo" },
      { key: "brave",  label: "Brave" },
    ];
    const radios = opts.map((o) => `
      <label style="display:flex;align-items:center;gap:8px;margin:8px 0;cursor:pointer">
        <input type="radio" name="npt-engine" value="${o.key}" ${o.key === cur ? "checked" : ""} style="accent-color:var(--primary-color,#1976d2)">
        ${o.label}
      </label>`).join("");
    const overlay = this._showModal(`
      <div class="npt-dialog">
        <h3>⚙️ Innstillinger</h3>
        <span class="npt-label">Søkemotor for forstyrrelser</span>
        ${radios}
        <div class="npt-actions">
          <button class="npt-btn npt-btn-secondary" id="npt-cancel">Avbryt</button>
          <button class="npt-btn npt-btn-primary" id="npt-settings-save">Lagre</button>
        </div>
      </div>`);
    overlay.querySelector("#npt-cancel").addEventListener("click", () => this._closeModal());
    overlay.querySelector("#npt-settings-save").addEventListener("click", () => {
      const chosen = overlay.querySelector("input[name='npt-engine']:checked");
      if (chosen) { try { localStorage.setItem("npt-search-engine", chosen.value); } catch {} }
      this._closeModal();
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

    return `
      <div class="detail-pane">
        <h2>${this._escHtml(a.display_name || a.sender_name || trackingNum)}</h2>
        <div class="detail-tracking">${this._escHtml(trackingNum)}</div>

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
    return `
      <div style="font-size:0.78em;opacity:0.55;padding:0 0 6px">${this._t("All parcel routes — click a dot to view details & route")}</div>
      <div class="map-frame-overview"><div id="npt-overview-map" class="leaflet-map-overview"></div></div>
      ${noDataHtml}`;
  }

  _renderRouteMap(state) {
    const coords = (state && state.attributes && state.attributes.route_coords) || [];
    if (coords.length === 0) return `<div class="map-empty">${this._t("No route data")}</div>`;
    return `<div class="map-frame"><div id="npt-route-map" class="leaflet-map-route"></div></div>`;
  }

  _render() {
    if (!this._hass) return;
    const parcels = this._parcels;
    const selected = this._selected
      ? parcels.find((s) => s.entity_id === this._selected)
      : null;

    const rows = parcels.map((s) => {
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
      return `
        <tr class="parcel-row ${isActive ? "selected" : ""}" data-id="${s.entity_id}">
          <td class="col-icon">${icon}</td>
          <td class="col-name">${this._escHtml(name)}</td>
          <td class="col-status">${this._escHtml(status)}</td>
          <td class="col-loc">${this._escHtml(loc)}${locTime ? `<br><span class="col-loc-time">${this._escHtml(locTime)}</span>` : ""}</td>
          <td class="col-eta">${this._escHtml(a.estimated_delivery_iso ? a.estimated_delivery_iso.slice(0,10) : "")}</td>
          ${notePreview ? `<td class="col-note" data-tn="${this._escHtml(tn)}" data-note="${this._escHtml(a.note || "")}">📝 ${this._escHtml(notePreview)}</td>` : "<td></td>"}
        </tr>`;
    }).join("");

    if (this._leafletMap) { try { this._leafletMap.remove(); } catch(e){} this._leafletMap = null; }

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
        .map-frame { border: 4px solid #5c3a1e; border-radius: 2px; box-shadow: inset 0 0 30px rgba(100,60,20,0.3), 0 4px 20px rgba(0,0,0,0.6); overflow: hidden; margin-bottom: 12px; background: #c8a96e; position: relative; }
        .map-frame-overview { border: 4px solid #5c3a1e; border-radius: 2px; box-shadow: inset 0 0 30px rgba(100,60,20,0.3), 0 4px 20px rgba(0,0,0,0.6); overflow: hidden; background: #c8a96e; }
        .leaflet-map-route { height: 280px; width: 100%; display: block; filter: sepia(0.75) contrast(0.9) brightness(1.08) saturate(0.45) hue-rotate(8deg); }
        .leaflet-map-overview { height: calc(100vh - 160px); min-height: 300px; width: 100%; display: block; filter: sepia(0.75) contrast(0.9) brightness(1.08) saturate(0.45) hue-rotate(8deg); }
        .leaflet-container { background: #c8a96e !important; }
        .leaflet-tile-pane { z-index: 2 !important; }
        .leaflet-overlay-pane { z-index: 4 !important; }
        .leaflet-marker-pane { z-index: 6 !important; }
        .map-empty { padding: 20px; opacity: 0.5; text-align: center; }
        .detail-pane { max-width: 720px; }
        .detail-pane h2 { margin: 0 0 4px; font-size: 1.1em; }
        .detail-tracking { font-size: 0.8em; opacity: 0.6; margin-bottom: 12px; }
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
      </style>

      <div class="panel-header">
        <ha-icon icon="mdi:package-variant-closed"></ha-icon>
        <span class="panel-header-title">Pakker</span>
        <button class="btn-add-parcel" id="btn-add-parcel">+ ${this._isNo ? "Legg til pakke" : "Add parcel"}</button>
        <button class="btn-settings" id="btn-settings" title="Innstillinger">⚙️</button>
      </div>
      <div class="panel-body ${selected ? "" : "no-selected"}">
        <div class="left-pane">
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

    this._shadow.querySelectorAll(".col-note[data-tn]").forEach((cell) => {
      cell.addEventListener("click", (e) => {
        e.stopPropagation();
        this._showNoteDialog(cell.dataset.tn, cell.dataset.note || "");
      });
    });

    this._shadow.querySelectorAll(".parcel-row").forEach((row) => {
      row.addEventListener("click", () => this._selectParcel(row.dataset.id));
    });

    if (selected) {
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

    this._initLeafletMaps().catch(() => {});
  }

  connectedCallback() { this._render(); }

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

  async _initLeafletMaps() {
    const selected = this._selected ? this._parcels.find((s) => s.entity_id === this._selected) : null;
    if (selected) {
      await this._initRouteMap(selected);
    } else {
      await this._initOverviewMap(this._parcels);
    }
  }

  async _initRouteMap(state) {
    const mapDiv = this._shadow.getElementById("npt-route-map");
    if (!mapDiv) return;
    const coords = (state.attributes && state.attributes.route_coords) || [];
    if (coords.length === 0) return;
    try { await this._ensureLeaflet(); } catch (e) { return; }
    const L = window.L;

    const ordered = [...coords].reverse();
    const latLngs = ordered.map((c) => [c.lat, c.lng]);
    const map = L.map(mapDiv, { zoomControl: true, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer(_CARTO_TILES, { attribution: _CARTO_ATTR, maxZoom: 19 }).addTo(map);
    map.fitBounds(L.latLngBounds(latLngs), { padding: [24, 24] });
    this._leafletMap = map;

    L.polyline(latLngs, { color: "#4a2800", weight: 3, opacity: 0.85, dashArray: "8 5" }).addTo(map);

    ordered.slice(0, -1).forEach((c) => {
      const tip = `${(c.date_iso || "").slice(0, 16).replace("T", " ")} — ${c.description || ""}`;
      L.circleMarker([c.lat, c.lng], { radius: 5, color: "#4a2800", fillColor: "#7a4800", fillOpacity: 0.6, weight: 1.5 })
        .bindTooltip(tip).addTo(map);
    });

    const cur = coords[0];
    const isDelivered = /delivered|levert|hentet/i.test(state.state || "");
    const planeEmoji = isDelivered ? "✅" : "✈️";
    let bearing = 0;
    if (coords.length >= 2) {
      const dLat = coords[0].lat - coords[1].lat;
      const dLng = coords[0].lng - coords[1].lng;
      bearing = Math.atan2(dLng, dLat) * (180 / Math.PI);
    }
    const planeIcon = L.divIcon({
      html: `<div class="npt-plane" style="transform:rotate(${bearing.toFixed(0)}deg)">${planeEmoji}</div>`,
      className: "npt-plane-wrap",
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    L.marker([cur.lat, cur.lng], { icon: planeIcon })
      .bindTooltip(`${(cur.date_iso || "").slice(0, 16).replace("T", " ")} — ${cur.description || ""}`)
      .addTo(map);
  }

  async _initOverviewMap(parcels) {
    const mapDiv = this._shadow.getElementById("npt-overview-map");
    if (!mapDiv) return;
    const COLORS = ["#4a2800","#7a2800","#2a4800","#6a4800","#4a006a","#006a4a","#6a006a","#8d6e63"];
    const parcelRoutes = parcels
      .filter((s) => s.attributes.route_coords && s.attributes.route_coords.length > 0)
      .map((s, i) => ({
        entityId: s.entity_id,
        name: (s.attributes.display_name || s.attributes.sender_name || s.attributes.tracking_number || "").slice(0, 24),
        icon: s.attributes.npt_icon || "",
        delivered: /delivered|levert|hentet/i.test(s.state || ""),
        coords: s.attributes.route_coords,
        color: COLORS[i % COLORS.length],
      }));
    if (parcelRoutes.length === 0) return;
    try { await this._ensureLeaflet(); } catch (e) { return; }
    const L = window.L;

    const allLatLngs = parcelRoutes.flatMap((p) => p.coords.map((c) => [c.lat, c.lng]));
    const map = L.map(mapDiv, { zoomControl: true, scrollWheelZoom: false });
    L.tileLayer(_CARTO_TILES, { attribution: _CARTO_ATTR, maxZoom: 19 }).addTo(map);
    map.fitBounds(L.latLngBounds(allLatLngs), { padding: [24, 24] });
    this._leafletMap = map;

    parcelRoutes.forEach((p) => {
      const ordered = [...p.coords].reverse();
      const latLngs = ordered.map((c) => [c.lat, c.lng]);
      L.polyline(latLngs, { color: p.color, weight: 2.5, opacity: 0.85, dashArray: "8 5" }).addTo(map);

      ordered.slice(0, -1).forEach((c) => {
        L.circleMarker([c.lat, c.lng], { radius: 4, color: p.color, fillColor: p.color, fillOpacity: 0.5, weight: 1 })
          .bindTooltip(`${(c.date_iso || "").slice(0, 16).replace("T", " ")} — ${c.description || ""}`)
          .addTo(map);
      });

      const cur = p.coords[0];
      const isEmoji = p.icon && !p.icon.startsWith("mdi:") && !p.icon.startsWith("http");
      const label = isEmoji ? p.icon : (p.delivered ? "✅" : "✈️");
      let bearing = 0;
      if (p.coords.length >= 2) {
        const dLat = p.coords[0].lat - p.coords[1].lat;
        const dLng = p.coords[0].lng - p.coords[1].lng;
        bearing = Math.atan2(dLng, dLat) * (180 / Math.PI);
      }
      const icon = L.divIcon({
        html: `<div style="transform:rotate(${bearing.toFixed(0)}deg);font-size:20px;line-height:1">${label}</div>`,
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
}

customElements.define("norwegian-parcel-tracker-panel", NorwegianParcelTrackerPanel);
