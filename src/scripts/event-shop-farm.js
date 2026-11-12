import { TIERS } from "./constants.js";
import { EventShop } from "./domain.js";
import { DOMFactory } from "./presentation.js";
import { buildCurrencyImg } from "./event-shop-tier.js";
import { buildDropLines } from "./event-shop-farm-lines.js";
import { tierMappedIds, buildHeldBonusBoxes } from "./event-shop-farm-controls.js";

/* ===...=== Best-quest farm view (Amendment D) ===...=== */
/* Everything the Event tab shows instead of the legacy drop-rate model: one card per shop currency
   naming the quest Atlas' community data says drops the most of it, the card's own mode chrome (the
   base/primary/secondary row and the configured per-quest grid are legacy-only), the plan-backed
   tier boxes, and the results row per currency. Since Amendment I7 the farm card carries no
   Required box, and since Amendment K its currency header is a plain display: the tier cards'
   Required field is the one modal opener in the tab. For a currency no tier card owns the card
   also keeps its Held/Bonus inputs.
   Amendment I makes the card's figures the quest's two real shop-currency drops, one line each
   (event-shop-farm-lines.js), and retires the AP and reported-run lines: what a run costs is the
   results row's business, not the card's. DOM is built with createElement/textContent only and
   dropped into #farmGrid with a single replaceChildren(), so an Event Select switch repaints the grid
   without leaving nodes behind. */

const NO_DROP_MESSAGE = "No drop data yet";
const FARM_CARD_TITLE = "Drop Rates per Run";

export function hydrateFarmGrid(event, plan, onBonusChange = null) {
  const grid = document.getElementById("farmGrid");
  if (!grid) return;
  if (!event) {
    grid.replaceChildren();
    return;
  }
  const view = {
    snapshot: event,
    mapped: tierMappedIds(event.currencies),
    plan,
    onBonusChange,
  };
  const fragment = document.createDocumentFragment();
  for (const currency of event.currencies) {
    fragment.appendChild(buildFarmCard(currency, view));
  }
  grid.replaceChildren(fragment);
}

function buildFarmCard(currency, view) {
  const tier = currency.background;
  const card = DOMFactory.el("div", ["quest-drops-item", "farm-card"], { "data-tier": tier });
  card.appendChild(buildCardTitle(currency));
  const entry = farmEntry(view.snapshot.farm, currency);
  card.appendChild(entry ? buildDropStats(entry, currency, view) : buildMessage(NO_DROP_MESSAGE));
  if (!view.mapped.has(String(currency.id)))
    card.appendChild(buildHeldBonusBoxes(currency, view.plan, view.onBonusChange));
  return card;
}

/* The currency header is a plain display (Amendment K): name + art, no role, no tab stop, no
   opener. Shop items are reached through the tier cards' Required field, the tab's only opener. */
function buildCardTitle(currency) {
  const title = DOMFactory.el("div", "farm-card-title");
  const icon = DOMFactory.el("span", "mini-icon");
  icon.replaceChildren(buildCurrencyImg(currency, currency.background));
  const name = DOMFactory.el("span", "farm-card-name");
  name.textContent = currency.name;
  title.replaceChildren(icon, name);
  return title;
}

/* dropExpected is stacks per run and num the stack size, so the figure shown is items per run at
   the base stack: the Bonus box adds whole units onto num before the same multiply (domain farmPlan).
   A quest with no reported recommendation simply has no REC line — a bare "REC Lv." is noise.
   The two drop lines below the REC line are event-shop-farm-lines.js's business, not this file's. */
function buildDropStats(entry, currency, view) {
  const lines = [buildMessage(entry.questName || NO_DROP_MESSAGE, "farm-quest-name")];
  if (entry.recommendLv) lines.push(buildMessage(`REC Lv. ${entry.recommendLv}`));
  lines.push(...buildDropLines(entry, currency, view.snapshot.currencies));
  const body = DOMFactory.el("div", "farm-card-body");
  body.replaceChildren(...lines);
  return body;
}

function buildMessage(text, extraClass) {
  const line = DOMFactory.el("div", extraClass ? ["farm-stat", extraClass] : "farm-stat");
  line.textContent = text;
  return line;
}

/* The snapshot keys farm by currency id as a JSON string. A missing key is the same as a null one:
   a currency the community has no reported drop for. */
function farmEntry(farm, currency) {
  if (!farm) return null;
  return farm[String(currency.id)] || null;
}

/* ===...=== Event-mode results and plan boxes ===...=== */

/* Event mode results: what each currency still needs and the runs its best quest takes, straight
   from EventShop.farmPlan. AP is priced but never printed (Amendment K): the run count is the
   answer. Tiers the shop has no currency for show 0 and "—", because there is nothing to farm and
   no plan to price. */
export function showFarmResults(snapshot, plan, reveal) {
  reveal();
  TIERS.forEach((tier) => writeFarmTier(tier, snapshot, plan));
}

function writeFarmTier(tier, snapshot, plan) {
  const row = farmRowForTier(snapshot, plan, tier);

  const deficitEl = document.getElementById(`${tier}Deficit`);
  if (deficitEl) deficitEl.textContent = row ? String(Math.max(0, Math.ceil(row.deficit))) : "0";

  const runEl = document.getElementById(`${tier}Play`);
  if (runEl) runEl.textContent = row && row.runs !== null ? String(row.runs) : "\u2014";

  const labelEl = document.getElementById(`${tier}Label`);
  if (labelEl) labelEl.textContent = farmTierLabel(row);
}

function farmTierLabel(row) {
  if (!row || row.runs === null) return NO_DROP_MESSAGE;
  return row.runs === 1 ? "run" : "runs";
}

function farmRowForTier(snapshot, plan, tier) {
  const currency = EventShop.currencyForTier(snapshot.currencies, tier);
  return currency ? plan[String(currency.id)] : null;
}

/* Event-mode tier boxes read the selected event's plan: Required is the plan's spend, Held and
   Bonus are that plan's figures — the legacy boxes belong to `state`, not to the plan. `values` is
   { held, bonus } keyed by tier. */
export function syncPlanBoxes(elements, values, needs = {}) {
  TIERS.forEach((tier) => {
    writeBox(elements, `${tier}Need`, needs[tier] || 0);
    writeBox(elements, `${tier}Have`, values.held[tier] || 0);
    writeBox(elements, `${tier}Bonus`, values.bonus[tier] || 0);
  });
}

function writeBox(elements, id, value) {
  const input = elements[id];
  if (input) input.value = String(value);
}

/* Event mode swaps the drop-rate card's face: the base/primary/secondary row and the configured
   per-quest grid are legacy-only, so they are hidden while #farmGrid — the best quest per shop
   currency — is shown. Stub mode never calls this: #farmGrid ships hidden in the markup, so the
   legacy card is the page as it was, with nothing to undo.
   display is written inline on purpose: the shipped rules give .base-row `display: flex` and
   #questDropsGrid `display: grid`, and an author-level display declaration beats the UA `[hidden]`
   rule, so `el.hidden` alone would not hide them. */
export function showFarmCard() {
  const card = document.getElementById("farmGrid")?.closest(".card");
  if (!card) return;
  setDisplay(card.querySelector(".base-row"), "none");
  setDisplay(document.getElementById("questDropsGrid"), "none");
  setDisplay(document.getElementById("farmGrid"), "");
  const title = card.querySelector(".card-title");
  if (title) title.textContent = FARM_CARD_TITLE;
}

function setDisplay(element, value) {
  if (element) element.style.display = value;
}
