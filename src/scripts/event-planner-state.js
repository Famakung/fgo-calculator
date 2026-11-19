import { DEFAULT_EVENT_SERVER, EVENT_SERVERS } from "./constants.js";
import { Validator } from "./domain.js";

/* ===...=== Event-planner plan-state helpers (app layer, pure) ===...=== */
/* The plan-shaped functions EventPlanner delegates to: read the snapshot list, copy one event's
   plan out of state so a caller cannot write into the stored one, carry a pruned event's saved
   bytes through a save, and write one currency box figure through the schema its box declares.
   No DOM, no storage, no event-selection logic — that all stays on EventPlanner itself. */

/* The snapshot list of a generated data module; the pre-G single-event shape has none, so the site
   falls back to the legacy calculator rather than reading a stale one-event blob as an event list. */
function isQpDumpItem(item) {
  return (
    item &&
    item.purchaseType === "item" &&
    item.limitNum === 0 &&
    (item.icon === "event_shop/item_1.webp" || item.name === "QP")
  );
}

function pruneQuestDrops(quests, keepKeys) {
  if (!Array.isArray(quests)) return [];
  return quests
    .map((q) => {
      const drops = {};
      for (const [k, v] of Object.entries((q && q.drops) || {})) {
        if (keepKeys.has(k)) drops[k] = v;
      }
      return Object.keys(drops).length ? { ...q, drops } : null;
    })
    .filter(Boolean);
}

/* Strip currencies whose only shop rows are unlimited leftover-to-QP exchanges (e.g. crafting
   materials or event points) when real shop currencies exist. Keeps farm cards and all-covering
   quest detection scoped to actual event shop currencies. */
function pruneQpOnlyCurrencies(snap) {
  if (!snap || !Array.isArray(snap.currencies) || !Array.isArray(snap.items)) return snap;
  const realCids = new Set();
  const seenCids = new Set();
  for (const it of snap.items) {
    const cid = it && it.cost && it.cost.itemId;
    if (cid == null) continue;
    seenCids.add(cid);
    if (!isQpDumpItem(it)) realCids.add(cid);
  }
  const farm = snap.farm || {};
  const droppedKeys = new Set();
  for (const q of Array.isArray(farm.quests) ? farm.quests : []) {
    for (const k of Object.keys((q && q.drops) || {})) droppedKeys.add(k);
  }
  for (const boss of Array.isArray(farm.raids) ? farm.raids : []) {
    for (const q of Array.isArray(boss && boss.quests) ? boss.quests : []) {
      for (const k of Object.keys((q && q.drops) || {})) droppedKeys.add(k);
    }
  }
  const firstTierIds = new Set();
  const seenTiers = new Set();
  for (const c of snap.currencies) {
    if (
      c &&
      (c.background === "bronze" || c.background === "silver" || c.background === "gold") &&
      !seenTiers.has(c.background)
    ) {
      seenTiers.add(c.background);
      firstTierIds.add(c.id);
    }
  }
  const keepIds = new Set(
    snap.currencies
      .filter((c) => {
        if (!c) return false;
        if (realCids.size && seenCids.has(c.id) && !realCids.has(c.id)) return false;
        if (droppedKeys.size && !droppedKeys.has(String(c.id)) && c.background !== "zero" && !firstTierIds.has(c.id))
          return false;
        return true;
      })
      .map((c) => c.id),
  );
  if (!keepIds.size || keepIds.size === snap.currencies.length) return snap;
  const keepKeys = new Set([...keepIds].map(String));
  const best = {};
  for (const [k, v] of Object.entries(farm.best || {})) {
    if (keepKeys.has(k)) best[k] = v;
  }
  const quests = pruneQuestDrops(farm.quests, keepKeys);
  const nextFarm = { ...farm, quests, best };
  if (Array.isArray(farm.raids)) {
    nextFarm.raids = farm.raids
      .map((boss) => {
        if (!boss || typeof boss !== "object") return null;
        const bossQuests = pruneQuestDrops(boss.quests, keepKeys);
        return bossQuests.length ? { ...boss, quests: bossQuests } : null;
      })
      .filter(Boolean);
  }
  const bonusCes = Array.isArray(snap.bonusCes)
    ? snap.bonusCes
        .map((ce) => {
          const bonuses = {};
          for (const [k, v] of Object.entries((ce && ce.bonuses) || {})) {
            if (keepKeys.has(k)) bonuses[k] = v;
          }
          return Object.keys(bonuses).length ? { ...ce, bonuses } : null;
        })
        .filter(Boolean)
    : [];
  return {
    ...snap,
    currencies: snap.currencies.filter((c) => c && keepIds.has(c.id)),
    items: snap.items.filter((it) => it && it.cost && keepIds.has(it.cost.itemId)),
    trades: Array.isArray(snap.trades) ? snap.trades.filter((t) => keepIds.has(t.fromId) && keepIds.has(t.toId)) : [],
    farm: nextFarm,
    bonusCes,
  };
}

