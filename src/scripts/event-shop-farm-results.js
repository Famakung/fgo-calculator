import { DOMFactory } from "./presentation.js";
import { buildCurrencyImg } from "./event-shop-tier.js";

/* ===...=== "Best Farm Runs" results card (Amendment L6b) ===...=== */
/* The plan EventShop.farmPlan found, painted: a per-currency requirement block (48px art, the shop
   "Required" spend, the "Get" final count held + farmed + traded, a ✓ when covered, and the
   leftover surplus as a plain "+X"), then "Quests to Play" rows
   prefixed with the quest's drop art — one icon of its main drop, or every currency icon when the
   quest drops them all — then the "Shop Trades" the plan executes, then the total-plays footer.
   Plays and trades are everything: AP never prints (the owner's rule since Amendment I), and the
   whole card is createElement/textContent only, rebuilt per Calculate with one replaceChildren(). */

const RESULTS_TITLE = "Best Farm Runs";
const PLAYS_SECTION = "Quests to Play";
const TRADES_SECTION = "Shop Trades";
const NO_PLAN_MESSAGE = "No drop data can cover this plan";
const FIGURE_FORMAT = { maximumFractionDigits: 1 };
const COVER_EPS = 1e-6;

export function renderFarmResults(snapshot, view) {
  const inner = document.querySelector("#results .results-card .card-inner");
  if (!inner) return;
  const fragment = document.createDocumentFragment();
  fragment.appendChild(buildNode(RESULTS_TITLE, "card-title"));
  fragment.appendChild(buildCurrencyBlocks(snapshot, view));
  if (view.result.totalPlays === null) {
    fragment.appendChild(buildNode(NO_PLAN_MESSAGE, "farm-res-empty"));
  } else {
    fragment.appendChild(buildPlaysBlock(snapshot.currencies || [], view.result));
    fragment.appendChild(buildTradesBlock(snapshot, view.result));
    fragment.appendChild(
      buildNode(
        `Total: ${formatFigure(view.result.totalPlays)} play${view.result.totalPlays === 1 ? "" : "s"}`,
        "farm-res-total",
      ),
    );
  }
  inner.replaceChildren(fragment);
}

function buildCurrencyBlocks(snapshot, view) {
  const grid = DOMFactory.el("div", "farm-res-grid grid");
  for (const currency of snapshot.currencies || []) grid.appendChild(buildCurrencyBlock(currency, view));
  return grid;
}

function buildCurrencyBlock(currency, view) {
  const key = String(currency.id);
  const required = countFigure(view.totals[key]);
  const get = countFigure(view.plan.held[key]) + countFigure(view.result.yields[key]);
  const covered = view.result.totalPlays !== null && get + COVER_EPS >= required;
  const block = DOMFactory.el("div", "farm-res-item", { "data-tier": currency.background });
  block.replaceChildren(
    buildIcon(currency, "mini-icon", ""),
    buildNode(currency.name, "farm-res-name"),
    buildNode(`Required ${formatFigure(required)}`, "farm-res-required"),
    buildNode(`Get ${formatFigure(get)} ${covered ? "\u2713" : "\u2014"}`, "farm-res-get"),
    buildSurplusLine({ surplus: countFigure(view.result.surplus[key]), covered }),
  );
  return block;
}

/* Surplus never hides (Amendment L5): a covered row with leftover prints the honest "+X". The
   trade-up preview is gone — the trade-aware optimizer already converts every full 10-stack, so
   the leftover is always under one trade and the annotation never printed. What the plan actually
   traded is the "Shop Trades" block below. An uncovered row prints nothing here: its "Get" line
   already shows the miss. */
function buildSurplusLine(block) {
  const { surplus, covered } = block;
  if (!covered || surplus <= 0) return buildNode("", "farm-res-surplus");
  return buildNode(`+${formatFigure(surplus)}`, "farm-res-surplus");
}

