#!/usr/bin/env node
/**
 * scripts/test_event_shop.js
 *
 * Browser gate for the Event Shop surfaces under Amendments D+E+F+G+H+I(final)+J. Amendment J pruned
 * every non-farm event from the shipped snapshot; the sanctioned 2026-11-12 sync added 80632, so
 * EVENT_SHOP_DATA.events == [80639, 80632] (scene event 80639: 3 tier-mapped
 * currencies, all with community drop data + a secondary drop). The gate therefore runs in THREE modes
 * against THREE served copies of the same fresh dist — one command per mode, every mode must exit 0:
 *   MAIN   (default)  — the shipped snapshot (2 events since 2026-11-12): farm card shape + opener + drop lines,
 *                        results math, modal/clamp/commit/hostile/quota/viewport, select options;
 *   MULTI  (--multi)  — a patched copy whose events[] also carries the three pruned events (80630
 *                        single-gold null-farm, 80379 two golds / first-match, 80292 QP "zero" + two
 *                        silvers) plus a synthetic 80555 dash fixture (the live farm rows with every
 *                        secondary deleted). Per-event isolation, migration, N-currency collision,
 *                        zero-background, null-farm and secondary-null CANNOT be tested against the
 *                        shipped single-event snapshot — they live here, whole, never weakened;
 *   LEGACY (--legacy) — a patched stub copy (events emptied) re-pinning the untouched calculator.
 * The oracle for every expected number is the mode's own event data (the data module for MAIN/LEGACY,
 * the fixture JSON for MULTI) — never the app's own EventShop.
 *
 * Contracts pinned (Amendment I final = I7 refinement included, Amendment J = pruning + fallback,
 * Amendment K = the owner-approved 7-point UI pass — the I7 header-opener pins are INVERTED to
 * absence pins BY DESIGN):
 *  - Select Event card FIRST in #panel-event and the K4 card order: "Select Event" →
 *    "Drop Rates per Run" → "Shop Requirements" → the #results "Items Needed" card; Bond-consistent
 *    .input-row > label.input-label + select.select-field; NO blank option; fresh storage
 *    FORCE-SELECTS the latest event (max startedAt == list head, both pinned); with one event the
 *    list is exactly the snapshot events in order ([80639, 80632] since the 2026-11-12 sync); a saved selection wins (MULTI); zero events (stub copy) →
 *    one disabled "No active event" option + the legacy calculator;
 *  - per-event saves (MULTI): set a plan on A, switch to B, switch back to A → A restored
 *    byte-equal, B's edit never leaked into A; plans survive reload; the pre-G { eventId, requires }
 *    blob migrates (live and dead ids) and the disk blob stays untouched until the first mutation;
 *  - farm cards (Amendment I, re-pinned by Amendment K2/K3/K6, "Drop Rates per Run"): title, one
 *    card per shop currency, card = [currency header: PLAIN DISPLAY — zero role, tabindex,
 *    aria-haspopup, aria-label, data-currency-id, cursor auto] + quest-name line +
 *    "REC Lv. {recommendLv}" (skipped when falsy) + primary drop line +
 *    secondary drop line (or a bare "—" when the quest has no second shop-currency drop). Each line
 *    is "[icon] {num}(+{bonus}) {dropExpected×(num+bonus)} / run" at 2dp, keyed to ITS OWN currency,
 *    repainted live when that currency's Bonus changes — on EVERY line carrying it (a currency can
 *    ride its own card's primary and another card's secondary at once). NO Required box, NO AP, NO
 *    "runs reported", NO Base/Primary/Secondary labels anywhere inside #farmGrid (absence regex over
 *    the cards' visible text + zero require-display inputs + zero farmRequired* ids); a null farm
 *    entry → the single "No drop data yet" line. Held/Bonus inputs appear on a farm card ONLY for a
 *    currency no tier card owns; the base-row and #questDropsGrid stay hidden, #farmGrid visible
 *    (the reverse in stub mode). Header art is 48px (box and img), drop-line art 24px (Amendment K3);
 *  - modal access (Amendment K2): the tier cards' Required field is the SOLE modal opener; clicking
 *    or pressing Enter/Space on a farm header must NEVER open the modal, and inputs inside a card
 *    never open anything either;
 *  - results math vs an INDEPENDENT reference farmPlan recomputed here from the mode's data: the
 *    gold buy-out (truth 6610) at held 1000 + bonus 2 reads deficit 5610 and
 *    runs = ceil(5610/(dropExpected×(num+2))) — the shipped snapshot's dropExpected says 104, a flat
 *    "per-run add" bug says 163, and the gate pins that the two disagree before trusting either;
 *    a null-farm currency says "—" + "No drop data yet"; event-mode #results labels are
 *    "{N} runs"/"run" with ZERO "AP" text (Amendment K6) and carry the CURRENCY names, restoring to
 *    the tier words when a switch leaves a tier unmapped (the stub keeps its own unchanged wording);
 *  - ABSENCE of every planner-card surface (#eventPlannerCard/.eshop-summary/.eshop-filter-chip/
 *    .eshop-group/...), zero requests for the deleted icons/materials mockup, zero HTTP >= 400;
 *  - geometry parity Required===Held===Bonus offsetHeight/Width per tier, dashed/pointer/focus
 *    cues, hover rule pinned through the CSSOM (headless reports (hover: hover)=false);
 *  - standalone event icons (.material-icon--event transparent, one decoded fg img, no badge) in
 *    the tier cards and farm cards; the hidden #questDropsGrid spans stay hydrated (1 img, right
 *    file, no badge) but decode is not demanded of nodes the user cannot see. Amendment K1: tier
 *    icon boxes are 96px tall, the fg-layer FILLS the box (100%, no 80px inset), the base
 *    .material-icon rule carries NO grey plate any more, and stub letter badges are 96px tall with
 *    their TIER_COLORS background;
 *  - the currency modal contract: the tier cards' Required field is the SOLE opener (Amendment K2),
 *    Escape/✕/Cancel/
 *    backdrop discard, ALL clamping in the draft rows (limit clamp, focus-preserving typing,
 *    schema max, negative, rapid stepper race), Default/Select All semantics, only Done commits;
 *  - Done agreement through storage (new {selectedEventId, plans} shape) + tier Required + the
 *    legacy fgo_calculator_data mirror; write discipline (draft writes 0, Done writes 1);
 *  - hostile storage sanitisation (both blob shapes), quota-failure path with the console warning,
 *    modal icon fallback badge (transparent, dashed), keyboard operation, zero sideways overflow at
 *    360px/1120px, zero runtime external fetches, the zero-background event (MULTI 80292, QP "zero")
 *    renders without crash and its farm card still gets a tier border via the :where() fallback.
 *
 * Legacy fallback (--legacy against a patched stub copy: events emptied) re-pins the untouched
 * calculator: grey plates with 9 tier-colour letter badges, editable Required, no modal, base-row +
 * quest grid visible, farmGrid hidden and empty, old persistence blob { bronzeNeed, ... } only.
 *
 * Run it against the static dist on the spare ports (3000 is the owner's server — never gate there,
 * never stop daemons that are not yours). QA builds the patched copies outside the repo:
 *   npm run build
 *   node /tmp/opencode/qa/build_sites.mjs && bash /tmp/opencode/qa/serve.sh
 *   node scripts/test_event_shop.js http://127.0.0.1:4173/fgo-calculator/              (MAIN)
 *   node scripts/test_event_shop.js http://127.0.0.1:4174/fgo-calculator/ --multi      (MULTI)
 *   node scripts/test_event_shop.js http://127.0.0.1:4175/fgo-calculator/ --legacy     (stub copy)
 *
 * Patched-copy recipe (mutants + stub, OUTSIDE the repo, served from throwaway dirs — symlink the
 * dist, replace only the patched chunk with a real file, kill every server by PID when done):
 *   stub:       in _astro/event-lazy.*.js replace `events:[{event:{id:` with `events:0&&[{event:{id:`
 *               — `0 && [...]` is 0, brackets stay balanced, snapshotEvents() sees no array and the
 *               page falls back to the legacy calculator (must reach the legacy pins, not the event pins);
 *   multi:      in the event-lazy chunk, brace-match the first events[] element and insert the fixture
 *               events after it (80639 stays the list head, so force-latest stays meaningful);
 *   force-latest: in _astro/selectors-chunk.*.js replace `t.length>0?t[0].event.id:null` with
 *               `t.length>0?t[t.length-1].event.id:null` (must redden the fresh-load force-select pins —
 *               only a MULTI list with >1 event can discriminate);
 *   shared-plans: in the event-lazy chunk replace `t[String(this.state.selectedEventId)]`
 *               with `t["80639"]` (must redden the per-event isolation pins: B's edit lands on A);
 *   flat-bonus: in the selectors chunk replace `I(e.dropExpected)*(I(e.num)+x.validate(t,` with
 *               `I(e.dropExpected)*I(e.num)+x.validate(t,`
 *               (bonus leaves the stack — must redden the farm results pin 104→163);
 *   header-still-clickable (Amendment K regression): in the event-lazy chunk find the farm card's
 *               plain header builder `s.el(`div`,`farm-card-title`)…replaceChildren(n,r),t}` and
 *               restore the removed opener — dataset currency id + role/tabindex + the
 *               bindCurrencyModalOpen call (resolved structurally by its `dataset.modalBound` body).
 *               The K2 absence pins and the inert-header scenes go red while the tier Required keeps working;
 *   calcbtn-misplaced (Amendment K regression): in index.html move the #calculateBtn button out of
 *               the Shop Requirements .bond-card-actions--end back to a card sibling — the K5
 *               placement/width pins go red;
 *   secondary-wrong-currency: in the event-lazy chunk replace `L(n,e.secondary.currencyId)` with
 *               `L(n,t.id)` — the secondary line resolves to the CARD's currency, so the drop-line
 *               pins (secondary id + art + amount) go red;
 *   costume:    in the event-lazy chunk replace `costume_20470011.webp` with `costume_20479999.webp`
 *               (must redden the costume-face src/decode pin and the zero-4xx absence pin).
 *
 * WARNING: the HMR dev server is not a valid target (see scripts/verify_render.js): it creates
 * duplicate module instances, so what it renders is not what ships.
 *
 * Exits 1 with one `[ERROR] <check>` line per failed check.
 */

import puppeteer from "puppeteer";
import fs from "node:fs";
import { EVENT_SHOP_DATA } from "../src/scripts/data/event_shop.js";
import {
  EVENT_SHOP_STORAGE_KEY,
  STORAGE_KEY,
  QUEST_DROPS,
  TIER_COLORS,
  IMAGE_VERSION,
  DEBOUNCE_MS,
} from "../src/scripts/constants.js";

const argv = process.argv.slice(2);
const LEGACY = argv.includes("--legacy");
const MULTI = argv.includes("--multi");
const MODE = LEGACY ? "legacy" : MULTI ? "multi" : "main";
const url = argv.find((a) => !a.startsWith("--")) || "http://localhost:4173/fgo-calculator/";
const errors = [];
const KEY = EVENT_SHOP_STORAGE_KEY;
const SETTLE_MS = 350; // DEBOUNCE_MS is 100; 350 leaves the commit room on a loaded machine.
const TIERS = ["bronze", "silver", "gold"];

/* --- the events[] contract. Frozen ids are looked up BY ID; a missing id is snapshot drift and is
   reported as such, never silently skipped. MULTI reads the fixture the patched copy was built from —
   the same JSON literal injected into the chunk, so DOM and oracle share one source of truth. --- */
const FIXTURE_PATH = process.env.QA_MULTI_FIXTURE || "/tmp/opencode/qa/fixtures/multi_events.json";
const DATA = MULTI ? JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) : EVENT_SHOP_DATA;
const EVENTS = Array.isArray(DATA.events) ? DATA.events : [];
const PIN_LATEST = 80639; // the planner scene event (buy-out truth, farm data, costume row)
const PIN_OTHER = 80630; // MULTI: single gold currency, farm null, EN currency name
const PIN_MULTI = 80379; // MULTI: two gold currencies (first-match), no bronze/silver
const PIN_ZERO = 80292; // MULTI: QP ships background "zero"
const PIN_DASH = 80555; // MULTI: synthetic — the live farm rows with every secondary deleted
const findEvent = (id, label) => {
  const snap = EVENTS.find((e) => e.event.id === id);
  if (!snap) {
    console.error(`[ERROR] planner: no event ${id} (${label}) in EVENT_SHOP_DATA.events — snapshot drifted`);
    process.exit(1);
  }
  return snap;
};
const EACTIVE = LEGACY ? null : findEvent(PIN_LATEST, "planner scenes");
const EOTHER = LEGACY || !MULTI ? null : findEvent(PIN_OTHER, "null-farm scenes");
const EMULTI = LEGACY || !MULTI ? null : findEvent(PIN_MULTI, "first-match / label-restore scenes");
const EZERO = LEGACY || !MULTI ? null : findEvent(PIN_ZERO, "zero-background scenes");
const EDASH = LEGACY || !MULTI ? null : findEvent(PIN_DASH, "secondary-null dash scenes");
const ACTIVE_ID = EACTIVE ? EACTIVE.event.id : null;
const CURRENCIES = EACTIVE ? EACTIVE.currencies : [];
const ITEMS = EACTIVE ? EACTIVE.items : [];
const farmMapOf = (snap) => {
  const raw = snap && snap.farm;
  if (!raw) return {};
  if (!Array.isArray(raw.quests)) return raw;
  const currencies = snap.currencies || [];
  const ids = currencies.map((c) => String(c.id));
  const covering = new Set(
    raw.quests.filter((q) => q && q.drops && ids.every((id) => Object.hasOwn(q.drops, id))).map((q) => q.questId),
  );
  const out = {};
  for (const cur of currencies) {
    const cid = String(cur.id);
    const nonCover = raw.quests.filter((q) => q && (q.drops || {})[cid] && !covering.has(q.questId));
    const pool = nonCover.length ? nonCover : raw.quests.filter((q) => q && (q.drops || {})[cid]);
    if (!pool.length) continue;
    const best = pool.reduce((top, q) => {
      if (!top) return q;
      const a = q.drops[cid].dropExpected * q.drops[cid].num;
      const b = top.drops[cid].dropExpected * top.drops[cid].num;
      return a > b || (a === b && q.questId < top.questId) ? q : top;
    }, null);
    let secPick = null;
    let secTop = 0;
    for (const other of currencies) {
      const oid = String(other.id);
      if (oid === cid || !(best.drops || {})[oid]) continue;
      const r = best.drops[oid].dropExpected * best.drops[oid].num;
      if (!secPick || r > secTop) {
        secPick = { currencyId: other.id, dropExpected: best.drops[oid].dropExpected, num: best.drops[oid].num };
        secTop = r;
      }
    }
    out[cid] = {
      questId: best.questId,
      questName: best.questName,
      recommendLv: best.recommendLv,
      ap: best.ap,
      sampleRuns: best.sampleRuns,
      dropExpected: best.drops[cid].dropExpected,
      num: best.drops[cid].num,
      secondary: secPick,
    };
  }
  return out;
};
const FARM = farmMapOf(EACTIVE);
const byId = new Map(ITEMS.map((item) => [String(item.id), item]));
const SHOP_MAX = 999999;
const LATEST = EVENTS.length ? EVENTS.reduce((a, b) => (b.event.startedAt > a.event.startedAt ? b : a)) : null;

/* --- reference math, deliberately a second implementation of the contract --- */
const maxRequire = (item) => (item.limitNum > 0 ? item.limitNum : SHOP_MAX);
const refClamp = (item, value) => {
  const num = parseFloat(value);
  const clamped = Number.isNaN(num) ? 0 : Math.min(maxRequire(item), Math.max(0, num));
  return Math.floor(clamped);
};
const refTotals = (items, currencies, requires) => {
  const totals = {};
  for (const currency of currencies) totals[String(currency.id)] = 0;
  for (const item of items) {
    const count = requires[String(item.id)] || 0;
    totals[String(item.cost.itemId)] += count * item.cost.amount;
  }
  return totals;
};
const refClear = (items) => {
  const requires = {};
  for (const item of items) requires[String(item.id)] = item.limitNum > 0 ? item.limitNum : 0;
  return requires;
};
const fmtRef = (value) => Number(value).toLocaleString("en-US");
const tierOfCurrency = (currency) => currency.background;
const currencyOfItem = (item) => CURRENCIES.find((c) => String(c.id) === String(item.cost.itemId));
const itemsOfCurrency = (currencyId, items = ITEMS) =>
  items.filter((i) => String(i.cost.itemId) === String(currencyId));
const currencyForTierRef = (currencies, tier) => currencies.find((c) => c.background === tier) || null;
const num = (text) => Number(String(text).replace(/[^0-9.-]/g, ""));

/* Independent farmPlan — never EventShop's own. Keys: String(currencyId). */
const refFarmRow = (entry, total, held, bonus) => {
  const deficit = Math.max(0, (total || 0) - (held || 0));
  const perRun = entry ? entry.dropExpected * (entry.num + bonus) : 0;
  const runs = entry && perRun > 0 ? Math.ceil(deficit / perRun) : null;
  return { deficit, perRun, runs, ap: runs === null ? null : runs * entry.ap };
};
/* Amendment I drop line: "[icon] {num}(+{bonus}) {dropExpected×(num+bonus)} / run", 2dp, the same
   multiply farmPlan prices with — formatted exactly the way toLocaleString("en-US", 2..2) does. */
