import { ACTIVE_TAB_KEY, VALID_TABS } from "./constants.js";
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
    const saved = localStorage.getItem(ACTIVE_TAB_KEY);
    if (VALID_TABS.includes(saved)) activeTab = saved;
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

  // Lazy-load servant info tab
  let _servantInfoModule = null;
  const initServantInfo = async () => {
    try {
      if (!_servantInfoModule) {
        const mod = await import("./servant-info-lazy.js");
        _servantInfoModule = mod;
      }
      _servantInfoModule.initServantInfo();
    } catch (e) {
      console.warn("Failed to load Servant Info module:", e);
    }
  };

  // Lazy-load bond tab (selectors + bond-app ≈ 66KB, ~13KB gzipped)
  let _bondModule = null;
  const initBond = async () => {
    try {
      if (!_bondModule) {
        const mod = await import("./bond-lazy.js");
        _bondModule = mod;
      }
      _bondModule.initBond();
    } catch (e) {
      console.warn("Failed to load Bond Calculator module:", e);
    }
  };

  // Lazy-load event shop (~9KB, ~2KB gzipped)
  let _eventModule = null;
  const initEvent = async () => {
    try {
      if (!_eventModule) {
        const mod = await import("./event-lazy.js");
        _eventModule = mod;
      }
      _eventModule.initEvent();
    } catch (e) {
      console.warn("Failed to load Event Shop module:", e);
    }
  };

  TabNavigator.init(initCEFilter, initBond, initEvent, initServantInfo);

  // Eagerly init ONLY the active tab
  if (activeTab === "servantinfo") {
    initServantInfo();
  } else if (activeTab === "event") {
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
    if (activeTab !== "cefilter") CEFilterApp.warmWorker();
  });

  /* Background scroll lock. All nine modals share `.servant-modal` and toggle `.open`, and a closed
     overlay is `display: none`, so these non-passive listeners never see a gesture while normal pages
     scroll — no cost to compositor scrolling — and once one is up, every gesture that does not land
     inside that modal's own scrolling list is swallowed here instead of moving the page behind it.
     The scrollbar keeps its track and the page keeps its position, unlike an `overflow: hidden` lock.
     `overscroll-behavior: contain` (BaseLayout) covers a list whose gesture reaches its end.
     shortcut: keyboard scrolling (PageDown, arrows) and dragging the page scrollbar still move the
     background; add a keydown guard here if the owner wants a hard lock. */
  const modalScrollAreas = ".servant-picker-grid, .cefilter-modal-body, .ceoverlap-scroll, #servantInfoModalBody";
  for (const modal of document.querySelectorAll(".servant-modal")) {
    const blockBackgroundScroll = (e) => {
      if (!modal.classList.contains("open")) return;
      if (e.target?.closest?.(modalScrollAreas)) return;
      e.preventDefault();
    };
    modal.addEventListener("wheel", blockBackgroundScroll, { passive: false });
    modal.addEventListener("touchmove", blockBackgroundScroll, { passive: false });
  }
});
