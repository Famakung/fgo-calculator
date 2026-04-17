import { ServantData } from "./data.js";
import { App } from "./event-shop.js";
import { BondApp } from "./bond-app.js";
import { CEFilterApp } from "./ce-filter-app.js";
import { TabNavigator } from "./tab-navigator.js";
import {
  ServantSelector,
  AscensionSelector,
  ServantDrag,
  CESelector,
  CESubSelector,
  CEFilterPicker,
  CEServantOverlap,
} from "./selectors.js";

document.addEventListener("DOMContentLoaded", () => {
  // Load servant/CE data
  ServantData.load();

  // Determine active tab before initializing apps
  let activeTab = "cefilter";
  try {
    activeTab = localStorage.getItem("fgo_active_tab") || "cefilter";
  } catch (_e) {
    /* ignore */
  }

  // CEFilterApp lazy-init callback for TabNavigator
  const initCEFilter = () => {
    CEFilterApp.init({
      openFilterPicker: () =>
        CEFilterPicker.open({
          onApply: (selectedCEs) => {
            CEFilterApp.state.selectedCEs = selectedCEs;
            CEFilterApp.state.currentPage = 1;
            CEFilterApp.render();
          },
          getSelectedCEs: () => CEFilterApp.state.selectedCEs,
          getCEMatches: () => CEFilterApp.computeAllCEMatches(),
          getCEMatchEntries: () => CEFilterApp._ceMatchEntriesIndex,
        }),
      initFilterPicker: () => CEFilterPicker.init(),
      initOverlap: () => CEServantOverlap.init(() => CEFilterApp.computeAllCEMatches()),
      openOverlap: (entry) => CEServantOverlap.open(entry),
    });
  };

  // BondApp init (configure + init in one function)
  const initBond = () => {
    BondApp.configure({
      ServantSelector,
      AscensionSelector,
      CESelector,
      CESubSelector,
      ServantDrag,
    });
    BondApp.init();
  };

  TabNavigator.init(initCEFilter, initBond);

  // Eagerly init ONLY the active tab
  if (activeTab === "event") {
    App.init();
  } else if (activeTab === "bond") {
    initBond();
  } else {
    initCEFilter();
  }

  // Defer Event Shop to idle (hydrates static HTML only — no image fetches)
  const rIC = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
  rIC(() => {
    if (activeTab !== "event") App.init();
  });
});
