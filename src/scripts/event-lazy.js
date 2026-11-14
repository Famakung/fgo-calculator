/* Event Shop lazy entry point — loaded on demand via import() */
import { App } from "./event-shop.js";
import { EventPlanner } from "./event-planner.js";
import { EventShopModal } from "./event-shop-modal.js";
import { DOMFactory } from "./presentation.js";

const NO_EVENT_OPTION = "No active event";

export function initEvent() {
  /* The modal edits a draft of the selected event's plan and commits it whole: applyRequires
     persists, refreshNeeds folds the new totals into the tier cards (event mode only). Planner is
     inited before App so App.init already reads the loaded plan. */
  EventShopModal.configure({
    itemsOf: (currencyId) => EventPlanner.itemsFor(currencyId),
    requiresOf: () => EventPlanner.activePlan().requires,
    currenciesOf: () => EventPlanner.currenciesForActive(),
    onCommit: (draft) => {
      EventPlanner.applyRequires(draft);
      App.refreshNeeds();
    },
  });
  EventPlanner.init();
  App.init();
  bindEventSelect();
}

/* Event Select card (Amendment G): the options are the snapshot list, and the change handler runs a
   full re-hydration because the tier cards, farm cards and plan all belong to the chosen event.
   One event still shows the card — the user asked for the picker to be there either way. */
function bindEventSelect() {
  const select = document.getElementById("eventSelect");
  if (!select) return;
  populateEventOptions(select, EventPlanner.events(), EventPlanner.state.selectedEventId);
  select.addEventListener("change", () => {
    /* Flush first, while the old event is still active and the boxes hold the typed figures. */
    App.flushPlanBoxes();
    EventPlanner.select(Number(select.value));
    App.rehydrate();
  });
}

function populateEventOptions(select, events, selectedEventId) {
  if (events.length === 0) {
    select.replaceChildren(buildDisabledOption());
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.replaceChildren(...events.map(buildOption));
  select.value = String(selectedEventId);
}

function buildOption(snapshot) {
  const option = DOMFactory.el("option", null, { value: String(snapshot.event.id) });
  option.textContent = eventLabel(snapshot.event);
  return option;
}

function buildDisabledOption() {
  const option = DOMFactory.el("option", null, { value: "", disabled: "disabled" });
  option.textContent = NO_EVENT_OPTION;
  return option;
}

/* Event names carry the line break the JP banner art uses; a <select> option is one line.
   Amendment L1 adds the start month/year to every option so a past event reads as history ("·
   Oct 2025"), not as the live shop — the window is displayed in Asia/Tokyo like the rest of the
   event chrome. */
const START_MONTH_FORMAT = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "Asia/Tokyo" });

function eventLabel(event) {
  const name = (event.shortName || event.name || String(event.id)).replace(/[\r\n]+/g, " ").trim();
  const started = event.startedAt ? ` \u00b7 ${START_MONTH_FORMAT.format(new Date(event.startedAt * 1000))}` : "";
  return name + started;
}
