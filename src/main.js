import { ServantData } from "./data.js";
import { App } from "./event-shop.js";
import { BondApp } from "./bond-app.js";
import { CEFilterApp } from "./ce-filter-app.js";
import { TabNavigator } from "./tab-navigator.js";
import {
  ServantSelector, AscensionSelector, ServantDrag,
  CESelector, CESubSelector, CEFilterPicker, CEServantOverlap
} from "./selectors.js";

document.addEventListener("DOMContentLoaded", () => {
  // Load servant/CE data
  ServantData.load();

  // Determine active tab before initializing apps
  let activeTab = "cefilter";
  try {
    activeTab = localStorage.getItem("fgo_active_tab") || "cefilter";
  } catch (e) { /* ignore */ }

  // CEFilterApp lazy-init callback for TabNavigator
  const initCEFilter = () => {
    CEFilterApp.init({
      openFilterPicker: () => CEFilterPicker.open({
        onApply: (selectedCEs) => {
          CEFilterApp.state.selectedCEs = selectedCEs;
          CEFilterApp.saveState();
          CEFilterApp.state.currentPage = 1;
          CEFilterApp.render();
        },
        getSelectedCEs: () => CEFilterApp.state.selectedCEs,
        getCEMatches: () => CEFilterApp.computeAllCEMatches(),
        getCEMatchEntries: () => CEFilterApp._ceMatchEntriesIndex
      }),
      initFilterPicker: () => CEFilterPicker.init(),
      initOverlap: () => CEServantOverlap.init(() => CEFilterApp.computeAllCEMatches()),
      openOverlap: (entry) => CEServantOverlap.open(entry)
    });
  };

  // BondApp init (configure + init in one function)
  const initBond = () => {
    BondApp.configure({
      ServantSelector, AscensionSelector, CESelector, CESubSelector, ServantDrag
    });
    BondApp.init();
  };

  TabNavigator.init(initCEFilter);

  // Eagerly init ONLY the active tab
  if (activeTab === "event") {
    App.init();
  } else if (activeTab === "bond") {
    initBond();
  } else {
    initCEFilter();
  }

  // Defer non-active tabs to idle time
  const rIC = window.requestIdleCallback || (cb => setTimeout(cb, 1));
  rIC(() => {
    if (activeTab !== "event") App.init();
    if (activeTab !== "bond") initBond();
  });
});
