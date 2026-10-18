// ── Translations ───────────────────────────────────────────────────────────────
const NPT_STRINGS = {
  nb: {
    title: "Pakker", addBtn: "Legg til pakke", addPrompt: "Sporingsnummer:",
    namePrompt: "Visningsnavn (valgfritt – trykk Avbryt eller la stå tom for å hoppe over):",
    adding: "Legger til pakke…",
    addOk: "Pakke lagt til. Det kan ta litt tid.",
    addErr: "Feil", addErrUnknown: "ukjent feil",
    empty: "Ingen pakker å vise",
    pickup: "Hentested", pickupNA: "Hentested er ikke tilgjengelig for denne pakken",
    eta: "Estimert levering", lastSeen: "Sist sett", time: "Tid",
    orderHome: "Bestille hjemlevering",
    refresh: "Oppdater",
    refreshParcel: "Oppdater denne pakken",
    deleteParcel: "Fjern denne pakken",
    deleteConfirm: "Fjerne pakken?",
    rowSettings: "Tidsgrenser for denne pakken",
    rowSettingsTitle: "Tidsgrenser",
    rowStaleHours: "Timer → treg",
    rowCriticalHours: "Timer → kritisk",
    rowReset: "Tilbakestill til kortstandard",
    renameParcel: "Gi pakken nytt navn",
    renamePrompt: "Nytt visningsnavn:",
    noteParcel: "Legg til/rediger notat",
    notePrompt: "Notat (la stå tom for å fjerne):",
    iconParcel: "Sett ikon",
    iconPrompt: "Ikon (f.eks. mdi:gift, 🎁, eller https://-URL – tom for å fjerne):",
    noteLabel: "📝 Notat",
    s: {
      title: "Innstillinger", language: "Språk",
      langNb: "Norsk", langEn: "English",
      colors: "Farger", colorNormal: "Normal rad", colorNormalTheme: "Bruk temafarge",
      colorStale: "Treg", colorCritical: "Kritisk (fast)", colorDelivered: "Levert",
      showDelivered: "Vis leverte pakker", highlightStuck: "Fremhev trege pakker",
      staleHours: "Timer → treg", criticalHours: "Timer → kritisk",
      on: "På", off: "Av",
      save: "Lagre", cancel: "Avbryt",
    },
  },
  en: {
    title: "Parcels", addBtn: "Add parcel", addPrompt: "Tracking number:",
    namePrompt: "Display name (optional – press Cancel or leave blank to skip):",
    adding: "Adding parcel…",
    addOk: "Parcel added. It may take a moment to appear.",
    addErr: "Error", addErrUnknown: "unknown error",
    empty: "No parcels to show",
    pickup: "Pickup", pickupNA: "Pickup location not available for this parcel",
    eta: "Estimated delivery", lastSeen: "Last seen", time: "Time",
    orderHome: "Order home delivery",
    refresh: "Refresh",
    refreshParcel: "Refresh this parcel",
    deleteParcel: "Remove this parcel",
    deleteConfirm: "Remove this parcel?",
    rowSettings: "Thresholds for this parcel",
    rowSettingsTitle: "Thresholds",
    rowStaleHours: "Hours → stale",
    rowCriticalHours: "Hours → critical",
    rowReset: "Reset to card defaults",
    renameParcel: "Rename parcel",
    renamePrompt: "New display name:",
    noteParcel: "Add/edit note",
    notePrompt: "Note (leave empty to remove):",
    iconParcel: "Set icon",
    iconPrompt: "Icon (e.g. mdi:gift, 🎁, or https:// URL — empty to remove):",
    noteLabel: "📝 Note",
    s: {
      title: "Settings", language: "Language",
      langNb: "Norsk", langEn: "English",
      colors: "Colors", colorNormal: "Normal row", colorNormalTheme: "Use theme color",
      colorStale: "Stale", colorCritical: "Critical (stuck)", colorDelivered: "Delivered",
      showDelivered: "Show delivered parcels", highlightStuck: "Highlight stuck parcels",
      staleHours: "Hours → stale", criticalHours: "Hours → critical",
      on: "On", off: "Off",
      save: "Save", cancel: "Cancel",
    },
  },
};

// ── Flag SVGs ─────────────────────────────────────────────────────────────────
const FLAG_NO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 16" width="22" height="16" style="display:inline;vertical-align:middle"><rect width="22" height="16" fill="#EF2B2D"/><rect x="6" width="4" height="16" fill="#fff"/><rect y="6" width="22" height="4" fill="#fff"/><rect x="7" width="2" height="16" fill="#002868"/><rect y="7" width="22" height="2" fill="#002868"/></svg>`;
const FLAG_EN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 16" width="22" height="16" style="display:inline;vertical-align:middle"><rect width="22" height="16" fill="#012169"/><path d="M0,0 L22,16 M22,0 L0,16" stroke="#fff" stroke-width="3.5"/><path d="M0,0 L22,16 M22,0 L0,16" stroke="#C8102E" stroke-width="1.8"/><rect x="8.5" width="5" height="16" fill="#fff"/><rect y="5.5" width="22" height="5" fill="#fff"/><rect x="9.5" width="3" height="16" fill="#C8102E"/><rect y="6.5" width="22" height="3" fill="#C8102E"/></svg>`;

