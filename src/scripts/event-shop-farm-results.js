import { DOMFactory } from "./presentation.js";
import { buildCurrencyImg } from "./event-shop-tier.js";
import { buildCeImg } from "./event-shop-ce.js";
import { buildQuestName, refreshSlidingNames } from "./event-shop-farm-names.js";

/* ===...=== "Best Farm Runs" results card (Amendment L6b, R18) ===...=== */
/* The plan EventShop.farmPlan found, painted: "Quests to Play" cards in the Drop Rates farm chrome —
   each play one card, its main-drop art over the quest name and the runs number centered where the
   drop lines sit, every currency icon when the quest drops them all, no dropdown — then "Item
   Receive": one 320px card wearing ONE centered row of the runs' raw drops (result.farmed,
   bonus-priced, before any trade), each whole-unit count overlaid on its own 96px art —
   then the "Shop Trades" as per-trade farm cards with the ratio overlaid on the header icons
   (cost→get), no separator bar, centered trade count. No total line: when held items cover every
   deficit, zero plays renders the section header over an empty grid. Receives speak for the runs alone. AP
   never prints (Amendment I); createElement/textContent/setAttribute only, quest names ride one sliding line (R25), rebuilt per Calculate with one replaceChildren(). */
const RESULTS_TITLE = "Best Farm Runs";
const PLAYS_SECTION = "Quests to Play";
const RECEIVE_SECTION = "Item Receive";
const TRADES_SECTION = "Shop Trades";
const NO_PLAN_MESSAGE = "No drop data can cover this plan";
const FIGURE_FORMAT = { maximumFractionDigits: 1 };

export function renderFarmResults(snapshot, view) {
  const inner = document.querySelector("#results .results-card .card-inner");
  if (!inner) return;
  inner.replaceChildren(buildResultsFragment(snapshot, view));
  refreshSlidingNames(inner);
}

function buildResultsFragment(snapshot, view) {
  const fragment = document.createDocumentFragment();
  fragment.appendChild(buildTitle(RESULTS_TITLE, "card-title"));
  if (view.result.totalPlays === null) {
    fragment.appendChild(buildNode(NO_PLAN_MESSAGE, "farm-res-empty"));
    return fragment;
  }
  const currencies = snapshot.currencies || [];
  const bonusCes = snapshot.bonusCes || [];
  const raidQuestById = buildRaidQuestMap(snapshot);
  fragment.appendChild(buildPlaysBlock(currencies, bonusCes, raidQuestById, view.result));
  fragment.appendChild(buildReceiveBlock(currencies, view.result));
  fragment.appendChild(buildTradesBlock(snapshot, view.result));
  return fragment;
}

function buildRaidQuestMap(snapshot) {
  const map = new Map();
  for (const boss of snapshot.farm?.raids || []) {
    for (const quest of boss.quests || []) {
      if (quest && quest.questId !== undefined && quest.questId !== null) map.set(String(quest.questId), quest);
    }
  }
  return map;
}

function buildPlaysBlock(currencies, bonusCes, raidQuestById, result) {
  const wrap = DOMFactory.el("div", "farm-res-quests");
  const grid = DOMFactory.el("div", "farm-grid");
  const ceById = new Map(bonusCes.map((ce) => [String(ce.id), ce]));
  for (const play of result.plays) grid.appendChild(buildPlayCard(currencies, ceById, raidQuestById, play));
  wrap.replaceChildren(buildTitle(PLAYS_SECTION, "quest-title"), grid);
  return wrap;
}

/* Item Receive: one 320px card, ONE centered row of the runs' raw drops (R5a) — no names (the art's
   alt carries them), no trade inflow, no Required. Each whole-unit count (R3) rides its own 96px art
   (R1) bottom-right at 1rem, the Bond golden-fruit display (R4a). */
function buildReceiveBlock(currencies, result) {
  const row = DOMFactory.el("div", "farm-res-row");
  for (const currency of currencies) row.appendChild(buildReceiveFruit(currency, result.farmed));
  const card = DOMFactory.el("div", "farm-res-receive-card");
  card.appendChild(row);
  const wrap = DOMFactory.el("div", "farm-res-receive");
  wrap.replaceChildren(buildTitle(RECEIVE_SECTION, "quest-title"), card);
  return wrap;
}

