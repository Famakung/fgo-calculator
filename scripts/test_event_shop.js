#!/usr/bin/env node
/**
 * scripts/test_event_shop.js
 *
 * Browser gate for the Event Shop planner under Amendment A (event-native tier cards +
 * per-currency draft modal). Pins, against the PRODUCTION build:
 *
 *  - planner card rows are read-only displays (role=button, tabindex, aria-haspopup, live
 *    aria-label); the old Buy all / Clear buttons and card-side steppers must NOT exist;
 *  - the currency modal #eventShopModal opens from a planner row (click / Tab+Enter) AND from a
 *    tier Required input; Escape / ✕ / Cancel / backdrop close it as a discard;
 *  - all clamping (limitNum, schema max 999999, focus-preserving typing, negative input, rapid
 *    stepper race) now lives INSIDE the modal draft rows — moved, never weakened;
 *  - Select All = clearRequires semantics, Default = zero the draft; only Done commits;
 *  - Done agreement: localStorage fgo_event_shop_data, planner displays/chips/group totals and
 *    the tier Required displays (plus the legacy calculator state) all show the same numbers,
 *    cross-checked against this file's independent reference math over
 *    src/scripts/data/event_shop.js — never through the app's EventShop;
 *  - tier cards and quest-drop titles/icons show the live event currency art and names;
 *  - persistence across reload, event-id mismatch reset, hostile storage sanitisation, storage
 *    write discipline (draft typing writes nothing; Done writes once), quota-failure path,
 *    filter chips, keyboard operation, zero sideways overflow / zero page errors at 360px and
 *    1120px, and zero runtime external fetches.
 *
 * Legacy fallback (stub snapshot: event null) is pinned with --legacy against a patched bundle
 * copy served on a spare port — the production snapshot always has an event, so the stub branch
 * cannot be reached through the unpatched site. See the footer notes for the patch recipe.
 *
 * Run it against `astro preview` on the spare port (3000 is the owner's live test server):
 *   npm run build
 *   npx astro preview --port 4173
 *   node scripts/test_event_shop.js http://localhost:4173/fgo-calculator/
 *   node scripts/test_event_shop.js http://localhost:4199/fgo-calculator/ --legacy   (stub copy)
 *
 * WARNING: the HMR dev server is not a valid target (see scripts/verify_render.js): it creates
 * duplicate module instances, so what it renders is not what ships.
 *
 * Exits 1 with one `[ERROR] <check>` line per failed check.
 */

import puppeteer from "puppeteer";
import { EVENT_SHOP_DATA } from "../src/scripts/data/event_shop.js";
import { EVENT_SHOP_STORAGE_KEY, STORAGE_KEY, QUEST_DROPS } from "../src/scripts/constants.js";

const argv = process.argv.slice(2);
const LEGACY = argv.includes("--legacy");
const url = argv.find((a) => !a.startsWith("--")) || "http://localhost:4173/fgo-calculator/";
const errors = [];
const KEY = EVENT_SHOP_STORAGE_KEY;
const SETTLE_MS = 350; // DEBOUNCE_MS is 100; 350 leaves the commit room on a loaded machine.
const TIERS = ["bronze", "silver", "gold"];

const DATA = EVENT_SHOP_DATA;
const ITEMS = DATA.items || [];
const CURRENCIES = DATA.currencies || [];
const EVENT_ID = DATA.event ? DATA.event.id : null;
const byId = new Map(ITEMS.map((item) => [String(item.id), item]));
const SHOP_MAX = 999999;

/* --- reference math, deliberately a second implementation of the contract --- */
const maxRequire = (item) => (item.limitNum > 0 ? item.limitNum : SHOP_MAX);
const refClamp = (item, value) => {
  const num = parseFloat(value);
  const clamped = Number.isNaN(num) ? 0 : Math.min(maxRequire(item), Math.max(0, num));
  return Math.floor(clamped);
};
const refTotals = (requires) => {
  const totals = {};
  for (const currency of CURRENCIES) totals[String(currency.id)] = 0;
  for (const item of ITEMS) {
    const count = requires[String(item.id)] || 0;
    totals[String(item.cost.itemId)] += count * item.cost.amount;
  }
  return totals;
};
const refClear = (items) => {
  const requires = {};
  for (const item of items) requires[String(item.id)] = item.limitNum > 0 ? item.limitNum : 0;
  return requires;
};
const fmtRef = (value) => Number(value).toLocaleString("en-US");
const currencyOf = (item) => CURRENCIES.find((c) => String(c.id) === String(item.cost.itemId));
const tierOfCurrency = (currency) => currency.background;
const itemsOfCurrency = (currencyId) => ITEMS.filter((item) => String(item.cost.itemId) === String(currencyId));
const num = (text) => Number(String(text).replace(/[^0-9.-]/g, ""));

/* Amendment A data truth (plan round tracker, id asc): never trust the UI against itself. */
const BUY_ALL_TRUTH = { 94164000: 5740, 94164001: 5390, 94164002: 6610 };
const BUY_ALL_NAMES = { 94164000: "MISOおでん", 94164001: "SHIMONITAネギ", 94164002: "YAKIまんじゅう" };

/* Fixed sample rows used by the modal clamp / unlimited / keyboard checks. */
const limitedRows = ITEMS.filter((item) => item.limitNum === 1);
const bigLimitRows = ITEMS.filter((item) => item.limitNum > 1);
const unlimitedRows = ITEMS.filter((item) => item.limitNum === 0);
const costumeRow = ITEMS.find((item) => item.purchaseType === "costumeRelease");
const equipRow = ITEMS.find((item) => item.purchaseType === "servant" && /equip_/.test(item.icon || ""));
const multiSetRow = ITEMS.find((item) => item.setNum > 1);

if (!LEGACY && (!limitedRows.length || !unlimitedRows.length || CURRENCIES.length < 3)) {
  console.error("[ERROR] planner: the data snapshot has no limited/unlimited rows to pin — gate is blind");
  process.exit(1);
}

const clampRow = limitedRows[0];
const stepRow = bigLimitRows[0] || limitedRows[0];
/* Scenes that open a currency modal need rows OF THAT CURRENCY: gold carries the clamp scene
   (clampRow/stepRow/draftFree), bronze carries the commit/quota/backdrop scenes (freeRow). */
const goldCurrency = CURRENCIES.find((c) => c.background === "gold");
const bronzeCurrency = CURRENCIES.find((c) => c.background === "bronze");
const sameCurrency = (item, currency) => String(item.cost.itemId) === String(currency.id);
const freeRow = unlimitedRows.find((item) => sameCurrency(item, bronzeCurrency)) || unlimitedRows[0];
const draftFree = unlimitedRows.find((item) => sameCurrency(item, currencyOf(clampRow))) || clampRow;

