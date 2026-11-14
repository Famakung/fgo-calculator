import { EventShop } from "./domain.js";
import { DOMFactory } from "./presentation.js";
import { buildCurrencyImg } from "./event-shop-tier.js";

/* ===...=== Farm-card drop lines (Amendment L3, M1) ===...=== */
/* What one quest pays per run for one currency: [art+num] {dropExpected*100}%  {amount} / run —
   default base community rates from Atlas Academy submissions, with the stack count overlaid on
   the 32px icon and bonus-free base rate per run. */

const DROP_PCT_FORMAT = { maximumFractionDigits: 1 };
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
    buildDropIcon(currency, drop.num),
    DOMFactory.el("span", "drop-material"),
    DOMFactory.el("span", "drop-value"),
  );
  writeDropFigures(line, drop);
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
   snapshot's id-ascending order — or null when the quest drops only the card's own currency. */
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

function buildDashLine() {
  const line = DOMFactory.el("div", "farm-stat");
  line.textContent = "\u2014";
  return line;
}

function buildDropIcon(currency, num) {
  const box = DOMFactory.el("span", "mini-icon");
  const children = [buildCurrencyImg(currency, currency.background)];
  if (num !== undefined && num !== null) {
    const count = DOMFactory.el("span", "drop-icon-count");
    count.textContent = String(num);
    children.push(count);
  }
  box.replaceChildren(...children);
  return box;
}

function writeDropFigures(line, drop) {
  const pct = (Number(drop.dropExpected || 0) * 100).toLocaleString("en-US", DROP_PCT_FORMAT);
  const perRun = EventShop.dropPerRun(drop, 0);
  setText(line.querySelector(".drop-material"), `${pct}%`);
  setText(line.querySelector(".drop-value"), `${perRun.toLocaleString("en-US", PER_RUN_FORMAT)} / run`);
}

function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}
