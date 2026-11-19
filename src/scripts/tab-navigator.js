/* ============================================
   TAB NAVIGATION
   ============================================ */
export const TabNavigator = {
  init(ceFilterInit, bondInit, eventInit) {
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
          localStorage.setItem("fgo_theme", nextDark ? "dark" : "light");
        } catch (_e) {
          /* ignore */
        }
      });
    }

    // Restore active tab
    try {
      const savedTab = localStorage.getItem("fgo_active_tab");
      if (savedTab) {
        navbar.querySelectorAll(".tab-btn").forEach((btn) => {
          const isActive = btn.dataset.tab === savedTab;
          btn.classList.toggle("active", isActive);
          btn.setAttribute("aria-selected", String(isActive));
        });
        navbar.querySelectorAll(".navbar-dropdown-item").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.tab === savedTab);
        });
        document.querySelectorAll(".tab-panel").forEach((panel) => {
          panel.classList.toggle("active", panel.id === "panel-" + savedTab);
        });
      } else {
        navbar.querySelectorAll(".tab-btn").forEach((btn) => {
          btn.setAttribute("aria-selected", String(btn.classList.contains("active")));
        });
      }
    } catch (_e) {
      /* ignore */
    }

    // Remove CSS-only tab override — JS now controls tab state
    document.documentElement.removeAttribute("data-tab");

    function switchTab(tab) {
      navbar.querySelectorAll(".tab-btn").forEach((b) => {
        const isActive = b.dataset.tab === tab;
        b.classList.toggle("active", isActive);
        b.setAttribute("aria-selected", String(isActive));
      });
      navbar.querySelectorAll(".navbar-dropdown-item").forEach((b) => {
        b.classList.toggle("active", b.dataset.tab === tab);
      });
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));

      document.getElementById("panel-" + tab).classList.add("active");

      if (tab === "cefilter" && ceFilterInit) ceFilterInit();
      if (tab === "bond" && bondInit) bondInit();
      if (tab === "event" && eventInit) eventInit();

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
