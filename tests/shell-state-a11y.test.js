import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ACTIVE_TAB_KEY, THEME_STORAGE_KEY, VALID_TABS } from "../src/scripts/constants.js";
import { TraitMatcher, computeCEMatchMatrix } from "../src/scripts/ce-matcher.js";

describe("constants storage keys", () => {
  test("exports ACTIVE_TAB_KEY, THEME_STORAGE_KEY, and VALID_TABS", () => {
    assert.equal(ACTIVE_TAB_KEY, "fgo_active_tab");
    assert.equal(THEME_STORAGE_KEY, "fgo_theme");
    assert.deepEqual(VALID_TABS, ["servantinfo", "cefilter", "bond", "event"]);
  });
});

describe("ce-matcher guards (B4)", () => {
  test("TraitMatcher.matches handles missing or non-array traitGroups and traits", () => {
    const traitSet = new Set(["0100", "1001"]);
    assert.equal(TraitMatcher.matches(traitSet, { traits: ["1001"] }), true);
    assert.equal(TraitMatcher.matches(traitSet, { traits: ["9999"], traitGroups: null }), false);
    assert.equal(TraitMatcher.matches(traitSet, {}), true);
  });

  test("computeCEMatchMatrix handles CEs with missing traitGroups", () => {
    const servants = [
      { id: "001", name: "Test", hasAscensions: false, traits: ["0100", "1001"], traitSet: new Set(["0100", "1001"]) },
    ];
    const traitCEs = [{ id: "ce1", traits: ["1001"] }];
    const { results, index } = computeCEMatchMatrix(servants, traitCEs, { 1001: "Female" });
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].matchingCEIds, ["ce1"]);
    assert.deepEqual(index.ce1, [0]);
  });
});

describe("ce-match-worker guards (B4)", () => {
  test("posts error when compute runs before init, and handles valid init + compute with reqId", async () => {
    const posted = [];
    const prevSelf = globalThis.self;
    globalThis.self = {
      postMessage: (msg) => posted.push(msg),
      onmessage: null,
    };
    try {
      await import("../src/scripts/ce-match-worker.js");
      assert.equal(typeof globalThis.self.onmessage, "function");

      // Compute before init -> clean error message
      globalThis.self.onmessage({ data: { type: "compute", reqId: 1 } });
      assert.equal(posted.length, 1);
      assert.equal(posted[0].type, "error");
      assert.equal(posted[0].reqId, 1);

      // Malformed event -> caught by try/catch
      globalThis.self.onmessage({ data: null });
      assert.equal(posted.length, 1);

      // Valid init + compute
      globalThis.self.onmessage({
        data: {
          type: "init",
          servants: [{ id: "001", name: "A", hasAscensions: false, traits: ["1001"] }],
          traitCEs: [{ id: "ce1", traits: ["1001"] }],
          traitNames: { 1001: "Female" },
        },
      });
      globalThis.self.onmessage({ data: { type: "compute", reqId: 2 } });
      assert.equal(posted.length, 2);
      assert.equal(posted[1].type, "result");
      assert.equal(posted[1].reqId, 2);
      assert.equal(posted[1].results.length, 1);
    } finally {
      if (prevSelf === undefined) {
        delete globalThis.self;
      } else {
        globalThis.self = prevSelf;
      }
    }
  });
});