const dropStackRef = (num_, bonus) => `${num_}(+${bonus})`;
const dropValueRef = (dropExpected, num_, bonus) =>
  (dropExpected * (num_ + bonus)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
  " / run";

/* Amendment C: the stub badge's background is TIER_COLORS[tier] applied through style.background,
   which the CSSOM normalises to rgb(...) — compare against the same normalisation here. */
const rgbOf = (hex) => {
  const v = hex.replace("#", "");
  return `rgb(${parseInt(v.slice(0, 2), 16)}, ${parseInt(v.slice(2, 4), 16)}, ${parseInt(v.slice(4, 6), 16)})`;
};
const BADGE_WANT = Object.fromEntries(
  Object.entries(TIER_COLORS).map(([tier, hex]) => [tier, { bg: rgbOf(hex), letter: tier.charAt(0).toUpperCase() }]),
);
/* the 9 icon containers Amendment C leaves empty in markup, and fills from JS */
const ICON_CONTAINERS = [
  ...TIERS.map((t) => `${t}Icon`),
  ...Object.entries(QUEST_DROPS).flatMap(([quest, drops]) => [
    `${quest}Quest_${drops.primary}_icon`,
    `${quest}Quest_${drops.secondary}_icon`,
  ]),
];
/* which material's colour + letter each container must carry as its fallback badge */
const CONTAINER_TIER = {};
for (const t of TIERS) CONTAINER_TIER[`${t}Icon`] = t;
for (const [quest, drops] of Object.entries(QUEST_DROPS)) {
  CONTAINER_TIER[`${quest}Quest_${drops.primary}_icon`] = drops.primary;
  CONTAINER_TIER[`${quest}Quest_${drops.secondary}_icon`] = drops.secondary;
}

const BUY_ALL_TRUTH = { 94164000: 5740, 94164001: 5390, 94164002: 6610 };
const BUY_ALL_NAMES = { 94164000: "MISOおでん", 94164001: "SHIMONITAネギ", 94164002: "YAKIまんじゅう" };
/* Data truth for the pinned planner event (plan tracker, id asc): never trust the UI against
   itself, and never trust the pinned truth against a drifted snapshot either. ap/sampleRuns stay in
   the schema (Amendment I3 removed them from the DISPLAY only), so they are pinned as live figures,
   not as rendered text. */
const FARM_TRUTH = {
  94164000: {
    questName: "【GUNMA巡り】癒やしの温泉女神様",
    recommendLv: "75",
    ap: 40,
    dropExpected: 14.8696,
    num: 3,
    secondary: { currencyId: 94164001, dropExpected: 2.7391, num: 3 },
  },
  94164001: {
    questName: "【GUNMA巡り】青城の白いドラゴン",
    recommendLv: "80",
    ap: 40,
    dropExpected: 14.52,
    num: 3,
    secondary: { currencyId: 94164002, dropExpected: 2.7867, num: 3 },
  },
  94164002: {
    questName: "【GUNMA巡り】槍をスキーに連れていけ",
    recommendLv: "70",
    ap: 40,
    dropExpected: 10.8199,
    num: 3,
    secondary: { currencyId: 94164000, dropExpected: 2.2844, num: 3 },
  },
};

/* Scene rows on the pinned event: the gold draft carries the clamp suite, the bronze draft the
   commit scenes. The gold limited-1 row is the costume row itself (Amendment F pins its art). */
const goldCurrency = currencyForTierRef(CURRENCIES, "gold");
const silverCurrency = currencyForTierRef(CURRENCIES, "silver");
const bronzeCurrency = currencyForTierRef(CURRENCIES, "bronze");
const goldItems = goldCurrency ? itemsOfCurrency(String(goldCurrency.id)) : [];
const bronzeItems = bronzeCurrency ? itemsOfCurrency(String(bronzeCurrency.id)) : [];
const clampRow = goldItems.find((i) => i.limitNum === 1); // + twice must stop at 1 — the costume
const draftFree = goldItems.find((i) => i.limitNum === 0); // unlimited row in the gold draft
const equipRow = goldItems.find((i) => i.purchaseType === "servant" && /equip_/.test(i.icon || ""));
const multiSetRow = goldItems.find((i) => i.setNum > 1);
const freeRow = bronzeItems.find((i) => i.limitNum === 0); // unlimited row in the bronze draft
const bronzeSteppable = bronzeItems.find((i) => maxRequire(i) >= 2); // write-discipline stepper row
const silverFree = silverCurrency ? itemsOfCurrency(String(silverCurrency.id)).find((i) => maxRequire(i) > 3) : null;

if (!LEGACY) {
  const blind = [];
  if (!clampRow) blind.push("no gold limit-1 (costume) row");
  if (!draftFree) blind.push("no gold unlimited row");
  if (!freeRow) blind.push("no bronze unlimited row");
  if (!bronzeSteppable) blind.push("no steppable bronze row");
  if (CURRENCIES.length < 3) blind.push("fewer than 3 currencies on the pinned event");
  /* Amendment J shipped: the live snapshot carried ONLY the farm event; the 2026-11-12 sync is
     sanctioned drift — it added 80632, so MAIN truth is [80639, 80632]. The pruned events exist in
     this gate only inside the MULTI patched copy — the isolation/collision/zero-bg/null-farm scenes
     run there, never silently skipped. */
  const wantIds = MULTI ? [80639, 80630, 80379, 80292, 80555] : [80639, 80632];
  if (EVENTS.length !== wantIds.length)
    blind.push(`${EVENTS.length} events in ${MODE} mode, want ${wantIds.length} (${wantIds.join(",")})`);
  else if (EVENTS.map((e) => e.event.id).join() !== wantIds.join())
    blind.push(`events[] are ${EVENTS.map((e) => e.event.id).join(",")}, want ${wantIds.join(",")} in order`);
  if (LATEST.event.id !== EVENTS[0].event.id) blind.push("events[] is not sorted newest-first");
  if (blind.length) {
    console.error(`[ERROR] planner: the snapshot has no rows to pin — gate is blind: ${blind.join("; ")}`);
    process.exit(1);
  }
  for (const [id, truth] of Object.entries(BUY_ALL_TRUTH)) {
    const currency = CURRENCIES.find((c) => String(c.id) === id);
    if (!currency || currency.name !== BUY_ALL_NAMES[id]) {
      console.error(`[ERROR] planner: pinned currency ${id} drifted — re-verify before pinning`);
      process.exit(1);
    }
    if (refTotals(ITEMS, CURRENCIES, refClear(ITEMS))[id] !== truth) {
      console.error(`[ERROR] planner: reference buy-all for ${id} drifted from ${truth}`);
      process.exit(1);
    }
  }
}

const sel = {
  tierNeed: (tier) => `#${tier}Need`,
  tierHeld: (tier) => `#${tier}Have`,
  tierBonus: (tier) => `#${tier}Bonus`,
  modalRow: (id) => `#eventShopModalList .eshop-item[data-item-id="${id}"]`,
  modalInput: (id) => `${sel.modalRow(id)} .eshop-require-input`,
  modalPlus: (id) => `${sel.modalRow(id)} .eshop-step-btn[data-step="1"]`,
  modalMinus: (id) => `${sel.modalRow(id)} .eshop-step-btn[data-step="-1"]`,
  footer: (name) => `#eventShopModal${name}Btn`,
};

/* Amendment B: every one of these must be GONE from the live document. */
const DEAD_IDS = [
  "eventPlannerCard",
  "eventPlannerEventName",
  "eventPlannerWindow",
  "eventPlannerSummary",
  "eventPlannerControls",
  "eventPlannerList",
  "eventPlannerBuyAll",
  "eventPlannerClear",
];
const DEAD_CLASS_SELECTOR = [
  ".eshop-summary",
  ".eshop-summary-chip",
  ".eshop-filter-chip",
  ".eshop-group",
  ".eshop-group-header",
  ".eshop-group-total",
  ".eshop-list",
  ".eshop-controls",
  ".eshop-empty",
  ".eshop-event-name",
  ".eshop-window",
].join(", ");

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1120, height: 900 });

  const pageErrors = [];
  const consoleMessages = [];
  const shopResponses = [];
  const materialRequests = [];
  const httpFailures = [];
  const externalHosts = new Set();
  const origin = new URL(url).origin;
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => consoleMessages.push({ type: m.type(), text: m.text() }));
  const consoleErrors = () => consoleMessages.filter((m) => m.type === "error").map((m) => m.text);
  const consoleWarnings = () =>
    consoleMessages.filter((m) => m.type === "warn" || m.type === "warning").map((m) => m.text);
  page.on("response", (res) => {
    if (/event_shop/.test(res.url())) shopResponses.push({ url: res.url(), status: res.status() });
    if (res.status() >= 400) httpFailures.push({ url: res.url(), status: res.status() });
  });
  page.on("request", (req) => {
    /* Amendment C absence pin: the generic material mockup is deleted — asking for it is a defect,
       whether the answer is 404 (httpFailures) or a cached copy that should never have shipped. */
    if (/icons\/materials\//.test(req.url())) materialRequests.push(req.url());
    try {
      const u = new URL(req.url());
      if (u.origin !== origin) externalHosts.add(u.origin);
    } catch {
      /* non-http schemes (data:) are not external fetches */
    }
  });

  /* --- harness helpers (identical discipline to the earlier rounds) --- */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  /* Lazy icons grow the document as they decode, so a click can aim at a box that already moved:
     scroll in, wait for geometry to stop, prove the target is under the cursor, retry if not. */
  const safeClick = async (target) => {
    let detail = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      detail = await page.evaluate(async (s) => {
        const el = document.querySelector(s);
        if (!el) return { found: false };
        el.scrollIntoView({ block: "center" });
        let stable = false;
        let last = null;
        for (let i = 0; i < 80; i++) {
          await new Promise((r) => setTimeout(r, 50));
          const b = el.getBoundingClientRect();
          const key = `${Math.round(b.x)}:${Math.round(b.y)}:${document.documentElement.scrollHeight}`;
          if (last === key) {
            stable = true;
            break;
          }
          last = key;
        }
        const b = el.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return {
          found: true,
          stable,
          onScreen: b.top >= 0 && b.bottom <= window.innerHeight && b.width > 0 && b.height > 0,
          hit: hit ? `${hit.tagName}|${hit.className}` : null,
          covered: !!hit && hit !== el && !el.contains(hit),
        };
      }, target);
      if (!detail.found) {
        errors.push(`harness click: nothing matches ${target}`);
        return;
      }
      if (detail.covered) {
        errors.push(
          `harness click: ${target} is covered by ${JSON.stringify(detail.hit)} at its own centre point — a real user cannot reach it`,
        );
        return;
      }
      if (detail.stable && detail.onScreen) {
        try {
          await page.click(target);
          return;
        } catch (e) {
          detail.error = e.message.split("\n")[0];
        }
      }
      await wait(150);
    }
    errors.push(`harness click: ${target} never became a stable on-screen target — ${JSON.stringify(detail)}`);
  };

  /* The whole read surface: tier boxes (values, geometry, computed cues, icon plates), quest drops,
     farm grid, results, the event select, planner storage, legacy calculator storage, tab state. */
  const readTier = () =>
    page.evaluate(() => {
      const box = (el) =>
        el
          ? {
              h: el.offsetHeight,
              w: el.offsetWidth,
              borderStyle: getComputedStyle(el).borderStyle,
              cursor: getComputedStyle(el).cursor,
              readOnly: el.readOnly,
            }
          : null;
      const badgeOf = (box) => {
        const b = box ? box.querySelector(".icon-fallback") : null;
        if (!b) return null;
        const s = getComputedStyle(b);
        return {
          tag: b.tagName,
          cls: b.className,
          text: b.textContent,
          bg: s.backgroundColor,
          w: b.offsetWidth,
          h: b.offsetHeight,
          count: box.querySelectorAll(".icon-fallback").length,
        };
      };
      const tiers = {};
      for (const t of ["bronze", "silver", "gold"]) {
        const card = document.querySelector(`#materialsGrid [data-tier="${t}"]`);
        const need = document.getElementById(`${t}Need`);
        const held = document.getElementById(`${t}Have`);
        const bonus = document.getElementById(`${t}Bonus`);
        const iconBox = card ? card.querySelector(".material-icon") : null;
        const imgs = iconBox ? [...iconBox.querySelectorAll("img")] : [];
        tiers[t] = {
          name: card
            ? (card.querySelector(".material-name .farm-quest-name-text") || card.querySelector(".material-name") || {})
                .textContent || null
            : null,
          needValue: need ? need.value : null,
          heldValue: held ? held.value : null,
          bonusValue: bonus ? bonus.value : null,
          needReadOnly: need ? need.readOnly : null,
          needDisplayClass: need ? need.classList.contains("eshop-require-display") : null,
          needFieldClass: need ? need.classList.contains("material-input-box-field") : null,
          needHaspopup: need ? need.getAttribute("aria-haspopup") : null,
          needBox: box(need),
          heldBox: box(held),
          bonusBox: box(bonus),
          iconEventClass: iconBox ? iconBox.classList.contains("material-icon--event") : null,
          iconBoxBg: iconBox ? getComputedStyle(iconBox).backgroundColor : null,
          iconBoxH: iconBox ? iconBox.offsetHeight : 0,
          badge: badgeOf(iconBox),
          imgs: imgs.map((i) => ({ cls: i.className, src: i.getAttribute("src"), w: i.naturalWidth, h: i.offsetHeight })),
        };
      }
      const quests = {};
      for (const t of ["bronze", "silver", "gold"]) {
        const titleEl = document.querySelector(`#questDropsGrid [data-tier="${t}"] .quest-drops-title`);
        const icons = {};
        for (const m of ["bronze", "silver", "gold"]) {
          const span = document.getElementById(`${t}Quest_${m}_icon`);
          if (span) {
            const img = span.querySelector("img.fg-layer") || span.querySelector("img");
            icons[m] = {
              img: img ? { cls: img.className, src: img.getAttribute("src"), w: img.naturalWidth } : null,
              badge: badgeOf(span),
              imgCount: span.querySelectorAll("img").length,
            };
            icons[`${m}_spanBg`] = getComputedStyle(span).backgroundColor;
          }
        }
        quests[t] = { title: titleEl ? titleEl.textContent : null, icons };
      }
      const results = {};
      for (const t of ["bronze", "silver", "gold"]) {
        results[t] = {
          deficit: (document.getElementById(`${t}Deficit`) || {}).textContent,
          play: (document.getElementById(`${t}Play`) || {}).textContent,
          label: (document.getElementById(`${t}Label`) || {}).textContent,
          deficitLabel: (document.querySelector(`#deficitGrid [data-tier="${t}"] .deficit-label`) || {}).textContent,
          questName: (document.querySelector(`#questGrid [data-tier="${t}"] .quest-name`) || {}).textContent,
        };
      }
      const selectEl = document.getElementById("eventSelect");
      const select = selectEl
        ? {
            value: selectEl.value,
            disabled: selectEl.disabled,
            options: [...selectEl.querySelectorAll("option")].map((o) => ({
              value: o.value,
              text: o.textContent,
              disabled: o.disabled,
            })),
            selectClass: selectEl.className,
            rowClass: !!selectEl.closest(".input-row"),
            labelFor: !!document.querySelector('label.input-label[for="eventSelect"]'),
          }
        : null;
      const farmGrid = document.getElementById("farmGrid");
      const farmCard = farmGrid ? farmGrid.closest(".card") : null;
      const farm = farmCard
        ? {
            gridDisplay: getComputedStyle(farmGrid).display,
            baseDisplay: getComputedStyle(farmCard.querySelector(".base-row")).display,
            questDisplay: getComputedStyle(document.getElementById("questDropsGrid")).display,
            title: (farmCard.querySelector(".card-title") || {}).textContent?.trim() || null,
            cards: [...farmGrid.querySelectorAll(".farm-card:not(.farm-card--combo)")].map((c) => {
              const header = c.querySelector(".farm-card-title");
              const hImg = header ? header.querySelector("img") : null;
              const hBox = header ? header.querySelector(".farm-card-icon, .mini-icon") : null;
              const altName = hImg ? hImg.getAttribute("alt") : null;
              const visibleParts = [
                ...c.querySelectorAll(".farm-card-title, .farm-stat, .drop-line, .material-input-box-label"),
              ].map((el) => (el.querySelector(".farm-quest-name-text") || el).textContent);
              return {
                tier: c.dataset.tier,
                name: (c.querySelector(".farm-card-name") || {}).textContent || altName || null,
                lines: [...c.querySelectorAll(".farm-stat")].map(
                  (s) => (s.querySelector(".farm-quest-name-text") || s).textContent,
                ),
                header: header
                  ? {
                      role: header.getAttribute("role"),
                      tabindex: header.getAttribute("tabindex"),
                      haspopup: header.getAttribute("aria-haspopup"),
                      ariaLabel: header.getAttribute("aria-label"),
                      currencyId: header.dataset.currencyId || null,
                      cursor: getComputedStyle(header).cursor,
                      boxH: hBox ? hBox.offsetHeight : 0,
                      imgH: hImg ? hImg.offsetHeight : 0,
                      imgSrc: hImg ? hImg.getAttribute("src") : null,
                      imgW: hImg ? hImg.naturalWidth : 0,
                      imgAlt: altName,
                      text: header.textContent,
                    }
                  : null,
                drops: [...c.querySelectorAll(".drop-line")].map((d, idx) => {
                  const img = d.querySelector("img");
                  const dBox = d.querySelector(".mini-icon");
                  return {
                    kind: d.dataset.dropLine === "currency" ? (idx === 0 ? "primary" : "secondary") : d.dataset.dropLine,
                    currencyId: d.dataset.currencyId || null,
                    dropExpected: d.dataset.dropExpected || null,
                    num: d.dataset.num || null,
                    material: (d.querySelector(".drop-material") || {}).textContent || null,
                    value: (d.querySelector(".drop-value") || {}).textContent || null,
                    imgSrc: img ? img.getAttribute("src") : null,
                    imgW: img ? img.naturalWidth : 0,
                    boxH: dBox ? dBox.offsetHeight : 0,
                    imgH: img ? img.offsetHeight : 0,
                  };
                }),
                inputs: [...c.querySelectorAll("input")].map((i) => ({
                  id: i.id,
                  type: i.type,
                  readOnly: i.readOnly,
                  displayClass: i.classList.contains("eshop-require-display"),
                  label: (() => {
                    const box = i.closest(".material-input-box");
                    const l = box ? box.querySelector(".material-input-box-label") : null;
                    return l ? l.textContent : null;
                  })(),
                })),
                text: visibleParts.join(" "),
                imgSrc: hImg ? hImg.getAttribute("src") : null,
                imgW: hImg ? hImg.naturalWidth : 0,
                borderColor: getComputedStyle(c).borderTopColor,
                badgeCount: c.querySelectorAll(".icon-fallback").length,
              };
            }),
          }
        : null;
      const resultsCard = document.querySelector("#results .results-card");
      const farmResultsEl = resultsCard ? resultsCard.querySelector(".farm-res-quests") : null;
      const farmEmptyEl = resultsCard ? resultsCard.querySelector(".farm-res-empty") : null;
      const farmResults =
        farmResultsEl || farmEmptyEl
          ? {
              title: (resultsCard.querySelector(".card-title") || {}).textContent?.trim() || null,
              empty: farmEmptyEl ? farmEmptyEl.textContent : null,
              plays: farmResultsEl
                ? [...farmResultsEl.querySelectorAll(".farm-card")].map((c) => {
                    const nameEl = c.querySelector(".farm-quest-name");
                    const img = c.querySelector(".farm-card-icon img");
                    const textEl = nameEl && nameEl.querySelector(".farm-quest-name-text");
                    return {
                      tier: c.dataset.tier || null,
                      questName: (textEl || nameEl || {}).textContent || null,
                      count: (c.querySelector(".farm-res-play-count") || {}).textContent || null,
                      label: (c.querySelector(".farm-res-play-label") || {}).textContent || null,
                      iconAlt: img ? img.getAttribute("alt") : null,
                    };
                  })
                : [],
            }
          : null;
      return {
        tiers,
        quests,
        results,
        farmResults,
        select,
        farm,
        storage: localStorage.getItem("fgo_event_shop_data"),
        legacyStorage: localStorage.getItem("fgo_calculator_data"),
        activeTab: (document.querySelector(".tab-btn.active") || {}).dataset?.tab || null,
        polluted: Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"),
      };
    });

  /* Amendment C: all 9 icon containers read the same way in both modes — how many imgs, how many
     tier-colour badges, what the badge shows. Empty containers in markup means either the fallback
     builder ran (stub) or hydration replaced it (event); anything else is a defect. */
  const readIconBoxes = () =>
    page.evaluate((ids) => {
      const out = {};
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) {
          out[id] = null;
          continue;
        }
        const badges = [...el.querySelectorAll(".icon-fallback")];
        const imgs = [...el.querySelectorAll("img")];
        const b = badges[0];
        out[id] = {
          childCount: el.children.length,
          imgCount: imgs.length,
          badgeCount: badges.length,
          imgSrcs: imgs.map((i) => i.getAttribute("src")),
          imgW: imgs.map((i) => i.naturalWidth),
          badgeText: b ? b.textContent : null,
          badgeBg: b ? getComputedStyle(b).backgroundColor : null,
          badgeW: b ? b.offsetWidth : 0,
          badgeH: b ? b.offsetHeight : 0,
          boxW: el.offsetWidth,
          boxH: el.offsetHeight,
          boxBg: getComputedStyle(el).backgroundColor,
          eventClass: el.classList.contains("material-icon--event"),
        };
      }
      return out;
    }, ICON_CONTAINERS);

  /* Stub mode contract: one tier-colour letter badge, zero imgs, in every container. */
  const assertStubBadges = (boxes, label) => {
    for (const id of ICON_CONTAINERS) {
      const box = boxes[id];
      const tier = CONTAINER_TIER[id];
      if (!box) {
        errors.push(`${label}: #${id} is missing from the document — Amendment C keeps every icon id`);
        continue;
      }
      if (box.imgCount !== 0)
        errors.push(
          `${label}: #${id} shows ${box.imgCount} img(s) ${JSON.stringify(box.imgSrcs)}, want 0 — the generic material mockup is deleted`,
        );
      if (box.badgeCount !== 1 || box.childCount !== 1)
        errors.push(
          `${label}: #${id} holds ${box.childCount} child node(s), ${box.badgeCount} .icon-fallback badge(s), want exactly 1 badge (buildTierFallback never ran or left residue)`,
        );
      const want = BADGE_WANT[tier];
      if (box.badgeText !== want.letter)
        errors.push(
          `${label}: #${id} badge letter is ${JSON.stringify(box.badgeText)}, want ${JSON.stringify(want.letter)} (TIER_COLORS key "${tier}")`,
        );
      if (box.badgeBg !== want.bg)
        errors.push(
          `${label}: #${id} badge background is ${JSON.stringify(box.badgeBg)}, want ${want.bg} = TIER_COLORS.${tier}`,
        );
      if (!(box.badgeW > 0 && box.badgeH > 0))
        errors.push(
          `${label}: #${id} badge collapsed to ${box.badgeW}×${box.badgeH}px — the .icon-fallback CSS is gone`,
        );
      if (box.badgeCount === 1 && (Math.abs(box.badgeW - box.boxW) > 2 || Math.abs(box.badgeH - box.boxH) > 2))
        errors.push(
          `${label}: #${id} badge is ${box.badgeW}×${box.badgeH}px in a ${box.boxW}×${box.boxH}px box, want it to fill the box`,
        );
      /* K1/27bb180: the tier icon containers are the 96px material-icon; the quest spans the 64px mini-icon */
      const wantH = TIERS.includes(tier) && id.endsWith("Icon") ? 96 : 64;
      if (Math.abs(box.boxH - wantH) > 1)
        errors.push(`${label}(K1/K3): #${id} container is ${box.boxH}px tall, want ${wantH}px`);
    }
  };

  /* Event mode contract: the badge is replaced by currency art in the same tick, so no container
     may still hold one, and each must hold exactly one img of the mapped currency's file. Decode is
     demanded only where the user can see the art — Amendment D hides #questDropsGrid, and Chrome
     never fetches a display:none lazy img, so the hidden spans pin hydration, not pixels. */
  const assertEventBoxes = (boxes, label, wantCurrencies) => {
    for (const id of ICON_CONTAINERS) {
      const box = boxes[id];
      const tier = CONTAINER_TIER[id];
      const currency = wantCurrencies.find((c) => c.background === tier);
      if (!currency) continue; // unmapped tier: the badge contract (stub assert) owns it
      if (!box) {
        errors.push(`${label}: #${id} is missing from the document`);
        continue;
      }
      if (box.badgeCount !== 0)
        errors.push(
          `${label}: #${id} still shows ${box.badgeCount} fallback badge(s) in event mode — hydration did not replace it (${JSON.stringify(box.badgeText)})`,
        );
      if (box.imgCount !== 1)
        errors.push(
          `${label}: #${id} holds ${box.imgCount} img(s) ${JSON.stringify(box.imgSrcs)}, want the single event currency art`,
        );
      const wantFile = `event_shop/${currency.icon.split("/").pop()}`;
      if (!box.imgSrcs.some((s) => (s || "").includes(wantFile)))
        errors.push(`${label}: #${id} img srcs ${JSON.stringify(box.imgSrcs)}, want ${wantFile}`);
    }
  };

  /* Amendment C absence pins, identical in both modes. */
  const assertMaterialAbsence = (label) => {
    if (materialRequests.length)
      errors.push(
        `${label}: ${materialRequests.length} request(s) asked for the deleted material mockup — ${JSON.stringify(materialRequests.slice(0, 3))}`,
      );
    if (httpFailures.length)
      errors.push(
        `${label}: ${httpFailures.length} HTTP response(s) >= 400 — ${JSON.stringify(httpFailures.slice(0, 3))}`,
      );
  };

  /* The static skeleton: dead card surfaces must not exist, the modal chrome must, and the first
     card of #panel-event is now the Event Select card (Amendment G) with the calculator second. */
  const readPage = () =>
    page.evaluate(
      (deadIds, deadSel) => {
        const ids = {};
        for (const id of deadIds) ids[id] = !!document.getElementById(id);
        const panel = document.getElementById("panel-event");
        const cards = [...panel.querySelectorAll(":scope > .card")];
        const titles = cards.map(
          (c) =>
            (
              c.querySelector(":scope > .card-inner > .card-title") ||
              c.querySelector(".card-title") ||
              {}
            ).textContent?.trim() || null,
        );
        return {
          deadIds: ids,
          deadClassCount: document.querySelectorAll(deadSel).length,
          firstCardId: cards[0] ? cards[0].id : null,
          firstCardTitle: titles[0] || null,
          secondCardTitle: titles[1] || null,
          cardTitles: titles,
          orderTitles: [...panel.querySelectorAll(".card-inner > .card-title")].map((e) =>
            e.textContent.trim(),
          ),
          calc: (() => {
            const b = document.getElementById("calculateBtn");
            if (!b) return null;
            const a = b.parentElement;
            const inner = a ? a.closest(".card-inner") : null;
            if (!inner) return { actions: a ? a.className : null, last: false, card: null };
            const t = inner.querySelector(":scope > .card-title");
            return { actions: a.className, last: a === inner.lastElementChild, card: t ? t.textContent.trim() : null };
          })(),
          selectCardHasSelect: !!(cards[0] && cards[0].querySelector("#eventSelect")),
          modalPresent: !!document.getElementById("eventShopModal"),
          modalList: !!document.getElementById("eventShopModalList"),
          footerBtns: ["Default", "SelectAll", "Cancel", "Done"].map(
            (n) => !!document.getElementById(`eventShopModal${n}Btn`),
          ),
          closeBtn: !!document.getElementById("eventShopModalClose"),
          calculatorBtn: !!document.getElementById("calculateBtn"),
          questRows: document.querySelectorAll("#questGrid > *").length,
          anyRequireInputsOnPage: document.querySelectorAll(
            "#panel-event .eshop-require-input, #panel-event .eshop-step-btn",
          ).length,
        };
      },
      DEAD_IDS,
      DEAD_CLASS_SELECTOR,
    );

  const readModal = () =>
    page.evaluate(() => {
      const modal = document.getElementById("eventShopModal");
      return {
        open: modal.classList.contains("open"),
        title: (document.getElementById("eventShopModalTitle") || {}).textContent || "",
        rows: [...document.querySelectorAll("#eventShopModalList .eshop-item")].map((row) => {
          const input = row.querySelector(".eshop-require-input");
          const icon = row.querySelector(".eshop-item-icon-wrap > *");
          return {
            id: row.getAttribute("data-item-id"),
            value: input ? input.value : null,
            max: input ? input.getAttribute("max") : null,
            ariaLabel: input ? input.getAttribute("aria-label") : null,
            total: (row.querySelector(".eshop-item-total") || {}).textContent || "",
            active: row.classList.contains("eshop-item--active"),
            meta: (row.querySelector(".eshop-item-meta") || {}).textContent || "",
            name: (row.querySelector(".eshop-item-name") || {}).textContent || "",
            minusLabel:
              (row.querySelector('.eshop-step-btn[data-step="-1"]') || {}).getAttribute?.("aria-label") || null,
            plusLabel: (row.querySelector('.eshop-step-btn[data-step="1"]') || {}).getAttribute?.("aria-label") || null,
            iconKind: icon ? (icon.tagName === "IMG" ? "img" : "fallback") : null,
            iconSrc: icon && icon.tagName === "IMG" ? icon.getAttribute("src") : null,
            iconW: icon && icon.tagName === "IMG" ? icon.naturalWidth : null,
            iconText: icon && icon.tagName !== "IMG" ? icon.textContent : null,
          };
        }),
        displaySpans: document.querySelectorAll("#eventShopModalList .eshop-require-display").length,
      };
    });

  /* CSSOM evidence for the hover cue — headless Chrome reports (hover: hover) = false and CDP
     cannot flip it, so the RULE is the pin; the :focus flip is additionally tested live. */
  const readCssCues = () =>
    page.evaluate(() => {
      const decl = (rule, props) => {
        const out = {};
        for (const p of props) out[p] = rule.style.getPropertyValue(p);
        return out;
      };
      const out = {
        hover: null,
        focus: null,
        requireBase: null,
        iconBase: null,
        iconEvent: null,
        iconFg: null,
        farmFallback: null,
        farmGrid: null,
        farmGridMedia: 0,
        farmTitle: null,
        farmTitleCues: 0,
        farmTitleFg: null,
        dropLine: null,
        btnActions: null,
        btnSmall: null,
      };
      const walk = (rules, mediaText) => {
        for (const r of rules) {
          if (r.media) {
            walk(r.cssRules, r.conditionText || "");
            continue;
          }
          if (r.cssRules && !r.selectorText) {
            walk(r.cssRules, mediaText);
            continue;
          }
          if (!r.selectorText) continue;
          const s = r.selectorText.replace(/\s+/g, "");
          if (s === "input.eshop-require-display:hover" && /hover:\s*hover/.test(mediaText))
            out.hover = {
              media: mediaText,
              decl: decl(r, ["border-style", "border-color", "background", "background-color"]),
            };
          if (s === "input.eshop-require-display:focus") out.focus = { decl: decl(r, ["border-style"]) };
          if (s === "input.eshop-require-display")
            out.requireBase = {
              decl: decl(r, [
                "border-style",
                "cursor",
                "user-select",
                "min-height",
                "height",
                "width",
                "padding",
                "font-size",
                "display",
              ]),
            };
          if (s === ".material-icon")
            out.iconBase = { decl: decl(r, ["background", "background-color", "height"]) };
          if (s === ".material-icon--event") out.iconEvent = { decl: decl(r, ["background", "background-color"]) };
          if (s === ".material-icon.fg-layer") out.iconFg = { decl: decl(r, ["width", "height"]) };
          if (s === ":where(.farm-card)") out.farmFallback = { decl: decl(r, ["--tier-color", "--tier-text"]) };
          if (s === ".farm-grid") {
            if (mediaText) out.farmGridMedia++;
            else out.farmGrid = { decl: decl(r, ["display", "grid-template-columns", "justify-content"]) };
          }
          if (s === ".farm-card-title") out.farmTitle = { decl: decl(r, ["cursor"]) };
          if (/farm-card-title(?![\w .-])/.test(s) && /(?::hover|:focus)/.test(s)) out.farmTitleCues++;
          if (s === ".farm-card-icon.fg-layer") out.farmTitleFg = { decl: decl(r, ["width", "height"]) };
          if (s === ".farm-card.drop-line.mini-icon") out.dropLine = { decl: decl(r, ["height"]) };
          if (s === ".bond-card-actions.calculate-btn") {
            if (/width\s*<\s*380/.test(mediaText)) out.btnSmall = { decl: decl(r, ["width"]) };
            else out.btnActions = { decl: decl(r, ["width"]) };
          }
        }
      };
      for (const sheet of document.styleSheets) {
        try {
          walk(sheet.cssRules, "");
        } catch {
          /* cross-origin sheets are unreadable; the shipped CSS is inline, so this never fires */
        }
      }
      return out;
    });

  /* Asserts the committed plan against the reference plan through the tier boxes, the planner
     storage blob (Amendment G shape) and the legacy calculator mirror. */
  const assertPlan = (tierState, expected, label, snapshot = EACTIVE) => {
    const want = refTotals(snapshot.items, snapshot.currencies, expected);
    if (tierState.activeTab && tierState.activeTab !== "event") {
      errors.push(
        `${label}: the active tab is ${JSON.stringify(tierState.activeTab)} — a modal gesture moved the user off the Event tab`,
      );
    }
    for (const currency of snapshot.currencies) {
      const tier = tierOfCurrency(currency);
      const t = tierState.tiers[tier];
      if (!t) continue; // a tier the boxes do not own (no card) is asserted nowhere else
      if (t.needValue !== String(want[String(currency.id)])) {
        errors.push(
          `${label}: ${tier} Required reads ${JSON.stringify(t.needValue)}, want ${want[String(currency.id)]}`,
        );
      }
      if (want[String(currency.id)] !== 0 && !t.needReadOnly) {
        errors.push(`${label}: ${tier} Required lost its read-only flag with a live plan`);
      }
    }
    if (tierState.legacyStorage) {
      try {
        const saved = JSON.parse(tierState.legacyStorage);
        for (const currency of snapshot.currencies) {
          const tier = tierOfCurrency(currency);
          if (saved[`${tier}Need`] !== want[String(currency.id)]) {
            errors.push(
              `${label}: legacy state ${tier}Need is ${saved[`${tier}Need`]}, plan says ${want[String(currency.id)]}`,
            );
          }
        }
      } catch {
        /* the legacy blob format is the calculator's own business; the DOM pin above already ran */
      }
    }
    return want;
  };

  /* Amendment G storage: { selectedEventId, plans: { [eventId]: { requires, held, bonus } } }. */
  const assertStorage = (raw, expected, label, { eventId = ACTIVE_ID, exact = false } = {}) => {
    const stored = raw ? JSON.parse(raw) : null;
    if (!stored) {
      errors.push(`${label}: storage blob missing`);
      return null;
    }
    if (stored.selectedEventId !== eventId)
      errors.push(`${label}: stored selectedEventId ${JSON.stringify(stored.selectedEventId)}, want ${eventId}`);
    if (!stored.plans || typeof stored.plans !== "object" || Array.isArray(stored.plans)) {
      errors.push(`${label}: storage plans map missing — ${JSON.stringify(stored.plans)}`);
      return stored;
    }
    for (const key of Object.keys(stored.plans)) {
      if (!EVENTS.some((e) => String(e.event.id) === key))
        errors.push(`${label}: storage holds plan for unknown event ${key}`);
    }
    const plan = stored.plans[String(eventId)] || {};
    for (const field of ["requires", "held", "bonus"]) {
      if (plan[field] !== undefined && (typeof plan[field] !== "object" || plan[field] === null))
        errors.push(`${label}: plans[${eventId}].${field} is not an object — ${JSON.stringify(plan[field])}`);
    }
    const req = plan.requires || {};
    for (const [id, value] of Object.entries(expected)) {
      if ((req[id] ?? 0) !== value)
        errors.push(`${label}: storage row ${id} is ${JSON.stringify(req[id])}, want ${value}`);
    }
    for (const [id, value] of Object.entries(req)) {
      if (value !== 0 && !(id in expected))
        errors.push(`${label}: storage holds unplanned row ${id} = ${JSON.stringify(value)}`);
      if (!byId.has(id)) errors.push(`${label}: storage holds item id ${id} the selected event never sold`);
    }
    if (exact) {
      const wantKeys = Object.keys(expected)
        .filter((k) => expected[k] !== 0)
        .sort()
        .join();
      const gotKeys = Object.keys(req)
        .filter((k) => req[k] !== 0)
        .sort()
        .join();
      if (wantKeys !== gotKeys) errors.push(`${label}: storage nonzero keys ${gotKeys}, want ${wantKeys}`);
    }
    return stored;
  };

  const typeInto = async (inputSel, text) => {
    await page.focus(inputSel);
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(text, { delay: 12 });
    const typed = await page.evaluate((s) => {
      const el = document.querySelector(s);
      return el ? { value: el.value, focused: document.activeElement === el } : { value: null, focused: false };
    }, inputSel);
    if (typed.value !== text) {
      errors.push(
        `harness typing: typed "${text}" into ${inputSel}, the input reads ${JSON.stringify(typed.value)} (focused=${typed.focused})`,
      );
    }
  };

  const modalGate = async (wantOpen, label) => {
    try {
      await page.waitForFunction(
        (o) => document.getElementById("eventShopModal").classList.contains("open") === o,
        { timeout: 5000 },
        wantOpen,
      );
      return true;
    } catch {
      errors.push(`${label}: #eventShopModal never became open=${wantOpen}`);
      return false;
    }
  };
  const openTierModal = async (tier, label) => {
    await safeClick(sel.tierNeed(tier));
    return modalGate(true, label || `open modal from ${tier} Required`);
  };
  const closeBy = async (via, label) => {
    if (via === "Escape") await page.keyboard.press("Escape");
    else if (via === "Cancel") await safeClick("#eventShopModalCancelBtn");
    else if (via === "X") await safeClick("#eventShopModalClose");
    else if (via === "backdrop") {
      const pt = await page.evaluate(() => {
        const modal = document.getElementById("eventShopModal");
        const content = modal.querySelector(".servant-modal-content");
        const mr = modal.getBoundingClientRect();
        const cr = content.getBoundingClientRect();
        const x = Math.round(cr.left - 12);
        const y = Math.round((mr.top + mr.bottom) / 2);
        const hit = x >= mr.left && document.elementFromPoint(x, y);
        return { x, y, onModal: hit === modal };
      });
      if (pt.onModal) await page.mouse.click(pt.x, pt.y);
      else {
        console.log(
          `NOTE: backdrop has no visible strip at this viewport — dispatching mousedown on the modal itself (same event target the browser would use)`,
        );
        await page.evaluate(() => {
          const m = document.getElementById("eventShopModal");
          m.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        });
      }
    } else errors.push(`harness: unknown modal close "${via}"`);
    await modalGate(false, label || `close modal via ${via}`);
  };
  const clickDone = async () => {
    await safeClick("#eventShopModalDoneBtn");
    await modalGate(false, "Done closes the modal");
    await wait(SETTLE_MS);
  };

  /* Amendment G: switch the working event through the real select control (fires change). */
  const switchEvent = async (eventId, label) => {
    await page.select("#eventSelect", String(eventId));
    await wait(SETTLE_MS);
    const st = await page.evaluate(() => {
      const s = document.getElementById("eventSelect");
      return { value: s ? s.value : null, disabled: s ? s.disabled : null };
    });
    if (st.value !== String(eventId))
      errors.push(`${label}: #eventSelect value is ${JSON.stringify(st.value)} after selecting ${eventId}`);
  };

  const seedStorage = async (raw) => {
    await page.evaluate(
      (k, value) => {
        if (value === null) localStorage.removeItem(k);
        else localStorage.setItem(k, value);
      },
      KEY,
      raw,
    );
  };
  const resetPlan = async () => {
    await page.evaluate(
      (k, lk) => {
        localStorage.removeItem(k);
        localStorage.removeItem(lk);
      },
      KEY,
      STORAGE_KEY,
    );
    await page.reload({ waitUntil: "networkidle0" });
    await ensureEventTab();
    await wait(SETTLE_MS);
  };
  const seedAndReload = async (raw) => {
    await seedStorage(raw);
    await page.reload({ waitUntil: "networkidle0" });
    await ensureEventTab();
    await wait(SETTLE_MS);
  };
  async function ensureEventTab() {
    const visible = () =>
      page.evaluate(() => {
        const need = document.getElementById("goldNeed");
        return {
          hasNeed: !!need,
          displayClass: need ? need.classList.contains("eshop-require-display") : null,
          activeTab: (document.querySelector(".tab-btn.active") || {}).dataset?.tab || null,
          panelShown: getComputedStyle(document.getElementById("panel-event")).display !== "none",
          selectReady: !!document.querySelector("#eventSelect option"),
        };
      });
    let st = await visible();
    /* main.js warms the Event tab while idle; a user only reaches the tier cards through the tab
       button, and the gate has to take that same route. Readiness = hydrated tier surface. */
    const ready = (s) =>
      s.hasNeed &&
      s.activeTab === "event" &&
      s.panelShown &&
      s.selectReady &&
      (LEGACY ? s.displayClass === false : s.displayClass === true);
    if (!ready(st)) {
      await safeClick('.tab-btn[data-tab="event"]');
      try {
        await page.waitForFunction(
          (legacy) => {
            const need = document.getElementById("goldNeed");
            if (!need) return false;
            const hasClass = need.classList.contains("eshop-require-display");
            return (
              document.querySelector(".tab-btn.active")?.dataset.tab === "event" &&
              getComputedStyle(document.getElementById("panel-event")).display !== "none" &&
              !!document.querySelector("#eventSelect option") &&
              (legacy ? !hasClass : hasClass)
            );
          },
          { timeout: 15000 },
          LEGACY,
        );
      } catch {
        /* falls through to the read below, which reports it */
      }
      st = await visible();
    }
    if (!ready(st)) {
      errors.push(
        `planner tab: the Event tab is not the visible/hydrated panel (${JSON.stringify(st)}, eventMode=${!LEGACY}) — nothing in the shop UI is reachable`,
      );
    }
    return st;
  }

  /* install a counting / throwing spy over localStorage for the planner key only */
  const installWriteSpy = (opts = {}) =>
    page.evaluate(
      async (k, throwIt) => {
        if (!self.__nativeSetItem) self.__nativeSetItem = Storage.prototype.setItem;
        const native = self.__nativeSetItem;
        self.__eshopWrites = [];
        Storage.prototype.setItem = function (key, value) {
          if (key === k) {
            self.__eshopWrites.push(value);
            if (throwIt) throw new DOMException("exceeded the quota", "QuotaExceededError");
          }
          return native.apply(this, arguments);
        };
      },
      KEY,
      !!opts.throw,
    );
  const uninstallWriteSpy = () =>
    page.evaluate(() => {
      Storage.prototype.setItem = self.__nativeSetItem;
      delete self.__eshopWrites;
    });
  const writeCount = () => page.evaluate(() => self.__eshopWrites.length);

  await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate(
    (k, lk) => {
      localStorage.removeItem(k);
      localStorage.removeItem(lk);
    },
    KEY,
    STORAGE_KEY,
  );
  await page.reload({ waitUntil: "networkidle0" });

  if (LEGACY) {
    /* ================= LEGACY FALLBACK (stub snapshot: events emptied, patched bundle) ========= */
    const t0 = Date.now();
    await ensureEventTab();
    console.log(`NOTE: legacy mode — tab ready in ${Date.now() - t0}ms`);
    const pg = await readPage();
    const survivors = DEAD_IDS.filter((id) => pg.deadIds[id]);
    if (survivors.length) errors.push(`legacy: planner card ids still present ${JSON.stringify(survivors)}`);
    if (pg.deadClassCount) errors.push(`legacy: ${pg.deadClassCount} dead card-class node(s) in the document`);
    if (pg.firstCardId !== "eventSelectCard" || pg.firstCardTitle !== "Select Event")
      errors.push(
        `legacy: first card is ${JSON.stringify([pg.firstCardId, pg.firstCardTitle])}, want ["eventSelectCard","Select Event"] — the card ships regardless of events`,
      );
    if (pg.secondCardTitle !== "Drop Rates per Run")
      errors.push(`legacy(K4): second card title is ${JSON.stringify(pg.secondCardTitle)}, want "Drop Rates per Run"`);
    if (JSON.stringify(pg.orderTitles) !== JSON.stringify(["Select Event", "Drop Rates per Run", "Shop Requirements", "Items Needed"]))
      errors.push(`legacy(K4): card order is ${JSON.stringify(pg.orderTitles)}, want Select Event → Drop Rates per Run → Shop Requirements → Items Needed`);
    if (!pg.calc || pg.calc.actions !== "bond-card-actions bond-card-actions--end" || !pg.calc.last || pg.calc.card !== "Shop Requirements")
      errors.push(`legacy(K5): #calculateBtn placement wrong — ${JSON.stringify(pg.calc)}, want LAST child of the Shop Requirements .bond-card-actions--end`);
    if (!pg.modalPresent || !pg.modalList)
      errors.push("legacy: #eventShopModal markup is static and must ship regardless of data");

    /* zero events → the select is a single DISABLED "No active event" option, nothing else */
    const tier0 = await readTier();
    const st = tier0.select;
    if (!st) errors.push("legacy: #eventSelect is missing — the Event Select card must always render");
    else {
      if (!st.disabled) errors.push("legacy: #eventSelect is enabled with zero events — nothing is selectable");
      if (st.options.length !== 1 || st.options[0].text !== "No active event" || !st.options[0].disabled)
        errors.push(`legacy: select options are ${JSON.stringify(st.options)}, want one disabled "No active event"`);
    }

    /* Amendment D stub chrome: the legacy card is the page as it was — base-row + quest grid
       visible, #farmGrid hidden and EMPTY (hydrateFarmGrid is event-mode only), title untouched. */
    const farm0 = tier0.farm;
    if (!farm0) errors.push("legacy: #farmGrid or its card vanished from the static markup");
    else {
      if (farm0.gridDisplay !== "none")
        errors.push(
          `legacy: #farmGrid display is ${farm0.gridDisplay}, want none — the farm cards are event-mode only`,
        );
      if (farm0.cards.length !== 0)
        errors.push(`legacy: #farmGrid holds ${farm0.cards.length} farm card(s) under a stub, want 0`);
      if (farm0.baseDisplay === "none")
        errors.push("legacy: the base/primary/secondary row is hidden — the stub must show the legacy calculator");
      if (farm0.questDisplay === "none")
        errors.push("legacy: #questDropsGrid is hidden — the stub must show the legacy drop grid");
      if (farm0.title !== "Drop Rates per Run")
        errors.push(`legacy: drop-rate card title is ${JSON.stringify(farm0.title)}, want "Drop Rates per Run"`);
    }

    for (const t of TIERS) {
      const td = tier0.tiers[t];
      if (td.needValue !== "0")
        errors.push(`legacy: ${t} Required reads ${JSON.stringify(td.needValue)} at cold start, want "0"`);
      if (td.needReadOnly !== false)
        errors.push(`legacy: ${t} Required is readOnly — the editable field must survive a stub snapshot`);
      if (td.needDisplayClass) errors.push(`legacy: ${t} Required carries the eshop-require-display class`);
      if (td.needHaspopup !== null) errors.push(`legacy: ${t} Required has aria-haspopup=${td.needHaspopup}`);
      if (td.needBox.borderStyle !== "solid")
        errors.push(
          `legacy: ${t} Required border-style is ${td.needBox.borderStyle}, want solid (no dashed display cue)`,
        );
      if (td.iconEventClass)
        errors.push(`legacy: ${t} icon box carries material-icon--event — the transparent override is event-mode only`);
      if (td.iconBoxBg !== "rgba(0, 0, 0, 0)")
        errors.push(
          `legacy(K1): ${t} icon box paints ${td.iconBoxBg} — the grey #e5e7eb base plate was deleted by Amendment K; the badge carries the colour`,
        );
      if (td.iconBoxH !== 96)
        errors.push(`legacy(K1): ${t} icon box is ${td.iconBoxH}px tall, want the 96px tier icon`);
      if (td.name !== t.charAt(0).toUpperCase() + t.slice(1))
        errors.push(`legacy: ${t} card name is ${JSON.stringify(td.name)}`);
      if (td.imgs.length)
        errors.push(
          `legacy: ${t} icon box shows ${td.imgs.length} img(s) ${JSON.stringify(td.imgs.map((i) => i.src || ""))}, want 0 — the material mockup must not come back`,
        );
      if (!td.badge)
        errors.push(`legacy: ${t} icon box has no .icon-fallback badge — buildTierFallback never ran on it`);
      if (!(td.needBox.h > 0) || td.needBox.h !== td.heldBox.h || td.needBox.h !== td.bonusBox.h)
        errors.push(
          `legacy: ${t} box heights differ — need ${td.needBox.h} held ${td.heldBox.h} bonus ${td.bonusBox.h}`,
        );
      const before = td.needValue;
      await page.focus(sel.tierNeed(t));
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.press("Digit7");
      await wait(SETTLE_MS);
      const after = (await readTier()).tiers[t].needValue;
      if (after !== "7")
        errors.push(
          `legacy: typing into ${t} Required left it at ${JSON.stringify(after)} (was ${JSON.stringify(before)}), want editable "7"`,
        );
    }
    /* a stub snapshot maps no currency: clicking a Required must NOT open the modal */
    await safeClick("#bronzeNeed");
    await wait(SETTLE_MS);
    if ((await readModal()).open)
      errors.push("legacy: clicking a tier Required opened the currency modal — no currency is mapped under a stub");
    await page.focus("#goldNeed");
    await page.keyboard.press("Enter");
    await wait(SETTLE_MS);
    if ((await readModal()).open) errors.push("legacy: Enter on a stub Required opened the modal");

    const boxes = await readIconBoxes();
    assertStubBadges(boxes, "legacy");
    assertMaterialAbsence("legacy");
    for (const [quest, drops] of Object.entries(QUEST_DROPS)) {
      const qd = tier0.quests[quest];
      const wantTitle = `${quest.charAt(0).toUpperCase() + quest.slice(1)} Quest`;
      if (qd.title !== wantTitle)
        errors.push(`legacy: ${quest} quest title is ${JSON.stringify(qd.title)}, want ${JSON.stringify(wantTitle)}`);
      for (const m of [drops.primary, drops.secondary]) {
        const icon = qd.icons[m];
        if (!icon) {
          errors.push(`legacy: ${quest}Quest_${m}_icon span is missing from the document`);
          continue;
        }
        if (icon.imgCount !== 0 || icon.img)
          errors.push(
            `legacy: ${quest}Quest_${m}_icon shows ${JSON.stringify(icon.img && icon.img.src)}, want no img — the material mockup is deleted`,
          );
        if (!icon.badge)
          errors.push(`legacy: ${quest}Quest_${m}_icon has no .icon-fallback badge — loadQuestIcons never filled it`);
      }
    }
    console.log(
      `NOTE: legacy stub badges ${ICON_CONTAINERS.filter((id) => boxes[id] && boxes[id].badgeCount === 1).length}/${ICON_CONTAINERS.length}, stub imgs in boxes ${ICON_CONTAINERS.reduce((n, id) => n + (boxes[id] ? boxes[id].imgCount : 0), 0)}, icons/materials requests ${materialRequests.length}, >=400 responses ${httpFailures.length}`,
    );
    if (!pg.calculatorBtn || !pg.questRows)
      errors.push("legacy: the tier/run calculator is broken next to the stub planner");

    /* OLD math + OLD persistence: needs typed above (7×3 editable pins), reset then run the legacy
       model through the boxes it owns. The farm plan ("—" / "· AP" labels) must never appear. */
    await page.evaluate(
      (k, lk) => {
        localStorage.removeItem(k);
        localStorage.removeItem(lk);
      },
      KEY,
      STORAGE_KEY,
    );
    await page.reload({ waitUntil: "networkidle0" });
    await ensureEventTab();
    await typeInto("#bronzeNeed", "100");
    await safeClick("#calculateBtn");
    await wait(SETTLE_MS);
    const legacyRun = await readTier();
    if (legacyRun.results.bronze.deficit !== "100")
      errors.push(`legacy math: bronze deficit reads ${JSON.stringify(legacyRun.results.bronze.deficit)}, want "100"`);
    if (!/^\d+$/.test(legacyRun.results.bronze.play || ""))
      errors.push(
        `legacy math: bronze runs is ${JSON.stringify(legacyRun.results.bronze.play)} — the legacy calcOptimalRuns path (an integer per tier) must answer, not the farm "—"`,
      );
    for (const t of TIERS) {
      const label = legacyRun.results[t].label || "";
      if (/AP|—|No drop data yet/.test(label))
        errors.push(
          `legacy math: ${t} label is ${JSON.stringify(label)} — stub mode must keep the plain run/runs wording`,
        );
      if (legacyRun.results[t].deficitLabel !== t.charAt(0).toUpperCase() + t.slice(1))
        errors.push(
          `legacy math: ${t} deficit label is ${JSON.stringify(legacyRun.results[t].deficitLabel)}, want the tier word under a stub`,
        );
      if (legacyRun.results[t].questName !== `${t.charAt(0).toUpperCase() + t.slice(1)} Quest`)
        errors.push(
          `legacy math: ${t} quest-name is ${JSON.stringify(legacyRun.results[t].questName)}, want the legacy quest wording`,
        );
    }
    if (legacyRun.storage !== null)
      errors.push(
        `legacy math: the planner key was written under a stub (${JSON.stringify(legacyRun.storage && legacyRun.storage.slice(0, 60))}) — legacy mode must use the OLD blob only`,
      );
    const legacyBlob = legacyRun.legacyStorage ? JSON.parse(legacyRun.legacyStorage) : null;
    if (!legacyBlob || legacyBlob.bronzeNeed !== 100 || typeof legacyBlob.baseDrop !== "number")
      errors.push(
        `legacy math: fgo_calculator_data is ${JSON.stringify(legacyRun.legacyStorage)} — want the old Persistence blob with bronzeNeed 100`,
      );

    if (pageErrors.length) for (const e of pageErrors) errors.push(`legacy pageerror: ${e}`);
    if (consoleErrors().length) errors.push(`legacy console errors: ${JSON.stringify(consoleErrors().slice(0, 3))}`);
    if (externalHosts.size) errors.push(`legacy: external origins ${JSON.stringify([...externalHosts])}`);
  } else {
    /* ================= 1. Amendment G structure: Select Event first, modal chrome static ======== */
    await ensureEventTab();

    const pg = await readPage();
    const survivors = DEAD_IDS.filter((id) => pg.deadIds[id]);
    if (survivors.length)
      errors.push(`card absence: these planner-card ids still exist in the document ${JSON.stringify(survivors)}`);
    if (pg.deadClassCount)
      errors.push(`card absence: ${pg.deadClassCount} node(s) still carry dead card classes (${DEAD_CLASS_SELECTOR})`);
    if (pg.firstCardId !== "eventSelectCard" || pg.firstCardTitle !== "Select Event" || !pg.selectCardHasSelect)
      errors.push(
        `select card: first card of #panel-event is ${JSON.stringify([pg.firstCardId, pg.firstCardTitle, pg.selectCardHasSelect])}, want ["eventSelectCard","Select Event",true]`,
      );
    if (pg.secondCardTitle !== "Drop Rates per Run")
      errors.push(
        `select card(K4): the farm card must follow the select — second title ${JSON.stringify(pg.secondCardTitle)}`,
      );
    if (JSON.stringify(pg.orderTitles) !== JSON.stringify(["Select Event", "Drop Rates per Run", "Shop Requirements", "Items Needed"]))
      errors.push(
        `select card(K4): card order is ${JSON.stringify(pg.orderTitles)}, want Select Event → Drop Rates per Run → Shop Requirements → Items Needed`,
      );
    if (!pg.calc || pg.calc.actions !== "bond-card-actions bond-card-actions--end" || !pg.calc.last || pg.calc.card !== "Shop Requirements")
      errors.push(
        `btn(K5): #calculateBtn placement wrong — ${JSON.stringify(pg.calc)}, want LAST child of the Shop Requirements .bond-card-actions--end`,
      );
    if (!pg.modalPresent || !pg.modalList)
      errors.push("modal chrome: #eventShopModal / #eventShopModalList missing from static markup");
    if (pg.footerBtns.some((b) => !b))
      errors.push(
        `modal chrome: footer buttons present ${JSON.stringify(pg.footerBtns)}, want Default/SelectAll/Cancel/Done`,
      );
    if (!pg.closeBtn) errors.push("modal chrome: #eventShopModalClose missing");
    if (pg.anyRequireInputsOnPage)
      errors.push(
        `card absence: ${pg.anyRequireInputsOnPage} .eshop-require-input/.eshop-step-btn node(s) sit on the closed page — steppers may exist only inside an open modal draft`,
      );

    /* ================= 2. Select Event card: options, force-latest, saved selection ============ */
    {
      const base0 = await readTier();
      const s = base0.select;
      if (!s) {
        errors.push("select card: #eventSelect missing from the live document");
      } else {
        if (!/select-field/.test(s.selectClass) || !s.rowClass || !s.labelFor)
          errors.push(
            `select card: Bond-consistency — class ${JSON.stringify(s.selectClass)}, .input-row ${s.rowClass}, label.input-label[for] ${s.labelFor}, want all true and select-field`,
          );
        if (s.disabled) errors.push("select card: #eventSelect is disabled while the snapshot has events");
        if (s.options.length !== EVENTS.length)
          errors.push(`select card: ${s.options.length} options, want ${EVENTS.length} active events`);
        if (s.options.some((o) => o.value === ""))
          errors.push(
            "select card: a blank/placeholder option exists — Amendment G forbids it (the select must always show a real event)",
          );
        const START_MONTH_FORMAT = new Intl.DateTimeFormat("en", {
          month: "short",
          year: "numeric",
          timeZone: "Asia/Tokyo",
        });
        EVENTS.forEach((snap, i) => {
          const baseName = (snap.event.shortName || snap.event.name || String(snap.event.id))
            .replace(/[\r\n]+/g, " ")
            .trim();
          const want =
            baseName +
            (snap.event.startedAt ? ` \u00b7 ${START_MONTH_FORMAT.format(new Date(snap.event.startedAt * 1000))}` : "");
          const got = s.options[i];
          if (!got || got.value !== String(snap.event.id))
            errors.push(
              `select card: option ${i} is ${JSON.stringify(got && got.value)}, want ${snap.event.id} (list order)`,
            );
          if (got && got.text !== want)
            errors.push(
              `select card: option ${i} label ${JSON.stringify(got.text)}, want newlines folded — ${JSON.stringify(want)}`,
            );
          if (got && /\n/.test(got.text)) errors.push(`select card: option ${i} label contains a raw newline`);
        });
        /* fresh storage (this run cleared it) → force-select the LATEST event, never blank */
        if (s.value !== String(LATEST.event.id))
          errors.push(
            `select card: fresh storage shows ${JSON.stringify(s.value)}, want the latest ${LATEST.event.id} (${JSON.stringify(LATEST.event.shortName.split("\n")[0])}) — no blank, no stale default`,
          );
        if (String(ACTIVE_ID) !== String(LATEST.event.id))
          errors.push(
            `data truth: the pinned scene event ${ACTIVE_ID} is not the latest (${LATEST.event.id}) — the scenes below test the wrong event`,
          );
        /* the selection is live: the tier cards show the pinned event's currencies */
        for (const currency of CURRENCIES) {
          const td = base0.tiers[tierOfCurrency(currency)];
          if (td && td.name !== currency.name)
            errors.push(
              `select card: tier ${tierOfCurrency(currency)} reads ${JSON.stringify(td.name)} on fresh load, want ${currency.name}`,
            );
        }
      }

      /* Amendment J + the sanctioned 2026-11-12 sync drift: the SHIPPED list is exactly the snapshot
         events in list order (wantIds pins [80639, 80632] — 80639 head), selected, enabled, no blank.
         (The >1-event patched list shapes are pinned in MULTI mode.) */
      if (!MULTI && s) {
        const wantOpts = EVENTS.map((e) => String(e.event.id));
        if (s.options.length !== wantOpts.length || s.options.map((o) => o.value).join() !== wantOpts.join())
          errors.push(
            `select card(J): the shipped select holds ${JSON.stringify(s.options.map((o) => o.value))}, want ${wantOpts.join(",")} in list order`,
          );
        if (s.options.some((o) => o.disabled))
          errors.push("select card(J): a real option is disabled — a farm event must be selectable");
      }

      /* a saved selection WINS over the latest-event default — needs a second event to mean
         anything, so it runs against the MULTI patched copy (never deleted from MAIN's ledger). */
      if (MULTI) {
        const savedSeed = JSON.stringify({ selectedEventId: PIN_MULTI, plans: {} });
        await seedAndReload(savedSeed);
        const savedState = await readTier();
        if (savedState.select.value !== String(PIN_MULTI))
          errors.push(
            `select card: saved selection ignored — value ${JSON.stringify(savedState.select.value)}, want ${PIN_MULTI}`,
          );
        const multiGold = currencyForTierRef(EMULTI.currencies, "gold");
        if (savedState.tiers.gold.name !== multiGold.name)
          errors.push(
            `select card: gold card after a saved 80379 selection is ${JSON.stringify(savedState.tiers.gold.name)}, want ${JSON.stringify(multiGold.name)} — first-match gold`,
          );
      }
      /* unknown saved id → fall back to the latest, blob left alone until a mutation */
      await seedAndReload(JSON.stringify({ selectedEventId: 99999, plans: {} }));
      const fallbackState = await readTier();
      if (fallbackState.select.value !== String(LATEST.event.id))
        errors.push(
          `select card: unknown savedEventId did not fall back to latest — value ${JSON.stringify(fallbackState.select.value)}`,
        );
      /* an old-shape blob's eventId migrates into selectedEventId — pinned in section 14 */
      await resetPlan();
    }

    /* ================= 3. Required box parity + editability cues (all tiers) ================== */
    const base = await readTier();
    for (const t of TIERS) {
      const td = base.tiers[t];
      if (!td.needFieldClass)
        errors.push(`parity: ${t} Required lost the material-input-box-field class — geometry comes from it`);
      if (!td.needDisplayClass) errors.push(`parity: ${t} Required lacks the eshop-require-display class`);
      if (td.needReadOnly !== true) errors.push(`parity: ${t} Required is not read-only`);
      if (td.needHaspopup !== "dialog")
        errors.push(`parity: ${t} Required aria-haspopup=${JSON.stringify(td.needHaspopup)}, want dialog`);
      if (!(td.needBox.h > 0)) errors.push(`parity: ${t} Required has no height (${td.needBox.h}px)`);
      if (td.needBox.h !== td.heldBox.h || td.needBox.h !== td.bonusBox.h)
        errors.push(
          `parity: ${t} offsetHeight mismatch — Required ${td.needBox.h}px, Held ${td.heldBox.h}px, Bonus ${td.bonusBox.h}px`,
        );
      if (td.needBox.h === 44)
        errors.push(
          `parity: ${t} Required is exactly 44px tall — the removed min-height override is back (Held ${td.heldBox.h}px)`,
        );
      if (td.needBox.w !== td.heldBox.w || td.needBox.w !== td.bonusBox.w)
        errors.push(
          `parity: ${t} offsetWidth mismatch — Required ${td.needBox.w}px, Held ${td.heldBox.w}px, Bonus ${td.bonusBox.w}px`,
        );
      if (td.needBox.borderStyle !== "dashed")
        errors.push(`cues: ${t} Required computed border-style is ${td.needBox.borderStyle}, want dashed`);
      if (td.heldBox.borderStyle !== "solid")
        errors.push(
          `cues: ${t} Held computed border-style is ${td.heldBox.borderStyle}, want solid (dashed pin must discriminate)`,
        );
      if (td.needBox.cursor !== "pointer")
        errors.push(`cues: ${t} Required computed cursor is ${td.needBox.cursor}, want pointer`);
      if (td.needValue !== "0")
        errors.push(`parity: ${t} Required reads ${JSON.stringify(td.needValue)} on an empty plan, want "0"`);
    }

    /* CSSOM: hover cue rule + focus cue rule + the base rule must carry NO geometry. */
    const css = await readCssCues();
    if (!css.hover)
      errors.push(
        "cues CSSOM: no input.eshop-require-display:hover rule inside an @media (hover: hover) block — hover accent cue never ships (headless cannot apply it; the rule is the pin)",
      );
    else {
      const hd = css.hover.decl;
      if (hd["border-style"] !== "solid")
        errors.push(`cues CSSOM: hover border-style is ${JSON.stringify(hd["border-style"])}, want solid`);
      if (!/--accent/.test(hd["border-color"] || ""))
        errors.push(`cues CSSOM: hover border-color ${JSON.stringify(hd["border-color"])}, want the accent token`);
      if (!/--accent-light/.test((hd.background || "") + (hd["background-color"] || "")))
        errors.push(
          `cues CSSOM: hover background ${JSON.stringify([hd.background, hd["background-color"]])}, want --accent-light`,
        );
    }
    if (!css.focus || css.focus.decl["border-style"] !== "solid")
      errors.push("cues CSSOM: input.eshop-require-display:focus border-style solid rule missing");
    if (
      !css.requireBase ||
      css.requireBase.decl["border-style"] !== "dashed" ||
      css.requireBase.decl.cursor !== "pointer"
    )
      errors.push(`cues CSSOM: base eshop-require-display rule wrong — ${JSON.stringify(css.requireBase)}`);
    if (css.requireBase) {
      const geometry = ["min-height", "height", "width", "padding", "font-size", "display"].filter(
        (p) => css.requireBase.decl[p],
      );
      if (geometry.length)
        errors.push(
          `parity CSSOM: eshop-require-display still overrides box geometry (${geometry.join("/")}) — Amendment B says geometry inherits from material-input-box-field`,
        );
    }
    if (css.iconBase && (css.iconBase.decl.background || css.iconBase.decl["background-color"]))
      errors.push(
        `icons CSSOM(K1): base .material-icon declares a background (${JSON.stringify(css.iconBase.decl)}) — Amendment K deleted the grey plate, only --event keeps the box transparent`,
      );
    if (!css.iconBase || css.iconBase.decl.height !== "96px")
      errors.push(`icons CSSOM(K1): base .material-icon height is ${JSON.stringify(css.iconBase && css.iconBase.decl.height)}, want 96px`);
    if (!css.iconFg || css.iconFg.decl.width !== "100%" || css.iconFg.decl.height !== "100%")
      errors.push(
        `icons CSSOM(K1): .material-icon .fg-layer is ${JSON.stringify(css.iconFg && css.iconFg.decl)}, want 100%/100% fill — the 80px inset must not come back`,
      );
    if (
      !css.iconEvent ||
      !/transparent/.test((css.iconEvent.decl.background || "") + (css.iconEvent.decl["background-color"] || ""))
    )
      errors.push(`icons CSSOM: .material-icon--event transparent rule missing — ${JSON.stringify(css.iconEvent)}`);
    /* Amendment K7/P3/27bb180 farm grid track rule + the absence of the deleted media overrides */
    if (
      !css.farmGrid ||
      !/auto-fit/.test(css.farmGrid.decl["grid-template-columns"] || "") ||
      !/220px/.test(css.farmGrid.decl["grid-template-columns"] || "") ||
      !/240px/.test(css.farmGrid.decl["grid-template-columns"] || "") ||
      css.farmGrid.decl["justify-content"] !== "center"
    )
      errors.push(
        `farm CSSOM(P3): .farm-grid is ${JSON.stringify(css.farmGrid)}, want repeat(auto-fit, minmax(min(100%, 220px), 240px)) + justify-content: center`,
      );
    if (css.farmGridMedia !== 0)
      errors.push(
        `farm CSSOM(K7): ${css.farmGridMedia} media rule(s) still override .farm-grid — the old 580/940 repeat() pins were deleted by Amendment K`,
      );
    /* Amendment K2: the header is a plain display — no cursor cue rule, no hover/focus opener cue */
    if (css.farmTitle && css.farmTitle.decl.cursor && css.farmTitle.decl.cursor !== "auto")
      errors.push(`farm CSSOM(K2): .farm-card-title cursor is ${css.farmTitle.decl.cursor}, want none/auto (not a control)`);
    if (css.farmTitleCues !== 0)
      errors.push(
        `farm CSSOM(K2): ${css.farmTitleCues} rule(s) style .farm-card-title as a control (:hover/:focus-visible cues) — the opener cues were deleted by Amendment K`,
      );
    if (!css.farmTitleFg || css.farmTitleFg.decl.width !== "100%" || css.farmTitleFg.decl.height !== "100%")
      errors.push(`farm CSSOM(K3): the header fg-layer fill rule is ${JSON.stringify(css.farmTitleFg)}, want 100%/100%`);
    if (!css.dropLine || css.dropLine.decl.height !== "32px")
      errors.push(`farm CSSOM(27bb180): the drop-line .mini-icon height rule is ${JSON.stringify(css.dropLine)}, want 32px`);
    /* Amendment K5: the event Calculate button rides the bond actions house rule */
    if (!css.btnActions || css.btnActions.decl.width !== "auto")
      errors.push(`btn CSSOM(K5): .bond-card-actions .calculate-btn width is ${JSON.stringify(css.btnActions && css.btnActions.decl.width)}, want auto ≥380px`);
    if (!css.btnSmall || css.btnSmall.decl.width !== "100%")
      errors.push(`btn CSSOM(K5): the <380px media rule for .bond-card-actions .calculate-btn is ${JSON.stringify(css.btnSmall)}, want width: 100%`);
    /* K5 live geometry at the 1120px viewport: auto width, flush to the actions row's right edge */
    const btnGeo = await page.evaluate(() => {
      const b = document.getElementById("calculateBtn");
      const a = b.parentElement;
      const br = b.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      return { ratio: br.width / a.clientWidth, rightGap: Math.round(ar.right - br.right) };
    });
    if (!(btnGeo.ratio > 0 && btnGeo.ratio <= 0.5))
      errors.push(`btn(K5): #calculateBtn spans ${(btnGeo.ratio * 100).toFixed(0)}% of its row at 1120px, want at most half (bond parity)`);
    if (Math.abs(btnGeo.rightGap) > 1.5)
      errors.push(`btn(K5): the button's right edge is ${btnGeo.rightGap}px off the actions row's right edge, want flush (right-aligned)`);
    if (!css.farmFallback || !/var\(--silver\)/.test(css.farmFallback.decl["--tier-color"] || ""))
      errors.push(
        `farm CSSOM: :where(.farm-card) silver --tier-color fallback missing — ${JSON.stringify(css.farmFallback)} — an unknown tier background (QP "zero") would lose its border colour`,
      );
    /* live :focus flip */
    await page.focus("#goldNeed");
    const focusBorder = await page.evaluate(() => getComputedStyle(document.getElementById("goldNeed")).borderStyle);
    if (focusBorder !== "solid")
      errors.push(`cues live: focused gold Required border-style is ${focusBorder}, want solid`);
    await page.focus("#goldHave");
    const blurBorder = await page.evaluate(() => getComputedStyle(document.getElementById("goldNeed")).borderStyle);
    if (blurBorder !== "dashed")
      errors.push(`cues live: blurred gold Required border-style is ${blurBorder}, want dashed`);

    /* ================= 4. event-native tier cards: standalone icons, names, EN names ========== */
    for (const currency of CURRENCIES) {
      const tier = tierOfCurrency(currency);
      const td = base.tiers[tier];
      if (td.name !== BUY_ALL_NAMES[currency.id])
        errors.push(
          `tier card: ${tier} material-name is ${JSON.stringify(td.name)}, want ${JSON.stringify(BUY_ALL_NAMES[currency.id])}`,
        );
      if (!td.iconEventClass)
        errors.push(`icons: ${tier} .material-icon did not gain material-icon--event on hydration`);
      if (td.iconBoxBg !== "rgba(0, 0, 0, 0)")
        errors.push(
          `icons: ${tier} event icon plate background is ${JSON.stringify(td.iconBoxBg)}, want transparent rgba(0,0,0,0)`,
        );
      const fg = td.imgs.filter((i) => i.cls.includes("fg-layer"));
      const bg = td.imgs.filter((i) => i.cls.includes("bg-layer"));
      if (fg.length !== 1 || bg.length !== 0)
        errors.push(
          `icons: ${tier} icon box has ${fg.length} fg + ${bg.length} bg img(s), want a single event fg-layer`,
        );
      /* Amendment K1 geometry: the 96px box, filled by the fg-layer (no 80px inset) */
      if (td.iconBoxH !== 96) errors.push(`icons(K1): ${tier} tier icon box is ${td.iconBoxH}px tall, want 96px`);
      if (fg[0] && fg[0].h !== 96)
        errors.push(`icons(K1): ${tier} fg-layer is ${fg[0].h}px tall, want it to FILL the 96px box (the 80px inset must not return)`);
      if (td.badge)
        errors.push(
          `icons: ${tier} icon box still shows the ${JSON.stringify(td.badge.text)} fallback badge in event mode — hydration did not replace it`,
        );
      const src = fg[0] ? fg[0].src : "";
      const wantSrc = `event_shop/${currency.icon.split("/").pop()}?v=`;
      if (!src || !src.includes(wantSrc))
        errors.push(`icons: ${tier} icon src ${JSON.stringify(src)}, want ${JSON.stringify(wantSrc)}…`);
      if (td.heldBox.readOnly !== false || td.bonusBox.readOnly !== false)
        errors.push(
          `tier card: ${tier} Held/Bonus must stay editable (held readOnly=${td.heldBox.readOnly}, bonus readOnly=${td.bonusBox.readOnly})`,
        );
    }
    /* Amendment E data truth: currencies keep the JP names, NA-translated permanent materials are
       EN, the shop coin resolved through the JP-EN layer — pinned against the data module. */
    {
      for (const currency of CURRENCIES) {
        if (currency.name !== BUY_ALL_NAMES[String(currency.id)])
          errors.push(
            `names(E): currency ${currency.id} is ${JSON.stringify(currency.name)}, want the JP ${JSON.stringify(BUY_ALL_NAMES[String(currency.id)])}`,
          );
      }
      const allItems = EVENTS.flatMap((e) => e.items);
      if (!allItems.some((i) => i.name === "Servant Coin"))
        errors.push('names(E): no item resolves to the JP-EN name "Servant Coin" — the NA→JP-EN→JP chain never ran');
      if (!allItems.some((i) => i.name === "Crystallized Lore"))
        errors.push('names(E): no NA EN permanent-material name ("Crystallized Lore") — the NA layer never won');
      const coin = ITEMS.find((i) => i.name === "Servant Coin");
      if (!coin) errors.push('names(E): the pinned event has no "Servant Coin" row to label the stepper with');
    }
    /* currency-name result labels ride the hydration (deficit-label + quest-name) */
    for (const currency of CURRENCIES) {
      const tier = tierOfCurrency(currency);
      const r = base.results[tier];
      if (r.deficitLabel !== currency.name)
        errors.push(
          `labels(D): ${tier} deficit-label is ${JSON.stringify(r.deficitLabel)}, want ${JSON.stringify(currency.name)}`,
        );
      if (r.questName !== `${currency.name} Quest`)
        errors.push(
          `labels(D): ${tier} quest-name is ${JSON.stringify(r.questName)}, want ${JSON.stringify(`${currency.name} Quest`)}`,
        );
    }
    /* hidden #questDropsGrid keeps its Amendment A hydration: currency titles + art, no badges */
    for (const [quest, drops] of Object.entries(QUEST_DROPS)) {
      const qd = base.quests[quest];
      const cur = currencyForTierRef(CURRENCIES, quest);
      const wantTitle = `${cur.name} Quest`;
      if (qd.title !== wantTitle)
        errors.push(`quest drops: ${quest} title is ${JSON.stringify(qd.title)}, want ${JSON.stringify(wantTitle)}`);
      for (const m of [drops.primary, drops.secondary]) {
        const icon = qd.icons[m];
        const wantCur = currencyForTierRef(CURRENCIES, m);
        const wantFile = `event_shop/${wantCur.icon.split("/").pop()}`;
        if (!icon || !icon.img || !(icon.img.src || "").includes(wantFile)) {
          errors.push(`quest drops: ${quest}Quest_${m}_icon is ${JSON.stringify(icon)}, want ${wantFile}`);
        }
        if (icon && (icon.badge || icon.imgCount !== 1))
          errors.push(
            `quest drops: ${quest}Quest_${m}_icon holds ${icon ? icon.imgCount : "?"} img(s) + ${icon ? (icon.badge ? 1 : 0) : "?"} badge(s), want 1 event img and no fallback`,
          );
        if (qd.icons[`${m}_spanBg`] && qd.icons[`${m}_spanBg`] !== "rgba(0, 0, 0, 0)")
          errors.push(
            `quest drops: ${quest}Quest_${m}_icon span background is ${qd.icons[`${m}_spanBg`]}, want transparent`,
          );
      }
    }

    /* ============ 5. farm chrome + Amendment I card shape (drop lines, opener, absences) ====== */
    {
      const f = base.farm;
      if (!f) {
        errors.push("farm: #farmGrid or its card is missing from the static markup");
      } else {
        if (f.gridDisplay === "none")
          errors.push(`farm: #farmGrid is hidden in event mode — showFarmCard never ran (display ${f.gridDisplay})`);
        if (f.baseDisplay !== "none")
          errors.push(
            `farm: the base/primary/secondary row is still visible (${f.baseDisplay}) — Amendment D hides it in event mode`,
          );
        if (f.questDisplay !== "none")
          errors.push(
            `farm: #questDropsGrid is still visible (${f.questDisplay}) — Amendment D hides it in event mode`,
          );
        if (f.title !== "Drop Rates per Run")
          errors.push(`farm: card title is ${JSON.stringify(f.title)}, want "Drop Rates per Run" (Amendment I1)`);
        if (f.cards.length !== CURRENCIES.length)
          errors.push(`farm: ${f.cards.length} cards for ${CURRENCIES.length} currencies — one card per shop currency`);

        /* Amendment I7 absences, over the grid's VISIBLE text and its controls: no Required box, no
           AP, no runs-reported, no Base/Primary/Secondary label words, no require-display input and
           no farmRequired* id anywhere inside #farmGrid. (data-drop-line="primary|secondary" is an
           attribute, not text — the visible surface is what a user reads.) */
        const gridText = f.cards.map((c) => c.text || "").join(" ");
        const absent = [
          [/Required/, "Required box"],
          [/\bAP\b/, "AP line"],
          [/runs reported/i, "runs-reported line"],
          [/\bBase\b/, "Base label"],
          [/\bPrimary\b/, "Primary label"],
          [/\bSecondary\b/, "Secondary label"],
        ];
        for (const [re, what] of absent)
          if (re.test(gridText))
            errors.push(`farm absence(I7): #farmGrid visible text still carries the ${what} — ${JSON.stringify(gridText.slice(0, 160))}`);
        const strayInputs = f.cards.flatMap((c) => c.inputs.filter((i) => i.displayClass || /^farmRequired/.test(i.id)));
        if (strayInputs.length)
          errors.push(
            `farm absence(I7): ${strayInputs.length} require-display/farmRequired input(s) inside #farmGrid — ${JSON.stringify(strayInputs.map((i) => i.id))}`,
          );
        /* Amendment K2: the header is a PLAIN DISPLAY — every opener attribute must be ABSENT.
           (The inverted I7 pin: role=button/tabindex/aria-haspopup/aria-label/data-currency-id on
           any .farm-card-title, or a pointer cursor, means the header-opener regression is back.) */
        const openerAttrs = f.cards.filter(
          (c) => c.header && (c.header.role || c.header.tabindex || c.header.haspopup || c.header.ariaLabel || c.header.currencyId),
        );
        if (openerAttrs.length)
          errors.push(
            `farm(K2): ${openerAttrs.length}/${f.cards.length} headers still carry opener attrs — ${JSON.stringify(
              openerAttrs.map((c) => [c.name, c.header.role, c.header.tabindex, c.header.haspopup, c.header.ariaLabel, c.header.currencyId]),
            )}`,
          );
        const pointerHeaders = f.cards.filter((c) => c.header && c.header.cursor !== "auto");
        if (pointerHeaders.length)
          errors.push(
            `farm(K2): ${pointerHeaders.length} header(s) are not cursor:auto — ${JSON.stringify(pointerHeaders.map((c) => [c.name, c.header.cursor]))}`,
          );

        const mapped = new Set(TIERS.map((t) => currencyForTierRef(CURRENCIES, t)).filter(Boolean).map((c) => String(c.id)));
        for (const currency of CURRENCIES) {
          const id = String(currency.id);
          const card = f.cards.find((c) => c.name === currency.name);
          if (!card) {
            errors.push(
              `farm: no card for ${currency.name} (${id}, tier ${currency.background}) — ${JSON.stringify(f.cards.map((c) => [c.tier, c.name]))}`,
            );
            continue;
          }
          if (card.tier !== currency.background || card.name !== currency.name)
            errors.push(
              `farm(${currency.name}): card is tier ${JSON.stringify(card.tier)} name ${JSON.stringify(card.name)}, want ${currency.background} / ${currency.name}`,
            );
          /* the header is a plain display (K2) carrying the currency's art at the 48px header step
             (K3): no attrs of any kind, and the mini-icon box AND its img measure 48px */
          const h = card.header;
          if (!h) errors.push(`farm(${currency.name}): no .farm-card-title header`);
          else {
            if (h.currencyId || h.role || h.tabindex || h.haspopup || h.ariaLabel)
              errors.push(
                `farm(K2)(${currency.name}): header carries attrs ${JSON.stringify([h.role, h.tabindex, h.haspopup, h.ariaLabel, h.currencyId])}, want all absent`,
              );
            const wantFile = `event_shop/${currency.icon.split("/").pop()}`;
            if (!(h.imgSrc || "").includes(wantFile) || !(h.imgSrc || "").includes(`?v=${IMAGE_VERSION}`))
              errors.push(
                `farm(${currency.name}): header icon ${JSON.stringify(h.imgSrc)}, want ${wantFile}?v=${IMAGE_VERSION}`,
              );
            if (!(h.imgW > 0)) errors.push(`farm(${currency.name}): header icon never decoded (naturalWidth ${h.imgW})`);
            if (h.boxH !== 64 || h.imgH !== 64)
              errors.push(
                `farm(27bb180)(${currency.name}): header art is box ${h.boxH}px / img ${h.imgH}px, want 64px/64px (box and image)`,
              );
            const hText = h.text.replace(/\s+/g, " ").trim();
            if (hText !== "" || h.imgAlt !== currency.name)
              errors.push(
                `farm(P1)(${currency.name}): header text ${JSON.stringify(hText)} alt ${JSON.stringify(h.imgAlt)}, want icon-only with alt=${JSON.stringify(currency.name)}`,
              );
          }
          /* exactly one Held/Bonus pair per currency, and never on a tier-mapped card (Amendment H+I7) */
          const gotLabels = card.inputs.map((i) => i.label).sort().join(",");
          const wantLabels = mapped.has(id) ? "" : "Bonus,Held";
          if (gotLabels !== wantLabels)
            errors.push(
              `farm(${currency.name}): card holds inputs [${gotLabels}], want [${wantLabels}] — mapped currencies own their tier-card pair, unmapped ones the farm pair`,
            );
          for (const i of card.inputs)
            if (i.id !== `farm${i.label}${id}` || i.readOnly)
              errors.push(
                `farm(${currency.name}): farm box id/readOnly wrong — ${JSON.stringify([i.id, i.readOnly])}, want ["farm${i.label}${id}",false]`,
              );

          const entry = FARM[id] || null;
          if (!entry) {
            if (card.lines.length !== 1 || card.lines[0] !== "No drop data yet" || card.drops.length)
              errors.push(
                `farm(${currency.name}): null-farm card lines ${JSON.stringify(card.lines)} + ${card.drops.length} drop line(s), want ["No drop data yet"] and no drop lines`,
              );
            continue;
          }
          /* stats: quest name, REC only when recommendLv is truthy; then the two drop lines (or the
             bare em dash when the quest pays no second shop currency). Zero plan at this point. */
          const wantStats = [entry.questName];
          if (entry.recommendLv) wantStats.push(`REC Lv. ${entry.recommendLv}`);
          const statsNoDash = card.lines.filter((l) => l !== "\u2014");
          if (JSON.stringify(statsNoDash) !== JSON.stringify(wantStats))
            errors.push(`farm(${currency.name}): stat lines ${JSON.stringify(statsNoDash)}, want ${JSON.stringify(wantStats)}`);
          const dashCount = card.lines.filter((l) => l === "\u2014").length;
          const wantDash = entry.secondary ? 0 : 1;
          if (dashCount !== wantDash)
            errors.push(
              `farm(${currency.name}): ${dashCount} dash line(s), want ${wantDash} — ${JSON.stringify(card.lines)}`,
            );
          if (card.drops.length !== (entry.secondary ? 2 : 1))
            errors.push(
              `farm(${currency.name}): ${card.drops.length} drop line(s), want ${entry.secondary ? 2 : 1} (primary${entry.secondary ? " + secondary" : ""})`,
            );
          const wantDrops = [
            { kind: "primary", id, de: entry.dropExpected, num: entry.num, icon: currency.icon },
          ];
          if (entry.secondary) {
            const sec = CURRENCIES.find((c) => String(c.id) === String(entry.secondary.currencyId));
            if (!sec)
              errors.push(
                `farm(${currency.name}): the snapshot's secondary currency ${entry.secondary.currencyId} is not sold by this event — a dash must show`,
              );
            else
              wantDrops.push({
                kind: "secondary",
                id: String(sec.id),
                de: entry.secondary.dropExpected,
                num: entry.secondary.num,
                icon: sec.icon,
              });
          }
          for (const want of wantDrops) {
            const d = card.drops.find((x) => x.kind === want.kind);
            if (!d) {
              errors.push(`farm(${currency.name}): no ${want.kind} drop line — ${JSON.stringify(card.drops.map((x) => x.kind))}`);
              continue;
            }
            if (d.currencyId !== want.id)
              errors.push(
                `farm(${currency.name}): ${want.kind} line carries currency ${JSON.stringify(d.currencyId)}, want ${want.id} (the card's own currency is ${id})`,
              );
            if (d.dropExpected !== String(want.de) || d.num !== String(want.num))
              errors.push(
                `farm(${currency.name}): ${want.kind} line data ${JSON.stringify([d.dropExpected, d.num])}, want [${want.de},${want.num}]`,
              );
            if (d.material !== dropStackRef(want.num, 0))
              errors.push(`farm(${currency.name}): ${want.kind} stack reads ${JSON.stringify(d.material)}, want "${dropStackRef(want.num, 0)}"`);
            const wantValue = dropValueRef(want.de, want.num, 0);
            if (d.value !== wantValue)
              errors.push(`farm(${currency.name}): ${want.kind} amount reads ${JSON.stringify(d.value)}, want "${wantValue}"`);
            const wantFile = `event_shop/${want.icon.split("/").pop()}`;
            if (!(d.imgSrc || "").includes(wantFile) || !(d.imgSrc || "").includes(`?v=${IMAGE_VERSION}`))
              errors.push(
                `farm(${currency.name}): ${want.kind} line icon ${JSON.stringify(d.imgSrc)}, want ${wantFile}?v=${IMAGE_VERSION}`,
              );
            if (!(d.imgW > 0)) errors.push(`farm(${currency.name}): ${want.kind} line icon never decoded (${d.imgW})`);
            if (d.boxH !== 32 || d.imgH !== 32)
              errors.push(`farm(27bb180)(${currency.name}): ${want.kind} line art is box ${d.boxH}px / img ${d.imgH}px, want 32px/32px`);
          }
        }
        /* non-vacuity: with the shipped snapshot every card must be on the FULL-data path, and the
           dash path only ever shows in MULTI (80630/80379/80292 null-farm, 80555 secondary-null) */
        const fullCards = f.cards.filter((c) => c.drops.length >= 1).length;
        const wantFull = CURRENCIES.filter((c) => FARM[String(c.id)]).length;
        if (fullCards !== wantFull)
          errors.push(`farm: ${fullCards} cards render drop lines, want ${wantFull} — the full-data path never ran`);
        const wantDash = CURRENCIES.filter((c) => FARM[String(c.id)] && !FARM[String(c.id)].secondary).length;
        const gotDash = f.cards.filter((c) => c.lines.includes("\u2014")).length;
        if (gotDash !== wantDash)
          errors.push(`farm: ${gotDash} dash card(s), want ${wantDash} (secondary-null) — ${JSON.stringify(f.cards.map((c) => c.lines))}`);
        /* the pinned farm truth (plan tracker verified against the live API): the snapshot must
           still carry it — if this drifts, the reference math below pins the app to stale numbers */
        for (const [id, truth] of Object.entries(FARM_TRUTH)) {
          const entry = FARM[id];
          const drift = Object.keys(truth).filter((k) => JSON.stringify(entry && entry[k]) !== JSON.stringify(truth[k]));
          if (!entry || drift.length)
            errors.push(
              `farm truth: FARM[${id}] ${JSON.stringify(entry)} drifted from the pinned snapshot ${JSON.stringify(truth)} on [${drift.join(",")}]`,
            );
          if (entry && !(entry.sampleRuns > 0))
            errors.push(`farm truth: FARM[${id}].sampleRuns is ${JSON.stringify(entry.sampleRuns)} — the data field stays in the schema (I3 removed the DISPLAY only)`);
        }
        if (IMAGE_VERSION !== "4")
          errors.push(
            `costume(F): IMAGE_VERSION is ${JSON.stringify(IMAGE_VERSION)}, want "4" — the bump for the costume face must ship`,
          );
      }
    }

    /* ============ 5b. live Bonus repaints EVERY drop line carrying that currency ============== */
    /* A currency rides its own card's primary line and, when its best quest pays a second shop
       currency, another card's secondary line. The plan is empty here, so every line starts at +0. */
    if (base.farm) {
      for (const currency of CURRENCIES) {
        const id = String(currency.id);
        const tier = tierOfCurrency(currency);
        /* every line in the grid that carries THIS currency: its own card's primary plus any other
           quest's secondary when that quest pays it as the second-best shop drop */
        const carriersNow = [];
        for (const c of CURRENCIES) {
          const entry = FARM[String(c.id)];
          if (!entry) continue;
          if (String(c.id) === id) carriersNow.push({ card: c.name, kind: "primary", de: entry.dropExpected, num: entry.num });
          if (entry.secondary && String(entry.secondary.currencyId) === id)
            carriersNow.push({ card: c.name, kind: "secondary", de: entry.secondary.dropExpected, num: entry.secondary.num });
        }
        const readLine = (cards, cardName, kind) =>
          (((cards.find((c) => c.name === cardName) || {}).drops) || []).find(
            (d) => d.kind === kind && d.currencyId === id,
          );
        const cardCountBefore = (await readTier()).farm.cards.length;
        if (!carriersNow.length)
          errors.push(`bonus repaint: no drop line carries currency ${id} — the scene has nothing to pin`);
        if (carriersNow.length < 2 && FARM[id] && FARM[id].secondary)
          errors.push(
            `bonus repaint: currency ${id} rides only ${carriersNow.length} line(s) — the two-line repaint is unpinned for it`,
          );
        for (const want of [2, 0]) {
          await typeInto(sel.tierBonus(tier), String(want));
          await wait(SETTLE_MS);
          const cards = (await readTier()).farm.cards;
          for (const c of carriersNow) {
            const d = readLine(cards, c.card, c.kind);
            if (!d) {
              errors.push(`bonus repaint(${currency.name}): ${c.card}/${c.kind} line vanished at bonus ${want}`);
              continue;
            }
            if (d.material !== dropStackRef(c.num, want))
              errors.push(
                `bonus repaint(${currency.name}): ${c.card} ${c.kind} stack reads ${JSON.stringify(d.material)}, want "${dropStackRef(c.num, want)}"`,
              );
            const wantValue = dropValueRef(c.de, c.num, want);
            if (d.value !== wantValue)
              errors.push(
                `bonus repaint(${currency.name}): ${c.card} ${c.kind} amount reads ${JSON.stringify(d.value)}, want "${wantValue}" (dropExpected ${c.de} × (${c.num}+${want}))`,
              );
          }
          /* lines carrying OTHER currencies must not move */
          for (const card of cards) {
            for (const d of card.drops) {
              if (d.currencyId === id) continue;
              if (d.material !== dropStackRef(Number(d.num), 0))
                errors.push(
                  `bonus repaint(${currency.name}): editing its bonus moved ${card.name}'s ${d.kind} line for currency ${d.currencyId} — ${JSON.stringify(d.material)}`,
                );
            }
          }
        }
        if ((await readTier()).farm.cards.length !== cardCountBefore)
          errors.push(`bonus repaint: card count changed across the repaint (${cardCountBefore} → ${(await readTier()).farm.cards.length})`);
      }
      const planAfter = (await readTier()).storage ? JSON.parse((await readTier()).storage).plans[String(ACTIVE_ID)] : null;
      const bonusKeys = Object.keys((planAfter && planAfter.bonus) || {});
      if (bonusKeys.some((k) => TIERS.includes(k)))
        errors.push(`bonus repaint: plan.bonus holds TIER keys ${JSON.stringify(bonusKeys)} — Amendment H keys by currency id`);
      await resetPlan();
    }

    /* ================= 6. event + farm images actually decode ================================== */
    await page.evaluate(() => {
      for (const t of ["bronze", "silver", "gold"]) {
        const card = document.querySelector(`#materialsGrid [data-tier="${t}"]`);
        if (card) card.scrollIntoView({ block: "center" });
      }
      const farm = document.getElementById("farmGrid");
      if (farm) farm.scrollIntoView({ block: "center" });
    });
    await wait(400);
    const tierDecoded = await page.evaluate(() => {
      const out = [];
      for (const t of ["bronze", "silver", "gold"]) {
        for (const img of document.querySelectorAll(`#materialsGrid [data-tier="${t}"] img`))
          out.push({ zone: `tier:${t}`, src: img.getAttribute("src"), w: img.naturalWidth });
      }
      for (const img of document.querySelectorAll("#farmGrid .farm-card img"))
        out.push({ zone: "farm", src: img.getAttribute("src"), w: img.naturalWidth });
      return out;
    });
    const deadTier = tierDecoded.filter((i) => !(i.w > 0));
    if (deadTier.length)
      errors.push(
        `visible art: ${deadTier.length}/${tierDecoded.length} event image(s) never decoded — ${JSON.stringify(deadTier.slice(0, 3))}`,
      );
    /* non-vacuity: 3 tier imgs + per farm card its header art and one img per real drop line
       (the dash line has no art, a null-farm card has only its header) */
    const wantFarmImgs = CURRENCIES.reduce((n, c) => {
      const entry = FARM[String(c.id)];
      return n + 1 + (entry ? (entry.secondary ? 2 : 1) : 0);
    }, 0);
    const wantVisible = 3 + wantFarmImgs;
    if (tierDecoded.length !== wantVisible)
      errors.push(
        `visible art: the sweep found ${tierDecoded.length} img(s) in the visible tier + farm boxes, want ${wantVisible} — the boxes are empty or the art never rendered`,
      );
    const evBoxes = await readIconBoxes();
    assertEventBoxes(evBoxes, "event art", CURRENCIES);
    assertMaterialAbsence("event art");
    console.log(
      `NOTE: visible tier+farm images decoded ${tierDecoded.length - deadTier.length}/${tierDecoded.length}, hidden-grid spans hydrated 1-img ${ICON_CONTAINERS.filter((id) => evBoxes[id] && evBoxes[id].imgCount === 1).length}/${ICON_CONTAINERS.length}, fallback badges left in event boxes ${ICON_CONTAINERS.reduce((n, id) => n + (evBoxes[id] ? evBoxes[id].badgeCount : 0), 0)}, icons/materials requests ${materialRequests.length}, >=400 responses ${httpFailures.length}`,
    );

    /* ================= 7. modal opens from bronze Required; Escape discards =================== */
    if (currencyOfItem(freeRow) !== bronzeCurrency)
      errors.push(`data sanity: the bronze scene row maps to ${JSON.stringify(currencyOfItem(freeRow))}, want bronze`);
    await openTierModal("bronze", "open modal from bronze Required click");
    let modal = await readModal();
    const wantBronzeRows = itemsOfCurrency(String(bronzeCurrency.id));
    if (modal.title !== `${bronzeCurrency.name} — Shop Items`)
      errors.push(`modal title: reads ${JSON.stringify(modal.title)}, want "${bronzeCurrency.name} — Shop Items"`);
    if (modal.rows.length !== wantBronzeRows.length)
      errors.push(
        `modal rows: ${modal.rows.length} draft rows for ${bronzeCurrency.name}, want ${wantBronzeRows.length}`,
      );
    if (modal.displaySpans)
      errors.push(
        `modal: ${modal.displaySpans} read-only display span(s) inside the draft list, want 0 — draft rows must carry steppers`,
      );
    const draftBad = [];
    for (const row of modal.rows) {
      const item = byId.get(row.id);
      if (!item) {
        draftBad.push(`${row.id}: not in the snapshot`);
        continue;
      }
      if (String(item.cost.itemId) !== String(bronzeCurrency.id))
        draftBad.push(`${row.id}: belongs to another currency, leaked into the draft`);
      if (row.value !== "0")
        draftBad.push(`${row.id}: draft opens at ${JSON.stringify(row.value)}, want storage value "0"`);
      if (row.max !== String(maxRequire(item)))
        draftBad.push(`${row.id}: input max ${row.max}, want ${maxRequire(item)}`);
      if (row.ariaLabel !== `${item.name} require`)
        draftBad.push(`${row.id}: input aria ${JSON.stringify(row.ariaLabel)}`);
      if (row.minusLabel !== `Decrease ${item.name}` || row.plusLabel !== `Increase ${item.name}`)
        draftBad.push(`${row.id}: step labels ${JSON.stringify([row.minusLabel, row.plusLabel])}`);
      const wantMeta =
        `${bronzeCurrency.name} \u00d7${fmtRef(item.cost.amount)} \u00b7 ` +
        (item.limitNum > 0 ? `Limit ${fmtRef(item.limitNum)}` : "Unlimited") +
        (item.setNum > 1 ? ` \u00b7 \u00d7${fmtRef(item.setNum)} per buy` : "");
      if (row.meta !== wantMeta)
        draftBad.push(`${row.id}: meta ${JSON.stringify(row.meta)} want ${JSON.stringify(wantMeta)}`);
      if (row.active) draftBad.push(`${row.id}: active tint on a zero draft`);
      if (num(row.total) !== 0) draftBad.push(`${row.id}: subtotal ${JSON.stringify(row.total)} on a zero draft`);
      if (!row.iconKind) draftBad.push(`${row.id}: draft row has neither an icon nor a fallback`);
    }
    if (draftBad.length)
      errors.push(`modal draft: ${draftBad.length} row(s) wrong — ${draftBad.slice(0, 3).join(" | ")}`);
    await closeBy("Escape", "Escape closes the modal");
    assertPlan(await readTier(), {}, "Escape-discard");

    /* ================= 8. keyboard: Enter and Space open; the costume face (Amendment F) ====== */
    await page.focus(sel.tierNeed("gold"));
    await page.keyboard.press("Enter");
    await modalGate(true, "Enter opens the gold modal from the focused Required");
    modal = await readModal();
    if (!modal.title.startsWith(goldCurrency.name))
      errors.push(`keyboard: Enter on goldNeed opened ${JSON.stringify(modal.title)}, want ${goldCurrency.name}`);
    /* gold draft carries the interesting art: costume (= clampRow) + equip + multi-set rows */
    const artSamples = [clampRow, equipRow, multiSetRow].filter(Boolean).map((i) => String(i.id));
    if (artSamples.length < 3)
      errors.push(
        `data sanity: costume/equip/multi-set sample rows ${JSON.stringify(artSamples)} — re-verify the art pins against the snapshot`,
      );
    for (let i = 0; i < 60; i++) {
      const artNow = modal.rows.filter((r) => artSamples.includes(r.id));
      if (artNow.length === artSamples.length && artNow.every((r) => r.iconKind === "img" && r.iconW > 0)) break;
      await wait(100);
      modal = await readModal();
    }
    const artRows = artSamples.map((id) => modal.rows.find((r) => r.id === id)).filter(Boolean);
    if (artRows.length < artSamples.length)
      errors.push(
        `modal art: ${artRows.length}/${artSamples.length} sample art rows present in the gold draft — data moved between currencies, re-verify before trusting this pin`,
      );
    const deadArt = artRows.filter((r) => r.iconKind !== "img" || !(r.iconW > 0));
    if (deadArt.length)
      errors.push(
        `modal icons: costume/equip/multi-set draft icon(s) not decoded — ${JSON.stringify(deadArt.map((r) => [r.id, r.iconKind, r.iconW]))}`,
      );
    /* Amendment F: the costume row shows the COSTUME face (detail 204730), not the base servant —
       the shipped file is costume_20470011.webp and every shop icon carries the ?v=4 cache buster. */
    const costumeRow = clampRow;
    if (costumeRow && costumeRow.purchaseType === "costumeRelease") {
      const cRow = modal.rows.find((r) => r.id === String(costumeRow.id));
      const file = "costume_20470011.webp";
      if (!cRow) errors.push(`costume(F): the ${costumeRow.name} draft row is missing from the gold list`);
      else {
        const cSrc = cRow.iconSrc || "";
        if (!cSrc.includes(file))
          errors.push(
            `costume(F): the ${costumeRow.name} draft row icon is ${JSON.stringify(cRow.iconSrc)}, want the ${file} costume face`,
          );
        if (!cSrc.includes(`?v=${IMAGE_VERSION}`))
          errors.push(
            `costume(F): costume icon src ${JSON.stringify(cRow.iconSrc)} lacks the ?v=${IMAGE_VERSION} cache buster`,
          );
        if (!(cRow.iconW > 0)) errors.push(`costume(F): the costume face never decoded (naturalWidth ${cRow.iconW})`);
      }
      const coinRow = modal.rows.find((r) => r.id === String(multiSetRow ? multiSetRow.id : -1));
      if (coinRow && coinRow.name !== "Servant Coin")
        errors.push(`names(E): the gold multi-set row is ${JSON.stringify(coinRow.name)}, want the EN "Servant Coin"`);
    } else {
      errors.push("costume(F): the pinned gold limit-1 row is not the costumeRelease row — snapshot drifted");
    }
    await closeBy("Escape", "Escape after Enter-open");
    await page.focus(sel.tierNeed("silver"));
    await page.keyboard.press("Space");
    await modalGate(true, "Space opens the silver modal from the focused Required");
    modal = await readModal();
    if (!modal.title.startsWith(silverCurrency.name))
      errors.push(`keyboard: Space on silverNeed opened ${JSON.stringify(modal.title)}, want ${silverCurrency.name}`);
    await closeBy("Escape", "Escape after Space-open");

    /* ==== 8b. the tier Required is the SOLE opener; farm headers are inert (Amendment K2) ==== */
    /* Click, Enter and Space aimed at a farm card's currency header must NEVER open the modal — the
       header lost its opener role in Amendment K. The tier card's Required display keeps opening the
       SAME modal for the mapped currency. Inputs inside a card still open nothing. */
    {
      await resetPlan();
      const headerByName = async (name) => {
        const handles = await page.$$("#farmGrid .farm-card-title");
        for (const el of handles) {
          const t = await el.evaluate((e) => {
            const txt = e.textContent.replace(/\s+/g, " ").trim();
            if (txt) return txt;
            const img = e.querySelector("img");
            return img ? img.getAttribute("alt") : "";
          });
          if (t === name) return el;
        }
        return null;
      };
      for (const currency of CURRENCIES) {
        const h = await headerByName(currency.name);
        if (!h) {
          errors.push(`8b(K2): no .farm-card-title header for ${currency.name} — the card title vanished`);
          continue;
        }
        await h.click();
        await wait(SETTLE_MS);
        if ((await readModal()).open) {
          errors.push(`8b(K2): clicking ${currency.name}'s farm header opened the modal — the header is not a control`);
          await closeBy("Escape", "8b: recover after the header click opened the modal");
        }
        for (const via of ["Enter", "Space"]) {
          await h.focus();
          const focused = await h.evaluate((e) => document.activeElement === e);
          if (focused) errors.push(`8b(K2): ${currency.name}'s header took keyboard focus — it must not be a tab stop`);
          await page.keyboard.press(via);
          await wait(SETTLE_MS);
          if ((await readModal()).open) {
            errors.push(`8b(K2): ${via} aimed at ${currency.name}'s header opened the modal`);
            await closeBy("Escape", "8b: recover after the header key opened the modal");
          }
        }
      }
      /* the tier Required opens the mapped currency's modal — same title, same rows */
      const expectedRows = (snapshot, currencyId) =>
        snapshot.items
          .filter((i) => String(i.cost.itemId) === String(currencyId))
          .map((i) => String(i.id))
          .sort()
          .join();
      for (const currency of CURRENCIES) {
        const id = String(currency.id);
        const mappedHere = currencyForTierRef(CURRENCIES, currency.background);
        if (!mappedHere || String(mappedHere.id) !== id) continue;
        await safeClick(sel.tierNeed(currency.background));
        if (await modalGate(true, `tier Required: ${currency.name} modal`)) {
          const mt = await readModal();
          if (mt.title !== `${currency.name} \u2014 Shop Items`)
            errors.push(`tier Required: ${currency.background} opened ${JSON.stringify(mt.title)}, want the mapped currency's modal`);
          if (mt.rows.map((r) => r.id).sort().join() !== expectedRows(EACTIVE, id))
            errors.push(`tier Required: ${currency.background} modal rows differ from the currency's own item list`);
          await closeBy("Escape", "tier Required then Escape");
        }
      }
      /* a farm input click never opens anything (MULTI is where unmapped cards carry inputs) */
      if (MULTI) {
        await switchEvent(PIN_ZERO, '8b: switch → 80292 (unmapped QP + second silver)');
        const unmapped = EZERO.currencies.filter((c) => !currencyForTierRef(EZERO.currencies, c.background) || String(currencyForTierRef(EZERO.currencies, c.background).id) !== String(c.id));
        for (const currency of unmapped) {
          const id = String(currency.id);
          const held = `#farmHeld${id}`;
          if (!(await page.$(held))) {
            errors.push(`8b: ${currency.name} (${id}) has no farm Held box — an unmapped currency must own its pair`);
            continue;
          }
          await safeClick(held);
          await wait(SETTLE_MS);
          if ((await readModal()).open)
            errors.push(`8b: clicking ${currency.name}'s farm Held input opened the modal — inputs must never open it`);
        }
        await switchEvent(ACTIVE_ID, "8b: back to the pinned event");
      }
    }

    /* ================= 9. clamp suite lives INSIDE the modal draft rows ======================= */
    /* Baseline before any draft editing: in MAIN storage is still null here; in MULTI an earlier
       scene switched events, so the blob may already exist. The contract pinned is "a draft writes
       nothing" — measured as zero setItem calls on the planner key AND the blob staying byte-equal,
       which is the same claim whether the starting blob was null or not. */
    const storageBeforeDraft = (await readTier()).storage;
    await installWriteSpy();
    await openTierModal("gold", "open modal for clamp scene");
    await safeClick(sel.modalPlus(clampRow.id));
    await safeClick(sel.modalPlus(clampRow.id));
    await wait(SETTLE_MS);
    modal = await readModal();
    let dr = modal.rows.find((r) => r.id === String(clampRow.id));
    const clampMax = maxRequire(clampRow);
    if (!dr || dr.value !== String(clampMax))
      errors.push(
        `draft clamp: + twice on limit-${clampRow.limitNum} row ${clampRow.id} reads ${JSON.stringify(dr && dr.value)}, want "${clampMax}"`,
      );
    if (dr && num(dr.total) !== clampRow.cost.amount * clampMax)
      errors.push(`draft clamp: row total ${dr && dr.total}, want ${clampRow.cost.amount * clampMax}`);
    await typeInto(sel.modalInput(clampRow.id), "999");
    await wait(SETTLE_MS);
    modal = await readModal();
    dr = modal.rows.find((r) => r.id === String(clampRow.id));
    const stillFocused = await page.evaluate(
      (s) => document.activeElement === document.querySelector(s),
      sel.modalInput(clampRow.id),
    );
    if (dr && dr.value !== "999")
      errors.push(
        `draft typing: focused input rewritten to ${JSON.stringify(dr && dr.value)} mid-typing, want the typed "999" kept`,
      );
    if (dr && num(dr.total) !== clampRow.cost.amount)
      errors.push(
        `draft typing: 999 on a limit-${clampRow.limitNum} row subtotals ${dr && dr.total}, want ${clampRow.cost.amount}`,
      );
    if (!stillFocused) errors.push("draft typing: the focused input lost focus while its subtotal refreshed");
    await safeClick(sel.modalPlus(clampRow.id));
    await wait(SETTLE_MS);
    modal = await readModal();
    dr = modal.rows.find((r) => r.id === String(clampRow.id));
    if (dr && dr.value !== String(clampMax))
      errors.push(
        `draft stepper sync: + after typing 999 left ${JSON.stringify(dr && dr.value)}, want the committed "${clampMax}"`,
      );
    await safeClick(sel.modalMinus(clampRow.id));
    await wait(SETTLE_MS);
    await safeClick("#eventShopModalDefaultBtn");
    await wait(SETTLE_MS);
    modal = await readModal();
    const notZero = modal.rows.filter((r) => r.value !== "0" || num(r.total) !== 0);
    if (notZero.length)
      errors.push(`modal Default: ${notZero.length} row(s) survived the zero — ${JSON.stringify(notZero.slice(0, 2))}`);
    await typeInto(sel.modalInput(draftFree.id), "5000");
    await wait(SETTLE_MS);
    modal = await readModal();
    dr = modal.rows.find((r) => r.id === String(draftFree.id));
    if (dr && dr.value !== "5000") errors.push(`draft unlimited: typed 5000 reads ${JSON.stringify(dr && dr.value)}`);
    if (dr && num(dr.total) !== 5000 * draftFree.cost.amount)
      errors.push(`draft unlimited: 5000 subtotals ${dr && dr.total}, want ${5000 * draftFree.cost.amount}`);
    await typeInto(sel.modalInput(draftFree.id), "10000000");
    await wait(SETTLE_MS);
    modal = await readModal();
    dr = modal.rows.find((r) => r.id === String(draftFree.id));
    if (dr && num(dr.total) !== SHOP_MAX * draftFree.cost.amount)
      errors.push(
        `draft unlimited: typed 10000000 subtotals ${dr && dr.total}, want the schema cap ${SHOP_MAX * draftFree.cost.amount}`,
      );
    if (dr && dr.value !== "10000000")
      errors.push(
        `draft unlimited: focused input rewritten mid-typing to ${JSON.stringify(dr && dr.value)}, want "10000000" kept`,
      );
    await typeInto(sel.modalInput(draftFree.id), "-5");
    await wait(SETTLE_MS);
    modal = await readModal();
    dr = modal.rows.find((r) => r.id === String(draftFree.id));
    if (dr && num(dr.total) !== 0) errors.push(`draft negative: "-5" subtotals ${dr && dr.total}, want 0`);
    await page.evaluate((id) => {
      const btn = document.querySelector(
        `#eventShopModalList .eshop-item[data-item-id="${id}"] .eshop-step-btn[data-step="1"]`,
      );
      for (let i = 0; i < 8; i++) btn.click();
    }, String(draftFree.id));
    await wait(SETTLE_MS);
    modal = await readModal();
    dr = modal.rows.find((r) => r.id === String(draftFree.id));
    const wantRace = Math.min(8, maxRequire(draftFree));
    if (dr && dr.value !== String(wantRace))
      errors.push(`draft race: 8 synchronous + clicks left ${JSON.stringify(dr && dr.value)}, want "${wantRace}"`);
    await closeBy("Cancel", "Cancel discards the draft");
    let tierState = await readTier();
    assertPlan(tierState, {}, "Cancel-discard leaves the plan");
    const clampCancelWrites = await writeCount();
    await uninstallWriteSpy();
    if (clampCancelWrites !== 0)
      errors.push(
        `Cancel-discard: draft typing/stepping wrote the planner key ${clampCancelWrites} time(s) before Done — nothing publishes before Done`,
      );
    if (tierState.storage !== storageBeforeDraft)
      errors.push(
        `Cancel-discard: localStorage changed from ${JSON.stringify(storageBeforeDraft)} to ${JSON.stringify(tierState.storage && tierState.storage.slice(0, 120))} — nothing publishes before Done`,
      );
    await openTierModal("gold", "reopen after Cancel");
    modal = await readModal();
    const leaked = modal.rows.filter((r) => r.value !== "0");
    if (leaked.length)
      errors.push(
        `draft isolation: after Cancel+reopen, ${leaked.length} row(s) kept draft edits ${JSON.stringify(leaked.slice(0, 2).map((r) => [r.id, r.value]))}, want all "0"`,
      );
    await closeBy("Cancel", "close reopen check");

    /* ================= 10. write discipline: drafts never touch storage, Done writes once ====== */
    await installWriteSpy();
    await openTierModal("bronze", "open modal for write-count scene");
    await typeInto(sel.modalInput(freeRow.id), "12345");
    await safeClick(sel.modalPlus(bronzeSteppable.id));
    await safeClick(sel.modalPlus(bronzeSteppable.id));
    await wait(SETTLE_MS);
    const draftWrites = await writeCount();
    if (draftWrites !== 0)
      errors.push(
        `write discipline: draft typing/stepping wrote localStorage ${draftWrites} time(s) before Done, want 0`,
      );
    await clickDone();
    const doneWrites = await writeCount();
    if (doneWrites !== 1)
      errors.push(`write discipline: Done wrote localStorage ${doneWrites} time(s), want exactly 1 whole-plan commit`);
    await uninstallWriteSpy();
    tierState = await readTier();
    const plan10 = {
      [String(freeRow.id)]: 12345,
      [String(bronzeSteppable.id)]: Math.min(2, maxRequire(bronzeSteppable)),
    };
    assertPlan(tierState, plan10, "Done commits typed + stepped values");
    assertStorage(tierState.storage, plan10, "Done commit", { exact: true });
    await openTierModal("bronze", "reopen with the committed plan");
    modal = await readModal();
    const cr10 = modal.rows.find((r) => r.id === String(freeRow.id));
    if (!cr10 || cr10.value !== "12345" || !cr10.active)
      errors.push(
        `draft prefill: committed row reads ${JSON.stringify(cr10 && [cr10.value, cr10.active])}, want "12345" + active`,
      );
    await closeBy("Cancel", "close prefill check");

    await openTierModal("silver", "open silver modal for isolation");
    modal = await readModal();
    const silverItems = itemsOfCurrency(String(silverCurrency.id));
    const foreign = modal.rows.filter((r) => !silverItems.some((i) => String(i.id) === r.id));
    if (foreign.length)
      errors.push(
        `draft isolation: the silver draft contains ${foreign.length} foreign row(s) ${JSON.stringify(foreign.slice(0, 2).map((r) => r.id))}`,
      );
    await typeInto(sel.modalInput(String(silverFree.id)), "9");
    await closeBy("Cancel", "cancel silver edit");
    tierState = await readTier();
    assertPlan(tierState, plan10, "silver Cancel leaves the committed plan");
    await openTierModal("silver", "reopen silver after Cancel");
    modal = await readModal();
    const kept9 = modal.rows.filter((r) => r.value === "9");
    if (kept9.length)
      errors.push(
        `draft isolation: Cancelled silver edit survived the reopen (${JSON.stringify(kept9.map((r) => r.id))})`,
      );
    await closeBy("Cancel", "close silver");

    /* ================= 11. Done agreement: storage + tier + legacy all match ================== */
    await resetPlan();
    await openTierModal("bronze", "bronze scene via tier Required");
    await typeInto(sel.modalInput(freeRow.id), "3");
    await clickDone();
    tierState = await readTier();
    const plan11 = { [String(freeRow.id)]: 3 };
    assertPlan(tierState, plan11, "Done agreement — tier Required + legacy state");
    assertStorage(tierState.storage, plan11, "Done agreement — storage blob (G shape)", { exact: true });
    if (freeRow.cost.amount !== 10)
      errors.push(
        `data truth: the bronze scene row costs ${freeRow.cost.amount}, the legacy mirror pin below assumes 10`,
      );
    const legacy11 = tierState.legacyStorage ? JSON.parse(tierState.legacyStorage) : null;
    if (!legacy11 || legacy11.bronzeNeed !== 3 * freeRow.cost.amount)
      errors.push(
        `Done agreement: legacy fgo_calculator_data bronzeNeed is ${legacy11 && legacy11.bronzeNeed}, want the plan total ${3 * freeRow.cost.amount}`,
      );
    await openTierModal("gold", "open gold for merge check");
    await typeInto(sel.modalInput(draftFree.id), "250");
    await clickDone();
    tierState = await readTier();
    const plan11b = { [String(freeRow.id)]: 3, [String(draftFree.id)]: 250 };
    assertPlan(tierState, plan11b, "merge commit keeps the earlier currency");
    assertStorage(tierState.storage, plan11b, "merge commit blob");

    /* ================= 12. Select All = buy-all semantics; whole-plan truth =================== */
    await resetPlan();
    for (const currency of CURRENCIES) {
      const tier = tierOfCurrency(currency);
      await openTierModal(tier, `open ${tier} for Select All`);
      await safeClick(sel.footer("SelectAll"));
      await wait(SETTLE_MS);
      modal = await readModal();
      const wantClear = refClear(itemsOfCurrency(String(currency.id)));
      const wrong = modal.rows.filter((r) => r.value !== String(wantClear[r.id] ?? 0));
      if (wrong.length)
        errors.push(
          `Select All (${currency.name}): ${wrong.length} draft row(s) off the buy-out plan — ${JSON.stringify(wrong.slice(0, 3).map((r) => [r.id, r.value, wantClear[r.id]]))}`,
        );
      const unlimitedWrong = modal.rows.filter((r) => {
        const item = byId.get(r.id);
        return item && item.limitNum === 0 && r.value !== "0";
      });
      if (unlimitedWrong.length)
        errors.push(
          `Select All (${currency.name}): ${unlimitedWrong.length} unlimited row(s) filled — buy-out must leave them at 0`,
        );
      await clickDone();
    }
    tierState = await readTier();
    const buyAll = refClear(ITEMS);
    const wantBuy = assertPlan(tierState, buyAll, "Select All ×3 (buy all)");
    for (const currency of CURRENCIES) {
      const tier = tierOfCurrency(currency);
      if (tierState.tiers[tier].needValue !== String(BUY_ALL_TRUTH[String(currency.id)]))
        errors.push(
          `buy-out truth: ${tier} Required reads ${tierState.tiers[tier].needValue}, the pinned data truth is ${BUY_ALL_TRUTH[String(currency.id)]}`,
        );
      if (wantBuy[String(currency.id)] !== BUY_ALL_TRUTH[String(currency.id)])
        errors.push(`buy-out truth: reference totals disagree with the pinned truth for ${currency.id}`);
    }
    const storedBuy = JSON.parse(tierState.storage);
    const storedBuyReq = (storedBuy.plans || {})[String(ACTIVE_ID)] || {};
    for (const item of ITEMS) {
      const want = buyAll[String(item.id)];
      if ((storedBuyReq.requires || {})[String(item.id)] !== want)
        errors.push(
          `buy-all storage: row ${item.id} stored ${JSON.stringify((storedBuyReq.requires || {})[String(item.id)])}, want ${want}`,
        );
    }
    console.log(
      `NOTE: buy-all via Select All → ${CURRENCIES.map((c) => `${c.name} ${wantBuy[String(c.id)]}`).join(", ")} (pinned truth ${JSON.stringify(BUY_ALL_TRUTH)})`,
    );

    await openTierModal("bronze", "open bronze for Default+Done");
    await safeClick("#eventShopModalDefaultBtn");
    await wait(SETTLE_MS);
    await clickDone();
    tierState = await readTier();
    const partial = { ...buyAll };
    for (const item of bronzeItems) partial[String(item.id)] = 0;
    assertPlan(tierState, partial, "Default+Done empties only its currency");

    /* ================= 13. persistence across reload + legacy-need recompute ================== */
    const persistPlan = { [String(freeRow.id)]: 250 };
    await resetPlan();
    await openTierModal("bronze", "open for persistence scene");
    await typeInto(sel.modalInput(freeRow.id), "250");
    await clickDone();
    await page.reload({ waitUntil: "networkidle0" });
    await ensureEventTab();
    await wait(SETTLE_MS);
    let restored = await readTier();
    assertPlan(restored, persistPlan, "persistence after reload");
    assertStorage(restored.storage, persistPlan, "persistence blob after reload", { exact: true });
    if (restored.select.value !== String(ACTIVE_ID))
      errors.push(`persistence after reload: select shows ${JSON.stringify(restored.select.value)}, want ${ACTIVE_ID}`);
    await page.evaluate(
      (lk, tier) => {
        const saved = JSON.parse(localStorage.getItem(lk));
        saved[`${tier}Need`] = 424242;
        localStorage.setItem(lk, JSON.stringify(saved));
      },
      STORAGE_KEY,
      "bronze",
    );
    await page.reload({ waitUntil: "networkidle0" });
    await ensureEventTab();
    await wait(SETTLE_MS);
    restored = await readTier();
    assertPlan(restored, persistPlan, "tampered legacy need is recomputed from the plan on load");

    /* ================= 14. farm results vs an INDEPENDENT reference (bonus into stack) ======== */
    {
      await resetPlan();
      await openTierModal("gold", "open gold for the buy-all farm scene");
      await safeClick(sel.footer("SelectAll"));
      await clickDone();
      await typeInto("#goldHave", "1000");
      await typeInto("#goldBonus", "2");
      /* the tier-box writers are debounced (Amendment H): let the flush land before pricing */
      await wait(SETTLE_MS);
      await safeClick("#calculateBtn");
      await wait(SETTLE_MS);
      const res = await readTier();
      /* the committed plan is the GOLD buy-out only — reference totals must match that plan */
      const goldOnlyPlan = refClear(goldItems);
      const totals = refTotals(ITEMS, CURRENCIES, goldOnlyPlan);
      const held = { bronze: 0, silver: 0, gold: 1000 };
      const bonus = { bronze: 0, silver: 0, gold: 2 };
      if (totals[String(goldCurrency.id)] !== BUY_ALL_TRUTH[String(goldCurrency.id)])
        errors.push(
          `farm math: the gold buy-out reference reads ${totals[String(goldCurrency.id)]}, pinned truth ${BUY_ALL_TRUTH[String(goldCurrency.id)]}`,
        );
      const goldId = String(goldCurrency.id);
      const goldRef = refFarmRow(FARM[goldId], 6610, 1000, 2);
      const flatRuns = Math.ceil(5610 / (FARM[goldId].dropExpected * FARM[goldId].num + 2));
      const noBonusRuns = Math.ceil(5610 / (FARM[goldId].dropExpected * FARM[goldId].num));
      if (goldRef.deficit !== 5610)
        errors.push(`farm math: the reference deficit moved off 5610 (${JSON.stringify(goldRef)}) — re-verify BUY_ALL_TRUTH before blaming the app`);
      if (goldRef.runs === flatRuns || goldRef.runs === noBonusRuns)
        errors.push(
          `farm math: the reference is blind — bonus-in-stack ${goldRef.runs} equals flat-bonus ${flatRuns} / no-bonus ${noBonusRuns} at this drop rate, re-pick the scene numbers`,
        );
      const wantGoldLabel = goldRef.runs === 1 ? "run" : "runs";
      const plays = (res.farmResults && res.farmResults.plays) || [];
      const goldPlay = plays.find((p) => p.questName === FARM[goldId].questName);
      if (!res.farmResults || res.farmResults.title !== "Best Farm Runs")
        errors.push(`farm math: #results title is ${JSON.stringify(res.farmResults && res.farmResults.title)}, want "Best Farm Runs"`);
      if (plays.length !== 1 || !goldPlay)
        errors.push(
          `farm math: #results plays ${JSON.stringify(plays)}, want single quest ${JSON.stringify(FARM[goldId].questName)}`,
        );
      else {
        if (goldPlay.count !== String(goldRef.runs))
          errors.push(`farm math: gold play cell is ${JSON.stringify(goldPlay.count)}, want ${goldRef.runs}`);
        if (goldPlay.label !== wantGoldLabel)
          errors.push(
            `farm math: gold label is ${JSON.stringify(goldPlay.label)}, want ${JSON.stringify(wantGoldLabel)}`,
          );
      }
      /* K6 absence sweep: no "AP" text anywhere in the visible #results surface */
      const resultsText = await page.evaluate(() => (document.getElementById("results") || {}).textContent || "");
      if (/\bAP\b/.test(resultsText))
        errors.push(`results(K6): #results still prints AP — ${JSON.stringify(resultsText.replace(/\s+/g, " ").slice(0, 160))}`);
      console.log(
        `NOTE: farm results gold = 5610 deficit, ${goldPlay && goldPlay.count} ${goldPlay && goldPlay.label} (bonus-in-stack ref ${goldRef.runs}; the flat-bonus bug would say ${flatRuns}, dropping the bonus entirely ${noBonusRuns})`,
      );
    }

    /* ================= 15. per-event saves: isolation, swap-on-switch, reload (MULTI) ========= */
    if (MULTI) {
      await resetPlan();
      /* plan A: bronze row 3 + gold held/bonus figures */
      await openTierModal("bronze", "A: commit a bronze requires plan");
      await typeInto(sel.modalInput(freeRow.id), "3");
      await clickDone();
      await typeInto("#goldHave", "1000");
      await typeInto("#goldBonus", "2");
      /* the tier-box writers are debounced (Amendment H): the figures reach the plan after
         DEBOUNCE_MS — snapshot only once the flush has landed (a human always types slower). */
      await wait(SETTLE_MS);
      const planABefore = JSON.parse((await readTier()).storage).plans[String(ACTIVE_ID)];
      const snapshotA = JSON.stringify({
        requires: planABefore.requires,
        held: planABefore.held,
        bonus: planABefore.bonus,
      });

      /* switch to B: everything the event owns must swap */
      await switchEvent(PIN_OTHER, "switch 80639 → 80630");
      const stateB = await readTier();
      if (stateB.tiers.bronze.name !== "Bronze")
        errors.push(
          `switch: 80630 has no bronze currency — the card must revert to ${JSON.stringify("Bronze")}, reads ${JSON.stringify(stateB.tiers.bronze.name)}`,
        );
      if (stateB.tiers.bronze.badge === null)
        errors.push("switch: the reverted bronze card lost its fallback badge — stale event art survived the switch");
      if (stateB.tiers.bronze.needValue !== "0")
        errors.push(
          `switch: bronze Required reads ${JSON.stringify(stateB.tiers.bronze.needValue)} on the empty 80630 plan, want "0"`,
        );
      if (stateB.tiers.gold.name !== EOTHER.currencies[0].name)
        errors.push(
          `switch: gold card is ${JSON.stringify(stateB.tiers.gold.name)}, want ${JSON.stringify(EOTHER.currencies[0].name)}`,
        );
      if (
        stateB.tiers.gold.needValue !== "0" ||
        stateB.tiers.gold.heldValue !== "0" ||
        stateB.tiers.gold.bonusValue !== "0"
      )
        errors.push(
          `switch: gold boxes leaked A's plan into B — ${JSON.stringify([stateB.tiers.gold.needValue, stateB.tiers.gold.heldValue, stateB.tiers.gold.bonusValue])}`,
        );
      if (stateB.farm.cards.length !== 1 || stateB.farm.cards[0].lines[0] !== "No drop data yet")
        errors.push(
          `switch: 80630 farm cards are ${JSON.stringify(stateB.farm.cards)} — want one "No drop data yet" card (null farm)`,
        );
      if (
        stateB.results.gold.deficitLabel !== EOTHER.currencies[0].name ||
        stateB.results.bronze.deficitLabel !== "Bronze"
      )
        errors.push(
          `switch: result labels after moving to 80630 — gold ${JSON.stringify(stateB.results.gold.deficitLabel)} bronze ${JSON.stringify(stateB.results.bronze.deficitLabel)}`,
        );
      /* empty plan on farm:null renders 0 plays; non-empty deficit renders empty-plan notice */
      await safeClick("#calculateBtn");
      await wait(SETTLE_MS);
      const resB0 = (await readTier()).farmResults;
      if (!resB0 || resB0.title !== "Best Farm Runs" || resB0.empty !== null || resB0.plays.length !== 0)
        errors.push(`farm null: empty 80630 results read ${JSON.stringify(resB0)}, want 0 plays`);

      /* edit B, prove A is byte-identical, switch back, prove B kept its own edit */
      await openTierModal("gold", "B: commit an 80630 plan");
      const bItem = itemsOfCurrency(String(EOTHER.currencies[0].id), EOTHER.items).find((i) => i.limitNum >= 1);
      if (!bItem) errors.push("switch: 80630 has no limited gold row to edit — snapshot drifted");
      else {
        await typeInto(sel.modalInput(String(bItem.id)), "1");
        await clickDone();
        const afterB = JSON.parse((await readTier()).storage);
        const aJson = JSON.stringify({
          requires: afterB.plans[String(ACTIVE_ID)].requires,
          held: afterB.plans[String(ACTIVE_ID)].held,
          bonus: afterB.plans[String(ACTIVE_ID)].bonus,
        });
        if (aJson !== snapshotA) errors.push(`isolation(G): editing 80630 mutated 80639 — ${aJson} vs ${snapshotA}`);
        const bReq = afterB.plans[String(PIN_OTHER)].requires || {};
        if (bReq[String(bItem.id)] !== 1)
          errors.push(`isolation(G): 80630's own edit did not persist — ${JSON.stringify(bReq)}`);
        if (afterB.selectedEventId !== PIN_OTHER)
          errors.push(`isolation(G): selectedEventId is ${JSON.stringify(afterB.selectedEventId)} after editing B`);
        await safeClick("#calculateBtn");
        await wait(SETTLE_MS);
        const resB = (await readTier()).farmResults;
        if (
          !resB ||
          resB.title !== "Best Farm Runs" ||
          resB.empty !== "No drop data can cover this plan" ||
          resB.plays.length !== 0
        )
          errors.push(
            `farm null: 80630 gold results read ${JSON.stringify(resB)}, want "No drop data can cover this plan"`,
          );

        await switchEvent(ACTIVE_ID, "switch back → 80639");
        const backA = await readTier();
        if (backA.tiers.bronze.needValue !== String(3 * freeRow.cost.amount))
          errors.push(
            `isolation(G): A's bronze Required after the round trip reads ${JSON.stringify(backA.tiers.bronze.needValue)}, want ${3 * freeRow.cost.amount}`,
          );
        if (backA.tiers.gold.heldValue !== "1000" || backA.tiers.gold.bonusValue !== "2")
          errors.push(
            `isolation(G): A's held/bonus after the round trip reads ${JSON.stringify([backA.tiers.gold.heldValue, backA.tiers.gold.bonusValue])}, want ["1000","2"]`,
          );
        const fullShape = (c) => {
          const cur = CURRENCIES.find((x) => x.name === c.name);
          const entry = cur ? FARM[String(cur.id)] : null;
          if (!entry) return c.lines.length === 1 && c.lines[0] === "No drop data yet" && c.drops.length === 0;
          const stats = entry.recommendLv ? 2 : 1;
          const drops = entry.secondary ? 2 : 1;
          return !c.lines.includes("\u2014") && c.lines.length === stats && c.drops.length === drops;
        };
        if (backA.farm.cards.length !== 3 || !backA.farm.cards.every(fullShape))
          errors.push(
            `switch back: A's farm grid is ${JSON.stringify(backA.farm.cards.map((c) => [c.lines, c.drops.length]))} — want 3 full-shape cards (quest + REC + primary + secondary)`,
          );
        /* and B's edit survived untouched in storage */
        const stillB = JSON.parse(backA.storage).plans[String(PIN_OTHER)];
        if (!stillB || (stillB.requires || {})[String(bItem.id)] !== 1)
          errors.push(`isolation(G): B's plan lost its edit while A was being worked — ${JSON.stringify(stillB)}`);
        /* both plans survive a reload, with the selection */
        await page.reload({ waitUntil: "networkidle0" });
        await ensureEventTab();
        await wait(SETTLE_MS);
        const reloaded = await readTier();
        if (reloaded.select.value !== String(ACTIVE_ID))
          errors.push(
            `persistence(G): after reload the select shows ${JSON.stringify(reloaded.select.value)}, want ${ACTIVE_ID}`,
          );
        if (reloaded.tiers.bronze.needValue !== String(3 * freeRow.cost.amount))
          errors.push(
            `persistence(G): after reload A's bronze Required reads ${JSON.stringify(reloaded.tiers.bronze.needValue)}`,
          );
        const reloadB = JSON.parse(reloaded.storage).plans[String(PIN_OTHER)];
        if (!reloadB || (reloadB.requires || {})[String(bItem.id)] !== 1)
          errors.push(`persistence(G): after reload B's plan is ${JSON.stringify(reloadB)}`);
      }
      await switchEvent(ACTIVE_ID, "reselect after reload");
    }

    /* ================= 16. first-match + label restore on an unmapped event (MULTI 80379) ===== */
    if (MULTI) {
      await resetPlan();
      await switchEvent(PIN_MULTI, "switch → 80379");
      const s79 = await readTier();
      const golds = EMULTI.currencies.filter((c) => c.background === "gold");
      if (golds.length < 2) errors.push(`data truth: 80379 expected 2 gold currencies, has ${golds.length}`);
      else if (s79.tiers.gold.name !== golds[0].name)
        errors.push(
          `first-match: gold card is ${JSON.stringify(s79.tiers.gold.name)}, want the FIRST gold currency ${JSON.stringify(golds[0].name)}`,
        );
      if (s79.results.bronze.deficitLabel !== "Bronze" || s79.results.silver.deficitLabel !== "Silver")
        errors.push(
          `label restore: unmapped tiers must show the tier words — bronze ${JSON.stringify(s79.results.bronze.deficitLabel)} silver ${JSON.stringify(s79.results.silver.deficitLabel)}`,
        );
      if (s79.farm.cards.length !== EMULTI.currencies.length)
        errors.push(`farm: 80379 shows ${s79.farm.cards.length} cards, want ${EMULTI.currencies.length}`);
      if (s79.farm.cards.some((c) => !c.lines.includes("No drop data yet") || c.drops.length))
        errors.push(
          `farm: an 80379 card invented drop data where the snapshot has null — ${JSON.stringify(s79.farm.cards.map((c) => [c.lines, c.drops.length]))}`,
        );
      const tagged = s79.farm.cards.filter((c) => c.header && c.header.currencyId);
      if (tagged.length)
        errors.push(
          `farm(K2): ${tagged.length} 80379 header(s) still carry data-currency-id — the header must be attr-free`,
        );
      const unnamed = s79.farm.cards.filter((c) => !EMULTI.currencies.some((x) => x.name === c.name));
      if (unnamed.length)
        errors.push(`farm: 80379 card names ${JSON.stringify(unnamed.map((c) => c.name))} are not the event's own currencies`);
      await switchEvent(ACTIVE_ID, "switch back → 80639");
      const back = await readTier();
      if (back.results.gold.deficitLabel !== BUY_ALL_NAMES[String(goldCurrency.id)])
        errors.push(
          `label restore: gold label after returning is ${JSON.stringify(back.results.gold.deficitLabel)}, want the currency name again`,
        );
    }

    /* ================= 17. zero-background event renders without crash (MULTI 80292) ========== */
    if (MULTI) {
      const errorsBefore = pageErrors.length;
      await switchEvent(PIN_ZERO, 'switch → 80292 (QP background "zero")');
      const s92 = await readTier();
      if (s92.farm.cards.length !== EZERO.currencies.length)
        errors.push(
          `zero tier: ${s92.farm.cards.length} farm cards, want ${EZERO.currencies.length} (one per currency)`,
        );
      const qpCard = s92.farm.cards.find((c) => c.tier === "zero");
      if (!qpCard)
        errors.push(`zero tier: no data-tier="zero" farm card — ${JSON.stringify(s92.farm.cards.map((c) => c.tier))}`);
      else {
        if (!qpCard.lines.includes("No drop data yet"))
          errors.push(`zero tier: QP card lines ${JSON.stringify(qpCard.lines)}, want the null-farm message`);
        const silverCard = s92.farm.cards.find((c) => c.tier === "silver");
        if (silverCard && qpCard.borderColor !== silverCard.borderColor)
          errors.push(
            `zero tier: the QP card border ${qpCard.borderColor} lost the :where() silver fallback (silver sibling ${silverCard.borderColor})`,
          );
        if (!/rgba\(|rgb\(/.test(qpCard.borderColor) || qpCard.borderColor === "rgba(0, 0, 0, 0)")
          errors.push(
            `zero tier: QP border is ${JSON.stringify(qpCard.borderColor)}, want a real colour, not transparent`,
          );
      }
      const silverCur = currencyForTierRef(EZERO.currencies, "silver");
      if (s92.tiers.silver.name !== silverCur.name)
        errors.push(
          `zero tier: silver card is ${JSON.stringify(s92.tiers.silver.name)}, want ${JSON.stringify(silverCur.name)}`,
        );
      if (s92.tiers.bronze.name !== "Bronze" || !s92.tiers.bronze.badge)
        errors.push("zero tier: the unmapped bronze card must keep the generic badge look");
      if (pageErrors.length !== errorsBefore)
        errors.push(
          `zero tier: switching to 80292 raised page errors — ${JSON.stringify(pageErrors.slice(errorsBefore))}`,
        );
      await switchEvent(ACTIVE_ID, "leave 80292");
    }

    /* ============ 17D. secondary-null drop line + falsy REC (MULTI 80555 dash fixture) ======== */
    /* No shipped or pruned event has drop data WITHOUT a secondary (the pruned ones have no farm
       data at all), so the patched MULTI copy carries one synthetic event: the live farm rows with
       every secondary deleted and one recommendLv blanked. It pins the two branches Amendment I
       added that real data cannot reach: the "—" secondary line and the skipped REC line. */
    if (MULTI) {
      const before17 = pageErrors.length;
      await switchEvent(PIN_DASH, "17D: switch → 80555 (secondary-null fixture)");
      const sd = await readTier();
      const currencies = EDASH.currencies;
      const dashFarm = farmMapOf(EDASH);
      if (sd.farm.cards.length !== currencies.length)
        errors.push(`dash: ${sd.farm.cards.length} cards, want ${currencies.length}`);
      for (const currency of currencies) {
        const id = String(currency.id);
        const entry = dashFarm[id];
        const card = sd.farm.cards.find((c) => c.name === currency.name);
        if (!card || !entry) {
          errors.push(
            `dash(${currency.name}): missing card or entry — ${JSON.stringify(sd.farm.cards.map((c) => c.name))}`,
          );
          continue;
        }
        const wantStats = [entry.questName];
        if (entry.recommendLv) wantStats.push(`REC Lv. ${entry.recommendLv}`);
        if (card.lines.includes("\u2014"))
          errors.push(`dash(${currency.name}): unexpected "\u2014" line — ${JSON.stringify(card.lines)}`);
        if (JSON.stringify(card.lines) !== JSON.stringify(wantStats))
          errors.push(
            `dash(${currency.name}): stats ${JSON.stringify(card.lines)}, want ${JSON.stringify(wantStats)}`,
          );
        if (card.drops.length !== 1 || card.drops[0].kind !== "primary")
          errors.push(`dash(${currency.name}): ${card.drops.length} drop line(s) ${JSON.stringify(card.drops.map((d) => d.kind))}, want the primary line alone`);
        if (card.drops[0] && (card.drops[0].currencyId !== id || card.drops[0].num !== String(entry.num)))
          errors.push(`dash(${currency.name}): primary line data wrong — ${JSON.stringify([card.drops[0].currencyId, card.drops[0].num])}`);
        /* Amendment K: the secondary-less card's header is still inert, and the tier Required
           (this fixture's currencies are all tier-mapped) opens its modal */
        if (card.header && (card.header.role || card.header.currencyId))
          errors.push(`dash(K2)(${currency.name}): the fixture header carries opener attrs ${JSON.stringify([card.header.role, card.header.currencyId])}`);
        await safeClick(sel.tierNeed(currency.background));
        if (await modalGate(true, `17D: ${currency.name} tier Required opens its modal`)) {
          const m = await readModal();
          if (m.title !== `${currency.name} \u2014 Shop Items`)
            errors.push(`dash(${currency.name}): the tier Required opened ${JSON.stringify(m.title)}`);
          await closeBy("Escape", "17D: close after the tier Required open");
        }
      }
      /* results math is untouched by the missing secondary: the primary line still prices alone */
      const dashGold = currencyForTierRef(currencies, "gold");
      const goldItemsD = EDASH.items.filter((i) => String(i.cost.itemId) === String(dashGold.id));
      await openTierModal("gold", "17D: buy the fixture's gold");
      await safeClick(sel.footer("SelectAll"));
      await clickDone();
      await safeClick("#calculateBtn");
      await wait(SETTLE_MS);
      const resD = (await readTier()).farmResults;
      const totalsD = refTotals(EDASH.items, currencies, refClear(goldItemsD));
      const dashGoldEntry = dashFarm[String(dashGold.id)];
      const refD = refFarmRow(dashGoldEntry, totalsD[String(dashGold.id)], 0, 0);
      if (refD.runs === null)
        errors.push("dash: the fixture's gold farm row priced to nothing — the scene is blind, re-check the fixture data");
      const playsD = (resD && resD.plays) || [];
      const goldPlayD = playsD.find((p) => p.questName === dashGoldEntry.questName);
      if (!resD || resD.title !== "Best Farm Runs" || playsD.length !== 1 || !goldPlayD)
        errors.push(`dash: #results plays ${JSON.stringify(playsD)}, want single quest ${dashGoldEntry.questName}`);
      else if (goldPlayD.count !== String(refD.runs))
        errors.push(
          `dash: gold runs is ${JSON.stringify(goldPlayD.count)}, want ${refD.runs} — missing secondary unchanged`,
        );
      if (pageErrors.length !== before17)
        errors.push(`dash: the secondary-null fixture raised page errors — ${JSON.stringify(pageErrors.slice(before17))}`);
      await resetPlan();
      await switchEvent(ACTIVE_ID, "17D: leave the fixture");
    }

    /* ==== 17H. Amendment H + K2: currency-keyed farm controls, tier-Required-only opener ==== */
    if (MULTI) {
      /* Amendment K moved the farm card's modal door back out of the header entirely: the header is
         a plain display and the tier cards' Required is the tab's only opener. The collision
         contract still holds, re-pinned: (1) NO header carries opener attrs and header clicks/keys
         open nothing — a currency no tier card owns simply has no modal door (owner directive K2);
         (2) exactly one Held/Bonus pair per currency — tier-mapped currencies keep
         the tier-card pair and get no farm pair, every other currency owns a farm pair writing the
         same currency-keyed plan; (3) farm figures persist by CURRENCY id, migrate from stored TIER
         ids through first-match, price per currency, and are committed synchronously at Calculate;
         (4) a pending debounce may never write into the event the user switched TO; (5) the farm
         label chip masks its own card surface; (6) NO Required surface of any kind lives in #farmGrid. */
      const readFarmCtl = (eventId) =>
        page.evaluate(
          (key, id) => {
            const stored = JSON.parse(localStorage.getItem(key) || "null");
            const plan = (stored && stored.plans && stored.plans[String(id)]) || { requires: {} };
            const labelOf = (input) => {
              const box = input.closest(".material-input-box");
              const l = box ? box.querySelector(".material-input-box-label") : null;
              return l ? l.textContent : null;
            };
            const cards = [...document.querySelectorAll("#farmGrid .farm-card:not(.farm-card--combo)")].map((c) => {
              const header = c.querySelector(".farm-card-title");
              const hImg = header ? header.querySelector("img") : null;
              const inputs = [...c.querySelectorAll("input")];
              return {
                tier: c.dataset.tier,
                headerCurrencyId: header ? header.dataset.currencyId || null : null,
                headerRole: header ? header.getAttribute("role") : null,
                headerTabindex: header ? header.getAttribute("tabindex") : null,
                headerHaspopup: header ? header.getAttribute("aria-haspopup") : null,
                headerAria: header ? header.getAttribute("aria-label") : null,
                headerText:
                  (hImg && hImg.getAttribute("alt")) || (header ? header.textContent.replace(/\s+/g, " ").trim() : null),
                requireDisplays: c.querySelectorAll("input.eshop-require-display").length,
                requiredIds: inputs.filter((i) => /^farmRequired/.test(i.id)).map((i) => i.id),
                cardBg: getComputedStyle(c).backgroundColor,
                boxes: inputs.map((i) => ({
                  id: i.id,
                  label: labelOf(i),
                  value: i.value,
                  readOnly: i.readOnly,
                  aria: i.getAttribute("aria-label"),
                  labelBg: (() => {
                    const box = i.closest(".material-input-box");
                    const l = box ? box.querySelector(".material-input-box-label") : null;
                    return l ? getComputedStyle(l).backgroundColor : null;
                  })(),
                })),
              };
            });
            return { cards, plan };
          },
          KEY,
          eventId,
        );

      const mappedIdsOf = (currencies) =>
        new Set(TIERS.map((t) => currencyForTierRef(currencies, t)).filter(Boolean).map((c) => String(c.id)));
      const itemsOf = (snap, currencyId) =>
        snap.items.filter((i) => String(i.cost.itemId) === String(currencyId));

      /* The shared ensureEventTab readiness test keys on #goldNeed carrying the display class, which
         an event with NO gold currency never does (its tier card reverts to the legacy editable
         box). Same route for those events — tab, then a readiness test the event can satisfy. */
      const seedAndReloadGoldless = async (raw, eventId) => {
        await seedStorage(raw);
        await page.reload({ waitUntil: "networkidle0" });
        await page.evaluate(() => {
          const active = document.querySelector(".tab-btn.active");
          if (!active || active.dataset.tab !== "event")
            document.querySelector('.tab-btn[data-tab="event"]').click();
        });
        try {
          await page.waitForFunction(
            (id) => {
              const s = document.getElementById("eventSelect");
              return !!s && s.value === String(id) && document.querySelectorAll("#farmGrid .farm-card").length > 0;
            },
            { timeout: 15000 },
            eventId,
          );
        } catch {
          errors.push(`H5: reloading onto goldless event ${eventId} never hydrated the select + farm grid`);
        }
        await wait(SETTLE_MS);
      };

      /* --- H1. reachability + one pair per currency, on all three multi-currency shapes --- */
      await resetPlan();
      for (const snap of [EACTIVE, EMULTI, EZERO]) {
        await switchEvent(snap.event.id, `H1: switch → ${snap.event.id}`);
        const ctl = await readFarmCtl(snap.event.id);
        const mapped = mappedIdsOf(snap.currencies);
        const totals = refTotals(snap.items, snap.currencies, (ctl.plan && ctl.plan.requires) || {});
        if (ctl.cards.length !== snap.currencies.length)
          errors.push(
            `H1(${snap.event.id}): ${ctl.cards.length} farm card(s), want ${snap.currencies.length} — one per shop currency`,
          );
        const names = ctl.cards.map((c) => c.headerText);
        if (new Set(names).size !== names.length)
          errors.push(`H1(${snap.event.id}): two farm cards share a header name — ${JSON.stringify(names)}`);
        const foreign = names.filter((n) => n !== null && !snap.currencies.some((c) => c.name === n));
        if (foreign.length)
          errors.push(
            `H1(${snap.event.id}): farm card headers name currencies the event never sold — ${JSON.stringify(foreign)}`,
          );
        /* Amendment K2: NO header may wear opener attrs on any multi-event shape */
        const attrHeaders = ctl.cards.filter(
          (c) => c.headerRole || c.headerTabindex || c.headerHaspopup || c.headerAria || c.headerCurrencyId,
        );
        if (attrHeaders.length)
          errors.push(
            `H1(K2)(${snap.event.id}): ${attrHeaders.length} header(s) still carry opener attrs — ${JSON.stringify(
              attrHeaders.map((c) => [c.headerText, c.headerRole, c.headerTabindex, c.headerHaspopup, c.headerAria, c.headerCurrencyId]),
            )}`,
          );
        const tierState = await readTier();
        for (const currency of snap.currencies) {
          const id = String(currency.id);
          const card = ctl.cards.find((c) => c.headerText === currency.name);
          if (!card) {
            errors.push(
              `H1(${snap.event.id}): no farm card header named ${currency.name} (${id}, background ${currency.background}) — ${
                mapped.has(id) ? "its tier Required is the modal door" : "unmapped: the card and its Held/Bonus pair must still render"
              }`,
            );
            continue;
          }
          /* K2 absence: the header is a plain display — role/tabindex/aria-haspopup/aria-label/dataset all gone */
          if (card.headerRole || card.headerTabindex || card.headerHaspopup || card.headerAria || card.headerCurrencyId)
            errors.push(
              `H1(K2)(${snap.event.id}): ${currency.name} header carries ${JSON.stringify([card.headerRole, card.headerTabindex, card.headerHaspopup, card.headerAria, card.headerCurrencyId])}, want all absent`,
            );
          if (card.headerText !== currency.name)
            errors.push(`H1(${snap.event.id}): ${currency.name} header text reads ${JSON.stringify(card.headerText)}`);
          /* I7: no Required surface may live in a farm card */
          if (card.requireDisplays || card.requiredIds.length)
            errors.push(
              `H1(${snap.event.id}): ${currency.name} farm card still carries a Required display (${card.requireDisplays} eshop-require-display, ids ${JSON.stringify(card.requiredIds)}) — Amendment I7 deleted it, the tier cards are its only home`,
            );
          /* the spend this card used to show now lives on the tier card — and only for a mapped
             currency; an unmapped one has no Required anywhere by design (H2/H3 pin its modal).
             A background outside TIERS (QP's "zero") maps to no card at all. */
          const mappedHere = TIERS.includes(currency.background)
            ? currencyForTierRef(snap.currencies, currency.background)
            : null;
          if (mappedHere && String(mappedHere.id) === id) {
            const td = tierState.tiers[currency.background];
            if (!td || td.needValue !== String(totals[id]))
              errors.push(
                `H1(${snap.event.id}): ${currency.name} tier Required reads ${JSON.stringify(td && td.needValue)}, want ITS currency's spend ${totals[id]}`,
              );
          } else if (totals[id] !== 0 && mapped.has(id))
            errors.push(`H1(${snap.event.id}): ${currency.name} is first-match mapped but its tier box is missing`);
          const wantLabels = mapped.has(id) ? "" : "Bonus,Held";
          const gotLabels = card.boxes.map((b) => b.label).sort().join(",");
          if (gotLabels !== wantLabels)
            errors.push(
              `H1(${snap.event.id}): ${currency.name} (${id}) farm card holds [${gotLabels}], want [${wantLabels}] — ${
                mapped.has(id)
                  ? "a tier-mapped currency already has the tier-card pair; a second pair makes two writers for one figure"
                  : "a currency with no tier card must own its Held/Bonus pair on the farm card"
              }`,
            );
          for (const b of card.boxes) {
            if (b.id !== `farm${b.label}${id}`)
              errors.push(
                `H1(${snap.event.id}): ${currency.name} ${b.label} box id ${JSON.stringify(b.id)}, want "farm${b.label}${id}"`,
              );
            if (b.aria !== `${currency.name} ${b.label.toLowerCase()}`)
              errors.push(
                `H1(${snap.event.id}): ${currency.name} ${b.label} aria-label is ${JSON.stringify(b.aria)}, want "${currency.name} ${b.label.toLowerCase()}"`,
              );
            if (b.readOnly)
              errors.push(`H1(${snap.event.id}): ${currency.name} ${b.label} farm box is readOnly — it is an input`);
            if (b.labelBg !== card.cardBg)
              errors.push(
                `H7: ${snap.event.id} ${currency.name} ${b.label} chip is ${b.labelBg} on a ${card.cardBg} card — the pill paints a tint patch (mask rule missing)`,
              );
          }
        }
      }

      /* --- H2. 80379 second gold: inert headers, currency-keyed plan, first-gold-only door --- */
      const golds = EMULTI.currencies.filter((c) => c.background === "gold");
      const [firstGold, secondGold] = golds;
      const secondItem = itemsOf(EMULTI, secondGold.id)[0];
      /* K2 removed the unmapped currency's modal door entirely — its draft survives only as a SAVED
         plan. Seed the blob the way the old modal-Done path wrote it, reload, and pin what the page
         does with it: totals key by currency, the tier maps first-match, and no header opens. */
      const farmHeaderInert = async (name, label) => {
        const handles = await page.$$("#farmGrid .farm-card:not(.farm-card--combo) .farm-card-title");
        let hit = null;
        for (const el of handles) {
          const t = await el.evaluate((e) => {
            const img = e.querySelector("img");
            return (img && img.getAttribute("alt")) || e.textContent.replace(/\s+/g, " ").trim();
          });
          if (t === name) hit = el;
        }
        if (!hit) {
          errors.push(`${label}: no farm header named ${name} — the card vanished`);
          return;
        }
        await hit.click();
        await wait(SETTLE_MS);
        if ((await readModal()).open) {
          errors.push(`${label}: clicking ${name}'s farm header opened the modal — K2 says the header is not a control`);
          await closeBy("Escape", `${label}: recover after header click`);
        }
        await hit.focus();
        await page.keyboard.press("Enter");
        await wait(SETTLE_MS);
        if ((await readModal()).open) {
          errors.push(`${label}: Enter on ${name}'s farm header opened the modal`);
          await closeBy("Escape", `${label}: recover after header Enter`);
        }
      };
      await resetPlan();
      await switchEvent(PIN_MULTI, "H2: switch → 80379 (two golds)");
      await seedAndReload(
        JSON.stringify({
          selectedEventId: PIN_MULTI,
          plans: { [String(PIN_MULTI)]: { requires: { [String(secondItem.id)]: 5 }, held: {}, bonus: {} } },
        }),
      );
      const h2ctl = await readFarmCtl(PIN_MULTI);
      const h2tier = await readTier();
      if ((h2ctl.plan.requires || {})[String(secondItem.id)] !== 5)
        errors.push(`H2: the reload lost the seeded second-gold row — ${JSON.stringify(h2ctl.plan.requires)}`);
      const want2 = refTotals(EMULTI.items, EMULTI.currencies, (h2ctl.plan && h2ctl.plan.requires) || {});
      if (want2[String(secondGold.id)] !== 5 * secondItem.cost.amount)
        errors.push(
          `H2: the reference says ${secondGold.name} spend is ${want2[String(secondGold.id)]}, expected 5 × ${secondItem.cost.amount} — the plan did not key by currency`,
        );
      if (h2tier.tiers.gold.needValue !== "0")
        errors.push(
          `H2: the gold TIER Required reads ${JSON.stringify(h2tier.tiers.gold.needValue)} — the tier maps to ${firstGold.name}, whose plan is empty; ${secondGold.name}'s spend must never tint it`,
        );
      /* no header opens anything; only the mapped first gold's tier Required has a door */
      await farmHeaderInert(firstGold.name, "H2: first gold header");
      await farmHeaderInert(secondGold.name, "H2: second gold header");
      await safeClick(sel.tierNeed("gold"));
      if (await modalGate(true, "H2: the mapped gold's tier Required opens ITS modal")) {
        const m2f = await readModal();
        if (m2f.title !== `${firstGold.name} \u2014 Shop Items`)
          errors.push(`H2: the tier Required opened ${JSON.stringify(m2f.title)}, want the first gold's own modal`);
        if (m2f.rows.some((r) => r.id === String(secondItem.id)))
          errors.push(`H2: the ${firstGold.name} modal lists ${secondGold.name}'s row — first-match must not merge the golds`);
        if (m2f.rows.some((r) => r.value !== "0"))
          errors.push(`H2: the ${firstGold.name} modal shows spend ${JSON.stringify(m2f.rows.map((r) => r.value))} — the seeded plan belongs to the OTHER gold`);
        await closeBy("Escape", "H2: Escape discards the draft");
      }

      /* --- H3. 80292 QP + second silver: three independent totals, all doors closed but tier --- */
      const silvers = EZERO.currencies.filter((c) => c.background === "silver");
      const [firstSilver, secondSilver] = silvers;
      const qp = EZERO.currencies.find((c) => String(c.id) === "1");
      const qpItems = itemsOf(EZERO, qp.id);
      const qpBig = qpItems.find((i) => i.limitNum > 1);
      const qpSmall = qpItems.find((i) => i.limitNum === 1);
      const kpItem = itemsOf(EZERO, secondSilver.id).find((i) => i.limitNum === 1);
      await resetPlan();
      await switchEvent(PIN_ZERO, 'H3: switch → 80292 (QP "zero" + two silvers)');
      /* K2: QP and the second silver have NO opener in this build — their drafts arrive as a saved
         plan (exactly the figures the old header-modal path used to commit). */
      await seedAndReloadGoldless(
        JSON.stringify({
          selectedEventId: PIN_ZERO,
          plans: {
            [String(PIN_ZERO)]: {
              requires: { [String(qpBig.id)]: qpBig.limitNum, [String(qpSmall.id)]: 1, [String(kpItem.id)]: 1 },
              held: {},
              bonus: {},
            },
          },
        }),
        PIN_ZERO,
      );
      const h3ctl = await readFarmCtl(PIN_ZERO);
      const h3tier = await readTier();
      const want3 = refTotals(EZERO.items, EZERO.currencies, (h3ctl.plan && h3ctl.plan.requires) || {});
      const qpBigTruth = qpItems.find((i) => i.limitNum > 1);
      const qpSmallTruth = qpItems.find((i) => i.limitNum === 1);
      const wantQpTruth = qpBigTruth.limitNum * qpBigTruth.cost.amount + qpSmallTruth.cost.amount;
      if (want3[String(qp.id)] !== wantQpTruth)
        errors.push(
          `H3: the reference QP spend is ${want3[String(qp.id)]}, pinned data truth ${wantQpTruth} — re-verify before blaming the app`,
        );
      /* three currencies, three independent plans — the unmapped ones open NOTHING and never tint
         the mapped currency's modal (first-match owns the single door) */
      await farmHeaderInert(qp.name, "H3: QP header");
      await farmHeaderInert(secondSilver.name, "H3: second silver header");
      await farmHeaderInert(firstSilver.name, "H3: mapped silver header");
      await safeClick(sel.tierNeed("silver"));
      if (await modalGate(true, "H3: the mapped silver's tier Required opens ITS modal")) {
        const m3 = await readModal();
        if (m3.title !== `${firstSilver.name} \u2014 Shop Items`)
          errors.push(`H3: the tier Required opened ${JSON.stringify(m3.title)}, want the mapped ${firstSilver.name}`);
        if (m3.rows.some((r) => r.id === String(kpItem.id)))
          errors.push(`H3: the ${firstSilver.name} modal lists ${secondSilver.name}'s row — the silvers must stay separate`);
        if (m3.rows.some((r) => r.id === String(qpBig.id) || r.id === String(qpSmall.id)))
          errors.push(`H3: the ${firstSilver.name} modal lists QP rows — "zero" maps to no tier card`);
        if (m3.rows.some((r) => r.value !== "0"))
          errors.push(`H3: the ${firstSilver.name} modal shows ${JSON.stringify(m3.rows.map((r) => r.value))} — the seeded spend belongs to OTHER currencies`);
        await closeBy("Escape", "H3: close the mapped silver's modal");
      }
      for (const currency of EZERO.currencies) {
        const mappedHere = TIERS.includes(currency.background) ? currencyForTierRef(EZERO.currencies, currency.background) : null;
        if (!mappedHere || String(mappedHere.id) !== String(currency.id)) continue;
        const td = h3tier.tiers[currency.background];
        if (td && td.needValue !== String(want3[String(currency.id)]))
          errors.push(
            `H3: ${currency.name} tier Required reads ${JSON.stringify(td.needValue)}, want ${want3[String(currency.id)]} — three currencies must keep three totals`,
          );
      }
      if (h3tier.tiers.silver.needValue !== "0")
        errors.push(
          `H3: the silver TIER Required reads ${JSON.stringify(h3tier.tiers.silver.needValue)} after spending QP and ${secondSilver.name} — the mapped ${firstSilver.name} plan is empty`,
        );
      if (h3tier.tiers.gold.needValue !== "0")
        errors.push(`H3: 80292 has no gold currency but the gold Required reads ${JSON.stringify(h3tier.tiers.gold.needValue)}`);

      /* --- H4. Calculate inside the debounce window prices the FARM box's fresh figure --- */
      await resetPlan();
      await switchEvent(PIN_MULTI, "H4: switch → 80379");
      await safeClick(sel.tierNeed("gold"));
      await modalGate(true, "H4: open the mapped gold modal");
      const firstItem = itemsOf(EMULTI, firstGold.id)[0];
      await typeInto(sel.modalInput(String(firstItem.id)), "10");
      await clickDone();
      await typeInto(sel.tierHeld("gold"), "4");
      await wait(SETTLE_MS);
      /* One JS task: type the farm box, press Calculate, read localStorage. The trailing debounce
         cannot have run between them, so a fresh figure in the plan is proof of a synchronous commit. */
      const h4 = await page.evaluate(
        (args) => {
          const box = document.getElementById(`farmHeld${args.second}`);
          box.value = "500";
          const t0 = performance.now();
          box.dispatchEvent(new Event("input", { bubbles: true }));
          document.getElementById("calculateBtn").click();
          const stored = JSON.parse(localStorage.getItem(args.key));
          return {
            ms: performance.now() - t0,
            held: stored.plans[String(args.event)].held,
            farmEmpty: (document.querySelector("#results .farm-res-empty") || {}).textContent || null,
          };
        },
        { second: String(secondGold.id), key: KEY, event: PIN_MULTI },
      );
      if (h4.ms >= DEBOUNCE_MS)
        errors.push(`H4: input→Calculate took ${h4.ms}ms, outside DEBOUNCE_MS ${DEBOUNCE_MS} — the scene did not test the window`);
      if (h4.held[String(secondGold.id)] !== 500)
        errors.push(
          `H4: Calculate ${h4.ms}ms after typing 500 into the farm Held box priced ${JSON.stringify(h4.held[String(secondGold.id)])} — the synchronous farm commit did not run, so a fast Calculate prices a stale figure`,
        );
      if (h4.held[String(firstGold.id)] !== 4)
        errors.push(
          `H4: the farm box write moved the MAPPED currency's held (${JSON.stringify(h4.held[String(firstGold.id)])}, want 4) — writes must key on the card's own currency`,
        );
      if (h4.farmEmpty !== "No drop data can cover this plan")
        errors.push(
          `H4: #results empty message is ${JSON.stringify(h4.farmEmpty)} — second gold 500 must not pay first gold's deficit`,
        );
      await wait(SETTLE_MS);
      const h4ctl = await readFarmCtl(PIN_MULTI);
      const h4Held = (h4ctl.cards.find((c) => c.headerText === secondGold.name) || { boxes: [] }).boxes.find(
        (b) => b.label === "Held",
      );
      if (!h4Held || h4Held.value !== "500")
        errors.push(
          `H4: after the trailing debounce the farm Held box reads ${JSON.stringify(h4Held && h4Held.value)}, want "500" kept`,
        );
      await page.reload({ waitUntil: "networkidle0" });
      await ensureEventTab();
      await wait(SETTLE_MS);
      const h4r = await readFarmCtl(PIN_MULTI);
      if (h4r.plan.held[String(secondGold.id)] !== 500)
        errors.push(`H4: the farm figure did not survive a reload — plan.held is ${JSON.stringify(h4r.plan.held)}`);

      /* --- H5. stored TIER keys migrate to CURRENCY keys through first-match --- */
      const migH = JSON.stringify({
        selectedEventId: PIN_MULTI,
        plans: { [String(PIN_MULTI)]: { held: { gold: 1234 }, bonus: { gold: 7 } } },
      });
      await seedAndReload(migH);
      const h5 = await readTier();
      const h5ctl = await readFarmCtl(PIN_MULTI);
      if (h5.tiers.gold.heldValue !== "1234" || h5.tiers.gold.bonusValue !== "7")
        errors.push(
          `H5: the gold tier boxes did not receive the stored tier keys — ${JSON.stringify([h5.tiers.gold.heldValue, h5.tiers.gold.bonusValue])}, want ["1234","7"]`,
        );
      const secondBoxes = (h5ctl.cards.find((c) => c.headerText === secondGold.name) || { boxes: [] }).boxes;
      if (secondBoxes.some((b) => b.value !== "0"))
        errors.push(
          `H5: the stored "gold" figure landed on ${secondGold.name} too — ${JSON.stringify(secondBoxes)}; first-match says it belongs to ${firstGold.name} alone`,
        );
      if (h5.storage !== migH)
        errors.push(
          `H5: load rewrote the tier-keyed blob (${JSON.stringify(h5.storage && h5.storage.slice(0, 90))}) — migration stays in memory until a mutation`,
        );
      await typeInto(`#farmHeld${secondGold.id}`, "3");
      await wait(SETTLE_MS);
      const h5w = (await readFarmCtl(PIN_MULTI)).plan;
      if (JSON.stringify(Object.keys(h5w.held).sort()) !== JSON.stringify([firstGold.id, secondGold.id].map(String).sort()))
        errors.push(`H5: after the rewrite held keys are ${JSON.stringify(Object.keys(h5w.held))}, want the two currency ids only`);
      if (h5w.held[String(firstGold.id)] !== 1234 || h5w.held[String(secondGold.id)] !== 3)
        errors.push(`H5: the migrated figures did not survive the rewrite — held is ${JSON.stringify(h5w.held)}`);
      if (h5w.bonus[String(firstGold.id)] !== 7 || Object.keys(h5w.bonus).some((k) => k === "gold"))
        errors.push(`H5: bonus after rewrite is ${JSON.stringify(h5w.bonus)} — the tier key must be gone, 7 on ${firstGold.name}`);
      const migZ = JSON.stringify({
        selectedEventId: PIN_ZERO,
        plans: { [String(PIN_ZERO)]: { held: { silver: 50, zero: 99, bronze: 7 }, bonus: { silver: 2 } } },
      });
      await seedAndReloadGoldless(migZ, PIN_ZERO);
      const h5z = await readTier();
      const h5zctl = await readFarmCtl(PIN_ZERO);
      if (h5z.tiers.silver.heldValue !== "50")
        errors.push(
          `H5: 80292 stored "silver" did not migrate onto the mapped ${firstSilver.name} — the box reads ${JSON.stringify(h5z.tiers.silver.heldValue)}, want "50"`,
        );
      if (h5z.tiers.bronze.heldValue !== "0")
        errors.push(
          `H5: a stored "bronze" figure survived on an event with no bronze currency — ${JSON.stringify(h5z.tiers.bronze.heldValue)}`,
        );
      for (const cur of [qp, secondSilver]) {
        const boxes = (h5zctl.cards.find((c) => c.headerText === cur.name) || { boxes: [] }).boxes;
        if (boxes.some((b) => b.value !== "0"))
          errors.push(
            `H5: currency ${cur.id} received a tier key it does not map to (${JSON.stringify(boxes)}) — "zero" is not a tier and ${secondSilver.name} is not first-match`,
          );
      }
      await typeInto(`#farmHeld${secondSilver.id}`, "1");
      await wait(SETTLE_MS);
      const h5zw = (await readFarmCtl(PIN_ZERO)).plan;
      const wantZKeys = EZERO.currencies.map((c) => String(c.id)).sort().join();
      if (Object.keys(h5zw.held).sort().join() !== wantZKeys)
        errors.push(`H5: 80292 held keys after rewrite are ${JSON.stringify(Object.keys(h5zw.held))}, want ${wantZKeys}`);
      if (h5zw.held[String(secondSilver.id)] !== 1 || h5zw.held[String(firstSilver.id)] !== 50 || h5zw.held[String(qp.id)] !== 0)
        errors.push(`H5: 80292 held after rewrite is ${JSON.stringify(h5zw.held)} — want 50 on ${firstSilver.name}, 1 on ${secondSilver.name}, 0 on QP`);

      /* --- H6. a debounce pending across an Event Select switch must not reach the new plan --- */
      await resetPlan();
      await switchEvent(PIN_ZERO, "H6: switch → 80292 (same-task race)");
      const h6 = await page.evaluate(
        (args) => {
          const box = document.getElementById(`farmHeld${args.qp}`);
          box.value = "424242";
          const t0 = performance.now();
          box.dispatchEvent(new Event("input", { bubbles: true }));
          const select = document.getElementById("eventSelect");
          select.value = String(args.other);
          select.dispatchEvent(new Event("change", { bubbles: true }));
          const blob = JSON.parse(localStorage.getItem(args.key)).plans;
          return {
            ms: performance.now() - t0,
            detached: box.isConnected === false,
            oldHeld: (blob[String(args.event)].held || {})[args.qp],
            newStillThere: !!document.getElementById(`farmHeld${args.qp}`),
          };
        },
        { qp: String(qp.id), other: PIN_OTHER, event: PIN_ZERO, key: KEY },
      );
      if (h6.ms >= DEBOUNCE_MS)
        errors.push(`H6: input→switch took ${h6.ms}ms, outside DEBOUNCE_MS ${DEBOUNCE_MS} — the scene did not test the window`);
      if (!h6.detached)
        errors.push(
          "H6: the farm box was still connected after the switch — replaceChildren did not detach it, so the stale-timer guard never ran",
        );
      if (h6.newStillThere)
        errors.push("H6: the new event's grid still holds 80292's QP Held box — the farm grid did not repaint on switch");
      if (h6.oldHeld !== 424242)
        errors.push(
          `H6: switching mid-debounce lost a typed farm figure — plans["${PIN_ZERO}"].held["${qp.id}"] is ${JSON.stringify(h6.oldHeld)}, want 424242 (flushPlanBoxes must commit to the event that was active while typing)`,
        );
      await wait(SETTLE_MS); // the pending timer fires well after the new grid is live
      const h6b = JSON.parse((await readTier()).storage).plans;
      const heldOther = h6b[String(PIN_OTHER)].held || {};
      if (Object.prototype.hasOwnProperty.call(heldOther, String(qp.id)))
        errors.push(
          `H6: the stale farm timer wrote QP's 424242 into event ${PIN_OTHER}'s plan under key "${qp.id}" (${JSON.stringify(heldOther)}) — a detached input must never write the new event's plan`,
        );
      if (Object.values(heldOther).some((v) => v !== 0))
        errors.push(`H6: event ${PIN_OTHER} carries held ${JSON.stringify(heldOther)} it never had`);
      await resetPlan();
      await switchEvent(PIN_ZERO, "H6c: switch → 80292 (real keystrokes)");
      await typeInto(`#farmHeld${qp.id}`, "777");
      await page.select("#eventSelect", String(PIN_OTHER));
      await wait(SETTLE_MS * 2);
      const h6c = JSON.parse((await readTier()).storage).plans;
      if ((h6c[String(PIN_ZERO)].held || {})[String(qp.id)] !== 777)
        errors.push(
          `H6c: a real-typed farm figure was lost on switch — plans["${PIN_ZERO}"].held["${qp.id}"] reads ${JSON.stringify((h6c[String(PIN_ZERO)].held || {})[String(qp.id)])}, want 777`,
        );
      if (Object.prototype.hasOwnProperty.call(h6c[String(PIN_OTHER)].held || {}, String(qp.id)))
        errors.push(
          `H6c: event ${PIN_OTHER} inherited QP's figure — ${JSON.stringify(h6c[String(PIN_OTHER)].held)}`,
        );

      /* --- H7. the shipped mask rule, and the tier-card chip it must not touch --- */
      const mask = await page.evaluate(() => {
        let rule = null;
        for (const sheet of document.styleSheets) {
          try {
            for (const r of sheet.cssRules) {
              if (r.selectorText && r.selectorText.replace(/\s+/g, "") === ".farm-card.material-input-box-label")
                rule = { background: r.style.getPropertyValue("background"), bg: r.style.getPropertyValue("background-color") };
            }
          } catch {
            /* cross-origin sheets are unreadable; the shipped CSS is inline, so this never fires */
          }
        }
        const farm = [...document.querySelectorAll("#farmGrid .farm-card")].map((c) => ({
          tier: c.dataset.tier,
          cardBg: getComputedStyle(c).backgroundColor,
          chips: [...c.querySelectorAll(".material-input-box-label")].map((l) => getComputedStyle(l).backgroundColor),
        }));
        return { rule, farm };
      });
      if (!mask.rule || !/var\(--bg\)/.test(`${mask.rule.background} ${mask.rule.bg}`))
        errors.push(
          `H7: the shipped CSSOM has no .farm-card .material-input-box-label { background: var(--bg) } rule — ${JSON.stringify(mask.rule)}`,
        );
      for (const c of mask.farm)
        for (const chip of c.chips)
          if (chip !== c.cardBg)
            errors.push(
              `H7: the ${c.tier} farm card's label chip is ${chip} on a ${c.cardBg} surface — the tint patch the mask rule exists to remove is back`,
            );
      await resetPlan();
    }

    /* ================= 18. pre-G blob migration (live id and dead id) ========================== */
    {
      const migrateSeed = JSON.stringify({ eventId: ACTIVE_ID, requires: { [String(freeRow.id)]: 3 } });
      await seedAndReload(migrateSeed);
      const mig = await readTier();
      assertPlan(mig, { [String(freeRow.id)]: 3 }, "migration: old {eventId, requires} plan is live");
      if (mig.select.value !== String(ACTIVE_ID))
        errors.push(
          `migration: the old blob's eventId did not become the selection — select reads ${JSON.stringify(mig.select.value)}`,
        );
      if (mig.storage !== migrateSeed)
        errors.push(
          `migration: load rewrote the blob (${JSON.stringify(mig.storage && mig.storage.slice(0, 60))}) — the disk must stay untouched until a mutation`,
        );
      /* first mutation rewrites into the G shape and must keep the migrated requires */
      await typeInto("#goldHave", "5");
      await wait(SETTLE_MS); // debounced writer: let the first mutation flush
      const written = JSON.parse((await readTier()).storage);
      if (!written.plans || !written.plans[String(ACTIVE_ID)])
        errors.push(
          `migration: after a mutation storage is not the G shape — ${JSON.stringify(written).slice(0, 120)}`,
        );
      else if ((written.plans[String(ACTIVE_ID)].requires || {})[String(freeRow.id)] !== 3)
        errors.push(
          `migration: the rewrite lost the migrated requires — ${JSON.stringify(written.plans[String(ACTIVE_ID)])}`,
        );
      if (written.selectedEventId !== ACTIVE_ID)
        errors.push(`migration: rewritten selectedEventId is ${JSON.stringify(written.selectedEventId)}`);
      /* a dead event's old-shape plan is dropped and the selection falls back to the latest */
      const mismatchSeed = JSON.stringify({ eventId: ACTIVE_ID + 7, requires: { [String(freeRow.id)]: 5 } });
      await seedAndReload(mismatchSeed);
      let mismatchTier = await readTier();
      assertPlan(mismatchTier, {}, "dead-event blob: plan dropped");
      if (mismatchTier.select.value !== String(LATEST.event.id))
        errors.push(
          `dead-event blob: selection ${JSON.stringify(mismatchTier.select.value)}, want the latest ${LATEST.event.id}`,
        );
      if (mismatchTier.storage !== mismatchSeed)
        errors.push(
          `dead-event blob: the app rewrote storage on load (${JSON.stringify(mismatchTier.storage && mismatchTier.storage.slice(0, 60))}) — it must leave the dead blob alone until a mutation`,
        );
      await openTierModal("bronze", "open after dead-event seed");
      await clickDone();
      mismatchTier = await readTier();
      const storedMismatch = mismatchTier.storage ? JSON.parse(mismatchTier.storage) : null;
      if (!storedMismatch || storedMismatch.selectedEventId !== ACTIVE_ID)
        errors.push(
          `dead-event blob: first mutation stored selectedEventId ${storedMismatch && storedMismatch.selectedEventId}, want the current ${ACTIVE_ID}`,
        );
      await resetPlan();
    }

    /* ================= 19. hostile localStorage blobs still sanitise ========================== */
    const junkIds = ITEMS.slice(0, 6).map((i) => String(i.id));
    const garbage = [
      ["corrupt text", "{{{ not json"],
      ["null", "null"],
      ["bare string", '"a shop plan"'],
      ["array", "[1,2,3]"],
      ["no ids", JSON.stringify({ plans: { [String(ACTIVE_ID)]: { requires: { [junkIds[0]]: 9 } } } })],
      ["plans string", JSON.stringify({ selectedEventId: ACTIVE_ID, plans: "99" })],
      ["plans array", JSON.stringify({ selectedEventId: ACTIVE_ID, plans: [7, 8, 9] })],
      [
        "old shape + prototype pollution + garbage values",
        `{"eventId":${ACTIVE_ID},"requires":{"__proto__":999,"constructor":{"prototype":{"polluted":true}},` +
          `"${junkIds[0]}":-0,"${junkIds[1]}":"1e3","${junkIds[2]}":1e999,` +
          `"${junkIds[3]}":[5],"${junkIds[4]}":true,"${junkIds[5]}":null,"70000000":99999,"${junkIds[0]}_x":1}}`,
      ],
      [
        "G shape pollution + dead-event plan + tier values out of range",
        `{"selectedEventId":${ACTIVE_ID},"plans":{"${ACTIVE_ID}":{"requires":{"__proto__":7,"polluted":` +
          `{"x":1},"${junkIds[0]}":-0,"${junkIds[1]}":"1e3","${junkIds[2]}":1e999,"${junkIds[3]}":[5],` +
          `"${junkIds[4]}":true,"${junkIds[5]}":null,"70000000":99999},"held":{"bronze":"1e9","silver":-4,` +
          `"constructor":2},"bonus":{"gold":1e999,"bronze":"x","silver":null}},"99999":{"requires":{"${junkIds[0]}":4}},` +
          `"__proto__":{"polluted":true}}}`,
      ],
    ];
    for (const [label, raw] of garbage) {
      await seedAndReload(raw);
      const stt = await readTier();
      if (stt.polluted) errors.push(`garbage storage (${label}): Object.prototype was polluted`);
      /* independent reference sanitiser: what may survive, per blob shape */
      const expect = {};
      let expectSelected = LATEST.event.id;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const blobPlans =
            parsed.plans || (parsed.eventId ? { [String(parsed.eventId)]: { requires: parsed.requires } } : null);
          if (parsed.eventId && !parsed.plans)
            expectSelected = parsed.eventId === ACTIVE_ID ? ACTIVE_ID : LATEST.event.id;
          if (parsed.selectedEventId && typeof parsed.selectedEventId === "object") expectSelected = LATEST.event.id;
          else if (parsed.selectedEventId !== undefined)
            expectSelected = EVENTS.some(
              (e) => e.event.id === parsed.selectedEventId && typeof parsed.selectedEventId === "number",
            )
              ? parsed.selectedEventId
              : LATEST.event.id;
          const plan = blobPlans && blobPlans[String(expectSelected)];
          const req =
            plan && plan.requires && typeof plan.requires === "object" && !Array.isArray(plan.requires)
              ? plan.requires
              : {};
          if (expectSelected === ACTIVE_ID) {
            for (const [id, value] of Object.entries(req)) {
              const item = byId.get(id);
              if (item) expect[id] = refClamp(item, value);
            }
          }
        }
      } catch {
        expect["__unparseable__"] = null;
      }
      if (expect.__unparseable__) assertPlan(stt, {}, `garbage storage (${label})`);
      else assertPlan(stt, expect, `garbage storage (${label})`);
      for (const t of TIERS) {
        if (!/^\d+$/.test(stt.tiers[t].needValue || ""))
          errors.push(
            `garbage storage (${label}): ${t} Required holds non-canonical text ${JSON.stringify(stt.tiers[t].needValue)}`,
          );
      }
      /* held/bonus figures for the G-shape case: Have 0..999999, Bonus 0..1000, floor */
      if (label.startsWith("G shape")) {
        const clampVal = (v, max) => {
          const n = parseFloat(v);
          /* mirrors Validator.clamp exactly: NaN → min, Infinity → max (NOT zero) */
          return Math.floor(Number.isNaN(n) ? 0 : Math.min(max, Math.max(0, n)));
        };
        const wantHave = { bronze: clampVal("1e9", 999999), silver: clampVal(-4, 999999), gold: 0 };
        const wantBonus = { bronze: clampVal("x", 1000), silver: 0, gold: clampVal(1e999, 1000) };
        for (const t of TIERS) {
          const gotHave = stt.tiers[t].heldValue;
          const gotBonus = stt.tiers[t].bonusValue;
          if (gotHave !== String(wantHave[t]))
            errors.push(
              `garbage storage (${label}): ${t} Held reads ${JSON.stringify(gotHave)}, want the clamped ${wantHave[t]}`,
            );
          if (gotBonus !== String(wantBonus[t]))
            errors.push(
              `garbage storage (${label}): ${t} Bonus reads ${JSON.stringify(gotBonus)}, want the clamped ${wantBonus[t]}`,
            );
        }
      }
      await openTierModal("gold", `open draft after garbage (${label})`);
      modal = await readModal();
      const draftRow = modal.rows.find((r) => r.id === String(clampRow.id));
      const wantDraft = expect[String(clampRow.id)] || 0;
      if (draftRow && draftRow.value !== String(wantDraft))
        errors.push(
          `garbage storage (${label}): draft opens at ${JSON.stringify(draftRow && draftRow.value)} for row ${clampRow.id}, want the sanitised ${wantDraft}`,
        );
      await safeClick(sel.modalPlus(clampRow.id));
      await wait(SETTLE_MS);
      await clickDone();
      const usable = await readTier();
      const usableExpect = { ...expect, [String(clampRow.id)]: Math.min(maxRequire(clampRow), wantDraft + 1) };
      assertPlan(usable, usableExpect, `garbage storage (${label}) then + & Done`);
      if (!usable.storage || usable.storage === raw)
        errors.push(
          `garbage storage (${label}): the commit did not rewrite storage ("${usable.storage && usable.storage.slice(0, 60)}")`,
        );
    }

    /* ================= 20. localStorage quota failure must not crash the Done path ============ */
    await resetPlan();
    await installWriteSpy({ throw: true });
    await openTierModal("bronze", "open modal for quota scene");
    await typeInto(sel.modalInput(freeRow.id), "1");
    const beforeQuotaErrors = pageErrors.length;
    await safeClick("#eventShopModalDoneBtn");
    await modalGate(false, "Done closes even when the save throws");
    await wait(SETTLE_MS);
    const quotaState = await readTier();
    assertPlan(quotaState, { [String(freeRow.id)]: 1 }, "quota failure keeps the plan live (state before persist)");
    if (quotaState.tiers.bronze.needValue !== String(freeRow.cost.amount))
      errors.push(`quota failure: tier Required did not follow the live plan (${quotaState.tiers.bronze.needValue})`);
    if (quotaState.storage)
      errors.push(`quota failure: storage holds "${quotaState.storage}", the write must have been refused`);
    if (pageErrors.length !== beforeQuotaErrors)
      errors.push(
        `quota failure: pageerror escaped the try/catch — ${JSON.stringify(pageErrors.slice(beforeQuotaErrors))}`,
      );
    const warned = consoleWarnings().some((w) => /Event shop planner save failed/.test(w));
    if (!warned)
      errors.push(
        `quota failure: the failed save was swallowed with no console warning (console: ${JSON.stringify(consoleMessages.slice(-4))})`,
      );
    await uninstallWriteSpy();
    await openTierModal("bronze", "reopen after quota recovery");
    modal = await readModal();
    const recoveryRow = modal.rows.find((r) => r.id === String(freeRow.id));
    if (recoveryRow && recoveryRow.value !== "1")
      errors.push(
        `quota recovery: the draft lost the in-memory plan (reads ${JSON.stringify(recoveryRow && recoveryRow.value)}, want "1")`,
      );
    await safeClick(sel.modalPlus(freeRow.id));
    await clickDone();
    const afterQuota = await readTier();
    assertPlan(afterQuota, { [String(freeRow.id)]: 2 }, "saving works again once setItem is restored");

    /* ================= 21. backdrop mousedown = click-outside immunity ======================== */
    await resetPlan();
    await openTierModal("bronze", "open for backdrop check");
    await typeInto(sel.modalInput(freeRow.id), "12");
    await page.evaluate(() => {
      const m = document.getElementById("eventShopModal");
      m.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await wait(SETTLE_MS);
    if (!(await readModal()).open)
      errors.push("backdrop-immunity: mousedown on backdrop closed #eventShopModal");
    await closeBy("Cancel", "Cancel discards the draft after backdrop check");
    const backdropState = await readTier();
    assertPlan(backdropState, {}, "backdrop-immunity leaves the plan");
    if (backdropState.storage !== null)
      errors.push(
        `backdrop-immunity: localStorage was written (${JSON.stringify(backdropState.storage)}) — backdrop + Cancel is discard, not OK`,
      );

    /* ================= 22. modal icon fallback: transparent plate, dashed badge =============== */
    /* Refuse ONE shop icon file over the wire. The row must fall back to the id badge WITHOUT a
       grey fill. Memory-cached images never reach the interceptor, so this scene also flips the
       browser cache off for its duration. */
    const fallbackItem = [...bronzeItems].reverse().find((i) => i.icon);
    const blockedFile = fallbackItem ? fallbackItem.icon.split("/").pop() : "___none___.webp";
    let abortedLoads = 0;
    const onRequest = (req) => {
      if (/event_shop/.test(req.url()) && req.url().includes(blockedFile)) {
        abortedLoads++;
        req.abort();
      } else req.continue();
    };
    if (fallbackItem) {
      const cdp = await page.createCDPSession();
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await page.setRequestInterception(true);
      page.on("request", onRequest);
      await openTierModal("bronze", "open modal with one refused icon");
      await page.evaluate((id) => {
        const row = document.querySelector(`#eventShopModalList .eshop-item[data-item-id="${id}"]`);
        if (row) row.scrollIntoView({ block: "center" });
      }, String(fallbackItem.id));
      let fallbackRow = null;
      for (let i = 0; i < 40 && !fallbackRow; i++) {
        await wait(100);
        fallbackRow = (await readModal()).rows.find(
          (r) => r.id === String(fallbackItem.id) && r.iconKind === "fallback",
        );
      }
      if (!fallbackRow) {
        errors.push(`modal fallback: row ${fallbackItem.id} never swapped the refused ${blockedFile} for the id badge`);
      } else {
        if (fallbackRow.iconText !== String(fallbackItem.id))
          errors.push(`modal fallback: badge text ${JSON.stringify(fallbackRow.iconText)}, want the item id`);
        const fbStyle = await page.evaluate((id) => {
          const fb = document.querySelector(
            `#eventShopModalList .eshop-item[data-item-id="${id}"] .eshop-item-icon-fallback`,
          );
          if (!fb) return null;
          const cs = getComputedStyle(fb);
          return { bg: cs.backgroundColor, borderStyle: cs.borderStyle, w: fb.offsetWidth, h: fb.offsetHeight };
        }, String(fallbackItem.id));
        if (!fbStyle) errors.push("modal fallback: .eshop-item-icon-fallback node vanished before the style read");
        else {
          if (fbStyle.bg !== "rgba(0, 0, 0, 0)")
            errors.push(
              `modal fallback: badge background ${JSON.stringify(fbStyle.bg)}, want transparent rgba(0,0,0,0)`,
            );
          if (fbStyle.borderStyle !== "dashed")
            errors.push(`modal fallback: badge border-style ${JSON.stringify(fbStyle.borderStyle)}, want dashed`);
          if (!(fbStyle.w >= 40 && fbStyle.h >= 40))
            errors.push(`modal fallback: badge collapsed to ${fbStyle.w}×${fbStyle.h}px`);
        }
        let survivor = null;
        for (let i = 0; i < 30 && !survivor; i++) {
          survivor = (await readModal()).rows.find(
            (r) => r.id !== String(fallbackItem.id) && r.iconKind === "img" && r.iconW > 0,
          );
          if (!survivor) await wait(100);
        }
        if (!survivor) errors.push("modal fallback: refusing one icon broke the sibling draft rows' art");
      }
      page.off("request", onRequest);
      await page.setRequestInterception(false);
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: false }).catch(() => {});
      await cdp.detach().catch(() => {});
      await closeBy("Cancel", "close after fallback scene");
      await page.reload({ waitUntil: "networkidle0" });
      await ensureEventTab();
      await wait(SETTLE_MS);
    }

    /* ================= 23. viewports: no sideways overflow, modal fits, no page errors ======== */
    for (const width of [360, 760, 1120]) {
      await page.setViewport({ width, height: 800 });
      /* K7: the farm grid tracks + the K5 button width behave per viewport */
      const gridInfo = await page.evaluate(() => {
        const g = document.getElementById("farmGrid");
        const b = document.getElementById("calculateBtn");
        return {
          tracks: getComputedStyle(g).gridTemplateColumns.split(" ").map((t) => parseFloat(t)),
          justify: getComputedStyle(g).justifyContent,
          cardW: [...g.querySelectorAll(".farm-card")].map((c) => c.offsetWidth),
          btnRatio: b.getBoundingClientRect().width / b.parentElement.clientWidth,
        };
      });
      const trackStr = gridInfo.tracks.filter((t) => t > 0).join(" ");
      if (width === 1120 && trackStr !== "240 240 240")
        errors.push(
          `farm grid(P3) @1120: non-zero tracks are ${trackStr} (raw ${gridInfo.tracks.join(" ")}), want 240 240 240 (three centred 240px cards with collapsed auto-fit tracks)`,
        );
      if (width === 760 && trackStr !== "240 240")
        errors.push(`farm grid(P3) @760: non-zero tracks are ${trackStr}, want 240 240 (two centred 240px cards)`);
      if (width === 360 && !(gridInfo.tracks.length === 1 && gridInfo.tracks[0] >= 220 && gridInfo.tracks[0] <= 240))
        errors.push(`farm grid(P3) @360: tracks are ${gridInfo.tracks.join(" ")}, want a single 220..240px track`);
      if (gridInfo.justify !== "center")
        errors.push(`farm grid(P3) @${width}: justify-content is ${gridInfo.justify}, want center`);
      if (gridInfo.cardW.some((w) => w > 241))
        errors.push(`farm grid(P3) @${width}: a farm card is ${Math.max(...gridInfo.cardW)}px wide, want at most 240px`);
      if (width < 380 ? gridInfo.btnRatio < 0.95 : !(gridInfo.btnRatio > 0 && gridInfo.btnRatio <= 0.5))
        errors.push(
          `btn(K5) @${width}: #calculateBtn spans ${(gridInfo.btnRatio * 100).toFixed(0)}% of its row, want ${width < 380 ? "house full-width" : "at most half"}`,
        );
      const layout = await page.evaluate(() => {
        const doc = document.documentElement;
        const panel = document.getElementById("panel-event");
        const overflowing = [];
        for (const el of panel.querySelectorAll(
          "input, select, button, img, .material-icon, .mini-icon, .material-input-box, .farm-card, .select-field",
        )) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.right > window.innerWidth + 1 || r.left < -1)
            overflowing.push({ cls: el.className || el.tagName, left: Math.round(r.left), right: Math.round(r.right) });
        }
        return {
          docOverflow: doc.scrollWidth - doc.clientWidth,
          bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
          overflowing: overflowing.slice(0, 4),
        };
      });
      if (layout.docOverflow > 0)
        errors.push(`viewport ${width}px: the page scrolls sideways by ${layout.docOverflow}px`);
      if (layout.bodyOverflow > 0) errors.push(`viewport ${width}px: body overflows by ${layout.bodyOverflow}px`);
      if (layout.overflowing.length)
        errors.push(
          `viewport ${width}px: Event-tab elements past the viewport edge — ${JSON.stringify(layout.overflowing)}`,
        );

      await openTierModal("bronze", `open modal at ${width}px`);
      const modalLayout = await page.evaluate(() => {
        const modal = document.getElementById("eventShopModal");
        const content = modal.querySelector(".servant-modal-content");
        const list = document.getElementById("eventShopModalList");
        const done = document.getElementById("eventShopModalDoneBtn");
        const cr = content.getBoundingClientRect();
        const dr = done.getBoundingClientRect();
        return {
          innerW: window.innerWidth,
          innerH: window.innerHeight,
          content: { l: Math.round(cr.left), r: Math.round(cr.right), t: Math.round(cr.top), b: Math.round(cr.bottom) },
          doneVisible: dr.top >= 0 && dr.bottom <= window.innerHeight && dr.width > 0 && dr.height > 0,
          listScrollable: list.scrollHeight >= list.clientHeight,
          rows: list.querySelectorAll(".eshop-item").length,
          scrollY: window.scrollY,
        };
      });
      if (modalLayout.content.l < -1 || modalLayout.content.r > modalLayout.innerW + 1)
        errors.push(
          `viewport ${width}px modal: content ${modalLayout.content.l}..${modalLayout.content.r} outside 0..${modalLayout.innerW}`,
        );
      if (modalLayout.content.t < -1 || modalLayout.content.b > modalLayout.innerH + 1)
        errors.push(
          `viewport ${width}px modal: content ${modalLayout.content.t}..${modalLayout.content.b} outside 0..${modalLayout.innerH}`,
        );
      if (!modalLayout.doneVisible)
        errors.push(`viewport ${width}px modal: the Done button is not reachable on screen`);
      if (!modalLayout.listScrollable)
        errors.push(`viewport ${width}px modal: the draft list cannot scroll (${modalLayout.rows} rows)`);
      const wheelPt = await page.evaluate(() => {
        const header = document.querySelector("#eventShopModal .servant-modal-header");
        const r = header.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      await page.mouse.move(wheelPt.x, wheelPt.y);
      await page.evaluate(() => window.scrollTo(0, 300));
      const yBefore = await page.evaluate(() => window.scrollY);
      await page.mouse.wheel({ deltaY: 240 });
      await wait(120);
      const yAfter = await page.evaluate(() => window.scrollY);
      if (yBefore !== yAfter)
        errors.push(
          `viewport ${width}px modal: wheel over the backdrop scrolled the page behind it ${yBefore} → ${yAfter}`,
        );
      await closeBy("Cancel", `close modal at ${width}px`);
      console.log(
        `NOTE: viewport ${width}px — doc overflow ${layout.docOverflow}px; modal list rows ${modalLayout.rows}, content ${modalLayout.content.r - modalLayout.content.l}px wide inside ${modalLayout.innerW}px`,
      );
    }
    await page.setViewport({ width: 1120, height: 900 });

    /* ================= 24. the untouched tier/run calculator must still be alive ============== */
    const neighbours = await page.evaluate(() => ({
      calculateBtn: !!document.getElementById("calculateBtn"),
      questRows: document.querySelectorAll("#questGrid > *").length,
    }));
    if (!neighbours.calculateBtn)
      errors.push("regression: #calculateBtn (tier/run calculator) is gone from the Event tab");
    if (neighbours.questRows === 0)
      errors.push(
        `regression: #questGrid has ${neighbours.questRows} children — the calculator broke next to the modal`,
      );
    await page.focus("#silverBonus");
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Digit5");
    await wait(SETTLE_MS);
    const bonusValue = await page.evaluate(() => document.getElementById("silverBonus").value);
    if (bonusValue !== "5")
      errors.push(
        `regression: the tier Bonus input no longer accepts typing (reads ${JSON.stringify(bonusValue)}, want "5")`,
      );

    await resetPlan();
    await page.evaluate((k) => localStorage.removeItem(k), KEY);

    /* ================= 25. network hygiene ==================================================== */
    const badResponses = shopResponses.filter((r) => r.status >= 400);
    if (badResponses.length)
      errors.push(
        `shop icons: ${badResponses.length} /event_shop/ response(s) >= 400 — ${JSON.stringify(badResponses.slice(0, 3))}`,
      );
    const versioned = shopResponses.every((r) => /[?&]v=\d+/.test(r.url));
    if (shopResponses.length && !versioned)
      errors.push(`shop icons: ${shopResponses.length} request(s) fetched, some without the ?v= cache buster`);
    if (externalHosts.size)
      errors.push(
        `planner security: runtime fetched ${JSON.stringify([...externalHosts])} — the site must ship zero external resources`,
      );
    assertMaterialAbsence("network hygiene");
    const stillEmpty = await readIconBoxes();
    if (ICON_CONTAINERS.some((id) => !stillEmpty[id]))
      errors.push("network hygiene: an icon container id vanished after the modal scenes");
    assertEventBoxes(stillEmpty, "network hygiene", CURRENCIES);
    console.log(
      `NOTE: ${shopResponses.length} /event_shop/ response(s) seen, all 2xx=${badResponses.length === 0}, external origins ${JSON.stringify([...externalHosts])}`,
    );

    /* the fallback scene deliberately aborts icon loads: the browser logs one
       "Failed to load resource" per abort — tolerate EXACTLY that many of that one message;
       anything else stays red. */
    const knownAbortNoise = "Failed to load resource: net::ERR_FAILED";
    const realConsoleErrors = consoleErrors().filter((text, i, all) => {
      const budget = abortedLoads;
      const isNoise = text === knownAbortNoise && all.slice(0, i).filter((t) => t === knownAbortNoise).length < budget;
      return !isNoise;
    });
    if (realConsoleErrors.length)
      errors.push(
        `console: ${realConsoleErrors.length} error message(s) — ${JSON.stringify(realConsoleErrors.slice(0, 3))}`,
      );
    if (pageErrors.length) for (const e of pageErrors) errors.push(`pageerror: ${e}`);
  }
} catch (e) {
  errors.push(`gate aborted mid-run: ${e.message.split("\n")[0]}`);
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(`\nFAILED with ${errors.length} error(s):`);
  for (const e of errors) console.error(`  [ERROR] ${e}`);
  process.exit(1);
}

console.log(
  `SUCCESS: event shop [${MODE}] ${LEGACY ? "legacy stub fallback (Select Event disabled, 96px tier-colour badges, old math, old blob, zero mockup requests)" : MULTI ? "multi-event patched copy (isolation + migration + N-currency collision with inert headers + zero-bg + null-farm + secondary-null + force-latest)" : "shipped single-event snapshot (Drop Rates per Run cards, tier Required sole opener, inert headers, 96/48/24 art, live bonus repaint, AP-free results, K5 button parity, auto-fill farm grid, modal contract)"} verified against ${url}`,
);
