import { TIERS } from "./constants.js";
import { EventShop } from "./domain.js";
import { DOMFactory } from "./presentation.js";
import { buildCurrencyImg } from "./event-shop-tier.js";
import { buildCurrencyDropLine, buildAllDropLines, buildSecondaryDropLine } from "./event-shop-farm-lines.js";
import {
  tierMappedIds,
  byRecommendLv,
  buildHeldBonusBoxes,
  buildFarmQuestSelect,
  buildCurrencyQuestSelect,
  questsDroppingCurrency,
} from "./event-shop-farm-controls.js";
import { renderFarmResults } from "./event-shop-farm-results.js";
import { buildQuestName, refreshSlidingNames } from "./event-shop-farm-names.js";

/* ===...=== Best-quest farm view (Amendment D, L, M) ===...=== */
/* Everything the Event tab shows instead of the legacy drop-rate model: three per-currency cards —
   each header is that currency's own 48px art, centered and alone (Amendment M2, P1), the body its OWN quest
   dropdown (Amendment M4, N1/N2: every quest dropping this currency and not covering the whole
    shop, REC Lv ascending, default the currency's best non-all-covering quest — never the 3-in-1
    card's pick, Amendment M3), the chosen quest's name, its REC
   Lv, the own-currency drop line and the quest's other shop currency as a secondary line (Amendment
   M1) — plus the conditional 4th card: all currency icons, a dropdown of the event's all-covering
   quests ONLY (no Auto), in REC Lv order (Amendment N1), the picked quest's name, REC and one icon-only drop line per currency
   (Amendment L3). The 4th card exists exactly when some quest drops every shop currency,
   so an event like 80639 shows three cards. Also the mode chrome (the legacy base/primary/
   secondary row and grid stay hidden in event mode), the plan-backed tier boxes sync, and the
   "Best Farm Runs" results render (event-shop-farm-results.js). DOM is built with createElement/
   textContent only and dropped into #farmGrid with a single replaceChildren(), so an Event Select
   switch or a quest pick repaints the grid without leaving nodes behind. */

const NO_DROP_MESSAGE = "No drop data yet";
const FARM_CARD_TITLE = "Drop Rates per Run";

export function hydrateFarmGrid(event, plan, handlers = {}) {
  const grid = document.getElementById("farmGrid");
  if (!grid) return;
  if (!event) {
    document.documentElement.removeAttribute("data-event-combo");
    grid.replaceChildren();
    return;
  }
  const view = { snapshot: event, plan, mapped: tierMappedIds(event.currencies), handlers };
  const fragment = document.createDocumentFragment();
  for (const currency of event.currencies) fragment.appendChild(buildCurrencyCard(currency, view));
  const covering = EventShop.allCoveringQuests(event.farm, currencyIds(view.snapshot)).sort(byRecommendLv);
  if (covering.length) {
    document.documentElement.setAttribute("data-event-combo", "1");
    fragment.appendChild(buildComboCard(view, covering));
  } else {
    document.documentElement.removeAttribute("data-event-combo");
  }
  grid.replaceChildren(fragment);
  refreshSlidingNames(grid);
}

function currencyIds(snapshot) {
  return (snapshot.currencies || []).map((currency) => currency.id);
}

function buildCurrencyCard(currency, view) {
  const card = DOMFactory.el("div", ["quest-drops-item", "farm-card"], { "data-tier": currency.background });
  card.appendChild(buildCardHeader(currency));
  const options = questsDroppingCurrency(view.snapshot.farm, currency, currencyIds(view.snapshot));
  const quest = options.length
    ? selectedQuest(view, currency, options)
    : bestDropperQuest(view.snapshot.farm, currency);
  card.appendChild(buildCardBody(currency, quest, view, options));
  if (!view.mapped.has(String(currency.id))) card.appendChild(buildHeldBonusBoxes(currency, view.plan));
  return card;
}

/* The cards 1-to-3 graceful fallback (Amendment N2): when every quest that drops this currency is
   all-covering, the dropdown has nothing to offer — the card still prints the currency's best
   dropper, the quest card 4 also carries. Passing no currency ids turns the exclusion off, so the
   same domain rule names the best quest of the full dropper list. */
function bestDropperQuest(farm, currency) {
  const id = EventShop.defaultCurrencyQuest(farm, [], currency.id);
  return ((farm || {}).quests || []).find((quest) => quest && quest.questId === id) || null;
}

/* The header is a plain display (Amendment K): one centered 48px icon, no name, no role, no tab
   stop, no modal opener. Shop items are reached through the tier cards' Required field. The card's
   own tier border and its body's drop lines already say which currency it speaks for (Amendment P1). */
function buildCardHeader(currency) {
  const title = DOMFactory.el("div", "farm-card-title");
  const icon = DOMFactory.el("span", "farm-card-icon");
  icon.replaceChildren(buildCurrencyImg(currency, currency.background));
  title.replaceChildren(icon);
  return title;
}

/* The quest this card speaks for (Amendment M3, N2): the plan's OWN pick for this currency when its
   dropdown still carries it — never the 3-in-1 card's shared farmQuest. A stale or absent pick
   falls to the currency's default, the best-rate NON-all-covering dropper (the same domain rule the
   planner sanitizes through), not the first listed option — the list is REC-sorted now. */