describe("TabNavigator whitelist and roving keyboard nav (B2, S2, A3)", () => {
  function makeClassList(initial = []) {
    const set = new Set(initial);
    return {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      contains: (c) => set.has(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (set.has(c)) {
            set.delete(c);
            return false;
          }
          set.add(c);
          return true;
        }
        if (force) set.add(c);
        else set.delete(c);
        return Boolean(force);
      },
    };
  }

  function makeEl({ id = "", dataset = {}, classes = [] } = {}) {
    const listeners = {};
    const attrs = {};
    let focused = false;
    return {
      id,
      dataset,
      tabIndex: 0,
      classList: makeClassList(classes),
      addEventListener: (ev, fn) => {
        if (!listeners[ev]) listeners[ev] = [];
        listeners[ev].push(fn);
      },
      dispatch: (ev, payload = {}) => {
        (listeners[ev] || []).forEach((fn) => fn(payload));
      },
      setAttribute: (k, v) => {
        attrs[k] = String(v);
      },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      removeAttribute: (k) => {
        delete attrs[k];
      },
      focus: () => {
        focused = true;
      },
      get focused() {
        return focused;
      },
      contains: () => false,
    };
  }

  test("invalid saved tab defaults to cefilter and Arrow/Home/End switch tabs", async () => {
    const storage = new Map([[ACTIVE_TAB_KEY, "invalid_tab"]]);
    const prevLS = globalThis.localStorage;
    const prevDoc = globalThis.document;

    const tabs = [
      makeEl({ dataset: { tab: "servantinfo" }, classes: ["tab-btn"] }),
      makeEl({ dataset: { tab: "cefilter" }, classes: ["tab-btn", "active"] }),
      makeEl({ dataset: { tab: "bond" }, classes: ["tab-btn"] }),
      makeEl({ dataset: { tab: "event" }, classes: ["tab-btn"] }),
    ];
    const panels = {
      "panel-servantinfo": makeEl({ id: "panel-servantinfo", classes: ["tab-panel"] }),
      "panel-cefilter": makeEl({ id: "panel-cefilter", classes: ["tab-panel"] }),
      "panel-bond": makeEl({ id: "panel-bond", classes: ["tab-panel"] }),
      "panel-event": makeEl({ id: "panel-event", classes: ["tab-panel"] }),
    };
    const hamburger = makeEl({ classes: ["navbar-hamburger"] });
    const dropdown = makeEl({ classes: ["navbar-dropdown"] });
    const themeToggle = makeEl({ classes: ["theme-toggle"] });
    const navbar = {
      ...makeEl({ classes: ["navbar"] }),
      querySelector: (sel) => {
        if (sel === ".navbar-hamburger") return hamburger;
        if (sel === ".navbar-dropdown") return dropdown;
        if (sel === ".theme-toggle") return themeToggle;
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel === ".tab-btn") return tabs;
        if (sel === ".navbar-dropdown-item") return [];
        return [];
      },
    };
    const docEl = makeEl();

    globalThis.localStorage = {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
    };
    globalThis.document = {
      documentElement: docEl,
      activeElement: null,
      querySelector: (sel) => (sel === ".navbar" ? navbar : null),
      querySelectorAll: (sel) => (sel === ".tab-panel" ? Object.values(panels) : []),
      getElementById: (id) => panels[id] || null,
      addEventListener: () => {},
    };

    try {
      const { TabNavigator } = await import("../src/scripts/tab-navigator.js");
      const calls = [];
      TabNavigator.init(
        () => calls.push("cefilter"),
        () => calls.push("bond"),
        () => calls.push("event"),
        () => calls.push("servantinfo"),
      );

      // Invalid saved tab falls back to cefilter
      assert.equal(tabs[1].classList.contains("active"), true);
      assert.equal(tabs[1].getAttribute("aria-selected"), "true");
      assert.equal(tabs[1].tabIndex, 0);
      assert.equal(tabs[0].tabIndex, -1);
      assert.equal(tabs[2].tabIndex, -1);
      assert.equal(panels["panel-cefilter"].classList.contains("active"), true);

      // ArrowRight from cefilter -> bond
      let prevented = false;
      tabs[1].dispatch("keydown", { key: "ArrowRight", preventDefault: () => (prevented = true) });
      assert.equal(prevented, true);
      assert.equal(tabs[2].focused, true);
      assert.equal(tabs[2].getAttribute("aria-selected"), "true");
      assert.equal(tabs[2].tabIndex, 0);
      assert.equal(tabs[1].getAttribute("aria-selected"), "false");
      assert.equal(tabs[1].tabIndex, -1);
      assert.equal(storage.get(ACTIVE_TAB_KEY), "bond");
      assert.deepEqual(calls, ["bond"]);

      // End -> event
      tabs[2].dispatch("keydown", { key: "End", preventDefault: () => {} });
      assert.equal(tabs[3].getAttribute("aria-selected"), "true");
      assert.equal(storage.get(ACTIVE_TAB_KEY), "event");

      // Home -> servantinfo
      tabs[3].dispatch("keydown", { key: "Home", preventDefault: () => {} });
      assert.equal(tabs[0].getAttribute("aria-selected"), "true");
      assert.equal(panels["panel-servantinfo"].classList.contains("active"), true);
      assert.equal(storage.get(ACTIVE_TAB_KEY), "servantinfo");
      assert.deepEqual(calls, ["bond", "event", "servantinfo"]);

      // Theme toggle persists under THEME_STORAGE_KEY
      themeToggle.dispatch("click");
      assert.equal(storage.get(THEME_STORAGE_KEY), "dark");
    } finally {
      globalThis.localStorage = prevLS;
      globalThis.document = prevDoc;
    }
  });
});

describe("BondApp B1 and S1", () => {
  test("onPendingRemove flushes inputs before resetting slot, and saveState warns on error", async () => {
    const prevLS = globalThis.localStorage;
    const prevWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };

    try {
      const { BondApp } = await import("../src/scripts/bond-app.js");
      BondApp.state = {
        slots: [
          { servantId: "001", bondNeeded: 100, type: "normal", maxBond: false, ces: [] },
          { servantId: "002", bondNeeded: 200, type: "normal", maxBond: false, ces: [] },
        ],
      };
      BondApp.elements = {
        slotBond_0: { value: "500" },
        slotBond_1: { value: "750" },
      };
      const prevBuild = BondApp.buildServantSlots;
      BondApp.buildServantSlots = () => {};
      try {
        const cbs = BondApp._createServantCallbacks(0);
        cbs.onPendingRemove();

        // Slot 1's typed bond value was flushed before slot 0 was reset
        assert.equal(BondApp.state.slots[1].bondNeeded, 750);
        assert.equal(BondApp.state.slots[0].servantId, null);

        // saveState warned instead of silently swallowing
        assert.ok(warnings.some((w) => w[0] === "Failed to save bond state:"));
      } finally {
        BondApp.buildServantSlots = prevBuild;
      }
    } finally {
      console.warn = prevWarn;
      globalThis.localStorage = prevLS;
    }
  });
});