export function snapshotEvents(data) {
  if (!data || !Array.isArray(data.events)) return [];
  return data.events.filter((snap) => snap && snap.event).map(pruneQpOnlyCurrencies);
}

export function sanitizeEventServer(server) {
  return EVENT_SERVERS.includes(server) ? server : DEFAULT_EVENT_SERVER;
}

/* Per-server event lists: each server's entries carry that region's event name/dates while
   borrowing the JP calculation snapshot by shared event id. When data.servers is absent (legacy
   fixtures), JP gets allEvents and other servers get []. */
export function snapshotServers(data, allEvents) {
  const byId = new Map(allEvents.map((snap) => [snap.event.id, snap]));
  const hasServers = data && data.servers && typeof data.servers === "object" && !Array.isArray(data.servers);
  const result = {};
  for (const server of EVENT_SERVERS) {
    if (!hasServers) {
      result[server] = server === DEFAULT_EVENT_SERVER ? allEvents : [];
      continue;
    }
    const list = Array.isArray(data.servers[server]) ? data.servers[server] : [];
    result[server] = list
      .filter((ev) => ev && typeof ev.id === "number" && byId.has(ev.id))
      .map((ev) => {
        const jpSnap = byId.get(ev.id);
        return { ...jpSnap, event: { ...jpSnap.event, ...ev } };
      });
  }
  return result;
}

/* A copy, so a caller reading the plan cannot write into the stored one by accident. */
export function planOf(state, eventId) {
  const plan = state.plans[String(eventId)];
  if (!plan) {
    return {
      requires: {},
      held: {},
      bonus: {},
      farmQuest: null,
      currencyQuest: {},
      ceOwned: {},
      ceEquipLimit: 6,
      questType: "free",
      raidQuest: {},
      raidEnded: {},
    };
  }
  return {
    requires: { ...plan.requires },
    held: { ...plan.held },
    bonus: { ...plan.bonus },
    farmQuest: plan.farmQuest ?? null,
    currencyQuest: { ...plan.currencyQuest },
    ceOwned: cloneCeOwned(plan.ceOwned),
    ceEquipLimit: plan.ceEquipLimit ?? 6,
    questType: plan.questType === "raid" ? "raid" : "free",
    raidQuest: plan.raidQuest && typeof plan.raidQuest === "object" ? { ...plan.raidQuest } : {},
    raidEnded: plan.raidEnded && typeof plan.raidEnded === "object" ? { ...plan.raidEnded } : {},
  };
}

function cloneCeOwned(ceOwned) {
  const copy = {};
  for (const [ceId, counts] of Object.entries(ceOwned || {})) {
    if (!counts || typeof counts !== "object") continue;
    copy[ceId] = { limitBreak: counts.limitBreak || 0, nonLimitBreak: counts.nonLimitBreak || 0 };
  }
  return copy;
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
