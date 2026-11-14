import { EVENT_SHOP_STORAGE_KEY } from "./constants.js";
import { EventShop, Schema } from "./domain.js";
import { planOf, snapshotEvents, retiredPlans, clampCurrencyBox } from "./event-planner-state.js";
import { EVENT_SHOP_DATA } from "./data/event_shop.js";

/* Application layer for the Event Shop planner: owns the selected event and that event's plan
   (requires + held + bonus + farmQuest + currencyQuest) and persists everything under EVENT_SHOP_STORAGE_KEY.
   Amendment G made
   the snapshot a list, so each event keeps its own plan and editing one never touches another.
   Amendment B removed the planner card: the per-currency modal is the sole configuration surface,
   so this module is state and storage only, with no DOM at all. The tier boxes and the farm cards
   delegate their Held/Bonus figures through setHeld/setBonus, keyed by CURRENCY id (Amendment H),
   so an event with two golds gives each one its own numbers; the card displays refresh through
   App.refreshNeeds(). There is no runtime network — state reads the generated snapshot list.
    Amendment J5 adds the retired stash: a pruned event's saved plan stays in storage untouched,
    because sanitizePlans drops it from state and a save that wrote only state would erase it.
    Amendment M4 adds the per-currency quest picks (currencyQuest: { [currencyId]: questId }); the
    pure plan helpers — snapshot list, plan copy, retired stash, currency-box clamp — live in
    event-planner-state.js. */
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

  ceOwnedOf(ceId) {
    const entry = (this.activePlan().ceOwned || {})[String(ceId)];
    return {
      limitBreak: entry ? entry.limitBreak || 0 : 0,
      nonLimitBreak: entry ? entry.nonLimitBreak || 0 : 0,
    };
  },

  setCeOwned(ceId, kind, value) {
    if (kind !== "limitBreak" && kind !== "nonLimitBreak") return;
    const event = this.activeEvent();
    if (!event) return;
    const key = String(ceId);
    if (!(event.bonusCes || []).some((ce) => String(ce.id) === key)) return;
    const current = this.activePlan().ceOwned || {};
    const prev = current[key] || { limitBreak: 0, nonLimitBreak: 0 };
    this._mutatePlan({
      ceOwned: {
        ...current,
        [key]: { ...prev, [kind]: EventShop.clampCeOwned(value) },
      },
    });
  },

  ceEquipLimit() {
    return EventShop.clampCeEquipLimit(this.activePlan().ceEquipLimit);
  },

  setCeEquipLimit(value) {
    this._mutatePlan({ ceEquipLimit: EventShop.clampCeEquipLimit(value) });
  },

  /* The 3-in-1 card's quest pick (Amendment L4): the dropdown only offers this event's all-covering
     quests, and anything else — a stale id, a quest the data retired — re-defaults through the same
     domain rule the load-time sanitize uses, so the plan never holds a quest the cards cannot show. */
  setFarmQuest(questId) {
    const event = this.activeEvent();
    if (!event) return;
    const quests = (event.farm || {}).quests || [];
    const id = Number(questId);
    const known = quests.some((quest) => quest.questId === id);
    const currencyIds = (event.currencies || []).map((currency) => currency.id);
    this._mutatePlan({ farmQuest: known ? id : EventShop.defaultFarmQuest(event.farm || {}, currencyIds) });
  },

  /* A per-currency card's quest pick (Amendment M4, N2): the card's dropdown only offers this event's
     quests that drop THIS currency and are not all-covering, and anything else re-defaults to that
     currency's best non-all-covering dropper through the same domain rule the load-time sanitize
     uses — the plan never holds a quest a card cannot show. The map is keyed by currency id,
     stringified the way the plan's other currency maps are. */
  setCurrencyQuest(currencyId, questId) {
    const event = this.activeEvent();
    if (!event) return;
    const key = String(currencyId);
    const currencyIds = (event.currencies || []).map((currency) => currency.id);
    const choice = EventShop.sanitizedCurrencyQuest({
      farm: event.farm || {},
      currencyIds,
      currencyKey: key,
      saved: questId,
    });
    this._mutatePlan({ currencyQuest: { ...this.activePlan().currencyQuest, [key]: choice } });
  },

  questType() {
    const event = this.activeEvent();
    if (!hasEventRaids(event)) return "free";
    return this.activePlan().questType === "raid" ? "raid" : "free";
  },

  setQuestType(type) {
    const event = this.activeEvent();
    if (!event) return;
    const next = hasEventRaids(event) && type === "raid" ? "raid" : "free";
    this._mutatePlan({ questType: next });
  },

  raidQuestOf(bossId) {
    const event = this.activeEvent();
    const boss = findRaidBoss(event, bossId);
    if (!boss) return null;
    const savedMap = this.activePlan().raidQuest || {};
    const key = String(boss.bossId);
    const saved = Object.hasOwn(savedMap, key) ? savedMap[key] : undefined;
    return EventShop.sanitizedRaidQuest(boss, saved);
  },

  setRaidQuest(bossId, questId) {
    const event = this.activeEvent();
    const boss = findRaidBoss(event, bossId);
    if (!boss) return;
    const choice = EventShop.sanitizedRaidQuest(boss, questId);
    if (choice === null) return;
    const key = String(boss.bossId);
    this._mutatePlan({ raidQuest: { ...this.activePlan().raidQuest, [key]: choice } });
  },

  activeRaidQuests() {
    const event = this.activeEvent();
    const raids = (event && event.farm && event.farm.raids) || [];
    if (!Array.isArray(raids) || !raids.length) return [];
    const savedMap = this.activePlan().raidQuest || {};
    const selected = [];
    for (const boss of raids) {
      if (!boss || !Array.isArray(boss.quests) || !boss.quests.length) continue;
      const key = String(boss.bossId);
      const saved = Object.hasOwn(savedMap, key) ? savedMap[key] : undefined;
      const questId = EventShop.sanitizedRaidQuest(boss, saved);
      const quest = boss.quests.find((entry) => entry && entry.questId === questId);
      if (quest) selected.push(quest);
    }
    return selected;
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

function hasEventRaids(event) {
  const raids = (event && event.farm && event.farm.raids) || [];
  return Array.isArray(raids) && raids.some((boss) => boss && Array.isArray(boss.quests) && boss.quests.length > 0);
}

function findRaidBoss(event, bossId) {
  if (!event || bossId === null || bossId === undefined) return null;
  const raids = (event.farm && event.farm.raids) || [];
  if (!Array.isArray(raids)) return null;
  const key = String(bossId);
  return raids.find((boss) => boss && String(boss.bossId) === key) || null;
}
