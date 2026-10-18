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

  _carrierLinks(carrier, trackingNumber) {
    const c = String(carrier || "").toLowerCase();
    const tn = encodeURIComponent(trackingNumber || "");
    if (c === "helthjem") return {
      tracking: `https://www.helthjem.no/sporing/${tn}`,
      trackingLabel: "Track on Helthjem",
    };
    return {
      tracking: `https://sporing.posten.no/tracking/${tn}`,
      trackingLabel: "Track on Posten",
    };
  }

  _disruptionSearchUrl(routeCoords) {
    // Build a news search for real disruptions at the parcel's recent locations:
    // airport/port strikes, weather, geopolitical events, etc.
    const recent = (routeCoords || []).slice(0, 6);
    const places = [...new Set(
      recent
        .map((c) => (c.location || "").split(",")[0].trim())
        .filter((l) => l.length > 2)
    )].slice(0, 3);

    const locationPart = places.join(" ");
    const terms = locationPart
      ? `${locationPart} disruption delay strike airport port closed`
      : "shipping disruption delay strike";

    return `https://duckduckgo.com/?q=${encodeURIComponent(terms)}&ia=news`;
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
        <h3>✏️ Rename parcel</h3>
        <span class="npt-label">Display name</span>
        <input class="npt-input" id="npt-rename-inp" type="text" value="${this._escHtml(current)}" maxlength="100">
        <div class="npt-actions">
          <button class="npt-btn npt-btn-secondary" id="npt-cancel">Cancel</button>
          <button class="npt-btn npt-btn-primary" id="npt-save">Save</button>
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

  _showNoteDialog(tn, current) {
    const overlay = this._showModal(`
      <div class="npt-dialog">
        <h3>📝 ${current ? "Edit note" : "Add note"}</h3>
        <span class="npt-label">Note — shown in cards and panel instead of status</span>
        <textarea class="npt-input" id="npt-note-inp" maxlength="2000">${this._escHtml(current)}</textarea>
        <div class="npt-actions">
          ${current ? `<button class="npt-btn npt-btn-danger" id="npt-clear-note">Clear note</button>` : ""}
          <button class="npt-btn npt-btn-secondary" id="npt-cancel">Cancel</button>
          <button class="npt-btn npt-btn-primary" id="npt-save">Save</button>
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
        <h3>🎨 Set icon</h3>
        <div class="icon-tabs">
          <button class="icon-tab${activeTab === "mdi" ? " active" : ""}" data-tab="mdi">MDI icon</button>
          <button class="icon-tab${activeTab === "url" ? " active" : ""}" data-tab="url">Image URL</button>
          <button class="icon-tab${activeTab === "emoji" ? " active" : ""}" data-tab="emoji">Emoji</button>
        </div>

        <div class="icon-panel${activeTab === "mdi" ? " visible" : ""}" id="tab-mdi">
          <span class="npt-label">MDI icon name</span>
          <div class="npt-row">
            <input class="npt-input" id="mdi-inp" type="text" placeholder="mdi:package-variant-closed" value="${mdiVal}">
            <a class="npt-btn-browse" href="https://pictogrammers.com/library/mdi/" target="_blank" rel="noopener">Browse ↗</a>
          </div>
          <span class="npt-label" style="opacity:0.45">Type the icon name (e.g. mdi:gift, mdi:truck-fast) and click Browse to search.</span>
        </div>

        <div class="icon-panel${activeTab === "url" ? " visible" : ""}" id="tab-url">
          <span class="npt-label">Image URL (https://)</span>
          <input class="npt-input" id="url-inp" type="url" placeholder="https://example.com/icon.png" value="${urlVal}">
        </div>

        <div class="icon-panel${activeTab === "emoji" ? " visible" : ""}" id="tab-emoji">
          <span class="npt-label">Emoji</span>
          <input class="npt-input" id="emoji-inp" type="text" placeholder="📦" maxlength="10" value="${emojiVal}" style="font-size:1.4em">
          <div class="emoji-grid">${emojiGrid}</div>
        </div>

        <div class="npt-actions">
          ${current ? `<button class="npt-btn npt-btn-danger" id="npt-clear-icon">Clear icon</button>` : ""}
          <button class="npt-btn npt-btn-secondary" id="npt-cancel">Cancel</button>
          <button class="npt-btn npt-btn-primary" id="npt-save-icon">Save</button>
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
    const note = a.note || "";
    const phone = this._carrierPhone(a.carrier);
    const trackingNum = a.tracking_number || state.entity_id;
    const carrierLinks = this._carrierLinks(a.carrier, trackingNum);
    const disruptionUrl = this._disruptionSearchUrl(a.route_coords);

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
          <button class="btn" id="btn-note">📝 ${note ? "Edit note" : "Add note"}</button>
          <button class="btn" id="btn-icon">🎨 Set icon</button>
          <button class="btn btn-refresh" id="btn-refresh">↺ Refresh</button>
        </div>

        <div class="carrier-links">
          <a href="${this._escHtml(carrierLinks.tracking)}" target="_blank" rel="noopener noreferrer" class="carrier-link">🔗 ${this._escHtml(carrierLinks.trackingLabel)}</a>
          <a href="${this._escHtml(disruptionUrl)}" target="_blank" rel="noopener noreferrer" class="carrier-link">🌐 Search disruptions near route</a>
          ${phone ? `<a href="tel:${this._escHtml(phone.num)}" class="carrier-link">📞 ${this._escHtml(phone.label)}</a>` : ""}
        </div>

        <h3>Event history</h3>
        <div class="events-list">${eventsHtml || "<p>No events</p>"}</div>
      </div>`;
  }

  _renderAllParcelsMap(parcels) {
    const COLORS = ["#42a5f5","#ef5350","#66bb6a","#ffa726","#ab47bc","#26c6da","#ec407a","#8d6e63"];

    const parcelRoutes = parcels
      .filter((s) => s.attributes.route_coords && s.attributes.route_coords.length > 0)
      .map((s, i) => ({
        entityId: s.entity_id,
        name: (s.attributes.display_name || s.attributes.sender_name || s.attributes.tracking_number || "").slice(0, 24),
        icon: s.attributes.npt_icon || "",
        delivered: /delivered|levert|hentet/i.test(s.state || ""),
        coords: s.attributes.route_coords,
        color: COLORS[i % COLORS.length],
        colorIdx: i % COLORS.length,
      }));

    const noDataParcels = parcels.filter(
      (s) => !s.attributes.route_coords || s.attributes.route_coords.length === 0
    );

    if (parcelRoutes.length === 0) {
      return `<div class="map-empty" style="padding-top:40px">No location data yet — parcel positions will appear here as events are tracked.</div>`;
    }

    const allCoords = parcelRoutes.flatMap((p) => p.coords);
    const lats = allCoords.map((c) => c.lat);
    const lngs = allCoords.map((c) => c.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const dLat = (maxLat - minLat) || 0.5;
    const dLng = (maxLng - minLng) || 0.5;
    const pad = 0.15;
    const vMinLat = minLat - dLat * pad, vMaxLat = maxLat + dLat * pad;
    const vMinLng = minLng - dLng * pad, vMaxLng = maxLng + dLng * pad;

    const W = 700, H = 420;
    const toX = (lng) => ((lng - vMinLng) / (vMaxLng - vMinLng)) * W;
    const toY = (lat) => H - ((lat - vMinLat) / (vMaxLat - vMinLat)) * H;

    const defs = COLORS.map((c, i) => `
      <marker id="arr-${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
        <path d="M0,1 L0,9 L10,5 z" fill="${c}" opacity="0.85"/>
      </marker>`).join("");

    const routeSvg = parcelRoutes.map((p) => {
      const { color, colorIdx } = p;
      // coords[0] = most recent; reverse to draw oldest → newest
      const ordered = [...p.coords].reverse();

      const segments = ordered.slice(0, -1).map((c, i) => {
        const x1 = toX(c.lng).toFixed(1), y1 = toY(c.lat).toFixed(1);
        const x2 = toX(ordered[i + 1].lng).toFixed(1), y2 = toY(ordered[i + 1].lat).toFixed(1);
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2.5" stroke-opacity="0.65" marker-end="url(#arr-${colorIdx})"/>`;
      }).join("");

      const histDots = ordered.slice(0, -1).map((c) => {
        const x = toX(c.lng).toFixed(1), y = toY(c.lat).toFixed(1);
        return `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}" opacity="0.45"><title>${this._escHtml((c.date_iso || "").slice(0, 16).replace("T", " "))} — ${this._escHtml(c.description || "")}</title></circle>`;
      }).join("");

      const cur = p.coords[0];
      const cx = toX(cur.lng), cy = toY(cur.lat);
      const isEmoji = p.icon && !p.icon.startsWith("mdi:") && !p.icon.startsWith("http");
      const label = isEmoji ? p.icon : "📦";
      const cls = p.delivered ? "overview-dot-delivered" : "overview-dot";

      const currentDot = `
        <g class="overview-parcel" data-id="${this._escHtml(p.entityId)}" style="cursor:pointer" tabindex="0">
          <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="14" class="${cls}" stroke="${color}" stroke-width="2"/>
          <text x="${cx.toFixed(1)}" y="${(cy + 5).toFixed(1)}" text-anchor="middle" font-size="13" style="pointer-events:none">${this._escHtml(label)}</text>
          ${p.name ? `<text x="${(cx + 18).toFixed(1)}" y="${(cy - 13).toFixed(1)}" class="route-label" font-size="10" fill="${color}" font-weight="600">${this._escHtml(p.name)}</text>` : ""}
          <title>${this._escHtml(p.name)}</title>
        </g>`;

      return segments + histDots + currentDot;
    }).join("");

    const noDataHtml = noDataParcels.length > 0
      ? `<div style="font-size:0.8em;opacity:0.5;margin-top:8px">No location data yet: ${noDataParcels.map((s) => this._escHtml(s.attributes.display_name || s.attributes.sender_name || s.attributes.tracking_number || s.entity_id)).join(", ")}</div>`
      : "";

    return `
      <div style="font-size:0.78em;opacity:0.55;padding:0 0 6px">All parcel routes — click a dot to view details &amp; route</div>
      <svg class="route-svg overview-map" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>${defs}</defs>
        ${routeSvg}
      </svg>
      ${noDataHtml}`;
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
    const W = 480, H = 320;
    const toX = (lng) => ((lng - (minLng - dlng * padPct)) / ((maxLng + dlng * padPct) - (minLng - dlng * padPct))) * W;
    const toY = (lat) => H - ((lat - (minLat - dlat * padPct)) / ((maxLat + dlat * padPct) - (minLat - dlat * padPct))) * H;

    const pointsStr = coords.map((c) => `${toX(c.lng).toFixed(1)},${toY(c.lat).toFixed(1)}`).join(" ");
    const dots = coords.map((c, i) => {
      const x = toX(c.lng), y = toY(c.lat);
      const label = (c.location || "").split(",")[0].slice(0, 20);
      return `
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === 0 ? 7 : 4}"
          class="${i === 0 ? "route-dot-current" : "route-dot"}">
          <title>${this._escHtml(c.date_iso ? c.date_iso.slice(0, 16).replace("T", " ") : "")} — ${this._escHtml(c.description || "")}</title>
        </circle>
        ${label ? `<text x="${(x + 8).toFixed(1)}" y="${(y + 4).toFixed(1)}" class="route-label">${this._escHtml(label)}</text>` : ""}`;
    }).join("");

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

    const rows = parcels.map((s) => {
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
    }).join("");

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
        .route-svg.overview-map { max-height: calc(100vh - 120px); min-height: 300px; }
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
        .note-box {
          background: rgba(255, 193, 7, 0.12);
          border: 1px solid rgba(255, 193, 7, 0.45);
          border-radius: 6px; padding: 10px 14px; margin: 8px 0 12px;
          color: var(--primary-text-color, #eee);
        }
        .note-label { font-weight: 600; font-size: 0.85em; display: block; margin-bottom: 4px; }
        .note-text { white-space: pre-wrap; word-break: break-word; font-size: 0.95em; line-height: 1.5; }
        .detail-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 12px; }
        .btn { background: var(--primary-color, #1976d2); color: #fff; border: none; border-radius: 4px; padding: 7px 13px; cursor: pointer; font-size: 0.85em; font-family: inherit; }
        .btn:hover { filter: brightness(1.1); }
        .btn-sm { background: transparent; border: 1px solid rgba(255,193,7,0.5); color: var(--primary-text-color, #eee); border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 0.75em; margin-top: 8px; font-family: inherit; }
        .carrier-links { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 14px; }
        .carrier-link { color: var(--primary-color, #42a5f5); text-decoration: none; font-size: 0.88em; padding: 4px 10px; border: 1px solid rgba(66,165,245,0.3); border-radius: 4px; }
        .carrier-link:hover { background: rgba(66,165,245,0.1); text-decoration: none; }
        .events-list { font-size: 0.92em; }
        .event-row { display: grid; grid-template-columns: 140px 1fr 120px; gap: 6px; padding: 6px 0; border-bottom: 1px solid var(--divider-color, #222); line-height: 1.4; }
        .event-date { opacity: 0.6; }
        .event-loc { opacity: 0.55; text-align: right; }
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
      const tn = selected.attributes.tracking_number || selected.entity_id;

      this._shadow.getElementById("btn-rename")?.addEventListener("click", () =>
        this._showRenameDialog(tn, selected.attributes.display_name || selected.attributes.sender_name || ""));

      this._shadow.getElementById("btn-note")?.addEventListener("click", () =>
        this._showNoteDialog(tn, selected.attributes.note || ""));

      this._shadow.getElementById("btn-clear-note")?.addEventListener("click", () =>
        this._callService("norwegian_parcel_tracker", "clear_note", { tracking_number: tn }));

      this._shadow.getElementById("btn-icon")?.addEventListener("click", () =>
        this._showIconDialog(tn, selected.attributes.npt_icon || ""));

      this._shadow.getElementById("btn-refresh")?.addEventListener("click", () =>
        this._callService("norwegian_parcel_tracker", "refresh", { tracking_number: tn }));
    }
  }

  connectedCallback() { this._render(); }
}

customElements.define("norwegian-parcel-tracker-panel", NorwegianParcelTrackerPanel);