function selectedQuest(view, currency, options) {
  const picked = String((view.plan.currencyQuest || {})[String(currency.id)] ?? "");
  const chosen = options.find((quest) => String(quest.questId) === picked);
  if (chosen) return chosen;
  const defaultId = EventShop.defaultCurrencyQuest(view.snapshot.farm, currencyIds(view.snapshot), currency.id);
  return options.find((quest) => quest.questId === defaultId) || options[0];
}

/* The card's body (Amendment M1/M4): its own quest dropdown first — the list is every quest
   dropping this currency except the all-covering ones, in REC Lv order — then the quest name, the
   REC line (skipped when falsy, a bare "REC Lv." is noise), the own-currency drop line and the
   quest's OTHER shop currency as a secondary line, omitted when the quest drops only this one. */
function buildCardBody(currency, quest, view, options) {
  const lines = [];
  if (options.length)
    lines.push(
      buildCurrencyQuestSelect({
        currency,
        quests: options,
        selectedQuestId: quest.questId,
        onChange: view.handlers.onQuestChange,
      }),
    );
  lines.push(buildQuestName(quest ? quest.questName || NO_DROP_MESSAGE : NO_DROP_MESSAGE));
  if (quest && quest.recommendLv) lines.push(buildMessage(`REC Lv. ${quest.recommendLv}`));
  if (quest) lines.push(...questDropLines(currency, quest, view));
  const body = DOMFactory.el("div", "farm-card-body");
  body.replaceChildren(...lines);
  return body;
}

/* The two drop lines of a per-currency card (Amendment M1): the selected quest's pay for THIS
   currency first, then its OTHER dropped shop currency with the highest rate — absent when the
   quest drops only the card's own. Both share the line builder, so Bonus repaints each by its own
   currency id. */
function questDropLines(currency, quest, view) {
  const lines = [buildCurrencyDropLine(currency, (quest.drops || {})[String(currency.id)])];
  const secondary = buildSecondaryDropLine(quest, currency, view.snapshot.currencies);
  if (secondary) lines.push(secondary);
  return lines;
}

/* The 3-in-1 card (Amendment L3): header = every currency icon, 48px (Amendment M2), NO names —
   the icons are the
   list of what this card covers. Body = the dropdown, then the picked quest's name, its REC line
   and one icon-only drop line per currency. The pick is the plan's farmQuest when the list still
   carries it, else the first listed quest (the same display fallback the select shows; the planner
   re-defaults the stored value itself). */
function buildComboCard(view, covering) {
  const card = DOMFactory.el("div", ["quest-drops-item", "farm-card", "farm-card--combo"]);
  card.appendChild(buildComboHeader(view.snapshot));
  const quest = covering.find((q) => String(q.questId) === String(view.plan.farmQuest)) || covering[0];
  const select = buildFarmQuestSelect(covering, view.plan.farmQuest, view.handlers.onQuestChange);
  const lines = [buildQuestName(quest.questName)];
  if (quest.recommendLv) lines.push(buildMessage(`REC Lv. ${quest.recommendLv}`));
  const drops = DOMFactory.el("div", "farm-combo-drops");
  drops.replaceChildren(buildAllDropLines(quest.drops, view.snapshot.currencies));
  const body = DOMFactory.el("div", "farm-card-body");
  body.replaceChildren(select, ...lines, drops);
  card.appendChild(body);
  return card;
}

function buildComboHeader(snapshot) {
  const title = DOMFactory.el("div", "farm-card-title farm-card-title--icons");
  for (const currency of snapshot.currencies) {
    const icon = DOMFactory.el("span", "farm-card-icon");
    icon.replaceChildren(buildCurrencyImg(currency, currency.background));
    title.appendChild(icon);
  }
  return title;
}

function buildMessage(text) {
  const line = DOMFactory.el("div", "farm-stat");
  line.textContent = text;
  return line;
}

/* ===...=== Event-mode results and plan boxes ===...=== */

/* Event mode results: the "Best Farm Runs" card — Quests to Play cards, Item Receive (raw run
   drops), the executed shop trades. All priced by EventShop.farmPlan; this only paints (results
   module). */
export function showFarmResults(snapshot, view) {
  view.reveal();
  renderFarmResults(snapshot, view);
}

/* Event-mode tier boxes read the selected event's plan: Required is the plan's spend and Held and
   Bonus are that plan's figures — the legacy boxes belong to `state`, not to the plan. `values` is
   { held, bonus } keyed by tier. */
export function syncPlanBoxes(elements, values, needs = {}) {
  TIERS.forEach((tier) => {
    writeBox(elements, `${tier}Need`, needs[tier] || 0);
    writeBox(elements, `${tier}Have`, values.held[tier] || 0);
  });
}

function writeBox(elements, id, value) {
  const input = elements[id];
  if (input) input.value = String(value);
}

/* Event mode swaps the drop-rate card's face: the base/primary/secondary row and the configured
   per-quest grid are legacy-only, so they are hidden while #farmGrid — the real community drop
   rates — is shown. Stub mode never calls this: #farmGrid ships hidden in the markup, so the
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

export function showLegacyCard() {
  const card = document.getElementById("farmGrid")?.closest(".card");
  if (!card) return;
  setDisplay(card.querySelector(".base-row"), "flex");
  setDisplay(document.getElementById("questDropsGrid"), "grid");
  setDisplay(document.getElementById("farmGrid"), "none");
  hydrateFarmGrid(null);
}

function setDisplay(element, value) {
  if (element) element.style.display = value;
}