function buildPlaysBlock(currencies, result) {
  if (!result.plays.length) return document.createDocumentFragment();
  const wrap = DOMFactory.el("div", "farm-res-quests");
  wrap.replaceChildren(
    buildNode(PLAYS_SECTION, "quest-title"),
    ...result.plays.map((play) => buildPlayLine(currencies, play)),
  );
  return wrap;
}

function buildPlayLine(currencies, play) {
  const line = DOMFactory.el("div", "farm-res-row");
  const parts = [...playIcons(currencies, play), buildNode(play.questName, "farm-res-quest-name")];
  if (play.recommendLv) parts.push(buildNode(`Lv.${play.recommendLv}`, "farm-res-quest-lv"));
  parts.push(buildNode(`${play.runs} ${play.runs === 1 ? "run" : "runs"}`, "farm-res-quest-runs"));
  line.replaceChildren(...parts);
  return line;
}

/* Main-drop icon for a normal quest; every currency icon for an all-drop quest (Amendment L6b:
   1 icon vs 3). Icons are 24px inline prefixes before the quest name. */
function playIcons(currencies, play) {
  if (play.isAllDrop) return currencies.map((currency) => buildIcon(currency, "farm-res-icon"));
  const main = currencies.find((currency) => String(currency.id) === String(play.mainDropId));
  return main ? [buildIcon(main, "farm-res-icon")] : [];
}

function buildTradesBlock(snapshot, result) {
  if (!result.trades.length) return document.createDocumentFragment();
  const byId = new Map((snapshot.currencies || []).map((currency) => [String(currency.id), currency]));
  const wrap = DOMFactory.el("div", "farm-res-trades");
  wrap.replaceChildren(
    buildNode(TRADES_SECTION, "quest-title"),
    ...result.trades.map((trade) => buildTradeLine(byId, trade, resolveTradeRatio(snapshot.trades, trade))),
  );
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

/* "{cost} {from} → {get} {to} × {count} trades" with both arts — the executed cascade of the plan.
   A currency id the snapshot does not know (stale hand-edit) still prints its raw id, never
   nothing: a trade the player must perform cannot be silently omitted. */
function buildTradeLine(byId, trade, ratio) {
  const from = byId.get(String(trade.fromId)) || {
    id: trade.fromId,
    name: String(trade.fromId),
    background: "silver",
    icon: null,
  };
  const to = byId.get(String(trade.toId)) || {
    id: trade.toId,
    name: String(trade.toId),
    background: "silver",
    icon: null,
  };
  const line = DOMFactory.el("div", "farm-res-row");
  line.replaceChildren(
    buildIcon(from, "farm-res-icon", ""),
    buildNode(ratio ? `${formatFigure(ratio.costAmount)} ${from.name}` : from.name, "farm-res-trade-from"),
    buildNode("\u2192", "farm-res-trade-arrow"),
    buildIcon(to, "farm-res-icon", ""),
    buildNode(ratio ? `${formatFigure(ratio.getNum)} ${to.name}` : to.name, "farm-res-trade-to"),
    buildNode(`\u00d7 ${trade.count} trade${trade.count === 1 ? "" : "s"}`, "farm-res-trade-count"),
  );
  return line;
}

/* The results icons speak for themselves only where no text names the currency: an undefined alt
   keeps the currency's name (the play rows — a quest row says which quest, not which currency),
   while a caller whose own line already prints the name passes "" (the requirement block and the
   trade rows, Amendment Q1) and the img reads as decoration. */
function buildIcon(currency, className, alt) {
  const box = DOMFactory.el("span", className);
  box.replaceChildren(buildCurrencyImg(currency, currency.background, alt));
  return box;
}

function buildNode(text, className) {
  const line = DOMFactory.el("div", ["farm-stat", className].filter(Boolean));
  line.textContent = text;
  return line;
}

function formatFigure(value) {
  return countFigure(value).toLocaleString("en-US", FIGURE_FORMAT);
}

function countFigure(value) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : 0;
}
