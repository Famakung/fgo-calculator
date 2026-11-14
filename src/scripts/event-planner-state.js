import { Validator } from "./domain.js";

/* ===...=== Event-planner plan-state helpers (app layer, pure) ===...=== */
/* The plan-shaped functions EventPlanner delegates to: read the snapshot list, copy one event's
   plan out of state so a caller cannot write into the stored one, carry a pruned event's saved
   bytes through a save, and write one currency box figure through the schema its box declares.
   No DOM, no storage, no event-selection logic — that all stays on EventPlanner itself. */

/* The snapshot list of a generated data module; the pre-G single-event shape has none, so the site
   falls back to the legacy calculator rather than reading a stale one-event blob as an event list. */
export function snapshotEvents(data) {
  if (!data || !Array.isArray(data.events)) return [];
  return data.events.filter((snap) => snap && snap.event);
}

/* A copy, so a caller reading the plan cannot write into the stored one by accident. */
export function planOf(state, eventId) {
  const plan = state.plans[String(eventId)];
  if (!plan) return { requires: {}, held: {}, bonus: {}, farmQuest: null, currencyQuest: {} };
  return {
    requires: { ...plan.requires },
    held: { ...plan.held },
    bonus: { ...plan.bonus },
    farmQuest: plan.farmQuest ?? null,
    currencyQuest: { ...plan.currencyQuest },
  };
}

/* Amendment J5: the saved plans of events the current data no longer lists, kept out of state but
   written back verbatim, so the first mutation after a prune cannot erase a player's plan for that
   event. Nothing reads or sanitizes these bytes, which is why they are copied by own key with
   defineProperty: a blob parsed from JSON can hold an own "__proto__" key, and plain assignment
   would turn that into a prototype swap instead of a stored entry. */
export function retiredPlans(saved, events) {
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
export function clampCurrencyBox(values, currencyId, value, schema) {
  const key = String(currencyId);
  if (!Object.hasOwn(values, key)) return values;
  return { ...values, [key]: Math.floor(Validator.validate(value, schema)) };
}
