import { DEBOUNCE_MS, TIERS } from "./constants.js";
import { EventShop, Schema } from "./domain.js";
import { DOMFactory, debounce } from "./presentation.js";
import { EventPlanner } from "./event-planner.js";

/* ===...=== Farm-card currency controls (Amendment H, I7, L4, N) ===...=== */
/* The controls a farm card owns but a tier card never shows for the same currency: a currency with
   no tier card gets its own Held/Bonus input pair, writing the same currency-keyed plan the tier
   boxes write. Exactly one input pair per currency: a tier-mapped currency gets no farm Held/Bonus,
   because its tier card already owns them. Amendment I7 removed the farm Required display — the
   tier cards are its only home now, and since Amendment K the farm card's header is a plain
   display. The boxes reuse the house .material-input-box markup, so the label and field geometry
   match the tier cards'. Amendment L adds the 3-in-1 card's quest dropdown; Amendment M4 gives
   every per-currency card its own. Amendment N sorts every farm dropdown by REC Lv descending and
   keeps the all-covering quests out of the cards 1-to-3 lists. */

/* The currency ids the tier cards own: the first currency carrying each TIERS background, through
   EventShop.currencyForTier — the single mapping rule. Snapshot currencies list in id-ascending
   order, so "first of its background" is exactly what the tier card shows. */
export function tierMappedIds(currencies) {
  const ids = new Set();
  for (const tier of TIERS) {
    const currency = EventShop.currencyForTier(currencies, tier);
    if (currency) ids.add(String(currency.id));
  }
  return ids;
}

/* Amendment N1: the REC Lv order every farm dropdown follows — numeric part first, then the
   suffix plain < "+" < "++" < "★", so 70 < 75 < 80 < 85 < 90 < 90+ < 90++ < 100★. An absent or
   unparseable recommendLv ranks Infinity and sorts last. The stride leaves the suffix ranks 0-4
   room below the next level, keeping the rank a plain comparable number. */
const REC_SUFFIX_RANK = { "": 0, "+": 1, "++": 2, "+++": 3, "★": 4 };
const REC_RANK_STRIDE = 8;
const UNKNOWN_SUFFIX_RANK = 5;

export function recLvRank(recommendLv) {
  const text = recommendLv === null || recommendLv === undefined ? "" : String(recommendLv).trim();
  const level = /^\d+/.exec(text);
  if (!level) return Number.POSITIVE_INFINITY;
  const suffixRank = REC_SUFFIX_RANK[text.slice(level[0].length).trim()] ?? UNKNOWN_SUFFIX_RANK;
  return Number(level[0]) * REC_RANK_STRIDE + suffixRank;
}

/* Dropdown order for the farm cards (Amendment N1, reversed): highest REC Lv first, missing levels
   last; ties — and two missing levels, whose Infinity difference is NaN — fall to the lower quest
   id, so the sort is stable. */
export function byRecommendLv(a, b) {
  return recLvRank(b.recommendLv) - recLvRank(a.recommendLv) || a.questId - b.questId;
}

/* A labelled box in the house shape: .material-input-box wrapping label + field. */
function labelledBox(labelText, input) {
  const box = DOMFactory.el("div", "material-input-box");
  const label = DOMFactory.el("label", "material-input-box-label", { for: input.id });
  label.textContent = labelText;
  box.replaceChildren(label, input);
  return box;
}

function planFigureBox(spec) {
  const input = DOMFactory.el("input", "material-input-box-field", {
    type: "number",
    id: `farm${spec.labelText}${spec.currency.id}`,
    min: "0",
    max: String(spec.schema.max),
    "aria-label": `${spec.currency.name} ${spec.labelText.toLowerCase()}`,
    inputmode: "numeric",
  });
  input.value = String(spec.value);
  /* Debounced write, the house input pattern (finding 7): typing reaches localStorage at most once
     per DEBOUNCE_MS. The clamp-on-read at Calculate never depends on this listener firing. */
  input.addEventListener(
    "input",
    debounce(() => {
      /* Detached input: timer pending across an Event Select switch; the stale value must not hit the new plan. */
      if (!input.isConnected) return;
      spec.write(input.value);
      spec.onWritten?.();
    }, DEBOUNCE_MS),
  );
  return labelledBox(spec.labelText, input);
}

/* The Held input of a currency no tier card owns. Writes go to EventPlanner keyed by this card's
   currency id — the same plan and clamps the tier boxes use. */
export function buildHeldBonusBoxes(currency, plan) {
  const key = String(currency.id);
  return planFigureBox({
    labelText: "Held",
    schema: Schema.tier.Have,
    value: plan.held[key] || 0,
    write: (v) => EventPlanner.setHeld(key, v),
    currency,
  });
}

/* The 3-in-1 card's quest dropdown (Amendment L3/L4, N1): the list is ONLY the event's all-covering
   quests — no "Auto", no other mode; that card exists to make one shared quest explicit — sorted by
   REC Lv descending. The choice writes plans[eid].farmQuest through the planner (a pick the event no
   longer carries re-defaults there), and the caller's onChange repaints the four cards and reprices
   the visible results. */
