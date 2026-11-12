import { TIERS, QUEST_DROPS, IMAGE_VERSION, TIER_COLORS } from "./constants.js";
import { EventShop } from "./domain.js";
import { DOMFactory } from "./presentation.js";
import { EventShopModal } from "./event-shop-modal.js";

/* ===...=== Event-native tier cards (Amendment A, per-event since Amendment G) ===...=== */
/* Re-skins the tier cards and quest-drop icons with the selected event shop's currency art. A tier
   is "mapped" when a currency carries its background; unmapped tiers — and the whole page under an
   empty snapshot list — keep their legacy markup, because every entry point below stops at the
   first null map. Each entry takes the snapshot the Event Select holds, so a switch repaints from
   that snapshot instead of re-reading a single-event module. */

/* { [tier]: currency } via EventShop.currencyForTier — the single mapping rule. */
export function tierCurrencyMap(snapshot) {
  const map = {};
  if (!snapshot) return map;
  for (const tier of TIERS) {
    const currency = EventShop.currencyForTier(snapshot.currencies, tier);
    if (currency) map[tier] = currency;
  }
  return map;
}

/* Tier need in event mode = the plan's per-currency spend, not the saved legacy number.
   null (no event, or no mapped tier) means "legacy mode — do not touch state.need". */
export function eventTierNeeds(snapshot, requires) {
  const map = tierCurrencyMap(snapshot);
  const tiers = Object.keys(map);
  if (tiers.length === 0) return null;
  const totals = EventShop.totals(snapshot.items, requires || {});
  const needs = {};
  for (const tier of tiers) needs[tier] = totals[String(map[tier].id)] || 0;
  return needs;
}

/* The tier-colour letter badge, shared by both icon paths: event imgs fall back to it on a missing
   or failed icon, and the legacy builder in event-shop.js fills the empty markup boxes with it.
   Atlas also ships a background no tier card knows ("zero" is QP), so an unknown one paints silver:
   a visible letter beats an invisible one, where `.icon-fallback` has no colour to inherit.
   A decorative caller (alt "") hides the letter too — the name it stands in for is already read. */
export function buildFallbackIcon(tier, alt) {
  const fallback = document.createElement("div");
  fallback.className = "icon-fallback";
  fallback.style.background = TIER_COLORS[tier] || TIER_COLORS.silver;
  fallback.textContent = DOMFactory.capitalize(tier).charAt(0);
  if (alt === "") fallback.setAttribute("aria-hidden", "true");
  return fallback;
}

/* Single fg-layer img so the icon rules size it — the tier box's own 96px height, the farm card's
   48px header and 24px drop lines; a null icon shows the card's own letter fallback directly instead
   of requesting the string "null". The alt names the currency by default (farm card headers carry
   no visible name, so the alt is their only label, Amendment P1); callers whose own text already
   prints the name pass "" — a decorative icon, never a second reading of the same word. */
export function buildCurrencyImg(currency, tier, alt = currency.name) {
  if (!currency.icon) return buildFallbackIcon(tier, alt);
  const img = DOMFactory.createLazyImg(currency.icon + "?v=" + IMAGE_VERSION, "fg-layer", { alt });
  img.onerror = () => img.replaceWith(buildFallbackIcon(tier, alt));
  return img;
}

/* Click and Enter/Space open the currency modal for the id this node carries in dataset — the one
   keydown contract, and since Amendment K the only node bound to it is a tier card's Required box.
   The currency id travels as data, not as a listener closure, so re-hydrating on an event switch
   re-points the one bound listener of a surviving node instead of stacking a new listener per
   switch. */
export function bindCurrencyModalOpen(node) {
  if (node.dataset.modalBound === "1") return;
  node.dataset.modalBound = "1";
  const openModal = () => {
    if (node.dataset.currencyId) EventShopModal.open(node.dataset.currencyId);
  };
  node.addEventListener("click", openModal);
  node.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    e.preventDefault();
    openModal();
  });
}

