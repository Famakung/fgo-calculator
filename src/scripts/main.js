import { ACTIVE_TAB_KEY, VALID_TABS } from "./constants.js";
import { ServantData } from "./data.js";
import { TabNavigator } from "./tab-navigator.js";

function getSavedActiveTab() {
  try {
    const saved = localStorage.getItem(ACTIVE_TAB_KEY);
    if (VALID_TABS.includes(saved)) return saved;
  } catch (_e) {
    /* ignore */
  }
  return "servantinfo";
}

const initialActiveTab = getSavedActiveTab();

let _servantInfoPromise = null;
let _ceFilterPromise = null;
let _selectorsPromise = null;
let _bondPromise = null;
let _eventPromise = null;

const loadServantInfo = () => (_servantInfoPromise ||= import("./servant-info-lazy.js"));
const loadCEFilter = () => (_ceFilterPromise ||= import("./ce-filter-app.js"));
const loadSelectors = () => (_selectorsPromise ||= import("./selectors.js"));
const loadBond = () => (_bondPromise ||= import("./bond-lazy.js"));
const loadEvent = () => (_eventPromise ||= import("./event-lazy.js"));

// Kick off active tab module fetch immediately so it overlaps with DOMContentLoaded + ServantData.load()
if (initialActiveTab === "servantinfo") {
  loadServantInfo();
} else if (initialActiveTab === "bond") {
  loadBond();
} else if (initialActiveTab === "event") {
  loadEvent();
} else {
  loadCEFilter();
  loadSelectors();
}

document.addEventListener("DOMContentLoaded", () => {
  // Load servant/CE data
  ServantData.load();

  // Determine active tab before initializing apps
  const activeTab = getSavedActiveTab();

  // CEFilterApp init — loaded on demand when cefilter is active or selected
  const initCEFilter = async () => {
    try {
      const [{ CEFilterApp }, { CEFilterPicker, CEServantOverlap }] = await Promise.all([
        loadCEFilter(),
        loadSelectors(),
      ]);
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
    } catch (e) {
      console.warn("Failed to load Bond Gain CE module:", e);
    }
  };

  // Lazy-load servant info tab
  const initServantInfo = async () => {
    try {
      const mod = await loadServantInfo();
      mod.initServantInfo();
    } catch (e) {
      console.warn("Failed to load Servant Info module:", e);
    }
  };

  // Lazy-load bond tab (selectors + bond-app ≈ 66KB, ~13KB gzipped)
  const initBond = async () => {
    try {
      const mod = await loadBond();
      mod.initBond();
    } catch (e) {
      console.warn("Failed to load Bond Calculator module:", e);
    }
  };

  // Lazy-load event shop (bundles event_shop.js, ~154KB minified; loaded on tab click or eagerly if active)
  const initEvent = async () => {
    try {
      const mod = await loadEvent();
      mod.initEvent();
    } catch (e) {
      console.warn("Failed to load Event Shop module:", e);
    }
  };

  TabNavigator.init(initCEFilter, initBond, initEvent, initServantInfo, {
    servantinfo: loadServantInfo,
    cefilter: () => {
      loadCEFilter();
      loadSelectors();
    },
    bond: loadBond,
    event: loadEvent,
  });

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
