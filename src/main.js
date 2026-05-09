import { ServantData } from "./data.js";
import { CEFilterApp } from "./ce-filter-app.js";
import { TabNavigator } from "./tab-navigator.js";
import { CEFilterPicker, CEServantOverlap } from "./selectors.js";

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

  // CEFilterApp init — default tab, loaded eagerly
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

  // Lazy-load bond tab (selectors + bond-app ≈ 66KB, ~13KB gzipped)
  let _bondModule = null;
  const initBond = async () => {
    if (!_bondModule) {
      _bondModule = await import("./bond-lazy.js");
    }
    _bondModule.initBond();
  };

  // Lazy-load event shop (~9KB, ~2KB gzipped)
  let _eventModule = null;
  const initEvent = async () => {
    if (!_eventModule) {
      _eventModule = await import("./event-lazy.js");
    }
    _eventModule.initEvent();
  };

  TabNavigator.init(initCEFilter, initBond);

  // Eagerly init ONLY the active tab
  if (activeTab === "event") {
    initEvent();
  } else if (activeTab === "bond") {
    initBond();
  } else {
    initCEFilter();
  }

  // Defer Event Shop to idle (hydrates static HTML only — no image fetches)
  const rIC = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
  rIC(() => {
    if (activeTab !== "event") initEvent();
  });
});