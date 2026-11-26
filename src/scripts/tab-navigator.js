import { ACTIVE_TAB_KEY, THEME_STORAGE_KEY, VALID_TABS } from "./constants.js";

/* ============================================
   TAB NAVIGATION
   ============================================ */
export const TabNavigator = {
  init(ceFilterInit, bondInit, eventInit, servantInfoInit, prefetchByTab = null) {
    const navbar = document.querySelector(".navbar");
    if (!navbar) return;

    const hamburger = navbar.querySelector(".navbar-hamburger");
    const dropdown = navbar.querySelector(".navbar-dropdown");
    const themeToggle = navbar.querySelector(".theme-toggle");

    if (themeToggle) {
      const syncThemeBtn = (isDark) => {
        themeToggle.setAttribute("aria-pressed", String(isDark));
      };
      syncThemeBtn(document.documentElement.getAttribute("data-theme") === "dark");
      themeToggle.addEventListener("click", () => {
        const nextDark = document.documentElement.getAttribute("data-theme") !== "dark";
        if (nextDark) {
          document.documentElement.setAttribute("data-theme", "dark");
        } else {
          document.documentElement.removeAttribute("data-theme");
        }
        syncThemeBtn(nextDark);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, nextDark ? "dark" : "light");
        } catch (_e) {
          /* ignore */
        }
      });
    }

    const tabBtns = Array.from(navbar.querySelectorAll(".tab-btn"));

    // Restore active tab
    let initialTab = "servantinfo";
    try {
      const savedTab = localStorage.getItem(ACTIVE_TAB_KEY);
      if (VALID_TABS.includes(savedTab)) initialTab = savedTab;
    } catch (_e) {
      /* ignore */
    }
    tabBtns.forEach((btn) => {
      const isActive = btn.dataset.tab === initialTab;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
      btn.tabIndex = isActive ? 0 : -1;
    });
    navbar.querySelectorAll(".navbar-dropdown-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === initialTab);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === "panel-" + initialTab);
    });

    // Remove CSS-only tab override — JS now controls tab state
    document.documentElement.removeAttribute("data-tab");

    function switchTab(tab) {
      if (!VALID_TABS.includes(tab)) return;
      prefetched.add(tab);
      tabBtns.forEach((b) => {
        const isActive = b.dataset.tab === tab;
        b.classList.toggle("active", isActive);
        b.setAttribute("aria-selected", String(isActive));
        b.tabIndex = isActive ? 0 : -1;
      });
      navbar.querySelectorAll(".navbar-dropdown-item").forEach((b) => {
        b.classList.toggle("active", b.dataset.tab === tab);
      });
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));

      document.getElementById("panel-" + tab)?.classList.add("active");

      if (tab === "servantinfo" && servantInfoInit) servantInfoInit();
      if (tab === "cefilter" && ceFilterInit) ceFilterInit();
      if (tab === "bond" && bondInit) bondInit();
      if (tab === "event" && eventInit) eventInit();

      try {
        localStorage.setItem(ACTIVE_TAB_KEY, tab);
      } catch (_e) {
        /* ignore */
      }

      closeDropdown();
    }

    // Roving keyboard navigation on main tablist
    tabBtns.forEach((btn, idx) => {
      btn.addEventListener("keydown", (e) => {
        let nextIdx;
        if (e.key === "ArrowRight") {
          nextIdx = (idx + 1) % tabBtns.length;
        } else if (e.key === "ArrowLeft") {
          nextIdx = (idx - 1 + tabBtns.length) % tabBtns.length;
        } else if (e.key === "Home") {
          nextIdx = 0;
        } else if (e.key === "End") {
          nextIdx = tabBtns.length - 1;
        } else {
          return;
        }
        e.preventDefault();
        const nextBtn = tabBtns[nextIdx];
        if (nextBtn && nextBtn.dataset.tab) {
          nextBtn.focus();
          switchTab(nextBtn.dataset.tab);
        }
      });
    });

    function closeDropdown() {
      if (dropdown.contains(document.activeElement)) {
        hamburger.focus();
      }
      hamburger.classList.remove("open");
      dropdown.classList.remove("open");
      hamburger.setAttribute("aria-expanded", "false");
      dropdown.setAttribute("aria-hidden", "true");
    }

    function toggleDropdown() {
      const isOpen = dropdown.classList.toggle("open");
      hamburger.classList.toggle("open", isOpen);
      hamburger.setAttribute("aria-expanded", String(isOpen));
      dropdown.setAttribute("aria-hidden", String(!isOpen));
    }

    const prefetched = new Set([initialTab]);
    const handlePrefetch = (e) => {
      if (!prefetchByTab) return;
      const btn = e.target.closest(".tab-btn, .navbar-dropdown-item");
      const tab = btn && btn.dataset.tab;
      if (!tab || prefetched.has(tab)) return;
      prefetched.add(tab);
      prefetchByTab[tab]?.();
    };
    if (prefetchByTab) {
      navbar.addEventListener("pointerover", handlePrefetch, { passive: true });
      navbar.addEventListener("focusin", handlePrefetch, { passive: true });
    }

    // Tab clicks (desktop tabs + dropdown items)
    navbar.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab-btn, .navbar-dropdown-item");
      if (btn && btn.dataset.tab) {
        switchTab(btn.dataset.tab);
        return;
      }
      if (e.target.closest(".navbar-hamburger")) {
        toggleDropdown();
      }
    });

    // Close on outside click
    document.addEventListener("click", (e) => {
      if (!navbar.contains(e.target)) closeDropdown();
    });

    // Close on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDropdown();
    });
  },
};
