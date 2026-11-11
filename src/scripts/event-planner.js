import { EVENT_SHOP_STORAGE_KEY } from "./constants.js";
import { EventShop } from "./domain.js";
import { EVENT_SHOP_DATA } from "./data/event_shop.js";

/* Application layer for the Event Shop planner: owns the per-item Require counts and persists the
   plan under EVENT_SHOP_STORAGE_KEY. Amendment B removed the planner card — the per-currency modal
   is the sole configuration surface — so this module is state and storage only, with no DOM at all.
   Tier-card Required displays refresh through App.refreshNeeds(), which the event-lazy onCommit
   wiring calls after every applyRequires(). State reads the generated EVENT_SHOP_DATA snapshot;
   there is no runtime network. */
export const EventPlanner = {
  state: { eventId: null, requires: {} },
  _initialized: false,
  _data: null,

  /* Idempotent entry (house BondApp pattern): load the snapshot and fold any saved plan for the
     current event into state. Renders nothing. */
  init() {
    if (this._initialized) return;
    this._initialized = true;
    this._data = EVENT_SHOP_DATA || { event: null, currencies: [], items: [] };
    const eventId = this._data.event ? this._data.event.id : null;
    this.state = {
      ...this.state,
      eventId,
      requires: EventShop.sanitizeRequires(this._loadSaved(), this._data.items, eventId),
    };
  },

  /* Whole-plan commit from the modal's Done button (and the sole writer of requires): merge known
     item ids only, clamp every value through the domain, persist. Unknown ids are dead data —
     dropped, never stored. Repainting the tier displays is the caller's job (App.refreshNeeds). */
  applyRequires(partial) {
    const merged = { ...this.state.requires };
    for (const [itemId, value] of Object.entries(partial || {})) {
      const item = this._items().find((it) => String(it.id) === itemId);
      if (item) merged[itemId] = EventShop.clampRequire(item, value);
    }
    this.state = { ...this.state, requires: merged };
    this._persist();
  },

  /* Currency rows for the modal's itemsOf callback — the planner owns the item list. */
  itemsFor(currencyId) {
    return this._items().filter((it) => String(it.cost.itemId) === String(currencyId));
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