/* Required box → read-only display that opens the currency modal on click or Enter/Space. */
function bindRequiredDisplay(input, currency) {
  input.readOnly = true;
  input.classList.add("eshop-require-display");
  input.setAttribute("aria-haspopup", "dialog");
  input.dataset.currencyId = String(currency.id);
  bindCurrencyModalOpen(input);
}

/* The results rows label the same currencies as the tier cards, so they take the same name: a farm
   card called "MISOおでん" above a results row still called "Bronze" reads as two different shops.
   The legacy markup ships tier words, so the unmapped reset restores them, not a hardcoded list. */
function setResultLabels(tier, name) {
  const deficit = document.querySelector(`#deficitGrid [data-tier="${tier}"] .deficit-label`);
  if (deficit) deficit.textContent = name;
  const quest = document.querySelector(`#questGrid [data-tier="${tier}"] .quest-name`);
  if (quest) quest.textContent = `${name} Quest`;
}

function applyEventTier({ tier, currency, card, needInput, need }) {
  const iconBox = card?.querySelector(".material-icon");
  if (iconBox) {
    /* Mark the box as event-owned: the class is the marker the QA pin looks for, and it keeps the
       box's background explicitly transparent now that the tier box carries no plate of its own. */
    iconBox.classList.add("material-icon--event");
    iconBox.replaceChildren(buildCurrencyImg(currency, tier));
  }
  const nameEl = card?.querySelector(".material-name");
  if (nameEl) nameEl.textContent = currency.name;
  setResultLabels(tier, currency.name);
  if (!needInput) return;
  bindRequiredDisplay(needInput, currency);
  needInput.value = String(need);
}

/* A tier the selected event has no currency for goes back to the generic card: a previous event may
   have mapped it, and stale art would read as live shop data. Its Required box stays a read-only
   display (event mode never types it) but loses the modal cue — there is no currency to edit — and
   reads 0, because a tier with no currency has no spend. */
function clearEventTier({ tier, card, needInput }) {
  const iconBox = card?.querySelector(".material-icon");
  if (iconBox) iconBox.replaceChildren(buildFallbackIcon(tier));
  const nameEl = card?.querySelector(".material-name");
  if (nameEl) nameEl.textContent = DOMFactory.capitalize(tier);
  setResultLabels(tier, DOMFactory.capitalize(tier));
  if (!needInput) return;
  delete needInput.dataset.currencyId;
  needInput.readOnly = true;
  needInput.classList.remove("eshop-require-display");
  needInput.removeAttribute("aria-haspopup");
  needInput.value = "0";
}

export function hydrateTierCards({ elements, container, needs = {}, snapshot }) {
  if (!snapshot) return;
  const map = tierCurrencyMap(snapshot);
  for (const tier of TIERS) {
    const view = {
      tier,
      card: container?.querySelector(`[data-tier="${tier}"]`),
      needInput: elements[`${tier}Need`],
    };
    if (map[tier]) applyEventTier({ ...view, currency: map[tier], need: needs[tier] });
    else clearEventTier(view);
  }
}

function applyQuestTitle(quest, map) {
  if (!map[quest]) return;
  const title = document.querySelector(`#questDropsGrid [data-tier="${quest}"] .quest-drops-title`);
  if (title) title.textContent = map[quest].name + " Quest";
}

function applyDropIcons(quest, drops, map) {
  for (const material of [drops.primary, drops.secondary]) {
    const span = document.getElementById(`${quest}Quest_${material}_icon`);
    if (span && map[material]) span.replaceChildren(buildCurrencyImg(map[material], material));
  }
}

export function hydrateQuestIcons(snapshot) {
  const map = tierCurrencyMap(snapshot);
  for (const [quest, drops] of Object.entries(QUEST_DROPS)) {
    applyQuestTitle(quest, map);
    applyDropIcons(quest, drops, map);
  }
}
