/* ============================================
   TAB NAVIGATION
   ============================================ */
export const TabNavigator = {
  init(ceFilterInit, bondInit) {
    const navbar = document.querySelector(".navbar");
    if (!navbar) return;

    const hamburger = navbar.querySelector(".navbar-hamburger");
    const dropdown = navbar.querySelector(".navbar-dropdown");

    // Restore active tab
    try {
      const savedTab = localStorage.getItem("fgo_active_tab");
      if (savedTab) {
        navbar.querySelectorAll(".tab-btn").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.tab === savedTab);
        });
        navbar.querySelectorAll(".navbar-dropdown-item").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.tab === savedTab);
        });
        document.querySelectorAll(".tab-panel").forEach((panel) => {
          panel.classList.toggle("active", panel.id === "panel-" + savedTab);
        });
      }
    } catch (_e) {
      /* ignore */
    }

    // Remove CSS-only tab override — JS now controls tab state
    document.documentElement.removeAttribute("data-tab");

    function switchTab(tab) {
      navbar.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      navbar.querySelectorAll(".navbar-dropdown-item").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));

      // Activate matching buttons in both tab bar and dropdown
      navbar.querySelectorAll('[data-tab="' + tab + '"]').forEach((b) => b.classList.add("active"));
      document.getElementById("panel-" + tab).classList.add("active");

      if (tab === "cefilter") ceFilterInit();
      if (tab === "bond") bondInit();

      try {
        localStorage.setItem("fgo_active_tab", tab);
      } catch (_e) {
        /* ignore */
      }

      closeDropdown();
    }

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