function buildReceiveFruit(currency, farmed) {
  const fruit = DOMFactory.el("span", "farm-res-fruit");
  fruit.replaceChildren(buildCurrencyImg(currency, currency.background));
  const count = DOMFactory.el("span", "farm-res-fruit-count");
  count.textContent = "×" + formatFigure(Math.round(countFigure((farmed || {})[String(currency.id)])));
  fruit.appendChild(count);
  return fruit;
}

/* Amendment R6: each play wears the Drop Rates farm-card chrome — centered 48px header art, quest
   name, REC line, and the runs number centered where the drop lines sit — with no dropdown. An
   all-drop play takes the combo card's neutral border and every currency icon, like card 4. */
function playDroppedCurrencies(currencies, raidQuestById, play) {
  if (play.isAllDrop) return currencies;
  const raidQuest = raidQuestById.get(String(play.questId));
  if (raidQuest && raidQuest.drops) {
    const dropped = currencies.filter((currency) => Boolean(raidQuest.drops[String(currency.id)]));
    if (dropped.length > 0) return dropped;
  }
  return currencies.filter((currency) => String(currency.id) === String(play.mainDropId));
}

function buildPlayCard(currencies, ceById, raidQuestById, play) {
  const icons = playDroppedCurrencies(currencies, raidQuestById, play);
  const isCombo = play.isAllDrop || icons.length > 1;
  const main = icons.find((currency) => String(currency.id) === String(play.mainDropId)) || icons[0];
  const classes = ["quest-drops-item", "farm-card"];
  if (isCombo) classes.push("farm-card--combo");
  const card = DOMFactory.el("div", classes, isCombo || !main ? {} : { "data-tier": main.background });
  card.appendChild(buildPlayCardHeader(icons, isCombo));
  const lines = [buildQuestName(play.questName)];
  if (play.recommendLv) lines.push(buildNode(`REC Lv. ${play.recommendLv}`));
  lines.push(
    buildNode(formatFigure(play.runs), "farm-res-play-count"),
    buildNode(play.runs === 1 ? "run" : "runs", "farm-res-play-label"),
  );
  const ceList = buildCeComboList(play.ceCombo, ceById);
  if (ceList) lines.push(ceList);
  const body = DOMFactory.el("div", "farm-card-body");
  body.replaceChildren(...lines);
  card.appendChild(body);
  return card;
}

function buildCeComboList(ceCombo, ceById) {
  const entries = (Array.isArray(ceCombo) ? ceCombo : []).filter(
    (entry) => entry && ((entry.limitBreak || 0) > 0 || (entry.nonLimitBreak || 0) > 0),
  );
  if (!entries.length) return null;
  const list = DOMFactory.el("div", "farm-res-ce-list");
  for (const entry of entries) {
    const ce = ceById.get(String(entry.ceId)) || { id: entry.ceId, name: String(entry.ceId), rarity: null, icon: null };
    const chip = DOMFactory.el("div", "farm-res-ce-chip", { title: ce.name });
    chip.appendChild(buildCeImg(ce, "farm-res-ce-img", "farm-res-ce-fallback"));
    const counts = DOMFactory.el("div", "farm-res-ce-counts");
    if ((entry.limitBreak || 0) > 0) {
      const lb = DOMFactory.el("span", ["farm-res-ce-count", "farm-res-ce-count--lb"], {
        title: `Limit Break: ${entry.limitBreak}`,
      });
      lb.textContent = `LB \u00d7${entry.limitBreak}`;
      counts.appendChild(lb);
    }
    if ((entry.nonLimitBreak || 0) > 0) {
      const nlb = DOMFactory.el("span", ["farm-res-ce-count", "farm-res-ce-count--nlb"], {
        title: `Non-Limit Break: ${entry.nonLimitBreak}`,
      });
      nlb.textContent = `NLB \u00d7${entry.nonLimitBreak}`;
      counts.appendChild(nlb);
    }
    chip.appendChild(counts);
    list.appendChild(chip);
  }
  return list;
}

function buildPlayCardHeader(icons, isCombo) {
  const title = DOMFactory.el("div", isCombo ? "farm-card-title farm-card-title--icons" : "farm-card-title");
  for (const currency of icons) title.appendChild(buildIcon(currency, "farm-card-icon"));
  return title;
}

