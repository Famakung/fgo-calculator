import { EVENT_SHOP_STORAGE_KEY } from "./constants.js";
import { EventShop } from "./domain.js";
import { EVENT_SHOP_DATA } from "./data/event_shop.js";
import { EventPlannerView } from "./event-planner-view.js";
import { EventShopModal } from "./event-shop-modal.js";

/* Application layer for the Event Shop planner: owns the per-item Require counts and the currency
   filter, persists the plan under EVENT_SHOP_STORAGE_KEY, and delegates every DOM operation to
   EventPlannerView. State is read from the generated EVENT_SHOP_DATA snapshot (no runtime network).
   Amendment A: the card rows are read-only displays — the currency modal is the sole mutation
   surface — so card handlers shrink to onFilter + onEdit and every commit arrives via
   applyRequires(). */
export const EventPlanner = {
  state: { eventId: null, requires: {}, filter: "all" },
  _initialized: false,
  _data: null,
  _card: null,

  init() {
    if (this._initialized) return;
    this._initialized = true;
    this._card = document.getElementById("eventPlannerCard");
    if (!this._card) return;

    this._data = EVENT_SHOP_DATA || { event: null, currencies: [], items: [] };
    const eventId = this._data.event ? this._data.event.id : null;
    this.state = {
      ...this.state,
      eventId,
      requires: EventShop.sanitizeRequires(this._loadSaved(), this._data.items, eventId),
    };
    EventPlannerView.render(this._card, this._data, this.state, this._handlers());
  },

  /* Whole-plan commit from the modal's Done button (and the sole writer of requires): merge known
     item ids only, clamp every value through the domain, persist, and repaint the read-only
     displays. Unknown ids are dead data — dropped, never stored. */
  applyRequires(partial) {
    const merged = { ...this.state.requires };
    for (const [itemId, value] of Object.entries(partial || {})) {
      const item = this._items().find((it) => String(it.id) === itemId);
      if (item) merged[itemId] = EventShop.clampRequire(item, value);
    }
    this.state = { ...this.state, requires: merged };
    this._applyView();
    this._persist();
  },

  /* Currency rows for the modal's itemsOf callback — the planner owns the item list. */
  itemsFor(currencyId) {
    return this._items().filter((it) => String(it.cost.itemId) === String(currencyId));
  },

  _handlers() {
    return {
      onFilter: (key) => this._onFilter(key),
      onEdit: (itemId) => this._onEdit(itemId),
    };
  },

  /* Display rows route every edit request into the currency modal; an item's currency is the one
     its cost is paid in. */
  _onEdit(itemId) {
    const item = this._items().find((it) => String(it.id) === String(itemId));
    if (item) EventShopModal.open(String(item.cost.itemId));
  },

  _onFilter(key) {
    this.state = { ...this.state, filter: String(key) };
    EventPlannerView.renderList(this._card, this._data, this.state, this._handlers());
  },

  _applyView() {
    EventPlannerView.syncInputs(this._card, this.state);
    EventPlannerView.updateTotals(this._card, this._data, this.state);
  },

  _items() {
    return this._data ? this._data.items : [];
  },

  _persist() {
    try {
      const payload = JSON.stringify({ eventId: this.state.eventId, requires: this.state.requires });
      localStorage.setItem(EVENT_SHOP_STORAGE_KEY, payload);
    } catch (e) {
      console.warn("Event shop planner save failed:", e);
    }
  },

  _loadSaved() {
    try {
      const raw = localStorage.getItem(EVENT_SHOP_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn("Event shop planner load failed:", e);
      return null;
    }
  },
};
