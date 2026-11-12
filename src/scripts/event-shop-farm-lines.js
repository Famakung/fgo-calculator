import { EventShop } from "./domain.js";
import { EventPlanner } from "./event-planner.js";
import { DOMFactory } from "./presentation.js";
import { buildCurrencyImg } from "./event-shop-tier.js";

/* ===...=== Farm-card drop lines (Amendment I) ===...=== */
/* What one quest pays per run, in the two currencies the shop actually sells: the card's own
   currency — the one this quest was chosen for — and that quest's second-best shop-currency drop.
   Each line reads [art] {stack}(+{bonus})  {amount} / run, the shape the old configurable card had,
   except the figures now come from Atlas' community submissions and nothing here is editable. The
   line carries its own dropExpected, num and currency id as data, so editing one currency's Bonus
   repaints only the lines carrying that currency: two text nodes, no card rebuild. The quest's AP and
   the number of runs reported are deliberately absent — what a plan costs belongs to the results row
   (event-shop-farm.js), not to a card that only reports drop rates. */

const DROP_LINE_SELECTOR = "#farmGrid [data-drop-line]";
const NO_SECONDARY_DROP = "\u2014";
const PER_RUN_FORMAT = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

/* Primary line first, then the secondary — or a bare em dash when the quest drops nothing else the
   shop sells. `currencies` is the snapshot's own list, which the secondary id resolves through: an id
   the shop does not sell (points, QP) has no art and no name to show, so it is treated as absent. */
export function buildDropLines(entry, currency, currencies) {
  const secondary = entry.secondary ? findCurrency(currencies, entry.secondary.currencyId) : null;
  return [
    buildDropLine("primary", currency, entry),
    secondary ? buildDropLine("secondary", secondary, entry.secondary) : buildDashLine(),
  ];
}

/* Re-read every live line against the selected event's plan. Called wherever plan figures are
   already re-synced: a tier or farm Bonus box, the modal's Done, Calculate. */
export function refreshFarmDropLines() {
  for (const line of document.querySelectorAll(DROP_LINE_SELECTOR)) {
    writeDropFigures(line, EventPlanner.bonusOf(line.dataset.currencyId));
  }
}

function findCurrency(currencies, currencyId) {
  return (currencies || []).find((currency) => String(currency.id) === String(currencyId)) || null;
}

function buildDashLine() {
  const line = DOMFactory.el("div", "farm-stat");
  line.textContent = NO_SECONDARY_DROP;
  return line;
}

function buildDropLine(kind, currency, figures) {
  const line = DOMFactory.el("div", "drop-line", {
    dataset: {
      dropLine: kind,
      currencyId: String(currency.id),
      dropExpected: String(figures.dropExpected),
      num: String(figures.num),
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

function buildDropIcon(currency) {
  const box = DOMFactory.el("span", "mini-icon");
  box.replaceChildren(buildCurrencyImg(currency, currency.background));
  return box;
}

/* Both figures of the line, from the one multiply farmPlan prices with: the stack the run pays with
   (num plus that currency's bonus) and what it comes to per run. Written only when the text moves. */
function writeDropFigures(line, bonus) {
  const drop = { dropExpected: Number(line.dataset.dropExpected), num: Number(line.dataset.num) };
  const perRun = EventShop.dropPerRun(drop, bonus);
  setText(line.querySelector(".drop-material"), `${drop.num}(+${bonus})`);
  setText(line.querySelector(".drop-value"), `${perRun.toLocaleString("en-US", PER_RUN_FORMAT)} / run`);
}

function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}