// ─────────────────────────────────────────────────────────────────────────────
class NorwegianParcelTrackingCard extends HTMLElement {
  constructor() {
    super();
    this._addMessage = "";
    this._addBusy = false;
    this._showSettings = false;
    this._yamlConfig = null;
    this._dragging = false;
    this._animating = false;
    this._swipeController = null;
    this._rowSettingsFor = null; // tracking_number of the row whose settings are open
  }

  setConfig(config) {
    this._yamlConfig = config || {};
    this.config = this._getCfg();
  }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    if (!this._showSettings && !this._rowSettingsFor && !this._dragging && !this._animating) {
      if (!prev || this._parcelStatesChanged(prev.states, hass.states)) this.render();
    }
  }

  _parcelStatesChanged(prevStates, nextStates) {
    const cfg = this._getCfg();
    let ids;
    if (Array.isArray(cfg.entities) && cfg.entities.length > 0) {
      ids = cfg.entities;
    } else {
      const isMaster = (id, s) => id.startsWith("sensor.") &&
        (s?.attributes?.npt_master_entity === true || s?.attributes?.parcel_tracker_entity === "status");
      ids = Object.keys(nextStates).filter(id => isMaster(id, nextStates[id]));
    }
    return ids.some(id => prevStates[id] !== nextStates[id]);
  }

  getCardSize() {
    return 3;
  }

  // ── Config helpers ───────────────────────────────────────────────────────────

  _storageKey() {
    return `npt_card_${this._yamlConfig?.title ?? "Pakker"}`;
  }

  _rowStorageKey(trackingNumber) {
    return `npt_row_${trackingNumber}`;
  }

  _loadStored() {
    try {
      const r = localStorage.getItem(this._storageKey());
      return r ? JSON.parse(r) : {};
    } catch { return {}; }
  }

  _loadRowStored(trackingNumber) {
    try {
      const r = localStorage.getItem(this._rowStorageKey(trackingNumber));
      return r ? JSON.parse(r) : {};
    } catch { return {}; }
  }

  _patchStored(patch) {
    try {
      localStorage.setItem(this._storageKey(), JSON.stringify({ ...this._loadStored(), ...patch }));
    } catch {}
  }

  _getCfg() {
    return {
      title: "Pakker",
      language: "nb",
      show_delivered: true,
      highlight_stuck: true,
      stale_hours: 24,
      critical_hours: 72,
      auto_entities: true,
      entities: [],
      color_normal: "",
      color_stale: "#b88700",
      color_critical: "#8b1e1e",
      color_delivered: "#1f7a3f",
      country_code: "NO",
      show_notes: true,
      show_icons: true,
      default_icon: "",
      ...(this._yamlConfig || {}),
      ...this._loadStored(),
    };
  }

  _renderIcon(icon) {
    if (!icon) return "";
    if (icon.startsWith("mdi:"))
      return `<span class="npt-icon"><ha-icon icon="${this._escapeAttr(icon)}"></ha-icon></span>`;
    if (icon.startsWith("http://") || icon.startsWith("https://"))
      return `<span class="npt-icon"><img class="npt-icon-img" src="${this._escapeAttr(icon)}" alt=""></span>`;
    return `<span class="npt-icon npt-icon-emoji">${this._escape(icon)}</span>`;
  }

  _str(key) {
    const lang = this._getCfg().language;
    const dict = NPT_STRINGS[lang] || NPT_STRINGS.nb;
    return key.split(".").reduce((o, k) => o?.[k], dict) ?? key;
  }

  // ── Main render ──────────────────────────────────────────────────────────────

  render() {
    if (!this._hass) return;
    const cfg = this._getCfg();
    const states = this._getParcelStates(cfg);
    const rows = states.map((s) => this._renderRow(s, cfg)).join("");
    const flagSvg = cfg.language === "en" ? FLAG_EN : FLAG_NO;

    const normalColor = this._safeColor(cfg.color_normal, "");
    const cssVars = [
      normalColor ? `--npt-normal:${normalColor};` : "",
      `--npt-stale:${this._safeColor(cfg.color_stale, "#b88700")};`,
      `--npt-critical:${this._safeColor(cfg.color_critical, "#8b1e1e")};`,
      `--npt-delivered:${this._safeColor(cfg.color_delivered, "#1f7a3f")};`,
    ].join("");


    this.innerHTML = `
      <div class="npt-swipe-wrapper">
        <div class="npt-refresh-hint">↻ ${this._str("refresh")}</div>
        <div class="npt-swipe-content">
          <ha-card style="${cssVars}">
            <div class="npt-card">
              <div class="npt-header">
                <div class="npt-title">${this._escape(cfg.title)}</div>
                <div class="npt-actions">
                  <button id="npt-flag-btn" class="npt-icon-btn npt-flag-btn" title="${cfg.language === "nb" ? "Norsk" : "English"}">${flagSvg}</button>
                  <button id="npt-settings-btn" class="npt-icon-btn" title="${this._str("s.title")}">⚙</button>
                  <button id="npt-add-btn" class="npt-icon-btn npt-add-icon" title="${this._str("addBtn")}" ${this._addBusy ? "disabled" : ""}>+</button>
                </div>
              </div>
              ${this._addMessage ? `<div class="npt-msg">${this._escape(this._addMessage)}</div>` : ""}
              <div>${rows || `<div class="npt-empty">${this._str("empty")}</div>`}</div>
            </div>
          </ha-card>
        </div>
      </div>
      ${this._styles()}
    `;

    this.querySelector("#npt-add-btn")?.addEventListener("click", () => this._addParcel());
    this.querySelector("#npt-settings-btn")?.addEventListener("click", () => this._openSettings());
    this.querySelector("#npt-flag-btn")?.addEventListener("click", () => this._toggleLang());

    // Per-row action buttons
    this.querySelectorAll(".npt-row-refresh").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._refreshParcel(btn.dataset.tn);
      });
    });
    this.querySelectorAll(".npt-row-delete").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._deleteParcel(btn.dataset.tn);
      });
    });
    this.querySelectorAll(".npt-row-settings").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._openRowSettings(btn.dataset.tn);
      });
    });
    this.querySelectorAll(".npt-row-rename").forEach(btn => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); this._renameParcel(btn.dataset.tn); });
    });
    this.querySelectorAll(".npt-row-note").forEach(btn => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); this._editNote(btn.dataset.tn); });
    });
    this.querySelectorAll(".npt-row-icon").forEach(btn => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); this._editIcon(btn.dataset.tn); });
    });

    this._attachSwipeGesture();
  }

  _renderRow(state, cfg) {
    const a = state.attributes || {};
    const cls = this._rowClass(a, cfg);
    const displayName = a.display_name || a.sender_name || a.tracking_number || state.name;
    const tn = a.tracking_number || "";
    const hasNote = cfg.show_notes !== false && !!a.note;

    const statusText = a.status || state.state;
    const mainRight = hasNote
      ? `<span class="npt-note-chip">${this._str("noteLabel")}</span>`
      : `${this._escape(statusText)}`;

    const iconHtml = cfg.show_icons !== false
      ? this._renderIcon(a.npt_icon || cfg.default_icon)
      : "";

    const latestHtml = hasNote
      ? `<div class="npt-note-text">${this._escape(a.note)}</div>`
      : `<div>${this._escape(a.latest_event || state.state)}</div>`;

    const pickupValue = this._cleanPickup(a.pickup_name || a.pickup_display);
    const pickup = pickupValue ? `<div>${this._str("pickup")}: ${this._escape(pickupValue)}</div>` : "";
    const etaValue = this._cleanEta(a.estimated_delivery_iso || a.estimated_delivery);
    const eta = etaValue ? `<div>${this._str("eta")}: ${this._escape(etaValue)}</div>` : "";
    const loc = a.latest_event_location ? `<div>${this._str("lastSeen")}: ${this._escape(a.latest_event_location)}</div>` : "";
    const time = a.latest_event_time ? `<div>${this._str("time")}: ${this._formatTime(a.latest_event_time)}</div>` : "";
    const homeUrl = this._safeUrl(a.home_delivery_url);
    const home = homeUrl
      ? `<div><a class="npt-link" href="${this._escapeAttr(homeUrl)}" target="_blank" rel="noreferrer">${this._str("orderHome")}</a></div>`
      : "";

    const spinner = a.refreshing ? `<span class="npt-spinner"></span>` : "";
    const rowStored = tn ? this._loadRowStored(tn) : {};
    const hasCustomThresholds = rowStored.stale_hours !== undefined || rowStored.critical_hours !== undefined;
    const thresholdDot = hasCustomThresholds ? `<span class="npt-threshold-dot" title="${this._str("rowSettings")}">●</span>` : "";

    const actions = tn ? `
      <div class="npt-row-actions">
        <button class="npt-row-btn npt-row-settings" data-tn="${this._escapeAttr(tn)}" title="${this._str("rowSettings")}">⏱${thresholdDot}</button>
        <button class="npt-row-btn npt-row-rename" data-tn="${this._escapeAttr(tn)}" title="${this._str("renameParcel")}">✏️</button>
        <button class="npt-row-btn npt-row-note" data-tn="${this._escapeAttr(tn)}" title="${this._str("noteParcel")}">${hasNote ? "📝✓" : "📝"}</button>
        <button class="npt-row-btn npt-row-icon" data-tn="${this._escapeAttr(tn)}" title="${this._str("iconParcel")}">🎨</button>
        <button class="npt-row-btn npt-row-refresh" data-tn="${this._escapeAttr(tn)}" title="${this._str("refreshParcel")}">↺</button>
        <button class="npt-row-btn npt-row-delete" data-tn="${this._escapeAttr(tn)}" title="${this._str("deleteParcel")}">🗑</button>
      </div>` : "";

    return `<div class="npt-row ${cls}">
      <div class="npt-main"><span>${iconHtml}${this._escape(displayName)}</span><span>${mainRight}${spinner}</span></div>
      <div class="npt-meta">${latestHtml}${hasNote ? "" : loc}${hasNote ? "" : time}${eta}${pickup}${home}</div>
      ${actions}
    </div>`;
  }

  // ── Per-row actions ───────────────────────────────────────────────────────────

  async _refreshParcel(trackingNumber) {
    if (!trackingNumber) return;
    try {
      await this._hass.callService("norwegian_parcel_tracker", "refresh", { tracking_number: trackingNumber });
    } catch (_) {}
    this.render();
  }

  async _deleteParcel(trackingNumber) {
    if (!trackingNumber) return;
    if (!window.confirm(this._str("deleteConfirm"))) return;
    try {
      await this._hass.callService("norwegian_parcel_tracker", "remove_parcel", { tracking_number: trackingNumber });
    } catch (_) {}
    this.render();
  }

  async _renameParcel(trackingNumber) {
    if (!trackingNumber) return;
    const state = Object.values(this._hass.states).find(s => (s.attributes?.tracking_number || "") === trackingNumber);
    const current = state?.attributes?.display_name || state?.attributes?.sender_name || "";
    const name = window.prompt(this._str("renamePrompt"), current);
    if (!name || !name.trim()) return;
    try {
      await this._hass.callService("norwegian_parcel_tracker", "rename_parcel", { tracking_number: trackingNumber, name: name.trim() });
    } catch (_) {}
  }

  async _editNote(trackingNumber) {
    if (!trackingNumber) return;
    const state = Object.values(this._hass.states).find(s => (s.attributes?.tracking_number || "") === trackingNumber);
    const current = state?.attributes?.note || "";
    const note = window.prompt(this._str("notePrompt"), current);
    if (note === null) return;
    try {
      if (note.trim()) {
        await this._hass.callService("norwegian_parcel_tracker", "set_note", { tracking_number: trackingNumber, text: note.trim() });
      } else {
        await this._hass.callService("norwegian_parcel_tracker", "clear_note", { tracking_number: trackingNumber });
      }
    } catch (_) {}
  }

  async _editIcon(trackingNumber) {
    if (!trackingNumber) return;
    const state = Object.values(this._hass.states).find(s => (s.attributes?.tracking_number || "") === trackingNumber);
    const current = state?.attributes?.npt_icon || "";
    const icon = window.prompt(this._str("iconPrompt"), current);
    if (icon === null) return;
    try {
      if (icon.trim()) {
        await this._hass.callService("norwegian_parcel_tracker", "set_icon", { tracking_number: trackingNumber, icon: icon.trim() });
      } else {
        await this._hass.callService("norwegian_parcel_tracker", "clear_icon", { tracking_number: trackingNumber });
      }
    } catch (_) {}
  }

  _openRowSettings(trackingNumber) {
    if (!trackingNumber) return;
    this._rowSettingsFor = trackingNumber;
    this._renderRowSettings(trackingNumber);
  }

  _renderRowSettings(trackingNumber) {
    const cfg = this._getCfg();
    const rowStored = this._loadRowStored(trackingNumber);
    const stale = rowStored.stale_hours ?? cfg.stale_hours ?? 24;
    const critical = rowStored.critical_hours ?? cfg.critical_hours ?? 72;

    this.innerHTML = `
      <ha-card>
        <div class="npt-card">
          <div class="npt-header">
            <div class="npt-title">${this._str("rowSettingsTitle")}</div>
            <button id="npt-close" class="npt-icon-btn" title="${this._str("s.cancel")}">✕</button>
          </div>
          <div class="npt-settings">
            <div class="npt-ssec">${this._escape(trackingNumber)}</div>
            <div class="npt-srow">
              <label class="npt-slabel">${this._str("rowStaleHours")}</label>
              <input type="number" id="row-stale-hours" value="${stale}" min="1" max="999" class="npt-num-input">
            </div>
            <div class="npt-srow">
              <label class="npt-slabel">${this._str("rowCriticalHours")}</label>
              <input type="number" id="row-critical-hours" value="${critical}" min="1" max="999" class="npt-num-input">
            </div>
            <div class="npt-footer">
              <button id="npt-row-save" class="npt-btn-pri">${this._str("s.save")}</button>
              <button id="npt-row-reset" class="npt-btn-sec">${this._str("rowReset")}</button>
              <button id="npt-row-cancel" class="npt-btn-sec">${this._str("s.cancel")}</button>
            </div>
          </div>
        </div>
      </ha-card>
      ${this._styles()}
    `;

    this.querySelector("#npt-row-save")?.addEventListener("click", () => {
      const sh = Math.max(1, Math.min(999, parseInt(this.querySelector("#row-stale-hours")?.value || "24", 10)));
      const ch = Math.max(1, Math.min(999, parseInt(this.querySelector("#row-critical-hours")?.value || "72", 10)));
      try {
        localStorage.setItem(this._rowStorageKey(trackingNumber), JSON.stringify({
          stale_hours: isNaN(sh) ? 24 : sh,
          critical_hours: isNaN(ch) ? 72 : Math.max((isNaN(sh) ? 24 : sh) + 1, ch),
        }));
      } catch {}
      this._rowSettingsFor = null;
      this.render();
    });

    this.querySelector("#npt-row-reset")?.addEventListener("click", () => {
      try { localStorage.removeItem(this._rowStorageKey(trackingNumber)); } catch {}
      this._rowSettingsFor = null;
      this.render();
    });

    this.querySelector("#npt-row-cancel")?.addEventListener("click", () => {
      this._rowSettingsFor = null;
      this.render();
    });
    this.querySelector("#npt-close")?.addEventListener("click", () => {
      this._rowSettingsFor = null;
      this.render();
    });
  }

  // ── Swipe-to-refresh ─────────────────────────────────────────────────────────

  _attachSwipeGesture() {
    if (this._swipeController) this._swipeController.abort();
    this._swipeController = new AbortController();
    const { signal } = this._swipeController;

    const wrapper = this.querySelector(".npt-swipe-wrapper");
    const content = this.querySelector(".npt-swipe-content");
    const hint = this.querySelector(".npt-refresh-hint");
    if (!wrapper || !content || !hint) return;

    const THRESHOLD = 110;
    let startX = 0, startY = 0, active = false, isHoriz = null, delta = 0;

    const onStart = (x, y) => {
      startX = x; startY = y; active = true; isHoriz = null; delta = 0;
    };

    const onMove = (x, y) => {
      if (!active) return;
      const dx = x - startX, dy = y - startY;
      if (isHoriz === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        isHoriz = Math.abs(dx) > Math.abs(dy);
      }
      if (!isHoriz || dx <= 0) return;
      this._dragging = true;
      delta = dx;
      const progress = Math.min(dx / THRESHOLD, 1);
      content.style.transform = `translateX(${Math.min(dx * 0.55, THRESHOLD * 0.55)}px)`;
      hint.style.opacity = String(progress);
      hint.style.transform = `translateX(${Math.min(dx * 0.25, 28)}px)`;
    };

    const onEnd = () => {
      if (!active) return;
      active = false;
      const triggered = delta >= THRESHOLD;
      delta = 0; isHoriz = null;
      content.style.transform = "";
      hint.style.opacity = "0";
      hint.style.transform = "";
      this._dragging = false;
      if (triggered) this._triggerRefresh();
    };

    wrapper.addEventListener("touchstart", e => onStart(e.touches[0].clientX, e.touches[0].clientY), { passive: true, signal });
    wrapper.addEventListener("touchmove", e => { onMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true, signal });
    wrapper.addEventListener("touchend", onEnd, { signal });
    wrapper.addEventListener("touchcancel", onEnd, { signal });

    wrapper.addEventListener("mousedown", e => { if (e.button === 0) onStart(e.clientX, e.clientY); }, { signal });
    window.addEventListener("mousemove", e => onMove(e.clientX, e.clientY), { signal });
    window.addEventListener("mouseup", onEnd, { signal });
  }

  async _triggerRefresh() {
    this._animating = true;
    const content = this.querySelector(".npt-swipe-content");
    if (content) {
      content.classList.add("npt-blinking");
      await new Promise(r => setTimeout(r, 900));
      content.classList.remove("npt-blinking");
    }
    this._animating = false;
    try {
      await this._hass.callService("norwegian_parcel_tracker", "refresh", {});
    } catch (_) {}
    this.render();
  }

  // ── Settings panel ───────────────────────────────────────────────────────────

  _openSettings() {
    this._showSettings = true;
    this._renderSettings();
  }

  _renderSettings() {
    const cfg = this._getCfg();
    const s = (NPT_STRINGS[cfg.language] || NPT_STRINGS.nb).s;

    const toggle = (id, val, label) => `
      <div class="npt-srow">
        <div class="npt-slabel">${label}</div>
        <div class="npt-toggle-wrap">
          <button class="npt-toggle ${val ? "on" : ""}" data-tid="${id}" data-tval="true">${s.on}</button>
          <button class="npt-toggle ${!val ? "on" : ""}" data-tid="${id}" data-tval="false">${s.off}</button>
        </div>
      </div>`;

    const useTheme = !cfg.color_normal;

    this.innerHTML = `
      <ha-card>
        <div class="npt-card">
          <div class="npt-header">
            <div class="npt-title">${s.title}</div>
            <button id="npt-close" class="npt-icon-btn" title="${s.cancel}">✕</button>
          </div>
          <div class="npt-settings">

            <div class="npt-ssec">${s.language}</div>
            <div class="npt-srow npt-lang-row">
              <button class="npt-lang-btn ${cfg.language === "nb" ? "on" : ""}" data-lang="nb">${FLAG_NO}&nbsp;${s.langNb}</button>
              <button class="npt-lang-btn ${cfg.language === "en" ? "on" : ""}" data-lang="en">${FLAG_EN}&nbsp;${s.langEn}</button>
            </div>

            <div class="npt-ssec">${s.colors}</div>
            <div class="npt-srow">
              <label class="npt-slabel">${s.colorNormal}</label>
              <div class="npt-color-wrap">
                <input type="color" id="clr-normal" value="${cfg.color_normal || "#2d2d2d"}" ${useTheme ? "disabled" : ""} style="opacity:${useTheme ? 0.35 : 1}">
                <label class="npt-theme-check"><input type="checkbox" id="clr-normal-theme" ${useTheme ? "checked" : ""}>&nbsp;${s.colorNormalTheme}</label>
              </div>
            </div>
            <div class="npt-srow">
              <label class="npt-slabel">${s.colorStale}</label>
              <input type="color" id="clr-stale" value="${cfg.color_stale || "#b88700"}">
            </div>
            <div class="npt-srow">
              <label class="npt-slabel">${s.colorCritical}</label>
              <input type="color" id="clr-critical" value="${cfg.color_critical || "#8b1e1e"}">
            </div>
            <div class="npt-srow">
              <label class="npt-slabel">${s.colorDelivered}</label>
              <input type="color" id="clr-delivered" value="${cfg.color_delivered || "#1f7a3f"}">
            </div>


            <div class="npt-ssec"></div>
            ${toggle("show_delivered", cfg.show_delivered !== false, s.showDelivered)}
            ${toggle("highlight_stuck", cfg.highlight_stuck !== false, s.highlightStuck)}

            <div class="npt-ssec"></div>
            <div class="npt-srow">
              <label class="npt-slabel">${s.staleHours}</label>
              <input type="number" id="stale-hours" value="${cfg.stale_hours ?? 24}" min="1" max="999" class="npt-num-input">
            </div>
            <div class="npt-srow">
              <label class="npt-slabel">${s.criticalHours}</label>
              <input type="number" id="critical-hours" value="${cfg.critical_hours ?? 72}" min="1" max="999" class="npt-num-input">
            </div>

            <div class="npt-footer">
              <button id="npt-save" class="npt-btn-pri">${s.save}</button>
              <button id="npt-cancel" class="npt-btn-sec">${s.cancel}</button>
            </div>
          </div>
        </div>
      </ha-card>
      ${this._styles()}
    `;

    // Language buttons
    this.querySelectorAll(".npt-lang-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this.querySelectorAll(".npt-lang-btn").forEach(b => b.classList.remove("on"));
        btn.classList.add("on");
      });
    });

    // Toggle buttons (on/off)
    this.querySelectorAll(".npt-toggle[data-tid]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.tid;
        this.querySelectorAll(`.npt-toggle[data-tid="${id}"]`).forEach(b => b.classList.remove("on"));
        btn.classList.add("on");
      });
    });


    // Normal color theme checkbox
    const themeChk = this.querySelector("#clr-normal-theme");
    const clrNorm = this.querySelector("#clr-normal");
    if (themeChk && clrNorm) {
      themeChk.addEventListener("change", () => {
        clrNorm.disabled = themeChk.checked;
        clrNorm.style.opacity = themeChk.checked ? "0.35" : "1";
      });
    }

    this.querySelector("#npt-save")?.addEventListener("click", () => this._saveSettings());
    this.querySelector("#npt-cancel")?.addEventListener("click", () => this._closeSettings());
    this.querySelector("#npt-close")?.addEventListener("click", () => this._closeSettings());
  }

  _saveSettings() {
    const stored = {};

    const langBtn = this.querySelector(".npt-lang-btn.on");
    if (langBtn) stored.language = langBtn.dataset.lang;

    const useTheme = this.querySelector("#clr-normal-theme")?.checked;
    stored.color_normal = useTheme ? "" : (this.querySelector("#clr-normal")?.value || "");
    stored.color_stale = this.querySelector("#clr-stale")?.value || "#b88700";
    stored.color_critical = this.querySelector("#clr-critical")?.value || "#8b1e1e";
    stored.color_delivered = this.querySelector("#clr-delivered")?.value || "#1f7a3f";


    ["show_delivered", "highlight_stuck"].forEach(id => {
      const btn = this.querySelector(`.npt-toggle[data-tid="${id}"].on`);
      if (btn) stored[id] = btn.dataset.tval === "true";
    });

    const sh = Math.max(1, Math.min(999, parseInt(this.querySelector("#stale-hours")?.value || "24", 10)));
    const ch = Math.max(1, Math.min(999, parseInt(this.querySelector("#critical-hours")?.value || "72", 10)));
    stored.stale_hours = isNaN(sh) ? 24 : sh;
    stored.critical_hours = isNaN(ch) ? 72 : Math.max(stored.stale_hours + 1, ch);

    try { localStorage.setItem(this._storageKey(), JSON.stringify(stored)); } catch {}
    this._showSettings = false;
    this.render();
  }

  _closeSettings() {
    this._showSettings = false;
    this.render();
  }

  _toggleLang() {
    const cfg = this._getCfg();
    this._patchStored({ language: cfg.language === "nb" ? "en" : "nb" });
    this.render();
  }

  // ── Parcel state helpers ─────────────────────────────────────────────────────

  _getParcelStates(cfg) {
    const isMaster = (s) => {
      if (!s?.entity_id?.startsWith("sensor.")) return false;
      const a = s.attributes || {};
      return a.npt_master_entity === true || a.parcel_tracker_entity === "status";
    };

    let states = [];
    if (Array.isArray(cfg.entities) && cfg.entities.length > 0) {
      states = cfg.entities.map(id => this._hass.states[id]).filter(isMaster);
    } else {
      states = Object.values(this._hass.states).filter(isMaster);
    }

    return states
      .filter(s => cfg.show_delivered !== false || !this._isDelivered(s.attributes || {}))
      .sort((a, b) => {
        const ta = new Date((a.attributes || {}).latest_event_time || 0).getTime();
        const tb = new Date((b.attributes || {}).latest_event_time || 0).getTime();
        return tb - ta;
      });
  }

  _rowClass(attrs, cfg) {
    if (this._isDelivered(attrs)) return "delivered";
    if (cfg.highlight_stuck === false) return "";
    const t = attrs.latest_event_time;
    if (!t) return "";
    const ageHours = (Date.now() - new Date(t).getTime()) / 36e5;
    const tn = attrs.tracking_number || "";
    const rowStored = tn ? this._loadRowStored(tn) : {};
    const critical = Number(rowStored.critical_hours ?? cfg.critical_hours ?? 72);
    const stale = Number(rowStored.stale_hours ?? cfg.stale_hours ?? 24);
    if (critical > 0 && ageHours >= critical) return "critical";
    if (stale > 0 && ageHours >= stale) return "warn";
    return "";
  }

  _isDelivered(attrs) {
    if (attrs.is_delivered === true) return true;
    const text = `${attrs.status || ""} ${attrs.latest_event || ""} ${attrs.status_code || ""}`.toLowerCase();
    return text.includes("pakken er levert") || text.includes("delivered") || text.includes("hentet pakken");
  }

  // ── Add parcel ───────────────────────────────────────────────────────────────

  async _addParcel() {
    if (this._addBusy) return;
    const tracking = window.prompt(this._str("addPrompt"))?.trim();
    if (!tracking) return;
    const nameRaw = window.prompt(this._str("namePrompt"));
    const name = (nameRaw ?? "").trim();

    this._addBusy = true;
    this._addMessage = this._str("adding");
    this.render();

    try {
      const serviceData = { tracking_number: tracking };
      if (name) serviceData.name = name;
      await this._hass.callService("norwegian_parcel_tracker", "add_parcel", serviceData);
      this._addMessage = this._str("addOk");
    } catch (err) {
      this._addMessage = `${this._str("addErr")}: ${err?.message || this._str("addErrUnknown")}`;
    } finally {
      this._addBusy = false;
      this.render();
      window.setTimeout(() => { this._addMessage = ""; this.render(); }, 5000);
    }
  }

  // ── String cleaning ──────────────────────────────────────────────────────────

  _cleanPickup(value) {
    if (!value) return "";
    const text = String(value).trim();
    // Keep in sync with _sanitize_pickup_name in norwegian-parcel-tracker (api.py)
    const bad = new Set(["expectedPickupUnitURL","expectedPickupUnitUrl","expectedPickupUnitId","expectedPickupUnitName","pickupPointInfo","pickup-point","Pickup not available","Unknown","unknown"]);
    if (bad.has(text)) return this._str("pickupNA");
    if (text.startsWith("http://") || text.startsWith("https://")) return this._str("pickupNA");
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text) && !/\d/.test(text)) return this._str("pickupNA");
    return text;
  }

  _cleanEta(value) {
    if (!value) return "";
    const text = String(value).trim();
    // Keep in sync with _sanitize_estimated_delivery / _looks_like_internal_key in norwegian-parcel-tracker (api.py)
    if (text === "estimatedTimeSpanOfDelivery" || text === "EstimatedTimeSpanOfDelivery") return "";
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text) && !/\d/.test(text)) return "";
    return text;
  }

  _formatTime(value) {
    try {
      const locale = this._getCfg().language === "en" ? "en-GB" : "no-NO";
      return new Date(value).toLocaleString(locale, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return value; }
  }

  _escape(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  _escapeAttr(value) {
    return this._escape(value).replaceAll('"', "&quot;");
  }

  // Returns val if it is a safe CSS hex color (#RGB / #RRGGBB / #RRGGBBAA), otherwise fallback.
  _safeColor(val, fallback) {
    return (typeof val === "string" && /^#[0-9a-fA-F]{3,8}$/.test(val.trim())) ? val.trim() : fallback;
  }

  // Returns the URL if it starts with https://, otherwise null.
  _safeUrl(val) {
    return (typeof val === "string" && val.startsWith("https://")) ? val : null;
  }

  // ── Styles ───────────────────────────────────────────────────────────────────

  _styles() {
    return `<style>
      .npt-swipe-wrapper { position: relative; overflow: hidden; border-radius: var(--ha-card-border-radius, 12px); }
      .npt-refresh-hint { position: absolute; left: 0; top: 0; bottom: 0; display: flex; align-items: center; padding-left: 20px; font-weight: 700; font-size: 1rem; color: var(--primary-color); opacity: 0; pointer-events: none; user-select: none; white-space: nowrap; will-change: opacity, transform; }
      .npt-swipe-content { will-change: transform; }
      @keyframes npt-blink { 0%,100%{opacity:1} 14%,42%,70%{opacity:0} 28%,56%,84%{opacity:1} }
      .npt-blinking { animation: npt-blink 0.9s ease-in-out forwards; }
      @keyframes npt-spin { to { transform: rotate(360deg); } }
      .npt-spinner { display: inline-block; width: 13px; height: 13px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: npt-spin 0.75s linear infinite; vertical-align: middle; margin-left: 6px; }
      .npt-card { padding: 16px; }
      .npt-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .npt-title { font-size: 1.15rem; font-weight: 600; }
      .npt-actions { display: flex; align-items: center; gap: 4px; }
      .npt-icon-btn { border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer; background: transparent; color: var(--primary-text-color); font-size: 1.1rem; line-height: 1; }
      .npt-icon-btn:hover { background: var(--secondary-background-color); }
      .npt-icon-btn:disabled { opacity: 0.65; cursor: progress; }
      .npt-flag-btn { padding: 3px 6px; }
      .npt-add-icon { background: var(--primary-color); color: var(--text-primary-color); font-weight: 700; font-size: 1.3rem; padding: 2px 10px; }
      .npt-add-icon:hover { filter: brightness(1.15); }
      .npt-msg { font-size: 0.8rem; opacity: 0.85; text-align: right; margin-bottom: 8px; }
      .npt-row { margin: 8px 0; border-radius: 10px; padding: 10px 12px 6px; background: var(--npt-normal, var(--secondary-background-color)); color: var(--primary-text-color); border-left: 5px solid var(--divider-color); }
      .npt-row.delivered { background: var(--npt-delivered, #1f7a3f); color: #fff; border-left-color: #0b4f28; }
      .npt-row.warn { background: var(--npt-stale, #b88700); color: #000; border-left-color: #6d5100; }
      .npt-row.critical { background: var(--npt-critical, #8b1e1e); color: #fff; border-left-color: #4d0c0c; }
      .npt-main { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-weight: 600; }
      .npt-icon { display: inline-flex; align-items: center; margin-right: 5px; vertical-align: middle; }
      .npt-icon ha-icon { --mdc-icon-size: 20px; }
      .npt-icon-emoji { font-size: 1.1rem; }
      .npt-icon-img { width: 20px; height: 20px; object-fit: contain; border-radius: 3px; vertical-align: middle; }
      .npt-note-chip { font-size: 0.8rem; background: rgba(200,150,0,0.25); border-radius: 4px; padding: 1px 6px; font-style: italic; }
      .npt-note-text { font-style: italic; opacity: 0.92; font-size: 0.88rem; background: rgba(200,150,0,0.15); border-radius: 4px; padding: 3px 7px; margin: 2px 0; white-space: pre-wrap; word-break: break-word; }
      .npt-meta { margin-top: 6px; font-size: 0.9rem; opacity: 0.95; line-height: 1.45; }
      .npt-empty { opacity: 0.7; }
      .npt-link { color: inherit; text-decoration: underline; }
      .npt-row-actions { display: flex; justify-content: flex-end; gap: 2px; margin-top: 6px; padding-top: 4px; border-top: 1px solid rgba(128,128,128,0.2); }
      .npt-row-btn { border: none; border-radius: 5px; padding: 2px 7px; cursor: pointer; background: transparent; color: inherit; font-size: 0.9rem; opacity: 0.6; line-height: 1.4; }
      .npt-row-btn:hover { opacity: 1; background: rgba(128,128,128,0.15); }
      .npt-threshold-dot { font-size: 0.5rem; vertical-align: super; color: var(--primary-color); }
      /* ── Settings ── */
      .npt-settings { display: flex; flex-direction: column; gap: 2px; }
      .npt-ssec { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; opacity: 0.55; margin-top: 16px; padding-bottom: 3px; border-bottom: 1px solid var(--divider-color); }
      .npt-srow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; }
      .npt-slabel { font-size: 0.9rem; flex: 1; }
      .npt-color-wrap { display: flex; align-items: center; gap: 8px; }
      .npt-theme-check { font-size: 0.8rem; display: flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }
      .npt-toggle-wrap { display: flex; gap: 4px; }
      .npt-toggle { border: 1px solid var(--divider-color); border-radius: 4px; padding: 3px 10px; font-size: 0.85rem; cursor: pointer; background: transparent; color: var(--primary-text-color); }
      .npt-toggle.on { background: var(--primary-color); color: var(--text-primary-color); border-color: var(--primary-color); }
      .npt-lang-row { justify-content: flex-start; gap: 8px; flex-wrap: wrap; }
      .npt-lang-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--divider-color); border-radius: 6px; padding: 5px 12px; font-size: 0.9rem; cursor: pointer; background: transparent; color: var(--primary-text-color); }
      .npt-lang-btn.on { background: var(--primary-color); color: var(--text-primary-color); border-color: var(--primary-color); }
      .npt-num-input { width: 72px; padding: 3px 6px; border: 1px solid var(--divider-color); border-radius: 4px; background: var(--secondary-background-color); color: var(--primary-text-color); font-size: 0.9rem; text-align: right; }
      .npt-footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--divider-color); flex-wrap: wrap; }
      .npt-btn-pri { background: var(--primary-color); color: var(--text-primary-color); border: none; border-radius: 6px; padding: 7px 20px; cursor: pointer; font-weight: 600; font-size: 0.95rem; }
      .npt-btn-sec { background: transparent; color: var(--primary-text-color); border: 1px solid var(--divider-color); border-radius: 6px; padding: 7px 20px; cursor: pointer; font-size: 0.95rem; }
    </style>`;
  }
}

if (!customElements.get("norwegian-parcel-tracking")) {
  customElements.define("norwegian-parcel-tracking", NorwegianParcelTrackingCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "norwegian-parcel-tracking",
  name: "Norwegian parcel tracking",
  description: "Shows parcels tracked by Norwegian parcel tracker.",
});
