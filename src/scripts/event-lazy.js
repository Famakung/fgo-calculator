/* Event Shop lazy entry point — loaded on demand via import() */
import { App } from "./event-shop.js";
import { EventPlanner } from "./event-planner.js";
import { EventShopModal } from "./event-shop-modal.js";

export function initEvent() {
  /* The modal edits a draft of the planner's plan and commits it whole: applyRequires persists,
     refreshNeeds folds the new totals into the tier cards (event mode only). Planner is inited
     before App so App.init's refreshNeeds already reads the loaded requires. */
  EventShopModal.configure({
    itemsOf: (currencyId) => EventPlanner.itemsFor(currencyId),
    requiresOf: () => EventPlanner.state.requires,
    onCommit: (draft) => {
      EventPlanner.applyRequires(draft);
      App.refreshNeeds();
    },
  });
  EventPlanner.init();
  App.init();
}
