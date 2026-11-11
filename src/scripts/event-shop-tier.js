import { TIERS, QUEST_DROPS, IMAGE_VERSION, TIER_COLORS } from "./constants.js";
import { EventShop } from "./domain.js";
import { EVENT_SHOP_DATA } from "./data/event_shop.js";
import { DOMFactory } from "./presentation.js";
import { EventShopModal } from "./event-shop-modal.js";

/* ===...=== Event-native tier cards (Amendment A) ===...=== */
/* Re-skins the tier cards and quest-drop icons with the live event shop's currency art. A tier is
   "mapped" when a currency carries its background; unmapped tiers — and the whole page under a
   stub snapshot — keep their legacy markup byte-identical, because every entry point below stops
   at the first null map. */

function eventShopSnapshot() {
  const data = EVENT_SHOP_DATA;
  if (!data || !data.event || !Array.isArray(data.items) || data.items.length === 0) return null;
  return data;
}

/* { [tier]: currency } via EventShop.currencyForTier — the single mapping rule. */
function tierCurrencyMap(snapshot) {
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
export function eventTierNeeds(requires) {
  const map = tierCurrencyMap(eventShopSnapshot());
  const tiers = Object.keys(map);
  if (tiers.length === 0) return null;
  const totals = EventShop.totals(eventShopSnapshot().items, requires || {});
  const needs = {};
  for (const tier of tiers) needs[tier] = totals[String(map[tier].id)] || 0;
  return needs;
}

function buildFallbackIcon(tier) {
  const fallback = document.createElement("div");
  fallback.className = "icon-fallback";
  fallback.style.background = TIER_COLORS[tier];
  fallback.textContent = DOMFactory.capitalize(tier).charAt(0);
  return fallback;
}

/* Single fg-layer img so the existing 80px/40px icon rules size it; a null icon shows the card's
   own letter fallback directly instead of requesting the string "null". */
function buildCurrencyImg(currency, tier) {
  if (!currency.icon) return buildFallbackIcon(tier);
  const img = DOMFactory.createLazyImg(currency.icon + "?v=" + IMAGE_VERSION, "fg-layer", { alt: currency.name });
  img.onerror = () => img.replaceWith(buildFallbackIcon(tier));
  return img;
}

/* Required box → read-only display that opens the currency modal on click or Enter/Space. */
function bindRequiredDisplay(input, currency) {
  input.readOnly = true;
  input.classList.add("eshop-require-display");
  input.setAttribute("aria-haspopup", "dialog");
  const openModal = () => EventShopModal.open(String(currency.id));
  input.addEventListener("click", openModal);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    e.preventDefault();
    openModal();
  });
}

function applyEventTier({ tier, currency, card, needInput, need }) {
  const iconBox = card?.querySelector(".material-icon");
  if (iconBox) {
    /* .material-icon carries a grey background meant for the generic bg/fg art; event currency art
       is bordered on its own, so mark the box for the transparent-background CSS override. */
    iconBox.classList.add("material-icon--event");
    iconBox.replaceChildren(buildCurrencyImg(currency, tier));
  }
  const nameEl = card?.querySelector(".material-name");
  if (nameEl) nameEl.textContent = currency.name;
  if (!needInput) return;
  bindRequiredDisplay(needInput, currency);
  needInput.value = String(need);
}

export function hydrateTierCards(elements, container, needs) {
  const map = tierCurrencyMap(eventShopSnapshot());
  for (const tier of TIERS) {
    if (!map[tier]) continue;
    applyEventTier({
      tier,
      currency: map[tier],
      card: container?.querySelector(`[data-tier="${tier}"]`),
      needInput: elements[`${tier}Need`],
      need: needs[tier],
    });
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

export function hydrateQuestIcons() {
  const map = tierCurrencyMap(eventShopSnapshot());
  for (const [quest, drops] of Object.entries(QUEST_DROPS)) {
    applyQuestTitle(quest, map);
    applyDropIcons(quest, drops, map);
  }
}