const sel = {
  cardRow: (id) => `#eventPlannerList .eshop-item[data-item-id="${id}"]`,
  cardDisplay: (id) => `${sel.cardRow(id)} .eshop-require-display`,
  chip: (key) => `#eventPlannerControls .eshop-filter-chip[data-filter="${key}"]`,
  modalRow: (id) => `#eventShopModalList .eshop-item[data-item-id="${id}"]`,
  modalInput: (id) => `${sel.modalRow(id)} .eshop-require-input`,
  modalPlus: (id) => `${sel.modalRow(id)} .eshop-step-btn[data-step="1"]`,
  modalMinus: (id) => `${sel.modalRow(id)} .eshop-step-btn[data-step="-1"]`,
  tierNeed: (tier) => `#${tier}Need`,
  footer: (name) => `#eventShopModal${name}Btn`,
};

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1120, height: 900 });

  const pageErrors = [];
  const consoleMessages = [];
  const shopResponses = [];
  const externalHosts = new Set();
  const origin = new URL(url).origin;
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => consoleMessages.push({ type: m.type(), text: m.text() }));
  const consoleErrors = () => consoleMessages.filter((m) => m.type === "error").map((m) => m.text);
  const consoleWarnings = () =>
    consoleMessages.filter((m) => m.type === "warn" || m.type === "warning").map((m) => m.text);
  page.on("response", (res) => {
    if (/event_shop/.test(res.url())) shopResponses.push({ url: res.url(), status: res.status() });
  });
  page.on("request", (req) => {
    try {
      const u = new URL(req.url());
      if (u.origin !== origin) externalHosts.add(u.origin);
    } catch {
      /* non-http schemes (data:) are not external fetches */
    }
  });

  /* --- harness helpers (identical discipline to round 1) --- */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  /* Lazy icons grow the document as they decode, so a click can aim at a box that already moved:
     scroll in, wait for geometry to stop, prove the target is under the cursor, retry if not. */
  const safeClick = async (target) => {
    let detail = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      detail = await page.evaluate(async (s) => {
        const el = document.querySelector(s);
        if (!el) return { found: false };
        el.scrollIntoView({ block: "center" });
        let stable = false;
        let last = null;
        for (let i = 0; i < 80; i++) {
          await new Promise((r) => setTimeout(r, 50));
          const b = el.getBoundingClientRect();
          const key = `${Math.round(b.x)}:${Math.round(b.y)}:${document.documentElement.scrollHeight}`;
          if (last === key) {
            stable = true;
            break;
          }
          last = key;
        }
        const b = el.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return {
          found: true,
          stable,
          onScreen: b.top >= 0 && b.bottom <= window.innerHeight && b.width > 0 && b.height > 0,
          hit: hit ? `${hit.tagName}|${hit.className}` : null,
          covered: !!hit && hit !== el && !el.contains(hit),
        };
      }, target);
      if (!detail.found) {
        errors.push(`harness click: nothing matches ${target}`);
        return;
      }
      if (detail.covered) {
        errors.push(
          `harness click: ${target} is covered by ${JSON.stringify(detail.hit)} at its own centre point — a real user cannot reach it`,
        );
        return;
      }
      if (detail.stable && detail.onScreen) {
        try {
          await page.click(target);
          return;
        } catch (e) {
          detail.error = e.message.split("\n")[0];
        }
      }
      await wait(150);
    }
    errors.push(`harness click: ${target} never became a stable on-screen target — ${JSON.stringify(detail)}`);
  };

  const readCard = () =>
    page.evaluate(
      (k, legacyKey) => {
        const fmt = (v) => Number(v).toLocaleString("en-US");
        const rows = [...document.querySelectorAll("#eventPlannerList .eshop-item")].map((row) => {
          const display = row.querySelector(".eshop-require-display");
          return {
            id: row.getAttribute("data-item-id"),
            display: display ? display.textContent : null,
            displayItemId: display ? display.getAttribute("data-item-id") : null,
            total: (row.querySelector(".eshop-item-total") || {}).textContent || null,
            active: row.classList.contains("eshop-item--active"),
            meta: (row.querySelector(".eshop-item-meta") || {}).textContent || "",
            name: (row.querySelector(".eshop-item-name") || {}).textContent || "",
            ariaLabel: row.getAttribute("aria-label"),
            role: row.getAttribute("role"),
            tabindex: row.getAttribute("tabindex"),
            haspopup: row.getAttribute("aria-haspopup"),
            editable: row.classList.contains("eshop-item--editable"),
            hasImg: !!row.querySelector("img.eshop-item-icon"),
            hasFallback: !!row.querySelector(".eshop-item-icon-fallback"),
          };
        });
        return {
          rows,
          groups: [...document.querySelectorAll("#eventPlannerList .eshop-group")].map((g) => ({
            currency: g.getAttribute("data-currency"),
            tier: g.getAttribute("data-tier"),
            total: (g.querySelector(".eshop-group-total") || {}).textContent || "",
            rows: g.querySelectorAll(":scope > .eshop-item").length,
            headerImg: !!g.querySelector(".eshop-group-header img"),
          })),
          chips: [...document.querySelectorAll("#eventPlannerSummary .eshop-summary-chip")].map((c) => ({
            currency: c.getAttribute("data-currency"),
            tier: c.getAttribute("data-tier"),
            name: (c.querySelector(".eshop-summary-name") || {}).textContent || "",
            total: (c.querySelector(".eshop-summary-total") || {}).textContent || "",
            hasImg: !!c.querySelector("img"),
          })),
          filters: [...document.querySelectorAll("#eventPlannerControls .eshop-filter-chip")].map((b) => ({
            key: b.getAttribute("data-filter"),
            pressed: b.getAttribute("aria-pressed"),
            active: b.classList.contains("eshop-filter-chip--active"),
            label: b.textContent.trim(),
          })),
          emptyMsg: (document.querySelector("#eventPlannerList .eshop-empty") || {}).textContent || null,
          cardSteppers: document.querySelectorAll("#eventPlannerList .eshop-require-input").length,
          cardStepBtns: document.querySelectorAll("#eventPlannerList .eshop-step-btn").length,
          buyAllBtn: !!document.getElementById("eventPlannerBuyAll"),
          clearBtn: !!document.getElementById("eventPlannerClear"),
          eventName: (document.getElementById("eventPlannerEventName") || {}).textContent || "",
          activeTab: (document.querySelector(".tab-btn.active") || {}).dataset?.tab || null,
          eventWindow: (document.getElementById("eventPlannerWindow") || {}).textContent || "",
          summaryHidden: !!document.getElementById("eventPlannerSummary").hasAttribute("hidden"),
          controlsHidden: !!document.getElementById("eventPlannerControls").hasAttribute("hidden"),
          fallbacks: document.querySelectorAll(
            "#eventPlannerCard .eshop-item-icon-fallback, #eventPlannerCard .eshop-icon-fallback",
          ).length,
          storage: localStorage.getItem(k),
          legacyStorage: localStorage.getItem(legacyKey),
          polluted: Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"),
          fmtCheck: fmt(5740),
        };
      },
      KEY,
      STORAGE_KEY,
    );

  const readModal = () =>
    page.evaluate(() => {
      const modal = document.getElementById("eventShopModal");
      return {
        open: modal.classList.contains("open"),
        title: (document.getElementById("eventShopModalTitle") || {}).textContent || "",
        rows: [...document.querySelectorAll("#eventShopModalList .eshop-item")].map((row) => {
          const input = row.querySelector(".eshop-require-input");
          return {
            id: row.getAttribute("data-item-id"),
            value: input ? input.value : null,
            max: input ? input.getAttribute("max") : null,
            ariaLabel: input ? input.getAttribute("aria-label") : null,
            total: (row.querySelector(".eshop-item-total") || {}).textContent || "",
            active: row.classList.contains("eshop-item--active"),
            minusLabel:
              (row.querySelector('.eshop-step-btn[data-step="-1"]') || {}).getAttribute?.("aria-label") || null,
            plusLabel: (row.querySelector('.eshop-step-btn[data-step="1"]') || {}).getAttribute?.("aria-label") || null,
          };
        }),
        displaySpans: document.querySelectorAll("#eventShopModalList .eshop-require-display").length,
      };
    });

  const readTier = () =>
    page.evaluate(() => {
      const tiers = {};
      for (const t of ["bronze", "silver", "gold"]) {
        const card = document.querySelector(`#materialsGrid [data-tier="${t}"]`);
        const need = document.getElementById(`${t}Need`);
        const held = document.getElementById(`${t}Have`);
        const bonus = document.getElementById(`${t}Bonus`);
        const iconBox = card ? card.querySelector(".material-icon") : null;
        const imgs = iconBox ? [...iconBox.querySelectorAll("img")] : [];
        tiers[t] = {
          name: card ? (card.querySelector(".material-name") || {}).textContent : null,
          needValue: need ? need.value : null,
          needReadOnly: need ? need.readOnly : null,
          needDisplayClass: need ? need.classList.contains("eshop-require-display") : null,
          needHaspopup: need ? need.getAttribute("aria-haspopup") : null,
          heldReadOnly: held ? held.readOnly : null,
          bonusReadOnly: bonus ? bonus.readOnly : null,
          imgs: imgs.map((i) => ({ cls: i.className, src: i.getAttribute("src"), w: i.naturalWidth })),
        };
      }
      const quests = {};
      for (const t of ["bronze", "silver", "gold"]) {
        const titleEl = document.querySelector(`#questDropsGrid [data-tier="${t}"] .quest-drops-title`);
        const icons = {};
        for (const m of ["bronze", "silver", "gold"]) {
          const span = document.getElementById(`${t}Quest_${m}_icon`);
          if (span) {
            const img = span.querySelector("img.fg-layer") || span.querySelector("img");
            icons[m] = img ? { cls: img.className, src: img.getAttribute("src"), w: img.naturalWidth } : "no-img";
          }
        }
        quests[t] = { title: titleEl ? titleEl.textContent : null, icons };
      }
      return { tiers, quests };
    }, KEY);

  const rowMap = (state) => new Map(state.rows.map((r) => [r.id, r]));
  const chipMap = (state) => new Map(state.chips.map((c) => [c.currency, c]));

  /* Asserts the visible card plan against the reference plan: the read-only display text, the row
     subtotal, the active tint, the summary chips and the group headers all carry the same number.
     Only on-screen rows are compared, so a currency filter narrows the check instead of breaking
     it; every planned purchase still has to be visible in its group. Card displays have no typed
     exemption any more — they mirror committed state exactly. */
  const assertPlan = (state, expected, label) => {
    const want = refTotals(expected);
    const rows = rowMap(state);
    if (state.activeTab && state.activeTab !== "event") {
      errors.push(
        `${label}: the active tab is ${JSON.stringify(state.activeTab)} — a planner gesture moved the user off the Event tab`,
      );
    }
    const badRows = [];
    if (state.groups.length === CURRENCIES.length && rows.size !== ITEMS.length) {
      badRows.push(`${rows.size} of ${ITEMS.length} rows on screen`);
    }
    for (const row of state.rows) {
      const item = byId.get(row.id);
      if (!item) {
        badRows.push(`${row.id}: not in the data snapshot`);
        continue;
      }
      const count = expected[row.id] || 0;
      if (row.display !== fmtRef(count) || num(row.total) !== count * item.cost.amount) {
        badRows.push(
          `${row.id}: display=${JSON.stringify(row.display)} total=${row.total} want ${count}/${count * item.cost.amount}`,
        );
      }
      if (row.active !== count > 0) badRows.push(`${row.id}: active tint ${row.active}, want ${count > 0}`);
    }
    const visibleCurrencies = new Set(state.groups.map((g) => String(g.currency)));
    const hiddenPlan = Object.keys(expected).filter((id) => {
      if (expected[id] <= 0 || rows.has(id)) return false;
      const item = byId.get(id);
      return !item || visibleCurrencies.has(String(item.cost.itemId));
    });
    if (hiddenPlan.length)
      errors.push(`planned row(s) missing from a visible group ${hiddenPlan.slice(0, 3).join("/")}`);
    if (badRows.length) errors.push(`${label}: ${badRows.length} row(s) off plan — ${badRows.slice(0, 4).join(" | ")}`);
    const chips = chipMap(state);
    for (const currency of CURRENCIES) {
      const chip = chips.get(String(currency.id));
      const got = chip ? num(chip.total) : null;
      if (got !== want[String(currency.id)]) {
        errors.push(
          `${label}: ${currency.name} (${currency.id}) summary chip shows ${got}, want ${want[String(currency.id)]}`,
        );
      }
    }
    for (const group of state.groups) {
      if (num(group.total) !== want[String(group.currency)]) {
        errors.push(
          `${label}: group ${group.currency} header shows ${group.total}, want ×${want[String(group.currency)]}`,
        );
      }
    }
    return want;
  };

  /* Tier Required displays and the legacy calculator state must agree with the same totals. */
  const assertTierNeeds = (tierState, expected, label) => {
    const want = refTotals(expected);
    for (const currency of CURRENCIES) {
      const tier = tierOfCurrency(currency);
      const t = tierState.tiers[tier];
      if (t.needValue !== String(want[String(currency.id)])) {
        errors.push(
          `${label}: ${tier} Required reads ${JSON.stringify(t.needValue)}, want ${want[String(currency.id)]}`,
        );
      }
      if (want[String(currency.id)] !== 0 && !t.needReadOnly) {
        errors.push(`${label}: ${tier} Required lost its read-only flag with a live plan`);
      }
    }
    if (tierState.legacyStorage) {
      try {
        const saved = JSON.parse(tierState.legacyStorage);
        for (const currency of CURRENCIES) {
          const tier = tierOfCurrency(currency);
          if (saved[`${tier}Need`] !== want[String(currency.id)]) {
            errors.push(
              `${label}: legacy state ${tier}Need is ${saved[`${tier}Need`]}, plan says ${want[String(currency.id)]}`,
            );
          }
        }
      } catch {
        /* the legacy blob format is the calculator's own business; the DOM pin above already ran */
      }
    }
  };

  const typeInto = async (inputSel, text) => {
    await page.focus(inputSel);
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(text, { delay: 12 });
    const typed = await page.evaluate((s) => {
      const el = document.querySelector(s);
      return el ? { value: el.value, focused: document.activeElement === el } : { value: null, focused: false };
    }, inputSel);
    if (typed.value !== text) {
      errors.push(
        `harness typing: typed "${text}" into ${inputSel}, the input reads ${JSON.stringify(typed.value)} (focused=${typed.focused})`,
      );
    }
  };

  const modalGate = async (wantOpen, label) => {
    try {
      await page.waitForFunction(
        (o) => document.getElementById("eventShopModal").classList.contains("open") === o,
        { timeout: 5000 },
        wantOpen,
      );
      return true;
    } catch {
      errors.push(`${label}: #eventShopModal never became open=${wantOpen}`);
      return false;
    }
  };
  const openRowModal = async (itemId, label) => {
    await safeClick(sel.cardRow(itemId));
    return modalGate(true, label || `open modal from row ${itemId}`);
  };
  const openTierModal = async (tier, label) => {
    await safeClick(sel.tierNeed(tier));
    return modalGate(true, label || `open modal from ${tier} Required`);
  };
  const closeBy = async (via, label) => {
    if (via === "Escape") await page.keyboard.press("Escape");
    else if (via === "Cancel") await safeClick("#eventShopModalCancelBtn");
    else if (via === "X") await safeClick("#eventShopModalClose");
    else if (via === "backdrop") {
      const pt = await page.evaluate(() => {
        const modal = document.getElementById("eventShopModal");
        const content = modal.querySelector(".servant-modal-content");
        const mr = modal.getBoundingClientRect();
        const cr = content.getBoundingClientRect();
        const x = Math.round(cr.left - 12);
        const y = Math.round((mr.top + mr.bottom) / 2);
        const hit = x >= mr.left && document.elementFromPoint(x, y);
        return { x, y, onModal: hit === modal };
      });
      if (pt.onModal) await page.mouse.click(pt.x, pt.y);
      else {
        console.log(
          `NOTE: backdrop has no visible strip at this viewport — dispatching mousedown on the modal itself (same event target the browser would use)`,
        );
        await page.evaluate(() => {
          const m = document.getElementById("eventShopModal");
          m.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        });
      }
    } else errors.push(`harness: unknown modal close "${via}"`);
    await modalGate(false, label || `close modal via ${via}`);
  };
  const clickDone = async () => {
    await safeClick("#eventShopModalDoneBtn");
    await modalGate(false, "Done closes the modal");
    await wait(SETTLE_MS);
  };

  const seedStorage = async (raw) => {
    await page.evaluate(
      (k, value) => {
        if (value === null) localStorage.removeItem(k);
        else localStorage.setItem(k, value);
      },
      KEY,
      raw,
    );
  };
  const resetPlan = async () => {
    await page.evaluate(
      (k, lk) => {
        localStorage.removeItem(k);
        localStorage.removeItem(lk);
      },
      KEY,
      STORAGE_KEY,
    );
    await page.reload({ waitUntil: "networkidle0" });
    await ensureEventTab();
    await wait(SETTLE_MS);
  };
  const seedAndReload = async (raw) => {
    await seedStorage(raw);
    await page.reload({ waitUntil: "networkidle0" });
    await ensureEventTab();
    await wait(SETTLE_MS);
  };
  async function ensureEventTab() {
    const visible = () =>
      page.evaluate(() => ({
        rows: document.querySelectorAll("#eventPlannerList .eshop-item").length,
        empty: !!document.querySelector("#eventPlannerList .eshop-empty"),
        built: !!document.querySelector("#eventPlannerList"),
        activeTab: (document.querySelector(".tab-btn.active") || {}).dataset?.tab || null,
        panelShown: getComputedStyle(document.getElementById("panel-event")).display !== "none",
      }));
    let st = await visible();
    if (st.activeTab !== "event" || !st.panelShown) {
      // main.js warms the Event tab while idle, so its rows exist inside a hidden panel; a user only
      // ever reaches them through the tab button, and the gate has to take that same route.
      await safeClick('.tab-btn[data-tab="event"]');
      try {
        await page.waitForFunction(() => document.querySelector(".tab-btn.active")?.dataset.tab === "event", {
          timeout: 15000,
        });
      } catch {
        /* falls through to the read below, which reports it */
      }
      st = await visible();
    }
    if (st.activeTab !== "event" || !st.panelShown) {
      errors.push(
        `planner tab: the Event tab is not the visible panel (active=${JSON.stringify(st.activeTab)}, panelShown=${st.panelShown}) — nothing in the planner is reachable`,
      );
    }
    return st;
  }

  /* install a counting / throwing spy over localStorage for the planner key only */
  const installWriteSpy = (opts = {}) =>
    page.evaluate(
      async (k, throwIt) => {
        if (!self.__nativeSetItem) self.__nativeSetItem = Storage.prototype.setItem;
        const native = self.__nativeSetItem;
        self.__eshopWrites = [];
        Storage.prototype.setItem = function (key, value) {
          if (key === k) {
            self.__eshopWrites.push(value);
            if (throwIt) throw new DOMException("exceeded the quota", "QuotaExceededError");
          }
          return native.apply(this, arguments);
        };
      },
      KEY,
      !!opts.throw,
    );
  const uninstallWriteSpy = () =>
    page.evaluate(() => {
      Storage.prototype.setItem = self.__nativeSetItem;
      delete self.__eshopWrites;
    });
  const writeCount = () => page.evaluate(() => self.__eshopWrites.length);

  await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate(
    (k, lk) => {
      localStorage.removeItem(k);
      localStorage.removeItem(lk);
    },
    KEY,
    STORAGE_KEY,
  );
  await page.reload({ waitUntil: "networkidle0" });

  if (LEGACY) {
    /* ================= LEGACY FALLBACK (stub snapshot, patched bundle) ================= */
    const t0 = Date.now();
    const st0 = await ensureEventTab();
    console.log(`NOTE: legacy mode — tab ready in ${Date.now() - t0}ms (rows=${st0.rows}, empty=${st0.empty})`);
    if (st0.rows !== 0) errors.push(`legacy: planner shows ${st0.rows} rows with a stub snapshot, want 0`);
    if (!st0.empty) errors.push("legacy: #eventPlannerList has no .eshop-empty message");
    const base = await readCard();
    if (base.emptyMsg !== "No event shop data yet \u2014 run npm run data:sync.") {
      errors.push(`legacy: empty message reads ${JSON.stringify(base.emptyMsg)}`);
    }
    if (base.eventName !== "Event Shop")
      errors.push(`legacy: card name is ${JSON.stringify(base.eventName)}, want "Event Shop"`);
    if (!base.summaryHidden || !base.controlsHidden) {
      errors.push(
        `legacy: summary hidden=${base.summaryHidden} controls hidden=${base.controlsHidden}, want both hidden`,
      );
    }
    if (base.chips.length || base.groups.length) errors.push("legacy: chips/groups rendered with no event");
    const tier = await readTier();
    for (const t of TIERS) {
      const td = tier.tiers[t];
      if (td.needReadOnly !== false)
        errors.push(`legacy: ${t} Required is readOnly — the editable field must survive a stub snapshot`);
      if (td.needDisplayClass) errors.push(`legacy: ${t} Required carries the eshop-require-display class`);
      if (td.needHaspopup !== null) errors.push(`legacy: ${t} Required has aria-haspopup=${td.needHaspopup}`);
      if (td.name !== t.charAt(0).toUpperCase() + t.slice(1))
        errors.push(`legacy: ${t} card name is ${JSON.stringify(td.name)}`);
      const srcs = td.imgs.map((i) => i.src || "");
      if (
        !srcs.some((s) => s.includes(`icons/materials/${t}_bg.webp`)) ||
        !srcs.some((s) => s.includes(`icons/materials/${t}_fg.webp`))
      ) {
        errors.push(`legacy: ${t} icon shows ${JSON.stringify(srcs)}, want the generic bg+fg pair`);
      }
      const before = td.needValue;
      await page.focus(sel.tierNeed(t));
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.press("Digit7");
      await wait(SETTLE_MS);
      const after = (await readTier()).tiers[t].needValue;
      if (after !== "7")
        errors.push(
          `legacy: typing into ${t} Required left it at ${JSON.stringify(after)} (was ${JSON.stringify(before)}), want editable "7"`,
        );
    }
    await safeClick("#bronzeNeed");
    await wait(SETTLE_MS);
    const modalAfterTierClick = await readModal();
    if (modalAfterTierClick.open)
      errors.push("legacy: clicking a tier Required opened the currency modal — no currency is mapped under a stub");
    for (const [quest, drops] of Object.entries(QUEST_DROPS)) {
      const qd = tier.quests[quest];
      const wantTitle = `${quest.charAt(0).toUpperCase() + quest.slice(1)} Quest`;
      if (qd.title !== wantTitle)
        errors.push(`legacy: ${quest} quest title is ${JSON.stringify(qd.title)}, want ${JSON.stringify(wantTitle)}`);
      for (const m of [drops.primary, drops.secondary]) {
        const icon = qd.icons[m];
        if (!icon || icon === "no-img" || !(icon.src || "").includes(`icons/materials/${m}_fg.webp`)) {
          errors.push(`legacy: ${quest}Quest_${m}_icon is ${JSON.stringify(icon)}, want the generic fg icon`);
        }
      }
    }
    const neighbours = await page.evaluate(() => ({
      calculateBtn: !!document.getElementById("calculateBtn"),
      questRows: document.querySelectorAll("#questGrid > *").length,
      modalPresent: !!document.getElementById("eventShopModal"),
    }));
    if (!neighbours.calculateBtn || !neighbours.questRows)
      errors.push("legacy: the tier/run calculator is broken next to the stub planner");
    if (!neighbours.modalPresent)
      errors.push("legacy: #eventShopModal markup is static and must ship regardless of data");
    if (pageErrors.length) for (const e of pageErrors) errors.push(`legacy pageerror: ${e}`);
    if (consoleErrors().length) errors.push(`legacy console errors: ${JSON.stringify(consoleErrors().slice(0, 3))}`);
    if (externalHosts.size) errors.push(`legacy: external origins ${JSON.stringify([...externalHosts])}`);
  } else {
    /* ================= 1. structure: Amendment A read-only planner card ================= */
    const t0 = Date.now();
    const st0 = await ensureEventTab();
    const renderMs = Date.now() - t0;
    const rowCount = st0.rows;

    const base = await readCard();
    if (rowCount !== ITEMS.length) {
      errors.push(`planner render: #eventPlannerList shows ${rowCount} .eshop-item rows, want ${ITEMS.length}`);
    }
    if (base.groups.length !== CURRENCIES.length) {
      errors.push(`planner render: ${base.groups.length} .eshop-group(s), want ${CURRENCIES.length}`);
    }
    if (base.chips.length !== CURRENCIES.length) {
      errors.push(`planner render: ${base.chips.length} summary chip(s), want ${CURRENCIES.length}`);
    }
    if (renderMs > 5000) errors.push(`planner render: ${ITEMS.length} rows took ${renderMs}ms, want under 5000ms`);

    const firstCard = await page.evaluate(() => {
      const card = document.querySelector("#panel-event > .card:first-child");
      return card ? card.id : null;
    });
    if (firstCard !== "eventPlannerCard") {
      errors.push(`planner markup: first card in #panel-event is ${JSON.stringify(firstCard)}, want eventPlannerCard`);
    }

    /* REMOVED-by-Amendment-A surfaces: the card is read-only, the modal is the mutation surface. */
    if (base.buyAllBtn)
      errors.push("Amendment A: #eventPlannerBuyAll still exists — Buy all moved to the modal (Select All)");
    if (base.clearBtn) errors.push("Amendment A: #eventPlannerClear still exists — Clear moved to the modal (Default)");
    if (base.cardSteppers)
      errors.push(
        `Amendment A: ${base.cardSteppers} .eshop-require-input on the CARD, want 0 — steppers live in the modal draft rows only`,
      );
    if (base.cardStepBtns) errors.push(`Amendment A: ${base.cardStepBtns} .eshop-step-btn on the CARD, want 0`);

    const wantGroups = CURRENCIES.map((c) => ({ currency: String(c.id), rows: itemsOfCurrency(String(c.id)).length }));
    for (const want of wantGroups) {
      const group = base.groups.find((g) => g.currency === want.currency);
      if (!group) {
        errors.push(`planner groups: no .eshop-group for currency ${want.currency}`);
        continue;
      }
      if (group.rows !== want.rows)
        errors.push(`planner groups: currency ${want.currency} has ${group.rows} rows, want ${want.rows}`);
      if (want.headerImg && !group.headerImg)
        errors.push(`planner groups: currency ${want.currency} header has no icon img`);
    }
    const groupOrder = base.groups.map((g) => g.currency).join();
    const wantOrder = CURRENCIES.map((c) => String(c.id)).join();
    if (groupOrder !== wantOrder) errors.push(`planner groups: order ${groupOrder}, want ${wantOrder}`);

    for (const currency of CURRENCIES) {
      const chip = chipMap(base).get(String(currency.id));
      if (!chip) {
        errors.push(`planner chips: no summary chip for ${currency.name} (${currency.id})`);
        continue;
      }
      if (chip.name !== currency.name)
        errors.push(`planner chips: chip name ${JSON.stringify(chip.name)}, want ${JSON.stringify(currency.name)}`);
      if (chip.tier !== (currency.background || "silver"))
        errors.push(`planner chips: ${currency.name} data-tier ${chip.tier}, want ${currency.background || "silver"}`);
      if (!chip.hasImg) errors.push(`planner chips: ${currency.name} chip has no icon <img>`);
    }

    assertPlan(base, {}, "planner initial state");
    /* Row surface = a dialog opener: role/tabindex/haspopup/live label, display mirrors state. */
    const rowsById = rowMap(base);
    const ariaBad = [];
    for (const item of ITEMS) {
      const row = rowsById.get(String(item.id));
      if (!row) continue;
      const currency = currencyOf(item);
      const wantMeta =
        `${currency.name} \u00d7${fmtRef(item.cost.amount)} \u00b7 ` +
        (item.limitNum > 0 ? `Limit ${fmtRef(item.limitNum)}` : "Unlimited") +
        (item.setNum > 1 ? ` \u00b7 \u00d7${fmtRef(item.setNum)} per buy` : "");
      if (row.meta !== wantMeta)
        ariaBad.push(`${item.id} meta ${JSON.stringify(row.meta)} want ${JSON.stringify(wantMeta)}`);
      if (row.role !== "button") ariaBad.push(`${item.id} role=${JSON.stringify(row.role)}, want button`);
      if (row.tabindex !== "0") ariaBad.push(`${item.id} tabindex=${JSON.stringify(row.tabindex)}, want 0`);
      if (row.haspopup !== "dialog")
        ariaBad.push(`${item.id} aria-haspopup=${JSON.stringify(row.haspopup)}, want dialog`);
      if (row.displayItemId !== String(item.id))
        ariaBad.push(`${item.id} display carries data-item-id ${JSON.stringify(row.displayItemId)}`);
      const wantLabel = `${item.name}: require 0, edit`;
      if (row.ariaLabel !== wantLabel)
        ariaBad.push(`${item.id} aria-label ${JSON.stringify(row.ariaLabel)} want ${JSON.stringify(wantLabel)}`);
      if (!row.editable) ariaBad.push(`${item.id} lost the eshop-item--editable marker`);
      if (!row.hasImg && !row.hasFallback) ariaBad.push(`${item.id} row has neither an icon nor a fallback`);
    }
    if (ariaBad.length)
      errors.push(`planner rows: ${ariaBad.length} row(s) fail meta/label/role — ${ariaBad.slice(0, 3).join(" | ")}`);

    if (!base.eventName) errors.push("planner header: #eventPlannerEventName is empty");
    const wantName = (DATA.event.shortName || DATA.event.name || "Event Shop").replace(/\n/g, " ").trim();
    if (base.eventName !== wantName)
      errors.push(`planner header: name reads ${JSON.stringify(base.eventName)}, want ${JSON.stringify(wantName)}`);
    const tokyo = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "Asia/Tokyo" });
    const wantWindow = `${tokyo.format(new Date(DATA.event.startedAt * 1000))} \u2013 ${tokyo.format(new Date(DATA.event.endedAt * 1000))}`;
    if (base.eventWindow !== wantWindow)
      errors.push(
        `planner header: window reads ${JSON.stringify(base.eventWindow)}, want ${JSON.stringify(wantWindow)}`,
      );
    if (base.summaryHidden || base.controlsHidden) {
      errors.push(
        `planner render: summary hidden=${base.summaryHidden} controls hidden=${base.controlsHidden} with ${ITEMS.length} items present`,
      );
    }
    const role = await page.evaluate(() => document.getElementById("eventPlannerSummary").getAttribute("role"));
    if (role !== "status") errors.push(`planner a11y: #eventPlannerSummary role=${JSON.stringify(role)}, want status`);
    console.log(
      `NOTE: planner rendered ${rowCount}/${ITEMS.length} read-only rows, ${base.groups.length} group(s), ${base.chips.length} chip(s) in ${renderMs}ms; window "${base.eventWindow}"`,
    );

    /* ================= 2. event-native tier cards + quest drops ================= */
    const tierBase = await readTier();
    for (const currency of CURRENCIES) {
      const tier = tierOfCurrency(currency);
      const t = tierBase.tiers[tier];
      if (!t) {
        errors.push(`tier card: no [data-tier="${tier}"] under #materialsGrid`);
        continue;
      }
      if (t.name !== BUY_ALL_NAMES[currency.id])
        errors.push(
          `tier card: ${tier} material-name is ${JSON.stringify(t.name)}, want ${JSON.stringify(BUY_ALL_NAMES[currency.id])}`,
        );
      if (t.needReadOnly !== true) errors.push(`tier card: ${tier} Required is not read-only`);
      if (!t.needDisplayClass) errors.push(`tier card: ${tier} Required lacks the eshop-require-display class`);
      if (t.needHaspopup !== "dialog")
        errors.push(`tier card: ${tier} Required aria-haspopup=${JSON.stringify(t.needHaspopup)}, want dialog`);
      if (t.needValue !== "0")
        errors.push(`tier card: ${tier} Required reads ${JSON.stringify(t.needValue)} on an empty plan, want "0"`);
      const fg = t.imgs.filter((i) => i.cls.includes("fg-layer"));
      const bg = t.imgs.filter((i) => i.cls.includes("bg-layer"));
      if (fg.length !== 1 || bg.length !== 0)
        errors.push(
          `tier card: ${tier} icon box has ${fg.length} fg + ${bg.length} bg img(s), want a single event fg-layer`,
        );
      const src = fg[0] ? fg[0].src : "";
      const wantSrc = `event_shop/${currency.icon.split("/").pop()}?v=`;
      if (!src || !src.includes(wantSrc))
        errors.push(`tier card: ${tier} icon src ${JSON.stringify(src)}, want ${JSON.stringify(wantSrc)}…`);
      if (t.heldReadOnly !== false || t.bonusReadOnly !== false)
        errors.push(
          `tier card: ${tier} Held/Bonus must stay editable (held readOnly=${t.heldReadOnly}, bonus readOnly=${t.bonusReadOnly})`,
        );
    }
    for (const [quest, drops] of Object.entries(QUEST_DROPS)) {
      const qd = tierBase.quests[quest];
      const cur = CURRENCIES.find((c) => c.background === quest);
      const wantTitle = `${cur.name} Quest`;
      if (qd.title !== wantTitle)
        errors.push(`quest drops: ${quest} title is ${JSON.stringify(qd.title)}, want ${JSON.stringify(wantTitle)}`);
      for (const m of [drops.primary, drops.secondary]) {
        const icon = qd.icons[m];
        const wantCur = CURRENCIES.find((c) => c.background === m);
        const wantFile = `event_shop/${wantCur.icon.split("/").pop()}`;
        if (!icon || icon === "no-img" || !(icon.src || "").includes(wantFile)) {
          errors.push(`quest drops: ${quest}Quest_${m}_icon is ${JSON.stringify(icon)}, want ${wantFile}`);
        }
      }
    }
    console.log(
      `NOTE: tier cards hydrated — ${TIERS.map((t) => `${t}="${tierBase.tiers[t].name}"`).join(", ")}; quest titles ${TIERS.map((t) => JSON.stringify(tierBase.quests[t].title)).join(", ")}`,
    );

    /* ================= 3. icons actually decode, and only from this origin ================= */
    await page.evaluate(() => {
      for (const t of ["bronze", "silver", "gold"]) {
        const card = document.querySelector(`#materialsGrid [data-tier="${t}"]`);
        if (card) card.scrollIntoView({ block: "center" });
      }
    });
    await wait(400);
    const tierDecoded = await page.evaluate(() => {
      const out = [];
      for (const t of ["bronze", "silver", "gold"]) {
        const imgs = [
          ...document.querySelectorAll(`#materialsGrid [data-tier="${t}"] img, #questDropsGrid [data-tier="${t}"] img`),
        ];
        for (const img of imgs) out.push({ t, src: img.getAttribute("src"), w: img.naturalWidth });
      }
      return out;
    });
    const deadTier = tierDecoded.filter((i) => !(i.w > 0));
    if (deadTier.length)
      errors.push(
        `tier icons: ${deadTier.length}/${tierDecoded.length} event image(s) never decoded — ${JSON.stringify(deadTier.slice(0, 3))}`,
      );

    await page.evaluate(() => window.scrollTo(0, 0));
    const iconSelectors = [
      ...CURRENCIES.map((c) => `#eventPlannerSummary .eshop-summary-chip[data-currency="${c.id}"] img`),
      ...CURRENCIES.map((c) => `#eventPlannerList .eshop-group[data-currency="${c.id}"] img`),
    ];
    if (costumeRow) iconSelectors.push(`${sel.cardRow(costumeRow.id)} img.eshop-item-icon`);
    if (equipRow) iconSelectors.push(`${sel.cardRow(equipRow.id)} img.eshop-item-icon`);
    if (multiSetRow) iconSelectors.push(`${sel.cardRow(multiSetRow.id)} img.eshop-item-icon`);
    for (let i = 0; i < ITEMS.length; i += 6) iconSelectors.push(`${sel.cardRow(ITEMS[i].id)} img.eshop-item-icon`);

    const iconResults = await page.evaluate(async (sels) => {
      const card = document.getElementById("eventPlannerCard");
      const out = [];
      for (const s of sels) {
        const img = card.querySelector(s);
        if (!img) {
          out.push({ s, ok: false, detail: "no <img> — icon replaced by a fallback" });
          continue;
        }
        img.scrollIntoView({ block: "center" });
        let ok = img.complete && img.naturalWidth > 0;
        for (let i = 0; i < 60 && !ok; i++) {
          await new Promise((r) => setTimeout(r, 100));
          ok = img.complete && img.naturalWidth > 0;
        }
        out.push({ s, ok, w: img.naturalWidth, h: img.naturalHeight, src: img.getAttribute("src") });
      }
      return out;
    }, iconSelectors);
    const deadIcons = iconResults.filter((i) => !i.ok);
    if (deadIcons.length) {
      errors.push(
        `planner icons: ${deadIcons.length}/${iconResults.length} sampled icon(s) never decoded — ${JSON.stringify(deadIcons.slice(0, 3))}`,
      );
    }
    if (base.fallbacks > 0)
      errors.push(
        `planner icons: ${base.fallbacks} fallback badge(s) on screen, want 0 — some shop icons 404 or failed`,
      );
    const badResponses = shopResponses.filter((r) => r.status >= 400);
    if (badResponses.length)
      errors.push(
        `planner icons: ${badResponses.length} /event_shop/ response(s) >= 400 — ${JSON.stringify(badResponses.slice(0, 3))}`,
      );
    const versioned = shopResponses.every((r) => /[?&]v=\d+/.test(r.url));
    if (shopResponses.length && !versioned)
      errors.push(`planner icons: ${shopResponses.length} request(s) fetched, some without the ?v= cache buster`);
    console.log(
      `NOTE: icons sampled ${iconResults.length}, ${shopResponses.length} /event_shop/ response(s) seen, all 2xx=${badResponses.length === 0}, external origins ${JSON.stringify([...externalHosts])}`,
    );
    if (externalHosts.size)
      errors.push(
        `planner security: runtime fetched ${JSON.stringify([...externalHosts])} — the site must ship zero external resources`,
      );

    /* Sweep the page so every lazy icon decodes before any click is aimed, and the sampled check
       becomes a check of every icon in the card. */
    const iconSweep = await page.evaluate(async () => {
      const step = 400;
      for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 40));
      }
      let pending = -1;
      let rounds = 0;
      for (; rounds < 60; rounds++) {
        const imgs = [...document.querySelectorAll("#eventPlannerCard img")];
        pending = imgs.filter((im) => !(im.complete && im.naturalWidth > 0)).length;
        if (pending === 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 100));
      const imgs = [...document.querySelectorAll("#eventPlannerCard img")];
      return {
        total: imgs.length,
        pending: imgs.filter((im) => !(im.complete && im.naturalWidth > 0)).length,
        rounds,
        height: document.documentElement.scrollHeight,
      };
    });
    if (iconSweep.pending > 0)
      errors.push(
        `planner icons: ${iconSweep.pending}/${iconSweep.total} image(s) in the card never decoded after a full page sweep`,
      );
    console.log(
      `NOTE: icon sweep — ${iconSweep.total - iconSweep.pending}/${iconSweep.total} card image(s) decoded after ${iconSweep.rounds} round(s), document ${iconSweep.height}px tall`,
    );

    /* ================= 4. modal opens from a planner row; Escape discards ================= */
    const misoCurrency = CURRENCIES.find((c) => String(c.id) === String(freeRow.cost.itemId));
    if (misoCurrency.background !== "bronze")
      errors.push(`data sanity: MISO row currency maps to ${misoCurrency.background}, want bronze`);
    await openRowModal(freeRow.id, "open modal from planner row click");
    let modal = await readModal();
    const wantMisoRows = itemsOfCurrency(String(freeRow.cost.itemId));
    if (modal.title !== `${misoCurrency.name} \u2014 Shop Items`)
      errors.push(`modal title: reads ${JSON.stringify(modal.title)}, want "${misoCurrency.name} \u2014 Shop Items"`);
    if (modal.rows.length !== wantMisoRows.length)
      errors.push(`modal rows: ${modal.rows.length} draft rows for ${misoCurrency.name}, want ${wantMisoRows.length}`);
    if (modal.displaySpans)
      errors.push(
        `modal: ${modal.displaySpans} read-only display span(s) inside the draft list, want 0 — draft rows must carry steppers`,
      );
    const draftBad = [];
    for (const row of modal.rows) {
      const item = byId.get(row.id);
      if (!item) {
        draftBad.push(`${row.id}: not in the snapshot`);
        continue;
      }
      if (String(item.cost.itemId) !== String(freeRow.cost.itemId))
        draftBad.push(`${row.id}: belongs to another currency, leaked into the draft`);
      if (row.value !== "0")
        draftBad.push(`${row.id}: draft opens at ${JSON.stringify(row.value)}, want storage value "0"`);
      if (row.max !== String(maxRequire(item)))
        draftBad.push(`${row.id}: input max ${row.max}, want ${maxRequire(item)}`);
      if (row.ariaLabel !== `${item.name} require`)
        draftBad.push(`${row.id}: input aria ${JSON.stringify(row.ariaLabel)}`);
      if (row.minusLabel !== `Decrease ${item.name}` || row.plusLabel !== `Increase ${item.name}`)
        draftBad.push(`${row.id}: step labels ${JSON.stringify([row.minusLabel, row.plusLabel])}`);
    }
    if (draftBad.length)
      errors.push(`modal draft: ${draftBad.length} row(s) wrong — ${draftBad.slice(0, 3).join(" | ")}`);
    await closeBy("Escape", "Escape closes the modal");
    const afterEscape = await readCard();
    assertPlan(afterEscape, {}, "Escape-discard");

    /* ================= 5. modal opens from a tier Required; ✕ discards ================= */
    await openTierModal("gold", "open modal from gold Required click");
    modal = await readModal();
    const goldCurrency = CURRENCIES.find((c) => c.background === "gold");
    if (modal.title !== `${goldCurrency.name} \u2014 Shop Items`)
      errors.push(
        `modal via tier: title ${JSON.stringify(modal.title)}, want "${goldCurrency.name} \u2014 Shop Items"`,
      );
    if (modal.rows.length !== itemsOfCurrency(String(goldCurrency.id)).length)
      errors.push(`modal via tier: ${modal.rows.length} rows, want ${itemsOfCurrency(String(goldCurrency.id)).length}`);
    await closeBy("X", "\u2715 closes the modal");

    /* ================= 6. keyboard: Tab reaches a row, Enter opens, Escape closes = */
    await page.evaluate(() => {
      const chips = document.querySelectorAll("#eventPlannerControls .eshop-filter-chip");
      chips[chips.length - 1].focus();
    });
    await page.keyboard.press("Tab");
    const tabbed = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        cls: el.className,
        id: el.getAttribute ? el.getAttribute("data-item-id") : null,
        isRow: el.classList.contains("eshop-item"),
      };
    });
    if (!tabbed.isRow) {
      errors.push(
        `keyboard: Tab from the last filter chip landed on ${JSON.stringify(tabbed.cls || tabbed.id)}, want the first planner row (tabindex=0 button)`,
      );
    } else {
      await page.keyboard.press("Enter");
      await modalGate(true, "Enter opens the modal from a focused row");
      const kbdCurrency = byId.get(tabbed.id) ? currencyOf(byId.get(tabbed.id)) : null;
      modal = await readModal();
      if (kbdCurrency && !modal.title.startsWith(kbdCurrency.name))
        errors.push(
          `keyboard: Enter on row ${tabbed.id} opened ${JSON.stringify(modal.title)}, want ${kbdCurrency.name}`,
        );
      await closeBy("Escape", "Escape after Enter-open");
    }

    /* ================= 7. clamp moved INTO the modal draft rows ================= */
    const yakiCurrency = CURRENCIES.find((c) => c.background === "gold");
    const clampCurItems = itemsOfCurrency(String(clampRow.cost.itemId));
    await openRowModal(clampRow.id, "open modal for clamp scene");
    /* + twice on a limit-1 row stops at the limit */
    await safeClick(sel.modalPlus(clampRow.id));
    await safeClick(sel.modalPlus(clampRow.id));
    await wait(SETTLE_MS);
    modal = await readModal();
    let dr = modal.rows.find((r) => r.id === String(clampRow.id));
    const clampMax = maxRequire(clampRow);
    if (!dr || dr.value !== String(clampMax))
      errors.push(
        `draft clamp: + twice on limit-${clampRow.limitNum} row ${clampRow.id} reads ${JSON.stringify(dr && dr.value)}, want "${clampMax}"`,
      );
    if (dr && num(dr.total) !== clampRow.cost.amount * clampMax)
      errors.push(`draft clamp: row total ${dr && dr.total}, want ${clampRow.cost.amount * clampMax}`);
    /* typing 999 on the same row: box keeps the keystrokes (no rewrite = no caret loss), subtotal clamps */
    await typeInto(sel.modalInput(clampRow.id), "999");
    await wait(SETTLE_MS);
    modal = await readModal();
    dr = modal.rows.find((r) => r.id === String(clampRow.id));
    const stillFocused = await page.evaluate(
      (s) => document.activeElement === document.querySelector(s),
      sel.modalInput(clampRow.id),
    );
    if (dr && dr.value !== "999")
      errors.push(
        `draft typing: focused input rewritten to ${JSON.stringify(dr && dr.value)} mid-typing, want the typed "999" kept`,
      );
    if (dr && num(dr.total) !== clampRow.cost.amount)
      errors.push(
        `draft typing: 999 on a limit-${clampRow.limitNum} row subtotals ${dr && dr.total}, want ${clampRow.cost.amount}`,
      );
    if (!stillFocused) errors.push("draft typing: the focused input lost focus while its subtotal refreshed");
    /* stepping the same row writes the clamped draft back into the box */
    await safeClick(sel.modalPlus(clampRow.id));
    await wait(SETTLE_MS);
    modal = await readModal();
    dr = modal.rows.find((r) => r.id === String(clampRow.id));
    if (dr && dr.value !== String(clampMax))
      errors.push(
        `draft stepper sync: + after typing 999 left ${JSON.stringify(dr && dr.value)}, want the committed "${clampMax}"`,
      );
    /* ArrowUp from 0 is an input event, not a rewrite: unlimited row accepts it */
    await safeClick(sel.modalMinus(clampRow.id)); // back to a known low value path (clamped at 0)
    await wait(SETTLE_MS);
    /* Default zeroes the whole draft (write-back through the sync path) */
    await safeClick("#eventShopModalDefaultBtn");
    await wait(SETTLE_MS);
    modal = await readModal();
    const notZero = modal.rows.filter((r) => r.value !== "0" || num(r.total) !== 0);
    if (notZero.length)
      errors.push(`modal Default: ${notZero.length} row(s) survived the zero — ${JSON.stringify(notZero.slice(0, 2))}`);
    /* unlimited rows accept 5000 and cap the subtotal at the schema max (gold draft row) */
    await typeInto(sel.modalInput(draftFree.id), "5000");
    await wait(SETTLE_MS);
    modal = await readModal();
    dr = modal.rows.find((r) => r.id === String(draftFree.id));
    if (dr && dr.value !== "5000") errors.push(`draft unlimited: typed 5000 reads ${JSON.stringify(dr && dr.value)}`);
    if (dr && num(dr.total) !== 5000 * draftFree.cost.amount)
      errors.push(`draft unlimited: 5000 subtotals ${dr && dr.total}, want ${5000 * draftFree.cost.amount}`);
    await typeInto(sel.modalInput(draftFree.id), "10000000");
    await wait(SETTLE_MS);
    modal = await readModal();
    dr = modal.rows.find((r) => r.id === String(draftFree.id));
    if (dr && num(dr.total) !== SHOP_MAX * draftFree.cost.amount)
      errors.push(
        `draft unlimited: typed 10000000 subtotals ${dr && dr.total}, want the schema cap ${SHOP_MAX * draftFree.cost.amount}`,
      );
    if (dr && dr.value !== "10000000")
      errors.push(
        `draft unlimited: focused input rewritten mid-typing to ${JSON.stringify(dr && dr.value)}, want "10000000" kept`,
      );
    /* a negative can never buy in the negative */
    await typeInto(sel.modalInput(draftFree.id), "-5");
    await wait(SETTLE_MS);
    modal = await readModal();
    dr = modal.rows.find((r) => r.id === String(draftFree.id));
    if (dr && num(dr.total) !== 0) errors.push(`draft negative: "-5" subtotals ${dr && dr.total}, want 0`);
    /* rapid synchronous + clicks: no lost or double-counted step */
    await page.evaluate((id) => {
      const btn = document.querySelector(
        `#eventShopModalList .eshop-item[data-item-id="${id}"] .eshop-step-btn[data-step="1"]`,
      );
      for (let i = 0; i < 8; i++) btn.click();
    }, String(draftFree.id));
    await wait(SETTLE_MS);
    modal = await readModal();
    dr = modal.rows.find((r) => r.id === String(draftFree.id));
    const wantRace = Math.min(8, maxRequire(draftFree));
    if (dr && dr.value !== String(wantRace))
      errors.push(`draft race: 8 synchronous + clicks left ${JSON.stringify(dr && dr.value)}, want "${wantRace}"`);
    /* Cancel discards: storage untouched, displays unchanged, reopen re-clones from state */
    await closeBy("Cancel", "Cancel discards the draft");
    let card = await readCard();
    assertPlan(card, {}, "Cancel-discard leaves the plan");
    if (card.storage !== null)
      errors.push(
        `Cancel-discard: localStorage was written by draft editing (${JSON.stringify(card.storage)}) — nothing publishes before Done`,
      );
    await openRowModal(clampRow.id, "reopen after Cancel");
    modal = await readModal();
    const leaked = modal.rows.filter((r) => r.value !== "0");
    if (leaked.length)
      errors.push(
        `draft isolation: after Cancel+reopen, ${leaked.length} row(s) kept draft edits ${JSON.stringify(leaked.slice(0, 2).map((r) => [r.id, r.value]))}, want all "0"`,
      );
    await closeBy("Cancel", "close reopen check");

    /* ================= 8. write discipline: drafts never touch storage, Done writes once = */
    await installWriteSpy();
    await openRowModal(freeRow.id, "open modal for write-count scene");
    await typeInto(sel.modalInput(freeRow.id), "12345");
    const localStep = itemsOfCurrency(String(freeRow.cost.itemId)).find((i) => maxRequire(i) >= 2);
    await safeClick(sel.modalPlus(localStep.id));
    await safeClick(sel.modalPlus(localStep.id));
    await wait(SETTLE_MS);
    const draftWrites = await writeCount();
    if (draftWrites !== 0)
      errors.push(
        `write discipline: draft typing/stepping wrote localStorage ${draftWrites} time(s) before Done, want 0`,
      );
    await clickDone();
    const doneWrites = await writeCount();
    if (doneWrites !== 1)
      errors.push(`write discipline: Done wrote localStorage ${doneWrites} time(s), want exactly 1 whole-plan commit`);
    await uninstallWriteSpy();
    card = await readCard();
    const plan8 = { [String(freeRow.id)]: 12345, [String(localStep.id)]: Math.min(2, maxRequire(localStep)) };
    assertPlan(card, plan8, "Done commits typed + stepped values");
    const stored8 = card.storage ? JSON.parse(card.storage) : null;
    if (!stored8 || stored8.eventId !== EVENT_ID)
      errors.push(
        `Done commit: stored blob ${JSON.stringify(stored8 && stored8.eventId)} lacks the current eventId ${EVENT_ID}`,
      );

    /* draft isolation ACROSS currencies: another currency's rows are not in this draft */
    await openTierModal("silver", "open SHIMONITA modal for isolation");
    modal = await readModal();
    const silverItems = itemsOfCurrency(String(CURRENCIES.find((c) => c.background === "silver").id));
    const foreign = modal.rows.filter((r) => !silverItems.some((i) => String(i.id) === r.id));
    if (foreign.length)
      errors.push(
        `draft isolation: the silver draft contains ${foreign.length} foreign row(s) ${JSON.stringify(foreign.slice(0, 2).map((r) => r.id))}`,
      );
    await typeInto(sel.modalInput(String(silverItems.find((i) => i.limitNum === 0 || i.limitNum > 3).id)), "9");
    await closeBy("Cancel", "cancel silver edit");
    card = await readCard();
    assertPlan(card, plan8, "silver Cancel leaves the committed plan");
    await openTierModal("silver", "reopen silver after Cancel");
    modal = await readModal();
    const kept9 = modal.rows.filter((r) => r.value === "9");
    if (kept9.length)
      errors.push(
        `draft isolation: Cancelled silver edit survived the reopen (${JSON.stringify(kept9.map((r) => r.id))})`,
      );
    await closeBy("Cancel", "close silver");

    /* ================= 9. Done agreement: storage + displays + tier all match = */
    await resetPlan();
    await openTierModal("bronze", "bronze scene via tier Required");
    await typeInto(sel.modalInput(freeRow.id), "3");
    await clickDone();
    card = await readCard();
    const tier9 = await readTier();
    const plan9 = { [String(freeRow.id)]: 3 };
    assertPlan(card, plan9, "Done agreement — planner displays");
    assertTierNeeds(tier9, plan9, "Done agreement — tier Required");
    const stored9 = card.storage ? JSON.parse(card.storage) : {};
    if ((stored9.requires || {})[String(freeRow.id)] !== 3)
      errors.push(
        `Done agreement: storage row ${freeRow.id} is ${JSON.stringify((stored9.requires || {})[String(freeRow.id)])}, want 3`,
      );
    const legacy9 = card.legacyStorage ? JSON.parse(card.legacyStorage) : null;
    if (!legacy9 || legacy9.bronzeNeed !== 30)
      errors.push(
        `Done agreement: legacy fgo_calculator_data bronzeNeed is ${legacy9 && legacy9.bronzeNeed}, want the plan total 30`,
      );
    /* a second currency commit must not disturb the first (applyRequires is a merge) */
    const goldFree = unlimitedRows.find((i) => String(i.cost.itemId) === String(yakiCurrency.id));
    await openRowModal(String(clampRow.id), "open gold for merge check");
    await typeInto(sel.modalInput(String(goldFree.id)), "250");
    await clickDone();
    card = await readCard();
    const plan9b = { [String(freeRow.id)]: 3, [String(goldFree.id)]: 250 };
    assertPlan(card, plan9b, "merge commit keeps the earlier currency");
    /* the aria label on the edited row now reads the live number */
    const labelRow = rowMap(card).get(String(freeRow.id));
    if (labelRow && labelRow.ariaLabel !== `${freeRow.name}: require 3, edit`)
      errors.push(
        `live aria: row ${freeRow.id} label ${JSON.stringify(labelRow && labelRow.ariaLabel)}, want "require 3, edit"`,
      );

    /* ================= 10. Select All = buy-all semantics; whole-plan truth ================= */
    await resetPlan();
    for (const currency of CURRENCIES) {
      const tier = tierOfCurrency(currency);
      await openTierModal(tier, `open ${tier} for Select All`);
      await safeClick(sel.footer("SelectAll"));
      await wait(SETTLE_MS);
      modal = await readModal();
      const wantClear = refClear(itemsOfCurrency(String(currency.id)));
      const wrong = modal.rows.filter((r) => r.value !== String(wantClear[r.id] ?? 0));
      if (wrong.length)
        errors.push(
          `Select All (${currency.name}): ${wrong.length} draft row(s) off the buy-out plan — ${JSON.stringify(wrong.slice(0, 3).map((r) => [r.id, r.value, wantClear[r.id]]))}`,
        );
      const unlimitedWrong = modal.rows.filter((r) => {
        const item = byId.get(r.id);
        return item && item.limitNum === 0 && r.value !== "0";
      });
      if (unlimitedWrong.length)
        errors.push(
          `Select All (${currency.name}): ${unlimitedWrong.length} unlimited row(s) filled — buy-out must leave them at 0`,
        );
      await clickDone();
    }
    card = await readCard();
    const buyAll = refClear(ITEMS);
    const buyTotals = assertPlan(card, buyAll, "Select All ×3 (buy all)");
    const tierBuy = await readTier();
    assertTierNeeds(tierBuy, buyAll, "buy-all tier agreement");
    const wantTruth = refTotals(buyAll);
    for (const currency of CURRENCIES) {
      const id = String(currency.id);
      if (wantTruth[id] !== BUY_ALL_TRUTH[id]) {
        errors.push(
          `data truth: reference buy-all for ${currency.name} (${id}) is ${wantTruth[id]}, the pinned plan truth says ${BUY_ALL_TRUTH[id]} — the snapshot drifted, re-verify before pinning`,
        );
      }
      if (currency.name !== BUY_ALL_NAMES[id])
        errors.push(
          `data truth: currency ${id} is named ${JSON.stringify(currency.name)}, want ${JSON.stringify(BUY_ALL_NAMES[id])}`,
        );
      const chip = chipMap(card).get(id);
      if (chip && chip.total !== `\u00d7${fmtRef(BUY_ALL_TRUTH[id])}`)
        errors.push(
          `buy-all chip ${currency.name}: reads ${JSON.stringify(chip.total)}, want ×${fmtRef(BUY_ALL_TRUTH[id])}`,
        );
    }
    console.log(
      `NOTE: buy-all via Select All → ${CURRENCIES.map((c) => `${c.name} ${wantTruth[String(c.id)]}`).join(", ")} (pinned truth ${JSON.stringify(BUY_ALL_TRUTH)})`,
    );

    /* Default on one currency must empty it and leave the others (partial commit) */
    await openTierModal("bronze", "open bronze for Default+Done");
    await safeClick("#eventShopModalDefaultBtn");
    await wait(SETTLE_MS);
    await clickDone();
    card = await readCard();
    const partial = { ...buyAll };
    for (const item of itemsOfCurrency(String(CURRENCIES.find((c) => c.background === "bronze").id)))
      partial[String(item.id)] = 0;
    assertPlan(card, partial, "Default+Done empties only its currency");
    const tierP = await readTier();
    assertTierNeeds(tierP, partial, "Default+Done tier agreement");

    /* ================= 11. filter chips ================= */
    const filtersNow = (await readCard()).filters;
    const wantFilterKeys = ["all", ...CURRENCIES.map((c) => String(c.id))].join();
    if (filtersNow.map((f) => f.key).join() !== wantFilterKeys)
      errors.push(`filter chips: chips are ${JSON.stringify(filtersNow.map((f) => f.key))}, want ${wantFilterKeys}`);
    for (const currency of CURRENCIES) {
      await safeClick(sel.chip(String(currency.id)));
      await wait(SETTLE_MS);
      const st = await readCard();
      if (st.groups.length !== 1) errors.push(`filter ${currency.id}: ${st.groups.length} group(s) visible, want 1`);
      else if (st.groups[0].currency !== String(currency.id))
        errors.push(`filter ${currency.id}: visible group is ${st.groups[0].currency}`);
      if (st.rows.length !== itemsOfCurrency(String(currency.id)).length)
        errors.push(
          `filter ${currency.id}: ${st.rows.length} rows, want ${itemsOfCurrency(String(currency.id)).length}`,
        );
      const pressed = st.filters.filter((f) => f.pressed === "true").map((f) => f.key);
      const active = st.filters.filter((f) => f.active).map((f) => f.key);
      if (pressed.join() !== String(currency.id))
        errors.push(`filter ${currency.id}: aria-pressed=true on ${JSON.stringify(pressed)}`);
      if (active.join() !== String(currency.id))
        errors.push(`filter ${currency.id}: --active class on ${JSON.stringify(active)}`);
      if (st.chips.length !== CURRENCIES.length)
        errors.push(`filter ${currency.id}: summary chips changed to ${st.chips.length}`);
      /* the committed plan survives the rebuild — displays are state, not DOM memory; the chips
         summarize the WHOLE plan regardless of which groups the filter shows */
      assertPlan(st, partial, `filter ${currency.id} keeps the plan`);
    }
    await safeClick(sel.chip("all"));
    await wait(SETTLE_MS);
    const backToAll = await readCard();
    if (backToAll.groups.length !== CURRENCIES.length || backToAll.rows.length !== ITEMS.length) {
      errors.push(
        `filter all: back to ${backToAll.groups.length} group(s) / ${backToAll.rows.length} rows, want ${CURRENCIES.length} / ${ITEMS.length}`,
      );
    }
    const rebuild = await page.evaluate((id) => {
      const chip = document.querySelector(`#eventPlannerControls .eshop-filter-chip[data-filter="${id}"]`);
      const t = performance.now();
      chip.click();
      return new Promise((r) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            r({ ms: performance.now() - t, rows: document.querySelectorAll("#eventPlannerList .eshop-item").length }),
          ),
        ),
      );
    }, String(CURRENCIES[1].id));
    if (rebuild.rows !== itemsOfCurrency(String(CURRENCIES[1].id)).length)
      errors.push(
        `filter rebuild: ${rebuild.rows} row(s) after rAF, want ${itemsOfCurrency(String(CURRENCIES[1].id)).length}`,
      );
    if (rebuild.ms > 1000)
      errors.push(`filter rebuild: ${rebuild.ms.toFixed(1)}ms for ${rebuild.rows} rows, want under 1000ms`);
    await safeClick(sel.chip("all"));
    await wait(SETTLE_MS);
    console.log(`NOTE: filter rebuild ${rebuild.ms.toFixed(1)}ms for ${rebuild.rows} rows`);

    /* ================= 12. persistence across reload + legacy-need recompute ================= */
    const persistPlan = { [String(freeRow.id)]: 250 };
    await resetPlan();
    await openRowModal(freeRow.id, "open for persistence scene");
    await typeInto(sel.modalInput(freeRow.id), "250");
    await clickDone();
    await page.reload({ waitUntil: "networkidle0" });
    await ensureEventTab();
    await wait(SETTLE_MS);
    let restored = await readCard();
    assertPlan(restored, persistPlan, "persistence after reload");
    const restoredStored = restored.storage ? JSON.parse(restored.storage) : null;
    if (!restoredStored || restoredStored.eventId !== EVENT_ID)
      errors.push(`persistence: stored blob after reload is ${restored.storage}`);
    /* tamper the legacy calculator need: the loaded plan must recompute it back on init */
    await page.evaluate(
      (lk, tier) => {
        const saved = JSON.parse(localStorage.getItem(lk));
        saved[`${tier}Need`] = 424242;
        localStorage.setItem(lk, JSON.stringify(saved));
      },
      STORAGE_KEY,
      "bronze",
    );
    await page.reload({ waitUntil: "networkidle0" });
    await ensureEventTab();
    await wait(SETTLE_MS);
    restored = await readCard();
    const tierR = await readTier();
    assertPlan(restored, { [String(freeRow.id)]: 250 }, "tampered legacy need — plan still drives the displays");
    assertTierNeeds(tierR, { [String(freeRow.id)]: 250 }, "tampered legacy need is recomputed from the plan on load");
    /* filters are not persisted */
    await safeClick(sel.chip(String(CURRENCIES[2].id)));
    await wait(SETTLE_MS);
    await page.reload({ waitUntil: "networkidle0" });
    await ensureEventTab();
    await wait(SETTLE_MS);
    const filteredReload = await readCard();
    if (filteredReload.groups.length !== CURRENCIES.length)
      errors.push(
        `persistence: filter survived reload (${filteredReload.groups.length} group(s)), plan says filters reset`,
      );

    /* ================= 13. event-id mismatch resets the plan ================= */
    const mismatchSeed = JSON.stringify({ eventId: EVENT_ID + 7, requires: { [String(freeRow.id)]: 5 } });
    await seedAndReload(mismatchSeed);
    const mismatch = await readCard();
    assertPlan(mismatch, {}, "event-id mismatch reset");
    if (mismatch.storage !== mismatchSeed)
      errors.push(
        `event-id mismatch: the app rewrote storage on load (${JSON.stringify(mismatch.storage)}) — it must leave the dead blob alone until a mutation`,
      );
    const tierM = await readTier();
    assertTierNeeds(tierM, {}, "event-id mismatch zeroes the tier needs");
    await openRowModal(freeRow.id, "open after mismatch");
    await clickDone();
    const afterMismatch = await readCard();
    const storedMismatch = afterMismatch.storage ? JSON.parse(afterMismatch.storage) : null;
    if (!storedMismatch || storedMismatch.eventId !== EVENT_ID)
      errors.push(
        `event-id mismatch: first mutation stored eventId ${storedMismatch && storedMismatch.eventId}, want the current ${EVENT_ID}`,
      );

    /* ================= 14. hostile localStorage blobs still sanitise ================= */
    const junkIds = ITEMS.slice(0, 6).map((i) => String(i.id));
    const garbage = [
      ["corrupt text", "{{{ not json"],
      ["null", "null"],
      ["bare string", '"a shop plan"'],
      ["array", "[1,2,3]"],
      ["no eventId", JSON.stringify({ requires: { [junkIds[0]]: 9 } })],
      ["requires string", JSON.stringify({ eventId: EVENT_ID, requires: "99" })],
      ["requires array", JSON.stringify({ eventId: EVENT_ID, requires: [7, 8, 9] })],
      [
        "prototype pollution + garbage values",
        `{"eventId":${EVENT_ID},"requires":{"__proto__":999,"constructor":{"prototype":{"polluted":true}},` +
          `"${junkIds[0]}":-0,"${junkIds[1]}":"1e3","${junkIds[2]}":1e999,` +
          `"${junkIds[3]}":[5],"${junkIds[4]}":true,"${junkIds[5]}":null,"70000000":99999,"${junkIds[0]}_x":1}}`,
      ],
    ];
    for (const [label, raw] of garbage) {
      await seedAndReload(raw);
      const st = await readCard();
      if (st.polluted) errors.push(`garbage storage (${label}): Object.prototype was polluted`);
      const expect = {};
      try {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed === "object" &&
          parsed.eventId === EVENT_ID &&
          parsed.requires &&
          typeof parsed.requires === "object" &&
          !Array.isArray(parsed.requires)
        ) {
          for (const [id, value] of Object.entries(parsed.requires)) {
            const item = byId.get(id);
            if (item) expect[id] = refClamp(item, value);
          }
        }
      } catch {
        expect["__unparseable__"] = null;
      }
      if (expect.__unparseable__) assertPlan(st, {}, `garbage storage (${label})`);
      else assertPlan(st, expect, `garbage storage (${label})`);
      const weird = st.rows.filter((r) => !/^(\d{1,3}(,\d{3})*|\d)$/.test(r.display || ""));
      if (weird.length)
        errors.push(
          `garbage storage (${label}): ${weird.length} display(s) hold non-canonical text ${JSON.stringify(weird.slice(0, 2).map((r) => r.display))}`,
        );
      /* still usable: the draft opens pre-filled from the sanitised plan, edits commit through Done */
      await openRowModal(clampRow.id, `open draft after garbage (${label})`);
      modal = await readModal();
      const draftRow = modal.rows.find((r) => r.id === String(clampRow.id));
      const wantDraft = expect[String(clampRow.id)] || 0;
      if (draftRow && draftRow.value !== String(wantDraft))
        errors.push(
          `garbage storage (${label}): draft opens at ${JSON.stringify(draftRow && draftRow.value)} for row ${clampRow.id}, want the sanitised ${wantDraft}`,
        );
      await safeClick(sel.modalPlus(clampRow.id));
      await wait(SETTLE_MS);
      await clickDone();
      const usable = await readCard();
      const usableExpect = { ...expect, [String(clampRow.id)]: Math.min(maxRequire(clampRow), wantDraft + 1) };
      assertPlan(usable, usableExpect, `garbage storage (${label}) then + & Done`);
      if (!usable.storage || usable.storage === raw)
        errors.push(
          `garbage storage (${label}): the commit did not rewrite storage ("${usable.storage && usable.storage.slice(0, 60)}")`,
        );
      const tierG = await readTier();
      assertTierNeeds(tierG, usableExpect, `garbage storage (${label}) tier agreement`);
    }

    /* ================= 15. localStorage quota failure must not crash the Done path ====== */
    await resetPlan();
    await installWriteSpy({ throw: true });
    await openRowModal(freeRow.id, "open modal for quota scene");
    await typeInto(sel.modalInput(freeRow.id), "1");
    const beforeQuotaErrors = pageErrors.length;
    await safeClick("#eventShopModalDoneBtn");
    await modalGate(false, "Done closes even when the save throws");
    await wait(SETTLE_MS);
    const quotaState = await readCard();
    assertPlan(quotaState, { [String(freeRow.id)]: 1 }, "quota failure keeps the plan live (state before persist)");
    const tierQ = await readTier();
    if (tierQ.tiers[tierOfCurrency(currencyOf(freeRow))].needValue !== String(freeRow.cost.amount))
      errors.push(
        `quota failure: tier Required did not follow the live plan (${tierQ.tiers[tierOfCurrency(currencyOf(freeRow))].needValue})`,
      );
    if (quotaState.storage)
      errors.push(`quota failure: storage holds "${quotaState.storage}", the write must have been refused`);
    if (pageErrors.length !== beforeQuotaErrors)
      errors.push(
        `quota failure: pageerror escaped the try/catch — ${JSON.stringify(pageErrors.slice(beforeQuotaErrors))}`,
      );
    const warned = consoleWarnings().some((w) => /Event shop planner save failed/.test(w));
    if (!warned)
      errors.push(
        `quota failure: the failed save was swallowed with no console warning (console: ${JSON.stringify(consoleMessages.slice(-4))})`,
      );
    await uninstallWriteSpy();
    await openRowModal(freeRow.id, "reopen after quota recovery");
    modal = await readModal();
    const recoveryRow = modal.rows.find((r) => r.id === String(freeRow.id));
    if (recoveryRow && recoveryRow.value !== "1")
      errors.push(
        `quota recovery: the draft lost the in-memory plan (reads ${JSON.stringify(recoveryRow && recoveryRow.value)}, want "1")`,
      );
    await safeClick(sel.modalPlus(freeRow.id));
    await clickDone();
    const afterQuota = await readCard();
    assertPlan(afterQuota, { [String(freeRow.id)]: 2 }, "saving works again once setItem is restored");

    /* ================= 16. backdrop mousedown = Cancel (discard) ================= */
    await resetPlan();
    await openRowModal(freeRow.id, "open for backdrop check");
    await typeInto(sel.modalInput(freeRow.id), "12");
    await closeBy("backdrop", "backdrop click discards the draft");
    const backdropState = await readCard();
    assertPlan(backdropState, {}, "backdrop-discard leaves the plan");
    if (backdropState.storage !== null)
      errors.push(
        `backdrop-discard: localStorage was written (${JSON.stringify(backdropState.storage)}) — backdrop is Cancel, not Done`,
      );

    /* ================= 17. viewports: no sideways overflow, modal fits, no page errors */
    for (const width of [360, 1120]) {
      await page.setViewport({ width, height: 800 });
      await safeClick(sel.chip("all"));
      await wait(SETTLE_MS);
      const layout = await page.evaluate(() => {
        const doc = document.documentElement;
        const card = document.getElementById("eventPlannerCard");
        const overflowing = [];
        for (const el of card.querySelectorAll(
          ".eshop-item, .eshop-summary-chip, .eshop-filter-chip, .eshop-group-header, .eshop-require-display, .eshop-item-total",
        )) {
          const r = el.getBoundingClientRect();
          if (r.right > window.innerWidth + 1 || r.left < -1)
            overflowing.push({ cls: el.className, left: Math.round(r.left), right: Math.round(r.right) });
        }
        const overlaps = [];
        for (const row of card.querySelectorAll(".eshop-item")) {
          const display = row.querySelector(".eshop-require-display");
          const total = row.querySelector(".eshop-item-total").getBoundingClientRect();
          if (display) {
            const d = display.getBoundingClientRect();
            if (total.left < d.right - 1)
              overlaps.push({
                id: row.getAttribute("data-item-id"),
                displayRight: Math.round(d.right),
                totalLeft: Math.round(total.left),
              });
          }
          const name = row.querySelector(".eshop-item-name");
          if (
            name.scrollHeight > name.clientHeight + 1 &&
            getComputedStyle(name).overflow !== "hidden" &&
            getComputedStyle(name).overflowWrap !== "anywhere"
          ) {
            overlaps.push({ id: row.getAttribute("data-item-id"), clippedName: true });
          }
        }
        return {
          docOverflow: doc.scrollWidth - doc.clientWidth,
          bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
          cardWidth: Math.round(card.getBoundingClientRect().width),
          innerWidth: window.innerWidth,
          overflowing: overflowing.slice(0, 4),
          overlaps: overlaps.slice(0, 4),
          rows: card.querySelectorAll(".eshop-item").length,
        };
      });
      if (layout.docOverflow > 0)
        errors.push(`viewport ${width}px: the page scrolls sideways by ${layout.docOverflow}px`);
      if (layout.bodyOverflow > 0) errors.push(`viewport ${width}px: body overflows by ${layout.bodyOverflow}px`);
      if (layout.cardWidth > layout.innerWidth)
        errors.push(`viewport ${width}px: card is ${layout.cardWidth}px wide inside a ${layout.innerWidth}px viewport`);
      if (layout.overflowing.length)
        errors.push(
          `viewport ${width}px: planner elements past the viewport edge — ${JSON.stringify(layout.overflowing)}`,
        );
      if (layout.overlaps.length)
        errors.push(`viewport ${width}px: require display/subtotal collide — ${JSON.stringify(layout.overlaps)}`);
      if (layout.rows !== ITEMS.length)
        errors.push(`viewport ${width}px: ${layout.rows} rows rendered, want ${ITEMS.length}`);

      /* modal at this viewport: inside the frame, list scrolls, footer reachable, wheel over the
         backdrop does not move the page (house scroll lock), backdrop gesture closes as a discard */
      await openTierModal("bronze", `open modal at ${width}px`);
      const modalLayout = await page.evaluate(() => {
        const modal = document.getElementById("eventShopModal");
        const content = modal.querySelector(".servant-modal-content");
        const list = document.getElementById("eventShopModalList");
        const done = document.getElementById("eventShopModalDoneBtn");
        const cr = content.getBoundingClientRect();
        const dr = done.getBoundingClientRect();
        return {
          innerW: window.innerWidth,
          innerH: window.innerHeight,
          content: { l: Math.round(cr.left), r: Math.round(cr.right), t: Math.round(cr.top), b: Math.round(cr.bottom) },
          doneVisible: dr.top >= 0 && dr.bottom <= window.innerHeight && dr.width > 0 && dr.height > 0,
          listScrollable: list.scrollHeight >= list.clientHeight,
          rows: list.querySelectorAll(".eshop-item").length,
          scrollY: window.scrollY,
        };
      });
      if (modalLayout.content.l < -1 || modalLayout.content.r > modalLayout.innerW + 1)
        errors.push(
          `viewport ${width}px modal: content ${modalLayout.content.l}..${modalLayout.content.r} outside 0..${modalLayout.innerW}`,
        );
      if (modalLayout.content.t < -1 || modalLayout.content.b > modalLayout.innerH + 1)
        errors.push(
          `viewport ${width}px modal: content ${modalLayout.content.t}..${modalLayout.content.b} outside 0..${modalLayout.innerH}`,
        );
      if (!modalLayout.doneVisible)
        errors.push(`viewport ${width}px modal: the Done button is not reachable on screen`);
      if (!modalLayout.listScrollable)
        errors.push(`viewport ${width}px modal: the draft list cannot scroll (${modalLayout.rows} rows)`);
      const wheelPt = await page.evaluate(() => {
        const header = document.querySelector("#eventShopModal .servant-modal-header");
        const r = header.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      await page.mouse.move(wheelPt.x, wheelPt.y);
      await page.evaluate(() => window.scrollTo(0, 300));
      const yBefore = await page.evaluate(() => window.scrollY);
      await page.mouse.wheel({ deltaY: 240 });
      await wait(120);
      const yAfter = await page.evaluate(() => window.scrollY);
      if (yBefore === yAfter && yBefore > 0) {
        /* page genuinely cannot scroll behind an open modal — good; equal-and-zero may just mean the page is short */
      }
      if (yBefore !== yAfter)
        errors.push(
          `viewport ${width}px modal: wheel over the backdrop scrolled the page behind it ${yBefore} → ${yAfter}`,
        );
      await closeBy("Cancel", `close modal at ${width}px`);
      console.log(
        `NOTE: viewport ${width}px — doc overflow ${layout.docOverflow}px, card ${layout.cardWidth}/${layout.innerWidth}px, ${layout.rows} rows; modal list rows ${modalLayout.rows}`,
      );
    }
    await page.setViewport({ width: 1120, height: 900 });

    /* ================= 18. the untouched tier/run calculator must still be alive ====== */
    const neighbours = await page.evaluate(() => ({
      calculateBtn: !!document.getElementById("calculateBtn"),
      questRows: document.querySelectorAll("#questGrid > *").length,
    }));
    if (!neighbours.calculateBtn)
      errors.push("regression: #calculateBtn (tier/run calculator) is gone from the Event tab");
    if (neighbours.questRows === 0)
      errors.push(
        `regression: #questGrid has ${neighbours.questRows} children — the calculator broke next to the planner`,
      );
    await page.focus("#silverBonus");
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Digit5");
    await wait(SETTLE_MS);
    const bonusValue = await page.evaluate(() => document.getElementById("silverBonus").value);
    if (bonusValue !== "5")
      errors.push(
        `regression: the tier Bonus input no longer accepts typing (reads ${JSON.stringify(bonusValue)}, want "5")`,
      );

    await resetPlan();
    await page.evaluate((k) => localStorage.removeItem(k), KEY);

    const consoleErrorsNow = consoleErrors();
    if (consoleErrorsNow.length)
      errors.push(
        `console: ${consoleErrorsNow.length} error message(s) — ${JSON.stringify(consoleErrorsNow.slice(0, 3))}`,
      );
    if (pageErrors.length) for (const e of pageErrors) errors.push(`pageerror: ${e}`);
  }
} catch (e) {
  errors.push(`gate aborted mid-run: ${e.message.split("\n")[0]}`);
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(`\nFAILED with ${errors.length} error(s):`);
  for (const e of errors) console.error(`  [ERROR] ${e}`);
  process.exit(1);
}

console.log(
  `SUCCESS: event shop ${LEGACY ? "legacy stub fallback" : "Amendment A planner + modal"} verified against ${url}`,
);