export function buildFarmQuestSelect(quests, selectedQuestId, onChange = null) {
  const select = DOMFactory.el("select", "select-field farm-quest-select", {
    id: "farmQuestSelect",
    "aria-label": "Farm quest for every shop currency",
  });
  const listed = [...quests].sort(byRecommendLv);
  for (const quest of listed) select.appendChild(buildQuestOption(quest));
  select.value = String(pickedQuestId(listed, selectedQuestId));
  select.addEventListener("change", () => {
    EventPlanner.setFarmQuest(Number(select.value));
    if (onChange) onChange();
  });
  return select;
}

function buildQuestOption(quest, label = quest.questName) {
  const option = DOMFactory.el("option", null, { value: String(quest.questId) });
  option.textContent = quest.recommendLv ? `${label} \u00b7 Lv.${quest.recommendLv}` : label;
  return option;
}

function raidQuestLabel(quest, bossName) {
  const rawDiff = (quest.difficultyLabel || "").trim();
  return rawDiff && rawDiff !== (bossName || "").trim() ? rawDiff : quest.questName;
}

/* The plan's pick shows when the list still carries it; otherwise the first listed quest — the
   list is REC-sorted (Amendment N1), so that is the highest-REC quest; the planner's sanitize and
   default owns the real decision. */
function pickedQuestId(quests, selectedQuestId) {
  const chosen = quests.find((quest) => String(quest.questId) === String(selectedQuestId));
  return chosen ? chosen.questId : quests[0].questId;
}

/* A quest's main drop (Amendment O): the shop currency whose dropExpected×num is the highest over
   the quest's drops — plain data figures, bonus-free like every other ranking here — ties to the
   lower currency id. currencyIds bounds the candidates to the event's shop currencies. */
function isMainDrop(quest, currencyId, currencyIds) {
  const drops = (quest || {}).drops || {};
  let top = null;
  let topAmount = 0;
  for (const id of (Array.isArray(currencyIds) ? currencyIds : []).map(String)) {
    const drop = drops[id];
    if (!drop) continue;
    const amount = Number(drop.dropExpected) * Number(drop.num) || 0;
    if (top === null || amount > topAmount || (amount === topAmount && Number(id) < Number(top))) {
      top = id;
      topAmount = amount;
    }
  }
  return top === String(currencyId);
}

/* The cards 1-to-3 dropdown list (Amendment M4, N2, O): the event's quests whose MAIN drop is this
   currency — a quest where the card's currency is only a secondary drop never appears here, and an
   all-covering quest is card 4's own. Sorted by REC Lv descending (Amendment N1), ties to the lower
   quest id. The default pick is NOT the first entry any more: EventShop.defaultCurrencyQuest names
   the currency's best-rate non-all-covering quest, the same figure the optimizer's top-up fallback
   resolves to — the card falls to the first listed quest when that best rate is a secondary drop. */
export function questsDroppingCurrency(farm, currency, currencyIds) {
  const key = String(currency.id);
  const covering = new Set(EventShop.allCoveringQuests(farm, currencyIds).map((quest) => quest.questId));
  const droppers = ((farm || {}).quests || []).filter(
    (quest) => quest && !covering.has(quest.questId) && isMainDrop(quest, key, currencyIds),
  );
  return droppers.sort(byRecommendLv);
}

/* A per-currency card's quest dropdown (Amendment M4, N1/N2): one per card, listing the quests that
   drop that card's currency and are not all-covering, in REC Lv order. The choice writes
   plans[eid].currencyQuest[cid] through the planner (a pick the event no longer carries re-defaults
   there), and onChange repaints the grid and reprices the results — the same contract the 3-in-1
   card's dropdown keeps for farmQuest. */
export function buildCurrencyQuestSelect(spec) {
  const { currency, quests, selectedQuestId, onChange = null } = spec;
  const select = DOMFactory.el("select", "select-field farm-quest-select", {
    id: `farmQuestSelect_${currency.id}`,
    "aria-label": `Farm quest for ${currency.name}`,
  });
  for (const quest of quests) select.appendChild(buildQuestOption(quest));
  select.value = String(pickedQuestId(quests, selectedQuestId));
  select.addEventListener("change", () => {
    EventPlanner.setCurrencyQuest(currency.id, Number(select.value));
    if (onChange) onChange();
  });
  return select;
}

export function buildRaidQuestSelect(spec) {
  const { boss, quests, selectedQuestId, onChange = null } = spec;
  const select = DOMFactory.el("select", "select-field farm-quest-select", {
    id: `raidQuestSelect_${boss.bossId}`,
    "aria-label": `Difficulty for ${boss.bossName}`,
  });
  for (const quest of quests) select.appendChild(buildQuestOption(quest, raidQuestLabel(quest, boss.bossName)));
  select.value = String(pickedQuestId(quests, selectedQuestId));
  select.addEventListener("change", () => {
    EventPlanner.setRaidQuest(boss.bossId, Number(select.value));
    if (onChange) onChange();
  });
  return select;
}
