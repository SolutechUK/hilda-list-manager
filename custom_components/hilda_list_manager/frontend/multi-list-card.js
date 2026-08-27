/*
 * Multi List Card
 * v0.2.0-dev
 * Dependency-free Home Assistant custom card for multiple todo.* lists.
 */

const MLC_VERSION = "0.4.0-beta.7";
const DEFAULT_ACCENT = "aqua";

class MultiListCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._selected = 0;
    this._items = [];
    this._loading = false;
    this._loadedEntity = null;
    this._loadToken = 0;
    this._lastStateSignature = "";
    this._toastTimer = null;
    this._selectorOpen = false;
  }

  static getStubConfig() {
    return {
      title: "H.I.L.D.A Multi List",
      persist_selection: true,
      confirm_clear: true,
      lists: [
        {
          name: "My List",
          entity: "todo.my_list",
          icon: "mdi:format-list-checks"
        }
      ]
    };
  }

  static getConfigElement() {
    return document.createElement("multi-list-card-editor");
  }

  static getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  getCardSize() {
    return 7;
  }

  setConfig(config) {
    if (!config || !Array.isArray(config.lists)) {
      throw new Error("H.I.L.D.A Multi List requires a 'lists:' array.");
    }

    // An empty array is valid. This is important when the user deletes the
    // final managed list: the card should fall back to an empty state instead
    // of becoming a Lovelace configuration error.
    for (const list of config.lists) {
      if (!list?.name || !list?.entity) {
        throw new Error("Each list requires both 'name' and 'entity'.");
      }
      if (!String(list.entity).startsWith("todo.")) {
        throw new Error(`'${list.entity}' is not a todo.* entity.`);
      }
    }

    this._config = {
      title: "",
      accent: DEFAULT_ACCENT,
      show_send: true,
      confirm_clear: true,
      persist_selection: true,
      show_completed: true,
      ...config
    };

    this._restoreSelection();
    if (this._selected >= this._config.lists.length) this._selected = 0;
    this._render();
    this._queueLoad();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;

    const signature = this._config.lists
      .map((l) => `${l.entity}:${hass.states[l.entity]?.state ?? "missing"}`)
      .join("|");

    if (signature !== this._lastStateSignature) {
      this._lastStateSignature = signature;
      this._render();
      this._queueLoad();
    }
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    this._render();
    this._queueLoad();
  }

  _storageKey() {
    const id = this._config?.storage_key || this._config?.title || "default";
    return `multi-list-card:selected:${id}`;
  }

  _restoreSelection() {
    if (this._config?.persist_selection === false) return;
    try {
      const raw = localStorage.getItem(this._storageKey());
      const idx = Number.parseInt(raw, 10);
      if (Number.isFinite(idx) && idx >= 0) this._selected = idx;
    } catch (_) {}
  }

  _persistSelection() {
    if (this._config?.persist_selection === false) return;
    try {
      localStorage.setItem(this._storageKey(), String(this._selected));
    } catch (_) {}
  }

  _visibleLists() {
    const lists = this._config?.lists || [];
    if (!this._hass) return lists;

    // H.I.L.D.A-created entities use todo.hilda_* object IDs.
    // If one of those entities no longer exists, it has been deleted from
    // the integration and should disappear from the runtime card as well.
    // External todo.* entries are NOT auto-pruned because they may simply
    // be temporarily unavailable.
    return lists.filter((list) => {
      const entity = String(list?.entity || "");
      if (!entity.startsWith("todo.hilda_")) return true;
      return Boolean(this._hass.states[entity]);
    });
  }

  _current() {
    const lists = this._visibleLists();
    if (!lists.length) return null;

    if (this._selected >= lists.length) {
      this._selected = 0;
      this._persistSelection();
    }

    return lists[this._selected];
  }

  _accent(list) {
    return list?.accent || this._config?.accent || DEFAULT_ACCENT;
  }

  _sendIcon(list) {
    return list?.send_icon || this._config?.send_icon || "mdi:send";
  }

  _count(list) {
    const raw = this._hass?.states?.[list.entity]?.state;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  _entityAvailable(entity) {
    const state = this._hass?.states?.[entity];
    return Boolean(state) && !["unavailable", "unknown"].includes(state.state);
  }

  _queueLoad() {
    if (!this.isConnected || !this._config || !this._hass) return;
    queueMicrotask(() => this._loadItems());
  }

  async _callServiceWithResponse(domain, service, serviceData = {}, target = {}) {
    const result = await this._hass.callWS({
      type: "call_service",
      domain,
      service,
      service_data: serviceData,
      target,
      return_response: true
    });
    return result?.response ?? result;
  }

  async _loadItems() {
    const list = this._current();
    if (!list || !this._hass) return;

    if (!this._entityAvailable(list.entity)) {
      this._items = [];
      this._loadedEntity = list.entity;
      this._loading = false;
      this._render();
      return;
    }

    const token = ++this._loadToken;
    this._loading = true;
    this._render();

    try {
      const statuses = this._config.show_completed === false
        ? ["needs_action"]
        : ["needs_action", "completed"];

      const response = await this._callServiceWithResponse(
        "todo",
        "get_items",
        { status: statuses },
        { entity_id: list.entity }
      );

      if (token !== this._loadToken) return;

      const block = response?.[list.entity];
      this._items = Array.isArray(block?.items) ? block.items : [];
      this._loadedEntity = list.entity;
    } catch (err) {
      console.error("[multi-list-card] Failed to load todo items", err);
      if (token === this._loadToken) {
        this._items = [];
        this._loadedEntity = list.entity;
        this._toast(`Could not read ${list.name}`);
      }
    } finally {
      if (token === this._loadToken) {
        this._loading = false;
        this._render();
      }
    }
  }

  async _refreshSoon() {
    await this._loadItems();
    setTimeout(() => this._loadItems(), 450);
  }

  async _addItem(summary) {
    const list = this._current();
    const text = String(summary ?? "").trim();
    if (!list || !text || !this._entityAvailable(list.entity)) return;

    await this._hass.callService(
      "todo",
      "add_item",
      { item: text },
      { entity_id: list.entity }
    );
    await this._refreshSoon();
  }

  async _toggleItem(item, checked) {
    const list = this._current();
    if (!list || !this._entityAvailable(list.entity)) return;

    await this._hass.callService(
      "todo",
      "update_item",
      {
        item: item.uid || item.summary,
        status: checked ? "completed" : "needs_action"
      },
      { entity_id: list.entity }
    );
    await this._refreshSoon();
  }

  async _markAllDone() {
    const list = this._current();
    if (!list || !this._entityAvailable(list.entity)) return;

    const pending = this._items.filter((item) => item.status === "needs_action");
    for (const item of pending) {
      await this._hass.callService(
        "todo",
        "update_item",
        { item: item.uid || item.summary, status: "completed" },
        { entity_id: list.entity }
      );
    }
    await this._refreshSoon();
  }

  _requestClearConfirmation() {
    const list = this._current();
    if (!list) return false;
    if (this._config.confirm_clear === false) return true;

    const event = new CustomEvent("hass-more-info", { bubbles: true, composed: true });
    // We still use a browser confirmation fallback because HA does not expose a stable public
    // confirmation-dialog API for third-party cards.
    return window.confirm(`Clear all items from "${list.name}"?`);
  }

  async _clearAll() {
    const list = this._current();
    if (!list || !this._entityAvailable(list.entity)) return;
    if (!this._requestClearConfirmation()) return;

    for (const item of this._items) {
      await this._hass.callService(
        "todo",
        "remove_item",
        { item: item.uid || item.summary },
        { entity_id: list.entity }
      );
    }
    await this._refreshSoon();
  }

  async _send() {
    const list = this._current();
    if (!list) return;

    try {
      // v0.3.9 simple sender: H.I.L.D.A formats the CURRENT list itself.
      if (list.send_destination_type && list.send_destination) {
        await this._hass.callService(
          "hilda_list_manager",
          "send_list",
          {
            list_entity: list.entity,
            destination_type: list.send_destination_type,
            destination: list.send_destination,
            heading: list.send_heading || list.name
          }
        );
        this._toast(`Sent ${list.name}`);
        return;
      }

      // Backwards compatibility with older send_action configs.
      const sendAction = list.send_action;
      if (!sendAction) return;

      if (Array.isArray(sendAction)) {
        if (!sendAction.length) return;
        await this._hass.callService(
          "hilda_list_manager",
          "execute_actions",
          { actions: sendAction }
        );
      } else if (typeof sendAction === "string") {
        const [domain] = sendAction.split(".");
        if (domain === "automation") {
          await this._hass.callService("automation", "trigger", {}, { entity_id: sendAction });
        } else if (domain === "script") {
          await this._hass.callService("script", "turn_on", {}, { entity_id: sendAction });
        } else if (domain === "button") {
          await this._hass.callService("button", "press", {}, { entity_id: sendAction });
        } else {
          throw new Error("Unsupported legacy send_action.");
        }
      } else {
        await this._hass.callService(
          "hilda_list_manager",
          "execute_actions",
          { actions: [sendAction] }
        );
      }

      this._toast(`Sent ${list.name}`);
    } catch (err) {
      console.error("[multi-list-card] Send failed", err);
      this._toast(`Send failed for ${list.name}`);
    }
  }

  _select(index) {
    this._selectorOpen = false;
    const lists = this._visibleLists();
    if (!lists.length) return;
    this._selected = (index + lists.length) % lists.length;
    this._persistSelection();
    this._items = [];
    this._loadedEntity = null;
    this._render();
    this._queueLoad();
  }

  _next() { this._select(this._selected + 1); }
  _previous() { this._select(this._selected - 1); }

  _toggleSelector() {
    this._selectorOpen = !this._selectorOpen;
    this._render();
  }

  _closeSelector() {
    if (!this._selectorOpen) return;
    this._selectorOpen = false;
    this._render();
  }

  _selectFromMenu(index) {
    this._selectorOpen = false;
    this._select(index);
  }

  _visual(list, small = false) {
    const size = small ? 30 : 78;

    if (list.image) {
      return `<img class="logo-img ${small ? "small" : ""}" src="${this._escape(list.image)}" alt="">`;
    }

    const icon = list.icon || "mdi:format-list-checks";
    return `<ha-icon class="logo-icon ${small ? "small" : ""}" icon="${this._escape(icon)}"
      style="--mdc-icon-size:${size}px"></ha-icon>`;
  }

  _renderItems(list) {
    if (!this._entityAvailable(list.entity)) {
      return `<div class="empty error">Entity unavailable: ${this._escape(list.entity)}</div>`;
    }

    if (this._loading && this._loadedEntity !== list.entity) {
      return `<div class="empty">Loading…</div>`;
    }

    if (!this._items.length) {
      return `<div class="empty">Nothing on ${this._escape(list.name)}.</div>`;
    }

    return this._items.map((item, i) => {
      const checked = item.status === "completed";
      return `
        <label class="todo-row ${checked ? "completed" : ""}">
          <input type="checkbox" data-action="toggle" data-index="${i}" ${checked ? "checked" : ""}>
          <span class="checkmark"><ha-icon icon="${checked ? "mdi:check" : ""}"></ha-icon></span>
          <span class="summary">${this._escape(item.summary)}</span>
        </label>
      `;
    }).join("");
  }

  _render() {
    if (!this.shadowRoot) return;
    if (!this._config) {
      this.shadowRoot.innerHTML = "";
      return;
    }

    const visibleLists = this._visibleLists();
    const list = this._current();

    if (!list) {
      const accent = this._config?.accent || DEFAULT_ACCENT;
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            --mlc-accent: ${this._escape(accent)};
            display: block;
          }

          ha-card {
            padding: 22px 18px;
            border-radius: 18px;
            overflow: hidden;
          }

          .empty-card {
            min-height: 170px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 10px;
            text-align: center;
          }

          .empty-icon {
            color: var(--mlc-accent);
            filter: drop-shadow(0 0 6px var(--mlc-accent));
          }

          .empty-icon ha-icon {
            --mdc-icon-size: 48px;
          }

          .empty-title {
            color: var(--mlc-accent);
            font-size: 18px;
            font-weight: 700;
          }

          .empty-text {
            max-width: 360px;
            opacity: .7;
            line-height: 1.4;
          }
        </style>

        <ha-card>
          <div class="empty-card">
            <div class="empty-icon">
              <ha-icon icon="mdi:format-list-plus"></ha-icon>
            </div>
            <div class="empty-title">No lists yet</div>
            <div class="empty-text">
              Edit this card to add an existing To-do list or create a new
              H.I.L.D.A list.
            </div>
          </div>
        </ha-card>
      `;
      return;
    }

    const count = this._count(list);
    const hasSend = Boolean(
      (list?.send_destination_type && list?.send_destination) || list?.send_action
    ) && this._config.show_send !== false;
    const available = this._entityAvailable(list.entity);
    const accent = this._accent(list);

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --mlc-accent: ${this._escape(accent)};
          display: block;
        }

        ha-card {
          padding: 12px;
          border-radius: 18px;
          overflow: hidden;
        }

        .title {
          font-size: 18px;
          font-weight: 700;
          margin: 2px 4px 10px;
        }

        .hero {
          min-height: 130px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          border-radius: 16px;
          background: transparent;
          user-select: none;
        }

        .hero-visual {
          position: relative;
          display: flex;
          justify-content: center;
          align-items: center;
          min-width: 120px;
          min-height: 90px;
          color: var(--mlc-accent);
          filter: drop-shadow(0 0 9px color-mix(in srgb, var(--mlc-accent) 60%, transparent));
        }

        .logo-img {
          width: clamp(100px, 40vw, 155px);
          max-height: 112px;
          object-fit: contain;
          display: block;
        }

        .logo-img.small {
          width: 30px;
          height: 30px;
          object-fit: contain;
        }

        .logo-icon { color: var(--mlc-accent); }

        .badge {
          position: absolute;
          top: -9px;
          right: -12px;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--mlc-accent);
          color: #000;
          font-size: 15px;
          font-weight: 900;
          box-shadow: 0 0 12px var(--mlc-accent);
        }

        .pills {
          display: grid;
          grid-template-columns: 50px minmax(0, 1fr) 50px;
          gap: 12px;
          align-items: center;
          margin-bottom: 12px;
        }

        button {
          font: inherit;
          border: 0;
          cursor: pointer;
        }

        .small-logo,
        .send {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--mlc-accent);
          background: rgba(0,0,0,0.35);
        }

        .small-logo { background: transparent; }

        .selector-wrap {
          position: relative;
          min-width: 0;
        }

        .selector {
          width: 100%;
          min-width: 0;
          min-height: 50px;
          border-radius: 22px;
          padding: 6px 18px;
          background: rgba(0,0,0,0.35);
          color: var(--mlc-accent);
          font-size: 17px;
          font-weight: 700;
          text-shadow: 0 0 4px #000;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
        }

        .selector-label {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .selector-chevron {
          --mdc-icon-size: 20px;
          transition: transform .16s ease;
        }

        .selector-chevron.open {
          transform: rotate(180deg);
        }

        .selector-menu {
          position: absolute;
          z-index: 30;
          top: calc(100% + 6px);
          left: 0;
          right: 0;
          border-radius: 16px;
          overflow: hidden;
          background: var(--ha-card-background, var(--card-background-color, #111));
          border: 1px solid rgba(255,255,255,.10);
          box-shadow: 0 10px 28px rgba(0,0,0,.45);
          backdrop-filter: blur(10px);
        }

        .selector-option {
          width: 100%;
          min-height: 44px;
          display: grid;
          grid-template-columns: 28px minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          padding: 7px 12px;
          background: transparent;
          color: var(--primary-text-color, #fff);
          text-align: left;
          border-radius: 0;
        }

        .selector-option + .selector-option {
          border-top: 1px solid rgba(255,255,255,.06);
        }

        .selector-option:hover,
        .selector-option.active {
          background: rgba(255,255,255,.07);
        }

        .selector-option.active {
          color: var(--mlc-accent);
          font-weight: 700;
        }

        .selector-option-visual {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .selector-option-visual img {
          width: 26px;
          height: 26px;
          object-fit: contain;
        }

        .selector-option-count {
          opacity: .7;
          font-size: 13px;
        }

        .send { filter: drop-shadow(0 0 4px var(--mlc-accent)); }
        .send.disabled { opacity: 0.28; filter: none; cursor: default; }

        .list {
          border-radius: 18px;
          background: rgba(0,0,0,0.25);
          overflow: hidden;
          margin-bottom: 10px;
        }

        .add-row {
          display: grid;
          grid-template-columns: 1fr 44px;
          gap: 8px;
          padding: 10px;
        }

        .add-row input {
          width: 100%;
          box-sizing: border-box;
          min-height: 44px;
          border: 1px solid rgba(255,255,255,.10);
          outline: 0;
          border-radius: 14px;
          padding: 0 13px;
          background: rgba(0,0,0,.72);
          color: var(--primary-text-color, #fff);
          caret-color: var(--mlc-accent);
          font: inherit;
        }

        .add-button {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: rgba(0,0,0,.45);
          color: var(--mlc-accent);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .add-button.disabled { opacity: .35; cursor: default; }

        .items { padding: 0 10px 10px; }

        .todo-row {
          display: grid;
          grid-template-columns: 30px 1fr;
          align-items: center;
          gap: 8px;
          min-height: 44px;
          padding: 4px 6px;
          border-top: 1px solid rgba(255,255,255,.06);
          cursor: pointer;
        }

        .todo-row input { display: none; }

        .checkmark {
          width: 23px;
          height: 23px;
          border-radius: 6px;
          border: 2px solid color-mix(in srgb, var(--mlc-accent) 75%, transparent);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #000;
        }

        .completed .checkmark {
          background: var(--mlc-accent);
          box-shadow: 0 0 7px color-mix(in srgb, var(--mlc-accent) 70%, transparent);
        }

        .checkmark ha-icon { --mdc-icon-size: 17px; }

        .summary {
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .completed .summary {
          text-decoration: line-through;
          opacity: .48;
        }

        .empty {
          padding: 18px;
          opacity: .6;
          text-align: center;
        }

        .empty.error {
          opacity: 1;
          color: var(--error-color, #db4437);
        }

        .actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .action-button {
          min-height: 48px;
          border-radius: 22px;
          background: rgba(0,0,0,0.35);
          color: var(--mlc-accent);
          font-weight: 700;
          display: flex;
          gap: 8px;
          align-items: center;
          justify-content: center;
        }

        .action-button.disabled {
          opacity: .35;
          cursor: default;
        }

        .action-button ha-icon { --mdc-icon-size: 22px; }

        .toast {
          position: fixed;
          z-index: 99999;
          left: 50%;
          bottom: 26px;
          transform: translateX(-50%);
          background: rgba(20,20,20,.96);
          color: #fff;
          padding: 10px 14px;
          border-radius: 12px;
          box-shadow: 0 6px 24px rgba(0,0,0,.4);
          opacity: 0;
          pointer-events: none;
          transition: opacity .2s ease;
        }

        .toast.show { opacity: 1; }
      </style>

      <ha-card>
        ${this._config.title ? `<div class="title">${this._escape(this._config.title)}</div>` : ""}

        <div class="hero">
          <div class="hero-visual">
            ${this._visual(list)}
            ${count > 0 ? `<div class="badge">${count}</div>` : ""}
          </div>
        </div>

        <div class="pills">
          <button class="small-logo" data-action="prev" title="Previous list">
            ${this._visual(list, true)}
          </button>

          <div class="selector-wrap">
            <button class="selector" data-action="selector" title="Choose list">
              <span class="selector-label">
                ${this._escape(list.name)}${count > 0 ? ` · ${count}` : ""}
              </span>
              <ha-icon
                class="selector-chevron ${this._selectorOpen ? "open" : ""}"
                icon="mdi:chevron-down"></ha-icon>
            </button>

            ${this._selectorOpen ? `
              <div class="selector-menu">
                ${visibleLists.map((item, index) => {
                  const itemCount = this._count(item);
                  const active = index === this._selected;
                  const visual = item.image
                    ? `<img src="${this._escape(item.image)}" alt="">`
                    : `<ha-icon icon="${this._escape(item.icon || "mdi:format-list-checks")}"
                         style="--mdc-icon-size:22px"></ha-icon>`;
                  return `
                    <button class="selector-option ${active ? "active" : ""}"
                            data-action="select-list"
                            data-index="${index}">
                      <span class="selector-option-visual">${visual}</span>
                      <span>${this._escape(item.name)}</span>
                      <span class="selector-option-count">${itemCount}</span>
                    </button>
                  `;
                }).join("")}
              </div>
            ` : ""}
          </div>

          <button class="send ${hasSend ? "" : "disabled"}"
                  data-action="${hasSend ? "send" : "noop"}"
                  title="${hasSend ? "Run send action" : "No send action configured"}">
            <ha-icon icon="${this._escape(this._sendIcon(list))}"></ha-icon>
          </button>
        </div>

        <div class="list">
          <div class="add-row">
            <input id="new-item" type="text" placeholder="Add item…" autocomplete="off"
                   ${available ? "" : "disabled"}>
            <button class="add-button ${available ? "" : "disabled"}"
                    data-action="${available ? "add" : "noop"}" title="Add item">
              <ha-icon icon="mdi:plus"></ha-icon>
            </button>
          </div>
          <div class="items">
            ${this._renderItems(list)}
          </div>
        </div>

        <div class="actions">
          <button class="action-button ${available ? "" : "disabled"}"
                  data-action="${available ? "mark-done" : "noop"}">
            <ha-icon icon="mdi:check-all"></ha-icon>
            <span>Mark Done</span>
          </button>
          <button class="action-button ${available ? "" : "disabled"}"
                  data-action="${available ? "clear" : "noop"}">
            <ha-icon icon="mdi:cart-off"></ha-icon>
            <span>Clear</span>
          </button>
        </div>
      </ha-card>
      <div class="toast" id="toast"></div>
    `;

    this._wireEvents();
  }

  _wireEvents() {
    const root = this.shadowRoot;
    if (!root) return;

    root.querySelectorAll("[data-action]").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        const action = ev.currentTarget.dataset.action;

        if (action === "prev") return this._previous();
        if (action === "next") return this._next();
        if (action === "selector") return this._toggleSelector();
        if (action === "select-list") {
          const index = Number.parseInt(ev.currentTarget.dataset.index, 10);
          return this._selectFromMenu(index);
        }
        if (action === "send") return this._send();
        if (action === "noop") return;
        if (action === "mark-done") return this._markAllDone();
        if (action === "clear") return this._clearAll();

        if (action === "add") {
          const input = root.querySelector("#new-item");
          const value = input?.value;
          if (input) input.value = "";
          return this._addItem(value);
        }

        if (action === "toggle") {
          const index = Number.parseInt(ev.currentTarget.dataset.index, 10);
          const item = this._items[index];
          if (item) return this._toggleItem(item, ev.currentTarget.checked);
        }
      });
    });

    const input = root.querySelector("#new-item");
    input?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        const value = input.value;
        input.value = "";
        this._addItem(value);
      }
    });
  }

  _toast(message) {
    const toast = this.shadowRoot?.querySelector("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
  }
}

