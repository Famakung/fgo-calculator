import { EventShop } from "./domain.js";
import { EventPlanner } from "./event-planner.js";
import { DOMFactory } from "./presentation.js";
import { buildCurrencyImg } from "./event-shop-tier.js";

/* ===...=== Farm-card drop lines (Amendment L3, M1) ===...=== */
/* What one quest pays per run for one currency: [art] {num}(+{bonus})  {amount} / run — the shape
   the old configurable card had, except the figures come from Atlas' community submissions and
   nothing here is editable. Cards 1-3 print the selected quest's own-currency line plus that quest's
   OTHER best shop-currency drop as a secondary line (Amendment M1), omitted when the quest drops
   only the card's own currency; the 3-in-1 card prints one line per shop currency, icons only, no
   currency names — the header already shows them. Each line carries its own dropExpected, num and currency
   id as data, so editing one currency's Bonus repaints only the lines carrying that currency: two
   text nodes, no card rebuild. The quest's AP and the reported-run counts are display-free (what a
   plan costs is the results card's business, not a rate card's). */

const DROP_LINE_SELECTOR = "#farmGrid [data-drop-line]";
const PER_RUN_FORMAT = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

/* The one line a per-currency card shows. A missing drop (no community data for that quest and
   currency) reads as the dash the old secondary line used — the card keeps its shape either way. */
export function buildCurrencyDropLine(currency, drop) {
  if (!drop) return buildDashLine();
  const line = DOMFactory.el("div", "drop-line", {
    dataset: {
      dropLine: "currency",
      currencyId: String(currency.id),
      dropExpected: String(drop.dropExpected),
      num: String(drop.num),
    },
  });
  line.replaceChildren(
    buildDropIcon(currency),
    DOMFactory.el("span", "drop-material"),
    DOMFactory.el("span", "drop-value"),
  );
  writeDropFigures(line, EventPlanner.bonusOf(currency.id));
  return line;
}

/* The 3-in-1 card's block: one line per currency, ids ascending like the snapshot itself. */
export function buildAllDropLines(drops, currencies) {
  const fragment = document.createDocumentFragment();
  for (const currency of currencies)
    fragment.appendChild(buildCurrencyDropLine(currency, (drops || {})[String(currency.id)]));
  return fragment;
}

/* The cards 1-to-3 secondary line (Amendment M1): the selected quest's OTHER dropped shop currency
   with the highest plain rate — dropExpected×num, ties to the lower currency id, walked in the
   snapshot's id-ascending order — or null when the quest drops only the card's own currency. The
   line is the shared builder's, so it repaints on its own currency's Bonus edit, not the card's. */
export function buildSecondaryDropLine(quest, ownCurrency, currencies) {
  const drops = quest.drops || {};
  let pick = null;
  let top = 0;
  for (const currency of currencies || []) {
    const key = String(currency.id);
    if (key === String(ownCurrency.id) || !drops[key]) continue;
    const rate = EventShop.dropPerRun(drops[key], 0);
    if (pick === null || rate > top) {
      pick = currency;
      top = rate;
    }
  }
  if (!pick) return null;
  return buildCurrencyDropLine(pick, drops[String(pick.id)]);
}

/* Re-read every live line against the selected event's plan. Called wherever plan figures are
   already re-synced: a tier or farm Bonus box, the modal's Done, Calculate, the quest dropdown. */
export function refreshFarmDropLines() {
  for (const line of document.querySelectorAll(DROP_LINE_SELECTOR)) {
    writeDropFigures(line, EventPlanner.bonusOf(line.dataset.currencyId));
  }
}

function buildDashLine() {
  const line = DOMFactory.el("div", "farm-stat");
  line.textContent = "\u2014";
  return line;
}

function buildDropIcon(currency) {
  const box = DOMFactory.el("span", "mini-icon");
  box.replaceChildren(buildCurrencyImg(currency, currency.background));
  return box;
}

/* Both figures of the line, from the one multiply the optimizer prices with: the stack the run
   pays with (num plus that currency's bonus) and what it comes to per run. Written only when the
   text moves. */
function writeDropFigures(line, bonus) {
  const drop = { dropExpected: Number(line.dataset.dropExpected), num: Number(line.dataset.num) };
  const perRun = EventShop.dropPerRun(drop, bonus);
  setText(line.querySelector(".drop-material"), `${drop.num}(+${bonus})`);
  setText(line.querySelector(".drop-value"), `${perRun.toLocaleString("en-US", PER_RUN_FORMAT)} / run`);
}

function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}
