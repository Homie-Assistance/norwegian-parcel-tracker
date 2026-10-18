// Norwegian Parcel Tracker — Compact card
// A minimal single-row-per-parcel card variant.
// Element type: custom:norwegian-parcel-tracker-compact

class NorwegianParcelCompactCard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._yamlConfig = null;
    this._expanded = null;
  }

  setConfig(config) { this._yamlConfig = config || {}; }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    if (!prev || this._statesChanged(prev, hass)) this._render();
  }

  getCardSize() { return 2; }

  _cfg() {
    return {
      title: "",
      show_delivered: true,
      compact_height: 0,
      ...(this._yamlConfig || {}),
    };
  }

  _statesChanged(prev, next) {
    return Object.keys(next.states).some(id =>
      id.startsWith("sensor.") &&
      next.states[id]?.attributes?.npt_master_entity === true &&
      prev.states[id] !== next.states[id]
    );
  }

  _isDelivered(a) {
    if (a.is_delivered === true) return true;
    const t = `${a.status || ""} ${a.latest_event || ""}`.toLowerCase();
    return t.includes("pakken er levert") || t.includes("delivered") || t.includes("hentet pakken");
  }

  _esc(v) {
    return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  _escA(v) { return this._esc(v).replace(/"/g, "&quot;"); }

  _icon(icon) {
    if (!icon) return `<ha-icon icon="mdi:package-variant-closed" style="--mdc-icon-size:18px"></ha-icon>`;
    if (icon.startsWith("mdi:")) return `<ha-icon icon="${this._escA(icon)}" style="--mdc-icon-size:18px"></ha-icon>`;
    if (icon.startsWith("http://") || icon.startsWith("https://"))
      return `<img src="${this._escA(icon)}" style="width:18px;height:18px;object-fit:contain;border-radius:3px;vertical-align:middle" alt="">`;
    return `<span style="font-size:1rem;line-height:1">${this._esc(icon)}</span>`;
  }

  _parcels() {
    const cfg = this._cfg();
    let states = Object.values(this._hass.states)
      .filter(s => s.entity_id.startsWith("sensor.") && s.attributes?.npt_master_entity === true);
    if (!cfg.show_delivered) states = states.filter(s => !this._isDelivered(s.attributes));
    return states.sort((a, b) => {
      const ta = new Date(a.attributes?.latest_event_time || 0).getTime();
      const tb = new Date(b.attributes?.latest_event_time || 0).getTime();
      return tb - ta;
    });
  }

  _renderExpanded(state) {
    const a = state.attributes || {};
    const tn = a.tracking_number || "";
    const events = (a.recent_events || []).slice(0, 5);
    const note = a.note ? `<div style="font-style:italic;opacity:0.85;font-size:0.85em;margin:4px 0">📝 ${this._esc(a.note)}</div>` : "";
    const evHtml = events.map(e =>
      `<div style="font-size:0.78em;opacity:0.75;padding:2px 0;border-bottom:1px solid rgba(128,128,128,0.15)">${this._esc(e.date_iso ? e.date_iso.slice(0, 16).replace("T", " ") : "")} — ${this._esc(e.description || "")}</div>`
    ).join("");
    return `
      <div style="padding:6px 12px 8px;border-top:1px solid rgba(128,128,128,0.2)">
        ${note}
        ${a.estimated_delivery_iso ? `<div style="font-size:0.85em;opacity:0.8">ETA: ${this._esc(a.estimated_delivery_iso)}</div>` : ""}
        ${a.pickup_name ? `<div style="font-size:0.85em;opacity:0.8">Pickup: ${this._esc(a.pickup_name)}</div>` : ""}
        ${evHtml}
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
          <button class="npt-compact-btn" data-action="refresh" data-tn="${this._escA(tn)}">↺ Refresh</button>
          <button class="npt-compact-btn" data-action="delete" data-tn="${this._escA(tn)}">🗑 Remove</button>
        </div>
      </div>`;
  }

  _render() {
    if (!this._hass) return;
    const cfg = this._cfg();
    const parcels = this._parcels();

    const rows = parcels.map(state => {
      const a = state.attributes || {};
      const tn = a.tracking_number || "";
      const name = a.display_name || a.sender_name || tn;
      const status = a.note ? `📝 ${a.note.slice(0, 60)}` : (a.status || state.state || "");
      const time = a.latest_event_time
        ? new Date(a.latest_event_time).toLocaleDateString("nb-NO", { day: "numeric", month: "short" })
        : "";
      const isDelivered = this._isDelivered(a);
      const isExpanded = this._expanded === tn;
      const rowStyle = isDelivered ? "opacity:0.6;text-decoration:line-through" : "";

      return `
        <div class="npt-compact-row${isExpanded ? " expanded" : ""}" data-tn="${this._escA(tn)}" style="${rowStyle}">
          <div class="npt-compact-main">
            <span class="npt-compact-icon">${this._icon(a.npt_icon)}</span>
            <span class="npt-compact-name">${this._esc(name)}</span>
            <span class="npt-compact-status">${this._esc(status)}</span>
            <span class="npt-compact-time">${this._esc(time)}</span>
          </div>
          ${isExpanded ? this._renderExpanded(state) : ""}
        </div>`;
    });

    const heightStyle = cfg.compact_height > 0
      ? `max-height:${cfg.compact_height * 40 + 32}px;overflow-y:auto;`
      : "";

    this.innerHTML = `
      ${cfg.title ? `<ha-card><div style="padding:12px 16px 4px;font-weight:600;font-size:1rem">${this._esc(cfg.title)}</div>` : "<ha-card>"}
        <div style="${heightStyle}">
          ${rows.length ? rows.join("") : `<div style="padding:16px;opacity:0.6">No parcels to show</div>`}
        </div>
      </ha-card>
      <style>
        .npt-compact-row { cursor:pointer; border-bottom:1px solid var(--divider-color,rgba(128,128,128,0.2)); }
        .npt-compact-row:hover { background:var(--secondary-background-color); }
        .npt-compact-row.expanded { background:var(--secondary-background-color); }
        .npt-compact-main { display:flex; align-items:center; gap:8px; padding:7px 14px; }
        .npt-compact-icon { flex-shrink:0; display:inline-flex; align-items:center; }
        .npt-compact-name { font-weight:500; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.92rem; }
        .npt-compact-status { font-size:0.8rem; opacity:0.75; flex:2; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .npt-compact-time { font-size:0.75rem; opacity:0.55; flex-shrink:0; white-space:nowrap; }
        .npt-compact-btn { background:transparent; border:1px solid var(--divider-color,rgba(128,128,128,0.4)); border-radius:4px; padding:3px 10px; cursor:pointer; font-size:0.8rem; color:var(--primary-text-color); }
        .npt-compact-btn:hover { background:var(--primary-color); color:var(--text-primary-color); }
      </style>`;

    this.querySelectorAll(".npt-compact-row").forEach(row => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".npt-compact-btn")) return;
        const tn = row.dataset.tn;
        this._expanded = this._expanded === tn ? null : tn;
        this._render();
      });
    });
    this.querySelectorAll(".npt-compact-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const tn = btn.dataset.tn;
        if (btn.dataset.action === "refresh") {
          try { await this._hass.callService("norwegian_parcel_tracker", "refresh", { tracking_number: tn }); } catch (_) {}
        } else if (btn.dataset.action === "delete") {
          if (!window.confirm("Remove this parcel?")) return;
          try { await this._hass.callService("norwegian_parcel_tracker", "remove_parcel", { tracking_number: tn }); } catch (_) {}
          this._expanded = null;
          this._render();
        }
      });
    });
  }
}

if (!customElements.get("norwegian-parcel-tracker-compact")) {
  customElements.define("norwegian-parcel-tracker-compact", NorwegianParcelCompactCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "norwegian-parcel-tracker-compact",
  name: "Norwegian parcel tracker (compact)",
  description: "Minimal single-row-per-parcel view. Click a row to expand.",
});
