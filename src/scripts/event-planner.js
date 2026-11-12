import { EVENT_SHOP_STORAGE_KEY } from "./constants.js";
import { EventShop, Schema, Validator } from "./domain.js";
import { EVENT_SHOP_DATA } from "./data/event_shop.js";

/* Application layer for the Event Shop planner: owns the selected event and that event's plan
   (requires + held + bonus) and persists everything under EVENT_SHOP_STORAGE_KEY. Amendment G made
   the snapshot a list, so each event keeps its own plan and editing one never touches another.
   Amendment B removed the planner card: the per-currency modal is the sole configuration surface,
   so this module is state and storage only, with no DOM at all. The tier boxes and the farm cards
   delegate their Held/Bonus figures through setHeld/setBonus, keyed by CURRENCY id (Amendment H),
   so an event with two golds gives each one its own numbers; the card displays refresh through
   App.refreshNeeds(). There is no runtime network — state reads the generated snapshot list.
    Amendment J5 adds the retired stash: a pruned event's saved plan stays in storage untouched,
    because sanitizePlans drops it from state and a save that wrote only state would erase it. */
export const EventPlanner = {
  state: { selectedEventId: null, plans: {} },
  _initialized: false,
  _events: [],
  _retired: {},

  /* Idempotent entry (house BondApp pattern): load the snapshot list and fold the saved plans into
     state, migrating the pre-G { eventId, requires } blob. Renders nothing. */
  init() {
    if (this._initialized) return;
    this._initialized = true;
    this.load(this._loadSaved(), EVENT_SHOP_DATA);
  },

  /* The seam init() uses. Split out so the offline tests can fold a fixture snapshot list and a
     hostile saved blob through the real state path without the generated data file. The retired
     stash is rebuilt from the raw blob every load, so an event that re-enters the data leaves it
     here and sanitizePlans reads its plan again. */
  load(saved, data) {
    this._events = snapshotEvents(data);
    this._retired = retiredPlans(saved, this._events);
    this.state = EventShop.sanitizePlans(saved, this._events);
  },

  /* Every shop snapshot the select can offer, newest event first (the sync sorted them). */
  events() {
    return this._events;
  },

  /* The snapshot the UI is working on: the selected event, or null when the list is empty. */
  activeEvent() {
    return this._events.find((snap) => snap.event.id === this.state.selectedEventId) || null;
  },

  /* The active event's plan. A never-touched event has an empty one — never null. */
  activePlan() {
    return planOf(this.state, this.state.selectedEventId);
  },

  /* Currency rows for the modal's itemsOf callback — the planner owns the item list of the selection. */
  itemsFor(currencyId) {
    const event = this.activeEvent();
    if (!event) return [];
    return event.items.filter((it) => String(it.cost.itemId) === String(currencyId));
  },

  /* Currencies of the selected event, for the modal's currency lookup. */
  currenciesForActive() {
    const event = this.activeEvent();
    return event ? event.currencies : [];
  },

  /* Switch the working event (Event Select). Unknown ids are refused: the id came from a list this
     module built, so a miss is stale data, not a user choice. Returns whether the selection moved. */
  select(eventId) {
    if (eventId === this.state.selectedEventId) return false;
    if (!this._events.some((snap) => snap.event.id === eventId)) return false;
    this.state = { ...this.state, selectedEventId: eventId };
    this._persist();
    return true;
  },

  /* Whole-plan commit from the modal's Done button (and the sole writer of requires): only item ids
     the selected event actually sells survive, clamped through the domain. Repainting the tier
     displays is the caller's job (App.refreshNeeds). */
  applyRequires(partial) {
    const event = this.activeEvent();
    if (!event) return;
    const plan = this.activePlan();
    this._mutatePlan({ requires: EventShop.mergeRequires(plan.requires, partial, event.items) });
  },

  /* Currency box readers for App delegation — the active event's figures, not the legacy tier
     state. Keys are the currency ids the plan carries (Amendment H). */
  heldOf(currencyId) {
    return this.activePlan().held[String(currencyId)] || 0;
  },

  bonusOf(currencyId) {
    return this.activePlan().bonus[String(currencyId)] || 0;
  },

  /* Currency box writers, clamped by the same schema the tier boxes declare (Schema.tier bounds).
     An id the plan does not carry is refused — a plan holds exactly the event's currencies, never
     whatever a caller sent. */
  setHeld(currencyId, value) {
    this._mutatePlan({ held: clampCurrencyBox(this.activePlan().held, currencyId, value, Schema.tier.Have) });
  },

  setBonus(currencyId, value) {
    this._mutatePlan({ bonus: clampCurrencyBox(this.activePlan().bonus, currencyId, value, Schema.tier.Bonus) });
  },

  _mutatePlan(patch) {
    if (this.state.selectedEventId === null) return;
    const plans = { ...this.state.plans };
    plans[String(this.state.selectedEventId)] = { ...this.activePlan(), ...patch };
    this.state = { ...this.state, plans };
    this._persist();
  },

  _persist() {
    try {
      /* The pruned events' plans ride along verbatim so no save can erode them; a live plan wins a
         key collision, which is what an event that re-entered the data must write back. */
      const plans = { ...this._retired, ...this.state.plans };
      const payload = JSON.stringify({ selectedEventId: this.state.selectedEventId, plans });
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

/* The snapshot list of a generated data module; the pre-G single-event shape has none, so the site
   falls back to the legacy calculator rather than reading a stale one-event blob as an event list. */
function snapshotEvents(data) {
  if (!data || !Array.isArray(data.events)) return [];
  return data.events.filter((snap) => snap && snap.event);
}

/* A copy, so a caller reading the plan cannot write into the stored one by accident. */
function planOf(state, eventId) {
  const plan = state.plans[String(eventId)];
  if (!plan) return { requires: {}, held: {}, bonus: {} };
  return { requires: { ...plan.requires }, held: { ...plan.held }, bonus: { ...plan.bonus } };
}

/* Amendment J5: the saved plans of events the current data no longer lists, kept out of state but
   written back verbatim, so the first mutation after a prune cannot erase a player's plan for that
   event. Nothing reads or sanitizes these bytes, which is why they are copied by own key with
   defineProperty: a blob parsed from JSON can hold an own "__proto__" key, and plain assignment
   would turn that into a prototype swap instead of a stored entry. */
function retiredPlans(saved, events) {
  const plans = (saved && typeof saved === "object" && saved.plans) || {};
  const live = new Set(events.map((snap) => String(snap.event.id)));
  const retired = {};
  for (const key of Object.keys(plans).filter((key) => !live.has(key))) {
    Object.defineProperty(retired, key, { value: plans[key], enumerable: true, writable: true, configurable: true });
  }
  return retired;
}

/* One currency's figure of one plan, written through the schema its box declares. An id outside the
   plan's currencies is refused, so a stale caller cannot widen a plan. */
function clampCurrencyBox(values, currencyId, value, schema) {
  const key = String(currencyId);
  if (!Object.hasOwn(values, key)) return values;
  return { ...values, [key]: Math.floor(Validator.validate(value, schema)) };
}