/* -----------------------------
 * Visual editor
 * ----------------------------- */

class MultiListCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { lists: [] };
    this._hass = null;
  }

  set hass(hass) {
    const previousEntities = this._todoEntitySignature();
    this._hass = hass;
    const nextEntities = this._todoEntitySignature();

    const pruned = this._pruneDeletedHildaLists();

    // Home Assistant assigns `hass` to editors frequently. Rebuilding the
    // editor DOM every time destroys focus and closes open selects/inputs.
    // Only redraw when the available todo entity list actually changes or
    // a deleted H.I.L.D.A list was cleaned out of the card configuration.
    if (pruned) {
      this._fireConfigChanged();
    }

    if (!this._editorRendered || previousEntities !== nextEntities || pruned) {
      this._render();
    }
  }

  _pruneDeletedHildaLists() {
    if (!this._hass || !Array.isArray(this._config?.lists)) return false;

    const before = this._config.lists.length;
    this._config.lists = this._config.lists.filter((list) => {
      const entity = String(list?.entity || "");
      if (!entity.startsWith("todo.hilda_")) return true;
      return Boolean(this._hass.states[entity]);
    });

    return this._config.lists.length !== before;
  }

  setConfig(config) {
    const next = JSON.parse(JSON.stringify(config || { lists: [] }));
    if (!Array.isArray(next.lists)) next.lists = [];

    // HA may echo config back while the user is editing. Avoid replacing the
    // entire editor DOM when the effective config has not changed.
    const changed = JSON.stringify(next) !== JSON.stringify(this._config);
    this._config = next;

    if (!this._editorRendered || changed) {
      this._render();
    }
  }

  _todoEntitySignature() {
    if (!this._hass) return "";
    return Object.keys(this._hass.states)
      .filter((e) => e.startsWith("todo."))
      .sort()
      .join("|");
  }

  _fireConfigChanged() {
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: this._config },
      bubbles: true,
      composed: true
    }));
  }

  _todoEntities() {
    if (!this._hass) return [];
    return Object.keys(this._hass.states)
      .filter((e) => e.startsWith("todo."))
      .sort();
  }

  _render() {
    if (!this.shadowRoot) return;

    const lists = this._config.lists || [];
    const options = this._todoEntities();

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        .wrap { display:grid; gap:12px; padding:4px 0; }
        .row { display:grid; gap:6px; }
        label { font-size:12px; opacity:.72; }
        input, select {
          box-sizing:border-box;
          width:100%;
          min-height:40px;
          border-radius:8px;
          border:1px solid var(--divider-color);
          background:var(--card-background-color);
          color:var(--primary-text-color);
          padding:8px 10px;
          font:inherit;
        }
        .toggles {
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:10px;
        }
        .toggle {
          display:flex;
          gap:8px;
          align-items:center;
          min-height:40px;
        }
        .toggle input { width:auto; min-height:0; }
        .list-card {
          border:1px solid var(--divider-color);
          border-radius:12px;
          padding:10px;
          display:grid;
          gap:8px;
        }
        .list-head {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
        }
        .list-title { font-weight:700; }
        .list-actions { display:flex; gap:6px; }
        button {
          border:0;
          border-radius:8px;
          min-height:34px;
          padding:0 10px;
          background:var(--secondary-background-color);
          color:var(--primary-text-color);
          cursor:pointer;
        }
        .danger { color:var(--error-color); }
        .add { width:100%; min-height:42px; font-weight:700; }
        .add-buttons {
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:8px;
        }
        .add.managed {
          color:var(--primary-color);
        }
        .add:disabled {
          opacity:.45;
          cursor:not-allowed;
        }
        .hint { font-size:12px; opacity:.65; }
        .managed-hint { margin-top:-4px; }
        .ha-action-selector,
        .ha-icon-selector,
        .send-destination-host {
          min-width: 0;
        }
        .send-destination-host select {
          box-sizing:border-box;
          width:100%;
          min-height:40px;
          border-radius:8px;
          border:1px solid var(--divider-color);
          background:var(--card-background-color);
          color:var(--primary-text-color);
          padding:8px 10px;
          font:inherit;
        }
        .zone-section {
          border: 1px solid var(--divider-color);
          border-radius: 12px;
          padding: 10px;
          display: grid;
          gap: 8px;
        }
        .zone-title {
          font-weight: 700;
        }
        .ha-entity-selector {
          min-width: 0;
        }
        .no-lists-editor {
          border: 1px dashed var(--divider-color);
          border-radius: 10px;
          padding: 14px;
          text-align: center;
          opacity: .72;
          line-height: 1.4;
        }
      </style>

      <div class="wrap">
        <div class="row">
          <label>Card title</label>
          <input data-top="title" value="${this._esc(this._config.title || "")}" placeholder="Shopping & Trips">
        </div>

        <div class="row">
          <label>Default accent colour</label>
          <input data-top="accent" value="${this._esc(this._config.accent || DEFAULT_ACCENT)}" placeholder="aqua">
        </div>

        <div class="row">
          <label>Default send icon</label>
          <div class="ha-icon-selector"
               data-icon-selector
               data-scope="top"
               data-field="send_icon"></div>
        </div>

        <div class="toggles">
          <label class="toggle">
            <input type="checkbox" data-bool="persist_selection" ${this._config.persist_selection !== false ? "checked" : ""}>
            Remember selected list
          </label>
          <label class="toggle">
            <input type="checkbox" data-bool="confirm_clear" ${this._config.confirm_clear !== false ? "checked" : ""}>
            Confirm Clear
          </label>
          <label class="toggle">
            <input type="checkbox" data-bool="show_completed" ${this._config.show_completed !== false ? "checked" : ""}>
            Show completed items
          </label>
          <label class="toggle">
            <input type="checkbox" data-bool="show_send" ${this._config.show_send !== false ? "checked" : ""}>
            Show send pill
          </label>
        </div>

        ${lists.map((list, i) => `
          <div class="list-card" data-list="${i}">
            <div class="list-head">
              <div class="list-title">List ${i + 1}</div>
              <div class="list-actions">
                <button data-move-up="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
                <button data-move-down="${i}" ${i === lists.length - 1 ? "disabled" : ""}>↓</button>
                <button class="danger" data-remove="${i}">Remove</button>
              </div>
            </div>

            <div class="row">
              <label>Name</label>
              <input data-list-field="name" data-index="${i}" value="${this._esc(list.name || "")}">
            </div>

            <div class="row">
              <label>To-do entity</label>
              <select data-list-field="entity" data-index="${i}">
                <option value="">Select todo entity…</option>
                ${list.entity && !options.includes(list.entity)
                  ? `<option value="${this._esc(list.entity)}" selected>${this._esc(list.entity)} (waiting for entity)</option>`
                  : ""}
                ${options.map((e) => `<option value="${this._esc(e)}" ${e === list.entity ? "selected" : ""}>${this._esc(e)}</option>`).join("")}
              </select>
            </div>

            <div class="row">
              <label>Image (optional)</label>
              <input data-list-field="image" data-index="${i}" value="${this._esc(list.image || "")}" placeholder="/local/custom_icons/store.png">
            </div>

            <div class="row">
              <label>Icon (used when no image)</label>
              <div class="ha-icon-selector"
                   data-icon-selector
                   data-scope="list"
                   data-field="icon"
                   data-index="${i}"></div>
            </div>

            <div class="row">
              <label>Accent colour (optional)</label>
              <input data-list-field="accent" data-index="${i}" value="${this._esc(list.accent || "")}" placeholder="aqua">
            </div>

            <div class="row">
              <label>Send icon (optional)</label>
              <div class="ha-icon-selector"
                   data-icon-selector
                   data-scope="list"
                   data-field="send_icon"
                   data-index="${i}"></div>
            </div>

            <div class="row">
              <label>Send list (optional)</label>
              <select data-list-field="send_destination_type" data-index="${i}">
                <option value="">No send button</option>
                <option value="notify" ${list.send_destination_type === "notify" ? "selected" : ""}>Notify entity</option>
                <option value="rest_command" ${list.send_destination_type === "rest_command" ? "selected" : ""}>REST command</option>
              </select>
            </div>

            <div class="row">
              <label>Send destination</label>
              <div class="send-destination-host"
                   data-send-destination
                   data-index="${i}"></div>
              <div class="hint">
                H.I.L.D.A will format the currently selected list automatically.
              </div>
            </div>

            <div class="row">
              <label>Message heading (optional)</label>
              <input data-list-field="send_heading" data-index="${i}"
                     value="${this._esc(list.send_heading || "")}"
                     placeholder="${this._esc(list.name || "H.I.L.D.A List")}">
            </div>

            <div class="zone-section">
              <div class="zone-title">Send on zone (optional)</div>

              <div class="row">
                <label>Zone trigger</label>
                <select data-list-field="zone_event" data-index="${i}">
                  <option value="">Off</option>
                  <option value="enter" ${list.zone_event === "enter" ? "selected" : ""}>Enter zone</option>
                  <option value="leave" ${list.zone_event === "leave" ? "selected" : ""}>Leave zone</option>
                </select>
              </div>

              <div class="row">
                <label>Person</label>
                <div class="ha-entity-selector"
                     data-entity-selector
                     data-domain="person"
                     data-field="zone_person"
                     data-index="${i}"></div>
              </div>

              <div class="row">
                <label>Zone</label>
                <div class="ha-entity-selector"
                     data-entity-selector
                     data-domain="zone"
                     data-field="zone_entity"
                     data-index="${i}"></div>
              </div>

              <div class="row">
                <label>Cooldown minutes</label>
                <input type="number"
                       min="0"
                       max="1440"
                       data-list-field="zone_cooldown"
                       data-index="${i}"
                       value="${this._esc(list.zone_cooldown ?? 10)}">
                <div class="hint">
                  Prevents repeat sends if location tracking bounces around the zone boundary.
                </div>
              </div>

              <div class="hint">
                Zone sending uses the same Send List destination and heading configured above.
              </div>
            </div>
          </div>
        `).join("")}

        ${lists.length === 0 ? `
          <div class="no-lists-editor">
            No lists are configured. Add an existing Home Assistant To-do list
            or create a new H.I.L.D.A-managed list below.
          </div>
        ` : ""}

        <div class="add-buttons">
          <button class="add" data-add-list>Add existing To-do list</button>
          <button class="add managed" data-create-managed
            ${this._hass?.services?.hilda_list_manager?.create_list ? "" : "disabled"}>
            Create new Hilda list
          </button>
        </div>
        <div class="hint managed-hint">
          ${this._hass?.services?.hilda_list_manager?.create_list
            ? "Creates a new local todo.* entity, then adds it to this card."
            : "Install and configure the Hilda List Manager integration to create new todo.* entities here."}
        </div>
      </div>
    `;

    this._wireEditor();
    this._hydrateSendDestinations();
    this._hydrateIconSelectors();
    this._hydrateEntitySelectors();
    this._editorRendered = true;
  }

  _esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  _normalizeSendActionForSelector(value) {
    if (!value) return [];

    if (Array.isArray(value)) return value;

    // Convert old simple entity actions to ordinary HA action YAML so they
    // appear correctly inside the native action editor.
    if (typeof value === "string") {
      const [domain] = value.split(".");
      if (domain === "automation") {
        return [{
          action: "automation.trigger",
          target: { entity_id: value }
        }];
      }
      if (domain === "script") {
        return [{
          action: "script.turn_on",
          target: { entity_id: value }
        }];
      }
      if (domain === "button") {
        return [{
          action: "button.press",
          target: { entity_id: value }
        }];
      }
      return [];
    }

    // Convert H.I.L.D.A's old custom {domain,service,target,data} format.
    if (typeof value === "object" && value.domain && value.service) {
      return [{
        action: `${value.domain}.${value.service}`,
        ...(value.target ? { target: value.target } : {}),
        ...(value.data ? { data: value.data } : {})
      }];
    }

    return [value];
  }

  _hydrateActionSelectors() {
    if (!this._hass) return;

    this.shadowRoot.querySelectorAll("[data-action-selector]").forEach((host) => {
      const index = Number.parseInt(host.dataset.index, 10);
      const list = this._config?.lists?.[index];
      if (!list) return;

      const selector = document.createElement("ha-selector");
      selector.hass = this._hass;
      selector.selector = { action: {} };
      selector.value = this._normalizeSendActionForSelector(list.send_action);

      selector.addEventListener("value-changed", (ev) => {
        const value = ev.detail?.value;

        if (Array.isArray(value) && value.length > 0) {
          this._config.lists[index].send_action = value;
        } else if (value && !Array.isArray(value)) {
          this._config.lists[index].send_action = value;
        } else {
          delete this._config.lists[index].send_action;
        }

        this._fireConfigChanged();
      });

      host.replaceChildren(selector);
    });
  }

  _hydrateSendDestinations() {
    if (!this._hass) return;

    this.shadowRoot.querySelectorAll("[data-send-destination]").forEach((host) => {
      const index = Number.parseInt(host.dataset.index, 10);
      const list = this._config?.lists?.[index];
      if (!list) return;

      const type = list.send_destination_type || "";

      if (!type) {
        host.innerHTML = `<div class="hint">Choose a send type above.</div>`;
        return;
      }

      const select = document.createElement("select");
      select.innerHTML = `<option value="">Select destination…</option>`;

      let choices = [];

      if (type === "notify") {
        choices = Object.keys(this._hass.states)
          .filter((entityId) => entityId.startsWith("notify."))
          .sort();
      } else if (type === "rest_command") {
        const services = this._hass.services?.rest_command || {};
        choices = Object.keys(services)
          .sort()
          .map((service) => `rest_command.${service}`);
      }

      for (const value of choices) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        if (value === list.send_destination) option.selected = true;
        select.appendChild(option);
      }

      select.addEventListener("change", async () => {
        const value = select.value;
        if (value) this._config.lists[index].send_destination = value;
        else delete this._config.lists[index].send_destination;
        this._fireConfigChanged();
        await this._syncZoneRule(index);
      });

      host.replaceChildren(select);
    });
  }

  _hydrateEntitySelectors() {
    if (!this._hass) return;

    this.shadowRoot.querySelectorAll("[data-entity-selector]").forEach((host) => {
      const index = Number.parseInt(host.dataset.index, 10);
      const domain = host.dataset.domain;
      const field = host.dataset.field;
      const list = this._config?.lists?.[index];
      if (!list) return;

      const selector = document.createElement("ha-selector");
      selector.hass = this._hass;
      selector.selector = {
        entity: {
          domain
        }
      };
      selector.value = list[field] || "";

      selector.addEventListener("value-changed", async (ev) => {
        const value = ev.detail?.value || "";

        if (value) this._config.lists[index][field] = value;
        else delete this._config.lists[index][field];

        this._fireConfigChanged();
        await this._syncZoneRule(index);
      });

      host.replaceChildren(selector);
    });
  }

  async _syncZoneRule(index) {
    if (!this._hass || !this._config?.lists?.[index]) return;

    const list = this._config.lists[index];

    const complete = Boolean(
      list.zone_event &&
      list.zone_person &&
      list.zone_entity &&
      list.send_destination_type &&
      list.send_destination
    );

    try {
      if (!complete) {
        await this._hass.callService(
          "hilda_list_manager",
          "clear_zone_rule",
          { list_entity: list.entity }
        );
        return;
      }

      await this._hass.callService(
        "hilda_list_manager",
        "set_zone_rule",
        {
          list_entity: list.entity,
          person_entity: list.zone_person,
          zone_entity: list.zone_entity,
          event: list.zone_event,
          destination_type: list.send_destination_type,
          destination: list.send_destination,
          heading: list.send_heading || list.name,
          cooldown_minutes: Number.parseInt(list.zone_cooldown ?? 10, 10) || 0
        }
      );
    } catch (err) {
      console.error("[multi-list-card] Could not sync zone rule", err);
    }
  }

  _hydrateIconSelectors() {
    if (!this._hass) return;

    this.shadowRoot.querySelectorAll("[data-icon-selector]").forEach((host) => {
      const scope = host.dataset.scope;
      const field = host.dataset.field;

      let currentValue = "";
      let index = null;

      if (scope === "top") {
        currentValue = this._config?.[field] || "";
      } else {
        index = Number.parseInt(host.dataset.index, 10);
        currentValue = this._config?.lists?.[index]?.[field] || "";
      }

      const selector = document.createElement("ha-selector");
      selector.hass = this._hass;
      selector.selector = { icon: {} };
      selector.value = currentValue;

      selector.addEventListener("value-changed", (ev) => {
        const value = ev.detail?.value || "";

        if (scope === "top") {
          if (value) this._config[field] = value;
          else delete this._config[field];
        } else if (this._config?.lists?.[index]) {
          if (value) this._config.lists[index][field] = value;
          else delete this._config.lists[index][field];
        }

        this._fireConfigChanged();
      });

      host.replaceChildren(selector);
    });
  }

  _wireEditor() {
    const root = this.shadowRoot;

    root.querySelectorAll("[data-top]").forEach((el) => {
      el.addEventListener("change", () => {
        const key = el.dataset.top;
        const value = el.value.trim();
        if (value) this._config[key] = value;
        else delete this._config[key];
        this._fireConfigChanged();
      });
    });

    root.querySelectorAll("[data-bool]").forEach((el) => {
      el.addEventListener("change", () => {
        this._config[el.dataset.bool] = el.checked;
        this._fireConfigChanged();
      });
    });

    root.querySelectorAll("[data-list-field]").forEach((el) => {
      el.addEventListener("change", async () => {
        const i = Number.parseInt(el.dataset.index, 10);
        const key = el.dataset.listField;
        const value = el.value.trim();
        if (!this._config.lists[i]) return;
        if (value) this._config.lists[i][key] = value;
        else delete this._config.lists[i][key];

        if (key === "send_destination_type") {
          delete this._config.lists[i].send_destination;
          this._fireConfigChanged();
          await this._syncZoneRule(i);
          this._render();
          return;
        }

        this._fireConfigChanged();

        if (
          key === "send_heading" ||
          key === "zone_event" ||
          key === "zone_cooldown"
        ) {
          await this._syncZoneRule(i);
        }
      });
    });

    root.querySelector("[data-add-list]")?.addEventListener("click", () => {
      this._config.lists.push({
        name: `List ${this._config.lists.length + 1}`,
        entity: ""
      });
      this._fireConfigChanged();
      this._render();
    });

    root.querySelector("[data-create-managed]")?.addEventListener("click", async () => {
      if (!this._hass?.services?.hilda_list_manager?.create_list) return;

      const name = window.prompt("Name for the new Hilda To-do list:");
      if (!name || !name.trim()) return;

      const wantedName = name.trim();

      try {
        const result = await this._hass.callWS({
          type: "call_service",
          domain: "hilda_list_manager",
          service: "create_list",
          service_data: { name: wantedName },
          target: {},
          return_response: true
        });

        const response = result?.response ?? result;
        if (response?.success === false) {
          window.alert(
            response.error === "duplicate_name"
              ? `A Hilda list named "${wantedName}" already exists.`
              : `Could not create list: ${response.error || "unknown error"}`
          );
          return;
        }

        const expected = response?.expected_entity_id || "";
        const expectedObjectId = expected.replace(/^todo\./, "");

        // Give the integration reload/entity registry a moment to settle.
        await new Promise((resolve) => setTimeout(resolve, 900));

        let entity = expected;
        const states = this._hass?.states || {};

        if (!entity || !states[entity]) {
          const match = Object.entries(states).find(([entityId, stateObj]) =>
            entityId.startsWith("todo.") &&
            String(stateObj?.attributes?.friendly_name || "").toLowerCase() === wantedName.toLowerCase()
          );
          entity = match?.[0] || expected;
        }

        this._config.lists.push({
          name: wantedName,
          entity,
          icon: "mdi:format-list-checks"
        });

        this._fireConfigChanged();
        this._render();
      } catch (err) {
        console.error("[multi-list-card] Could not create managed list", err);
        window.alert("Could not create the Hilda list. Check Home Assistant logs.");
      }
    });

    root.querySelectorAll("[data-remove]").forEach((el) => {
      el.addEventListener("click", () => {
        const i = Number.parseInt(el.dataset.remove, 10);
        this._config.lists.splice(i, 1);
        this._fireConfigChanged();
        this._render();
      });
    });

    root.querySelectorAll("[data-move-up]").forEach((el) => {
      el.addEventListener("click", () => {
        const i = Number.parseInt(el.dataset.moveUp, 10);
        if (i <= 0) return;
        [this._config.lists[i - 1], this._config.lists[i]] = [this._config.lists[i], this._config.lists[i - 1]];
        this._fireConfigChanged();
        this._render();
      });
    });

    root.querySelectorAll("[data-move-down]").forEach((el) => {
      el.addEventListener("click", () => {
        const i = Number.parseInt(el.dataset.moveDown, 10);
        if (i < 0 || i >= this._config.lists.length - 1) return;
        [this._config.lists[i + 1], this._config.lists[i]] = [this._config.lists[i], this._config.lists[i + 1]];
        this._fireConfigChanged();
        this._render();
      });
    });
  }
}

if (!customElements.get("multi-list-card")) {
  customElements.define("multi-list-card", MultiListCard);
}

if (!customElements.get("multi-list-card-editor")) {
  customElements.define("multi-list-card-editor", MultiListCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "multi-list-card")) {
  window.customCards.push({
    type: "multi-list-card",
    name: "H.I.L.D.A Multi List",
    preview: true,
    description: "Switch between multiple Home Assistant To-do lists in one card."
  });
}

console.info(
  `%c MULTI-LIST-CARD %c v${MLC_VERSION} `,
  "color:#000;background:aqua;font-weight:700;padding:2px 5px;border-radius:3px 0 0 3px",
  "color:aqua;background:#222;padding:2px 5px;border-radius:0 3px 3px 0"
);