function buildTradesBlock(snapshot, result) {
  if (!result.trades.length) return document.createDocumentFragment();
  const byId = new Map((snapshot.currencies || []).map((currency) => [String(currency.id), currency]));
  const grid = DOMFactory.el("div", "farm-grid");
  for (const trade of result.trades)
    grid.appendChild(buildTradeCard(byId, trade, resolveTradeRatio(snapshot.trades, trade)));
  const wrap = DOMFactory.el("div", "farm-res-trades");
  wrap.replaceChildren(buildTitle(TRADES_SECTION, "quest-title"), grid);
  return wrap;
}

/* The plan's trades carry only { fromId, toId, count } — the shop's ratio figures live in the event
   snapshot's trade list, so resolve them by matching both ends of the pair. A pair the snapshot no
   longer sells (stale hand-edit) resolves to null: the row still prints arts, names and count,
   never a fabricated 0. */
export function resolveTradeRatio(trades, trade) {
  const match = (trades || []).find(
    (candidate) => Number(candidate.fromId) === Number(trade.fromId) && Number(candidate.toId) === Number(trade.toId),
  );
  if (!match) return null;
  const costAmount = countFigure(match.costAmount);
  const getNum = countFigure(match.getNum);
  return costAmount > 0 && getNum > 0 ? { costAmount, getNum } : null;
}

function tradeCurrency(byId, id) {
  return byId.get(String(id)) || { id, name: String(id), background: "silver", icon: null };
}

/* Amendment R18: the exchange ratio rides the header icons — cost on the from-icon, get on the
   to-icon — in the fruit-count overlay voice; the body carries only the trade count. */
function buildTradeIcon(currency, amount) {
  const box = DOMFactory.el("span", "farm-card-icon");
  box.replaceChildren(buildCurrencyImg(currency, currency.background));
  if (amount !== null && amount !== undefined) {
    const count = DOMFactory.el("span", "farm-res-trade-icon-count");
    count.textContent = formatFigure(amount);
    box.appendChild(count);
  }
  return box;
}

function buildTradeCardHeader(from, to, ratio) {
  const header = DOMFactory.el("div", "farm-card-title farm-card-title--icons");
  header.replaceChildren(
    buildTradeIcon(from, ratio ? ratio.costAmount : null),
    buildNode("\u2192", "farm-res-trade-arrow"),
    buildTradeIcon(to, ratio ? ratio.getNum : null),
  );
  return header;
}

function buildTradeCard(byId, trade, ratio) {
  const from = tradeCurrency(byId, trade.fromId);
  const to = tradeCurrency(byId, trade.toId);
  const card = DOMFactory.el("div", ["quest-drops-item", "farm-card"], { "data-tier": to.background });
  card.appendChild(buildTradeCardHeader(from, to, ratio));
  const body = DOMFactory.el("div", "farm-card-body");
  body.replaceChildren(
    buildNode(formatFigure(trade.count), "farm-res-play-count"),
    buildNode(trade.count === 1 ? "trade" : "trades", "farm-res-play-label"),
  );
  card.appendChild(body);
  return card;
}

/* The results icons speak for themselves only where no text names the currency: an undefined alt
   keeps the currency's name (the play-card headers, the trade-card headers and the receive fruit —
   there the art is the only thing naming the currency). Amendment Q1's alt "" decorative callers
   left with the trade rows (R17); every current caller keeps the name. */
function buildIcon(currency, className, alt) {
  const box = DOMFactory.el("span", className);
  box.replaceChildren(buildCurrencyImg(currency, currency.background, alt));
  return box;
}

/* Stat lines carry .farm-stat (the card's monospace tabular track); titles never may — it would
   re-price them under the stat font and break the card title's parity with every other title. */
function buildNode(text, className) {
  const line = DOMFactory.el("div", ["farm-stat", className].filter(Boolean));
  line.textContent = text;
  return line;
}

function buildTitle(text, className) {
  const title = DOMFactory.el("div", className);
  title.textContent = text;
  return title;
}

function formatFigure(value) {
  return countFigure(value).toLocaleString("en-US", FIGURE_FORMAT);
}

function countFigure(value) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : 0;
}
