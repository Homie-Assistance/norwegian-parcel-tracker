// Norwegian Parcel Tracker — Dashboard Panel
// Registered as a HA sidebar panel (module_url). Full implementation: v2.0.

class NorwegianParcelTrackerPanel extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._parcels = [];
    this._selected = null;
    this._shadow = this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    this._parcels = Object.values(hass.states).filter(
      (s) => s.attributes && s.attributes.npt_master_entity === true
    );
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

  _renderIcon(icon) {
    if (!icon) return `<ha-icon icon="mdi:package-variant-closed"></ha-icon>`;
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

  _delaySearchUrl(carrier) {
    const c = String(carrier || "").toLowerCase();
    if (c === "helthjem") return "https://duckduckgo.com/?q=helthjem+forsinkelse";
    return "https://duckduckgo.com/?q=posten+forsinkelse";
  }

  _selectParcel(entityId) {
    this._selected = entityId === this._selected ? null : entityId;
    this._render();
  }

  _callService(domain, service, data) {
    if (this._hass) this._hass.callService(domain, service, data);
  }

  _renderDetailPane(state) {
    const a = state.attributes;
    const events = a.recent_events || [];
    const note = a.note || "";
    const phone = this._carrierPhone(a.carrier);
    const delayUrl = this._delaySearchUrl(a.carrier);
    const trackingNum = a.tracking_number || state.entity_id;

    const eventsHtml = events
      .slice(0, 20)
      .map(
        (e) => `
        <div class="event-row">
          <span class="event-date">${this._escHtml(e.date_iso ? e.date_iso.slice(0, 16).replace("T", " ") : "")}</span>
          <span class="event-desc">${this._escHtml(e.description)}</span>
          <span class="event-loc">${this._escHtml(e.location || "")}</span>
        </div>`
      )
      .join("");

    return `
      <div class="detail-pane">
        <h2>${this._escHtml(a.display_name || a.sender_name || trackingNum)}</h2>
        <div class="detail-tracking">${this._escHtml(trackingNum)}</div>

        ${note ? `<div class="note-box"><span class="note-label">📝 Note</span><div class="note-text">${this._escHtml(note)}</div><button class="btn-sm" id="btn-clear-note">Clear note</button></div>` : ""}

        <div class="detail-actions">
          <button class="btn" id="btn-rename">✏️ Rename</button>
          <button class="btn" id="btn-note">${note ? "Edit note" : "📝 Add note"}</button>
          <button class="btn" id="btn-icon">🎨 Set icon</button>
          <button class="btn btn-refresh" id="btn-refresh">↺ Refresh</button>
        </div>

        ${phone ? `<div class="carrier-contact"><a href="tel:${this._escHtml(phone.num)}" class="phone-link">📞 ${this._escHtml(phone.label)}</a></div>` : ""}
        <div class="carrier-contact"><a href="${this._escHtml(delayUrl)}" target="_blank" rel="noopener noreferrer" class="news-link">🔍 Search for delivery delays</a></div>

        <h3>Event history</h3>
        <div class="events-list">${eventsHtml || "<p>No events</p>"}</div>
      </div>`;
  }

  _renderAllParcelsMap(parcels) {
    const points = parcels
      .filter((s) => s.attributes.route_coords && s.attributes.route_coords.length > 0)
      .map((s) => ({
        entityId: s.entity_id,
        lat: s.attributes.route_coords[0].lat,
        lng: s.attributes.route_coords[0].lng,
        name: (s.attributes.display_name || s.attributes.sender_name || s.attributes.tracking_number || "").slice(0, 22),
        icon: s.attributes.npt_icon || "",
        delivered: /delivered|levert|hentet/i.test(s.state || ""),
      }));

    if (points.length === 0) {
      return `<div class="map-empty" style="padding-top:40px">No location data yet — parcel positions will appear here as events are tracked.</div>`;
    }

    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const dLat = (maxLat - minLat) || 0.05;
    const dLng = (maxLng - minLng) || 0.05;
    const pad = 0.18;
    const vMinLat = minLat - dLat * pad, vMaxLat = maxLat + dLat * pad;
    const vMinLng = minLng - dLng * pad, vMaxLng = maxLng + dLng * pad;

    const W = 600, H = 300;
    const toX = (lng) => ((lng - vMinLng) / (vMaxLng - vMinLng)) * W;
    const toY = (lat) => H - ((lat - vMinLat) / (vMaxLat - vMinLat)) * H;

    const dots = points.map((p) => {
      const x = toX(p.lng), y = toY(p.lat);
      const isEmoji = p.icon && !p.icon.startsWith("mdi:") && !p.icon.startsWith("http");
      const label = isEmoji ? p.icon : "📦";
      const cls = p.delivered ? "overview-dot-delivered" : "overview-dot";
      return `<g class="overview-parcel" data-id="${this._escHtml(p.entityId)}" style="cursor:pointer" tabindex="0">
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" class="${cls}"/>
        <text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle" font-size="12" style="pointer-events:none">${this._escHtml(label)}</text>
        ${p.name ? `<text x="${(x + 17).toFixed(1)}" y="${(y - 10).toFixed(1)}" class="route-label" font-size="10">${this._escHtml(p.name)}</text>` : ""}
        <title>${this._escHtml(p.name)}</title>
      </g>`;
    }).join("");

    return `
      <div style="font-size:0.78em;opacity:0.55;padding:0 0 6px">All parcels — click a dot to view route &amp; details</div>
      <svg class="route-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="max-height:300px">${dots}</svg>`;
  }

  _renderRouteMap(state) {
    const coords = (state && state.attributes && state.attributes.route_coords) || [];
    if (coords.length === 0) return `<div class="map-empty">No route data</div>`;

    const lats = coords.map((c) => c.lat);
    const lngs = coords.map((c) => c.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const padPct = 0.1;
    const dlat = (maxLat - minLat) || 0.05;
    const dlng = (maxLng - minLng) || 0.05;
    const vMinLat = minLat - dlat * padPct;
    const vMaxLat = maxLat + dlat * padPct;
    const vMinLng = minLng - dlng * padPct;
    const vMaxLng = maxLng + dlng * padPct;

    const W = 480, H = 320;

    const toX = (lng) => ((lng - vMinLng) / (vMaxLng - vMinLng)) * W;
    const toY = (lat) => H - ((lat - vMinLat) / (vMaxLat - vMinLat)) * H;

    const pointsStr = coords.map((c) => `${toX(c.lng).toFixed(1)},${toY(c.lat).toFixed(1)}`).join(" ");

    const dots = coords
      .map((c, i) => {
        const x = toX(c.lng), y = toY(c.lat);
        const isFirst = i === 0;
        const label = (c.location || "").split(",")[0].slice(0, 20);
        return `
          <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isFirst ? 7 : 4}"
            class="${isFirst ? "route-dot-current" : "route-dot"}"
            title="${this._escHtml(c.description || "")}">
            <title>${this._escHtml(c.date_iso ? c.date_iso.slice(0, 16).replace("T", " ") : "")} — ${this._escHtml(c.description || "")}</title>
          </circle>
          ${label ? `<text x="${(x + 8).toFixed(1)}" y="${(y + 4).toFixed(1)}" class="route-label">${this._escHtml(label)}</text>` : ""}`;
      })
      .join("");

    return `
      <svg class="route-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <polyline points="${pointsStr}" class="route-line" fill="none"/>
        ${dots}
      </svg>`;
  }

  _render() {
    if (!this._hass) return;
    const parcels = this._parcels;
    const selected = this._selected
      ? parcels.find((s) => s.entity_id === this._selected)
      : null;

    const rows = parcels
      .map((s) => {
        const a = s.attributes;
        const icon = this._renderIcon(a.npt_icon);
        const name = a.display_name || a.sender_name || a.tracking_number || s.entity_id;
        const status = a.note ? "📝 " + a.note.slice(0, 60) : (s.state || "");
        const isActive = s.entity_id === this._selected;
        return `
          <tr class="parcel-row ${isActive ? "selected" : ""}" data-id="${s.entity_id}">
            <td class="col-icon">${icon}</td>
            <td class="col-name">${this._escHtml(name)}</td>
            <td class="col-status">${this._escHtml(status)}</td>
            <td class="col-eta">${this._escHtml(a.estimated_delivery_iso || "")}</td>
          </tr>`;
      })
      .join("");

    this._shadow.innerHTML = `
      <style>
        :host { display: flex; flex-direction: column; height: 100%; background: var(--primary-background-color, #111); color: var(--primary-text-color, #eee); font-family: var(--paper-font-body1_-_font-family, sans-serif); }
        .panel-header { display: flex; align-items: center; padding: 12px 16px; background: var(--app-header-background-color, #1976d2); color: var(--app-header-text-color, #fff); font-size: 1.2em; font-weight: 600; }
        .panel-header ha-icon { margin-right: 8px; }
        .panel-body { display: flex; flex: 1; overflow: hidden; }
        .left-pane { width: 380px; min-width: 260px; display: flex; flex-direction: column; border-right: 1px solid var(--divider-color, #333); overflow: hidden; }
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
        .col-status { font-size: 0.85em; opacity: 0.8; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .col-eta { font-size: 0.75em; opacity: 0.6; white-space: nowrap; }
        .route-svg { width: 100%; max-height: 320px; background: var(--secondary-background-color, #181818); border-radius: 8px; border: 1px solid var(--divider-color, #333); margin-bottom: 12px; }
        .route-line { stroke: var(--primary-color, #1976d2); stroke-width: 2; stroke-dasharray: 6,3; }
        .route-dot { fill: var(--primary-color, #1976d2); opacity: 0.8; }
        .route-dot-current { fill: #f50057; animation: pulse 1.5s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{r:7;opacity:1} 50%{r:10;opacity:0.6} }
        .route-label { fill: var(--secondary-text-color, #aaa); font-size: 9px; }
        .map-empty { padding: 20px; opacity: 0.5; text-align: center; }
        .overview-dot { fill: var(--primary-color, #1976d2); opacity: 0.9; animation: pulse 2s ease-in-out infinite; }
        .overview-dot-delivered { fill: var(--success-color, #4caf50); opacity: 0.75; }
        .overview-parcel:hover .overview-dot,
        .overview-parcel:hover .overview-dot-delivered { opacity: 1; filter: brightness(1.15); }
        .detail-pane { max-width: 720px; }
        .detail-pane h2 { margin: 0 0 4px; font-size: 1.1em; }
        .detail-tracking { font-size: 0.8em; opacity: 0.6; margin-bottom: 12px; }
        .note-box { background: var(--warning-color, #7c5e00); border-radius: 6px; padding: 8px 12px; margin: 8px 0 12px; }
        .note-label { font-weight: 600; font-size: 0.85em; }
        .note-text { margin: 4px 0; white-space: pre-wrap; word-break: break-word; }
        .detail-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 12px; }
        .btn { background: var(--primary-color, #1976d2); color: #fff; border: none; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 0.85em; }
        .btn-sm { background: transparent; border: 1px solid var(--divider-color, #555); color: inherit; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 0.75em; margin-left: 8px; }
        .carrier-contact { margin: 6px 0; }
        .phone-link, .news-link { color: var(--primary-color, #42a5f5); text-decoration: none; font-size: 0.9em; }
        .phone-link:hover, .news-link:hover { text-decoration: underline; }
        .events-list { font-size: 0.82em; }
        .event-row { display: grid; grid-template-columns: 140px 1fr 120px; gap: 4px; padding: 4px 0; border-bottom: 1px solid var(--divider-color, #222); }
        .event-date { opacity: 0.6; font-size: 0.9em; }
        .event-loc { opacity: 0.5; font-size: 0.9em; text-align: right; }
        .no-parcels { padding: 32px; text-align: center; opacity: 0.5; }
        table { table-layout: fixed; }
      </style>

      <div class="panel-header">
        <ha-icon icon="mdi:package-variant-closed"></ha-icon>
        Parcels
      </div>
      <div class="panel-body">
        <div class="left-pane">
          ${parcels.length === 0
            ? `<div class="no-parcels">No parcels tracked.<br>Add one via the integration.</div>`
            : `<table class="parcel-table">
                <thead><tr>
                  <th></th><th>Package</th><th>Status</th><th>ETA</th>
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

    this._shadow.querySelectorAll(".parcel-row").forEach((row) => {
      row.addEventListener("click", () => this._selectParcel(row.dataset.id));
    });

    this._shadow.querySelectorAll(".overview-parcel").forEach((g) => {
      g.addEventListener("click", () => this._selectParcel(g.dataset.id));
    });

    if (selected) {
      const btnRename = this._shadow.getElementById("btn-rename");
      const btnNote = this._shadow.getElementById("btn-note");
      const btnClearNote = this._shadow.getElementById("btn-clear-note");
      const btnIcon = this._shadow.getElementById("btn-icon");
      const btnRefresh = this._shadow.getElementById("btn-refresh");
      const tn = selected.attributes.tracking_number || selected.entity_id;

      if (btnRename) {
        btnRename.addEventListener("click", () => {
          const name = window.prompt("New parcel name:", selected.attributes.display_name || selected.attributes.sender_name || "");
          if (name && name.trim()) this._callService("norwegian_parcel_tracker", "rename_parcel", { tracking_number: tn, name: name.trim() });
        });
      }
      if (btnNote) {
        btnNote.addEventListener("click", () => {
          const note = window.prompt("Parcel note (clears when removed):", selected.attributes.note || "");
          if (note !== null) {
            if (note.trim()) this._callService("norwegian_parcel_tracker", "set_note", { tracking_number: tn, text: note.trim() });
            else this._callService("norwegian_parcel_tracker", "clear_note", { tracking_number: tn });
          }
        });
      }
      if (btnClearNote) {
        btnClearNote.addEventListener("click", () => this._callService("norwegian_parcel_tracker", "clear_note", { tracking_number: tn }));
      }
      if (btnIcon) {
        btnIcon.addEventListener("click", () => {
          const icon = window.prompt("Icon (mdi:icon-name, emoji, or https:// URL):", selected.attributes.npt_icon || "");
          if (icon !== null) {
            if (icon.trim()) this._callService("norwegian_parcel_tracker", "set_icon", { tracking_number: tn, icon: icon.trim() });
            else this._callService("norwegian_parcel_tracker", "clear_icon", { tracking_number: tn });
          }
        });
      }
      if (btnRefresh) {
        btnRefresh.addEventListener("click", () => this._callService("norwegian_parcel_tracker", "refresh", { tracking_number: tn }));
      }
    }
  }

  connectedCallback() { this._render(); }
}

customElements.define("norwegian-parcel-tracker-panel", NorwegianParcelTrackerPanel);
