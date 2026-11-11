#!/usr/bin/env node
/**
 * scripts/test_event_shop.js
 *
 * Browser gate for the Event Shop surfaces under Amendment B (planner card REMOVED — the
 * per-currency modal is the sole configuration surface; tier Required boxes are read-only
 * modal openers with Held/Bonus box parity; event icons render standalone, no grey plate).
 *
 * Pins, against the PRODUCTION build:
 *  - ABSENCE of every planner-card surface: #eventPlannerCard, #eventPlannerSummary/Controls/
 *    List/EventName/Window/BuyAll/Clear and the .eshop-summary/.eshop-filter-chip/.eshop-group/
 *    .eshop-list/.eshop-controls/.eshop-empty classes must NOT exist anywhere; the first card
 *    of #panel-event is "Shop Requirements";
 *  - geometry parity: per tier, Required offsetHeight === Held === Bonus offsetHeight AND
 *    offsetWidth parity (> 0, and not the old 44px override); Required carries both
 *    .material-input-box-field and .eshop-require-display; its computed border-style is dashed
 *    and its cursor pointer, while Held/Bonus stay solid-bordered editable fields;
 *  - editability cues: the hover accent rule exists in the stylesheet inside
 *    @media (hover: hover) with border-color/background on the accent tokens, and the :focus
 *    rule flips the border to solid — pinned live, because this headless Chrome reports
 *    (hover: hover) = false and CDP cannot flip it, so :hover is CSSOM-pinned, never
 *    reported as a failure for not applying;
 *  - standalone icons: every mapped tier's .material-icon carries .material-icon--event with a
 *    computed transparent background while the base .material-icon grey rule still exists for
 *    the legacy (generic bg/fg) look; the event art decodes (naturalWidth > 0);
 *  - the currency modal #eventShopModal opens from a tier Required (click, Enter, Space) and
 *    Escape / ✕ / Cancel / backdrop mousedown close it as a discard;
 *  - ALL clamping lives in the modal draft rows (limit clamp, focus-preserving typing, schema
 *    max 999999, negative input, rapid stepper race) — moved, never weakened;
 *  - Select All = clearRequires semantics, Default = zero the draft; only Done commits;
 *  - Done agreement: localStorage fgo_event_shop_data, the tier Required values and the legacy
 *    calculator state all show the same numbers, cross-checked against this file's independent
 *    reference math over src/scripts/data/event_shop.js — never through the app's EventShop;
 *    buy-out data truth MISO 5740 / SHIMONITA 5390 / YAKI 6610;
 *  - modal draft-row icon fallback: when an icon request is refused (request interception
 *    aborts one /event_shop/ file), the .eshop-item-icon-fallback badge is transparent with a
 *    dashed border — no grey plate behind or in place of the art;
 *  - persistence across reload, event-id mismatch reset, hostile storage sanitisation, storage
 *    write discipline (draft typing writes nothing; Done writes once), quota-failure path,
 *    keyboard operation, zero sideways overflow / zero page errors at 360px and 1120px, and
 *    zero runtime external fetches.
 *
 * Legacy fallback (stub snapshot: event null) is pinned with --legacy against a patched bundle
 * copy served on a spare port — the production snapshot always has an event, so the stub branch
 * cannot be reached through the unpatched site. In stub mode the Required fields must be plain
 * editable inputs (no display class, no popup, solid border) on generic grey icon plates, and
 * clicking one must NOT open the modal.
 *
 * Run it against the static dist on the spare port (3000 is the owner's server — never gate
 * there, never stop daemons that are not yours):
 *   npm run build
 *   node scripts/test_event_shop.js http://localhost:4173/fgo-calculator/
 *   node scripts/test_event_shop.js http://localhost:4199/fgo-calculator/ --legacy   (stub copy)
 *
 * Patched-copy recipe (mutants + stub, outside the repo, served from throwaway dirs):
 *   stub:   in dist/_astro/event-lazy.*.js replace the balanced object literal that starts
 *           `={event:{id:<live id>` with `={event:null,currencies:[],items:[]}`;
 *   parity: append `min-height: 44px;` to the `input.eshop-require-display` rule in index.html
 *           (must redden the offsetHeight parity pin);
 *   grey:   set `.material-icon--event { background: transparent }` to `#e5e7eb` in index.html
 *           (must redden the standalone-icon pin);
 *   commit: in the event-lazy chunk replace `onCommit:e=>{<planner>.applyRequires(e),` with
 *           `onCommit:e=>{void 0,` (must redden the Done-agreement / write-discipline pins).
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

/* Amendment B data truth (plan round tracker, id asc): never trust the UI against itself. */
const BUY_ALL_TRUTH = { 94164000: 5740, 94164001: 5390, 94164002: 6610 };
const BUY_ALL_NAMES = { 94164000: "MISOおでん", 94164001: "SHIMONITAネギ", 94164002: "YAKIまんじゅう" };

/* Scene rows: the gold draft carries the clamp suite, the bronze draft the commit scenes. */
const goldCurrency = CURRENCIES.find((c) => c.background === "gold");
const silverCurrency = CURRENCIES.find((c) => c.background === "silver");
const bronzeCurrency = CURRENCIES.find((c) => c.background === "bronze");
const goldItems = goldCurrency ? itemsOfCurrency(String(goldCurrency.id)) : [];
const bronzeItems = bronzeCurrency ? itemsOfCurrency(String(bronzeCurrency.id)) : [];
const clampRow = goldItems.find((i) => i.limitNum === 1); // + twice must stop at 1
const draftFree = goldItems.find((i) => i.limitNum === 0); // unlimited row in the gold draft
const costumeRow = goldItems.find((i) => i.purchaseType === "costumeRelease");
const equipRow = goldItems.find((i) => i.purchaseType === "servant" && /equip_/.test(i.icon || ""));
const multiSetRow = goldItems.find((i) => i.setNum > 1);
const freeRow = bronzeItems.find((i) => i.limitNum === 0); // unlimited row in the bronze draft
const bronzeSteppable = bronzeItems.find((i) => maxRequire(i) >= 2); // write-discipline stepper row
const silverFree = silverCurrency ? itemsOfCurrency(String(silverCurrency.id)).find((i) => maxRequire(i) > 3) : null;

if (!LEGACY && (!clampRow || !draftFree || !freeRow || !bronzeSteppable || CURRENCIES.length < 3)) {
  console.error("[ERROR] planner: the data snapshot has no limited/unlimited rows to pin — gate is blind");
  process.exit(1);
}

const sel = {
  tierNeed: (tier) => `#${tier}Need`,
  tierHeld: (tier) => `#${tier}Have`,
  tierBonus: (tier) => `#${tier}Bonus`,
  modalRow: (id) => `#eventShopModalList .eshop-item[data-item-id="${id}"]`,
  modalInput: (id) => `${sel.modalRow(id)} .eshop-require-input`,
  modalPlus: (id) => `${sel.modalRow(id)} .eshop-step-btn[data-step="1"]`,
  modalMinus: (id) => `${sel.modalRow(id)} .eshop-step-btn[data-step="-1"]`,
  footer: (name) => `#eventShopModal${name}Btn`,
};

/* Amendment B: every one of these must be GONE from the live document. */
const DEAD_IDS = [
  "eventPlannerCard",
  "eventPlannerEventName",
  "eventPlannerWindow",
  "eventPlannerSummary",
  "eventPlannerControls",
  "eventPlannerList",
  "eventPlannerBuyAll",
  "eventPlannerClear",
];
const DEAD_CLASS_SELECTOR = [
  ".eshop-summary",
  ".eshop-summary-chip",
  ".eshop-filter-chip",
  ".eshop-group",
  ".eshop-group-header",
  ".eshop-group-total",
  ".eshop-list",
  ".eshop-controls",
  ".eshop-empty",
  ".eshop-event-name",
  ".eshop-window",
].join(", ");

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

  /* --- harness helpers (identical discipline to the earlier rounds) --- */
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

  /* The whole Amendment B read surface: tier boxes (values, geometry, computed cues, icon plates),
     quest drops, planner storage, legacy calculator storage, tab state. */
  const readTier = () =>
    page.evaluate(() => {
      const box = (el) =>
        el
          ? {
              h: el.offsetHeight,
              w: el.offsetWidth,
              borderStyle: getComputedStyle(el).borderStyle,
              cursor: getComputedStyle(el).cursor,
              readOnly: el.readOnly,
            }
          : null;
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
          needFieldClass: need ? need.classList.contains("material-input-box-field") : null,
          needHaspopup: need ? need.getAttribute("aria-haspopup") : null,
          needBox: box(need),
          heldBox: box(held),
          bonusBox: box(bonus),
          iconEventClass: iconBox ? iconBox.classList.contains("material-icon--event") : null,
          iconBoxBg: iconBox ? getComputedStyle(iconBox).backgroundColor : null,
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
            icons[`${m}_spanBg`] = getComputedStyle(span).backgroundColor;
          }
        }
        quests[t] = { title: titleEl ? titleEl.textContent : null, icons };
      }
      return {
        tiers,
        quests,
        storage: localStorage.getItem("fgo_event_shop_data"),
        legacyStorage: localStorage.getItem("fgo_calculator_data"),
        activeTab: (document.querySelector(".tab-btn.active") || {}).dataset?.tab || null,
        polluted: Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"),
      };
    });

  /* The static skeleton: dead card surfaces must not exist, the modal chrome must, and the first
     card of the Event panel is the requirements calculator the planner used to sit above. */
  const readPage = () =>
    page.evaluate(
      (deadIds, deadSel) => {
        const ids = {};
        for (const id of deadIds) ids[id] = !!document.getElementById(id);
        return {
          deadIds: ids,
          deadClassCount: document.querySelectorAll(deadSel).length,
          firstCardTitle: (document.querySelector("#panel-event .card .card-title") || {}).textContent?.trim() || null,
          modalPresent: !!document.getElementById("eventShopModal"),
          modalList: !!document.getElementById("eventShopModalList"),
          footerBtns: ["Default", "SelectAll", "Cancel", "Done"].map(
            (n) => !!document.getElementById(`eventShopModal${n}Btn`),
          ),
          closeBtn: !!document.getElementById("eventShopModalClose"),
          calculatorBtn: !!document.getElementById("calculateBtn"),
          questRows: document.querySelectorAll("#questGrid > *").length,
          anyRequireInputsOnPage: document.querySelectorAll(
            "#panel-event .eshop-require-input, #panel-event .eshop-step-btn",
          ).length,
        };
      },
      DEAD_IDS,
      DEAD_CLASS_SELECTOR,
    );

  const readModal = () =>
    page.evaluate(() => {
      const modal = document.getElementById("eventShopModal");
      return {
        open: modal.classList.contains("open"),
        title: (document.getElementById("eventShopModalTitle") || {}).textContent || "",
        rows: [...document.querySelectorAll("#eventShopModalList .eshop-item")].map((row) => {
          const input = row.querySelector(".eshop-require-input");
          const icon = row.querySelector(".eshop-item-icon-wrap > *");
          return {
            id: row.getAttribute("data-item-id"),
            value: input ? input.value : null,
            max: input ? input.getAttribute("max") : null,
            ariaLabel: input ? input.getAttribute("aria-label") : null,
            total: (row.querySelector(".eshop-item-total") || {}).textContent || "",
            active: row.classList.contains("eshop-item--active"),
            meta: (row.querySelector(".eshop-item-meta") || {}).textContent || "",
            name: (row.querySelector(".eshop-item-name") || {}).textContent || "",
            minusLabel:
              (row.querySelector('.eshop-step-btn[data-step="-1"]') || {}).getAttribute?.("aria-label") || null,
            plusLabel: (row.querySelector('.eshop-step-btn[data-step="1"]') || {}).getAttribute?.("aria-label") || null,
            iconKind: icon ? (icon.tagName === "IMG" ? "img" : "fallback") : null,
            iconSrc: icon && icon.tagName === "IMG" ? icon.getAttribute("src") : null,
            iconW: icon && icon.tagName === "IMG" ? icon.naturalWidth : null,
            iconText: icon && icon.tagName !== "IMG" ? icon.textContent : null,
          };
        }),
        displaySpans: document.querySelectorAll("#eventShopModalList .eshop-require-display").length,
      };
    });

  /* CSSOM evidence for the hover cue — headless Chrome reports (hover: hover) = false and CDP
     cannot flip it, so the RULE is the pin; the :focus flip is additionally tested live. */
  const readCssCues = () =>
    page.evaluate(() => {
      const decl = (rule, props) => {
        const out = {};
        for (const p of props) out[p] = rule.style.getPropertyValue(p);
        return out;
      };
      const out = { hover: null, focus: null, requireBase: null, iconBase: null, iconEvent: null };
      const walk = (rules, mediaText) => {
        for (const r of rules) {
          if (r.media) {
            walk(r.cssRules, r.conditionText || "");
            continue;
          }
          if (r.cssRules && !r.selectorText) {
            walk(r.cssRules, mediaText);
            continue;
          }
          if (!r.selectorText) continue;
          const s = r.selectorText.replace(/\s+/g, "");
          if (s === "input.eshop-require-display:hover" && /hover:\s*hover/.test(mediaText))
            out.hover = {
              media: mediaText,
              decl: decl(r, ["border-style", "border-color", "background", "background-color"]),
            };
          if (s === "input.eshop-require-display:focus") out.focus = { decl: decl(r, ["border-style"]) };
          if (s === "input.eshop-require-display")
            out.requireBase = {
              decl: decl(r, [
                "border-style",
                "cursor",
                "user-select",
                "min-height",
                "height",
                "width",
                "padding",
                "font-size",
                "display",
              ]),
            };
          if (s === ".material-icon") out.iconBase = { decl: decl(r, ["background", "background-color"]) };
          if (s === ".material-icon--event") out.iconEvent = { decl: decl(r, ["background", "background-color"]) };
        }
      };
      for (const sheet of document.styleSheets) {
        try {
          walk(sheet.cssRules, "");
        } catch {
          /* cross-origin sheets are unreadable; the shipped CSS is inline, so this never fires */
        }
      }
      return out;
    });

  /* Asserts the committed plan against the reference plan through the Amendment B surfaces only:
     the tier Required values, the planner storage blob and the legacy calculator state. */
  const assertPlan = (tierState, expected, label) => {
    const want = refTotals(expected);
    if (tierState.activeTab && tierState.activeTab !== "event") {
      errors.push(
        `${label}: the active tab is ${JSON.stringify(tierState.activeTab)} — a modal gesture moved the user off the Event tab`,
      );
    }
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
    return want;
  };

  const assertStorage = (raw, expected, label, { exact = false } = {}) => {
    const stored = raw ? JSON.parse(raw) : null;
    if (!stored) {
      errors.push(`${label}: storage blob missing`);
      return null;
    }
    if (stored.eventId !== EVENT_ID)
      errors.push(`${label}: stored eventId ${JSON.stringify(stored.eventId)}, want ${EVENT_ID}`);
    const req = stored.requires || {};
    for (const [id, value] of Object.entries(expected)) {
      if ((req[id] ?? 0) !== value)
        errors.push(`${label}: storage row ${id} is ${JSON.stringify(req[id])}, want ${value}`);
    }
    for (const [id, value] of Object.entries(req)) {
      if (value !== 0 && !(id in expected))
        errors.push(`${label}: storage holds unplanned row ${id} = ${JSON.stringify(value)}`);
      if (!byId.has(id)) errors.push(`${label}: storage holds unknown item id ${id}`);
    }
    if (exact) {
      const wantKeys = Object.keys(expected)
        .filter((k) => expected[k] !== 0)
        .sort()
        .join();
      const gotKeys = Object.keys(req)
        .filter((k) => req[k] !== 0)
        .sort()
        .join();
      if (wantKeys !== gotKeys) errors.push(`${label}: storage nonzero keys ${gotKeys}, want ${wantKeys}`);
    }
    return stored;
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
      page.evaluate(() => {
        const need = document.getElementById("goldNeed");
        return {
          hasNeed: !!need,
          displayClass: need ? need.classList.contains("eshop-require-display") : null,
          activeTab: (document.querySelector(".tab-btn.active") || {}).dataset?.tab || null,
          panelShown: getComputedStyle(document.getElementById("panel-event")).display !== "none",
        };
      });
    let st = await visible();
    /* main.js warms the Event tab while idle; a user only reaches the tier cards through the tab
       button, and the gate has to take that same route. Readiness = hydrated tier surface. */
    const ready = (s) =>
      s.hasNeed &&
      s.activeTab === "event" &&
      s.panelShown &&
      (LEGACY ? s.displayClass === false : s.displayClass === true);
    if (!ready(st)) {
      await safeClick('.tab-btn[data-tab="event"]');
      try {
        await page.waitForFunction(
          (legacy) => {
            const need = document.getElementById("goldNeed");
            if (!need) return false;
            const hasClass = need.classList.contains("eshop-require-display");
            return (
              document.querySelector(".tab-btn.active")?.dataset.tab === "event" &&
              getComputedStyle(document.getElementById("panel-event")).display !== "none" &&
              (legacy ? !hasClass : hasClass)
            );
          },
          { timeout: 15000 },
          LEGACY,
        );
      } catch {
        /* falls through to the read below, which reports it */
      }
      st = await visible();
    }
    if (!ready(st)) {
      errors.push(
        `planner tab: the Event tab is not the visible/hydrated panel (${JSON.stringify(st)}, eventMode=${!LEGACY}) — nothing in the shop UI is reachable`,
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
    await ensureEventTab();
    console.log(`NOTE: legacy mode — tab ready in ${Date.now() - t0}ms`);
    const pg = await readPage();
    const survivors = DEAD_IDS.filter((id) => pg.deadIds[id]);
    if (survivors.length) errors.push(`legacy: planner card ids still present ${JSON.stringify(survivors)}`);
    if (pg.deadClassCount) errors.push(`legacy: ${pg.deadClassCount} dead card-class node(s) in the document`);
    if (pg.firstCardTitle !== "Shop Requirements")
      errors.push(`legacy: first card title is ${JSON.stringify(pg.firstCardTitle)}, want "Shop Requirements"`);
    if (!pg.modalPresent || !pg.modalList)
      errors.push("legacy: #eventShopModal markup is static and must ship regardless of data");

    const tier = await readTier();
    for (const t of TIERS) {
      const td = tier.tiers[t];
      if (td.needValue !== "0")
        errors.push(`legacy: ${t} Required reads ${JSON.stringify(td.needValue)} at cold start, want "0"`);
      if (td.needReadOnly !== false)
        errors.push(`legacy: ${t} Required is readOnly — the editable field must survive a stub snapshot`);
      if (td.needDisplayClass) errors.push(`legacy: ${t} Required carries the eshop-require-display class`);
      if (td.needHaspopup !== null) errors.push(`legacy: ${t} Required has aria-haspopup=${td.needHaspopup}`);
      if (td.needBox.borderStyle !== "solid")
        errors.push(
          `legacy: ${t} Required border-style is ${td.needBox.borderStyle}, want solid (no dashed display cue)`,
        );
      if (td.iconEventClass)
        errors.push(`legacy: ${t} icon box carries material-icon--event — the transparent override is event-mode only`);
      if (td.iconBoxBg !== "rgb(229, 231, 235)")
        errors.push(`legacy: ${t} generic icon plate is ${td.iconBoxBg}, want the grey #e5e7eb`);
      if (td.name !== t.charAt(0).toUpperCase() + t.slice(1))
        errors.push(`legacy: ${t} card name is ${JSON.stringify(td.name)}`);
      const srcs = td.imgs.map((i) => i.src || "");
      if (
        !srcs.some((s) => s.includes(`icons/materials/${t}_bg.webp`)) ||
        !srcs.some((s) => s.includes(`icons/materials/${t}_fg.webp`))
      ) {
        errors.push(`legacy: ${t} icon shows ${JSON.stringify(srcs)}, want the generic bg+fg pair`);
      }
      /* parity by construction holds in legacy too: one shared field class */
      if (!(td.needBox.h > 0) || td.needBox.h !== td.heldBox.h || td.needBox.h !== td.bonusBox.h)
        errors.push(
          `legacy: ${t} box heights differ — need ${td.needBox.h} held ${td.heldBox.h} bonus ${td.bonusBox.h}`,
        );
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
    /* a stub snapshot maps no currency: clicking a Required must NOT open the modal */
    await safeClick("#bronzeNeed");
    await wait(SETTLE_MS);
    const modalAfterTierClick = await readModal();
    if (modalAfterTierClick.open)
      errors.push("legacy: clicking a tier Required opened the currency modal — no currency is mapped under a stub");
    await page.focus("#goldNeed");
    await page.keyboard.press("Enter");
    await wait(SETTLE_MS);
    if ((await readModal()).open) errors.push("legacy: Enter on a stub Required opened the modal");
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
    if (!pg.calculatorBtn || !pg.questRows)
      errors.push("legacy: the tier/run calculator is broken next to the stub planner");
    if (pageErrors.length) for (const e of pageErrors) errors.push(`legacy pageerror: ${e}`);
    if (consoleErrors().length) errors.push(`legacy console errors: ${JSON.stringify(consoleErrors().slice(0, 3))}`);
    if (externalHosts.size) errors.push(`legacy: external origins ${JSON.stringify([...externalHosts])}`);
  } else {
    /* ================= 1. Amendment B structure: card is GONE, modal chrome is static ========== */
    await ensureEventTab();

    const pg = await readPage();
    const survivors = DEAD_IDS.filter((id) => pg.deadIds[id]);
    if (survivors.length)
      errors.push(`card absence: these planner-card ids still exist in the document ${JSON.stringify(survivors)}`);
    if (pg.deadClassCount)
      errors.push(`card absence: ${pg.deadClassCount} node(s) still carry dead card classes (${DEAD_CLASS_SELECTOR})`);
    if (pg.firstCardTitle !== "Shop Requirements")
      errors.push(
        `card absence: first card of #panel-event is ${JSON.stringify(pg.firstCardTitle)}, want "Shop Requirements"`,
      );
    if (!pg.modalPresent || !pg.modalList)
      errors.push("modal chrome: #eventShopModal / #eventShopModalList missing from static markup");
    if (pg.footerBtns.some((b) => !b))
      errors.push(
        `modal chrome: footer buttons present ${JSON.stringify(pg.footerBtns)}, want Default/SelectAll/Cancel/Done`,
      );
    if (!pg.closeBtn) errors.push("modal chrome: #eventShopModalClose missing");
    if (pg.anyRequireInputsOnPage)
      errors.push(
        `card absence: ${pg.anyRequireInputsOnPage} .eshop-require-input/.eshop-step-btn node(s) sit on the closed page — steppers may exist only inside an open modal draft`,
      );

    /* ================= 2. Required box parity + editability cues (all tiers) ================== */
    const base = await readTier();
    for (const t of TIERS) {
      const td = base.tiers[t];
      if (!td.needFieldClass)
        errors.push(`parity: ${t} Required lost the material-input-box-field class — geometry comes from it`);
      if (!td.needDisplayClass) errors.push(`parity: ${t} Required lacks the eshop-require-display class`);
      if (td.needReadOnly !== true) errors.push(`parity: ${t} Required is not read-only`);
      if (td.needHaspopup !== "dialog")
        errors.push(`parity: ${t} Required aria-haspopup=${JSON.stringify(td.needHaspopup)}, want dialog`);
      if (!(td.needBox.h > 0)) errors.push(`parity: ${t} Required has no height (${td.needBox.h}px)`);
      if (td.needBox.h !== td.heldBox.h || td.needBox.h !== td.bonusBox.h)
        errors.push(
          `parity: ${t} offsetHeight mismatch — Required ${td.needBox.h}px, Held ${td.heldBox.h}px, Bonus ${td.bonusBox.h}px`,
        );
      if (td.needBox.h === 44)
        errors.push(
          `parity: ${t} Required is exactly 44px tall — the removed min-height override is back (Held ${td.heldBox.h}px)`,
        );
      if (td.needBox.w !== td.heldBox.w || td.needBox.w !== td.bonusBox.w)
        errors.push(
          `parity: ${t} offsetWidth mismatch — Required ${td.needBox.w}px, Held ${td.heldBox.w}px, Bonus ${td.bonusBox.w}px`,
        );
      if (td.needBox.borderStyle !== "dashed")
        errors.push(`cues: ${t} Required computed border-style is ${td.needBox.borderStyle}, want dashed`);
      if (td.heldBox.borderStyle !== "solid")
        errors.push(
          `cues: ${t} Held computed border-style is ${td.heldBox.borderStyle}, want solid (dashed pin must discriminate)`,
        );
      if (td.needBox.cursor !== "pointer")
        errors.push(`cues: ${t} Required computed cursor is ${td.needBox.cursor}, want pointer`);
      if (td.needValue !== "0")
        errors.push(`parity: ${t} Required reads ${JSON.stringify(td.needValue)} on an empty plan, want "0"`);
    }

    /* CSSOM: hover cue rule + focus cue rule + the base rule must carry NO geometry. */
    const css = await readCssCues();
    if (!css.hover)
      errors.push(
        "cues CSSOM: no input.eshop-require-display:hover rule inside an @media (hover: hover) block — hover accent cue never ships (headless cannot apply it; the rule is the pin)",
      );
    else {
      const hd = css.hover.decl;
      if (hd["border-style"] !== "solid")
        errors.push(`cues CSSOM: hover border-style is ${JSON.stringify(hd["border-style"])}, want solid`);
      if (!/--accent/.test(hd["border-color"] || ""))
        errors.push(`cues CSSOM: hover border-color ${JSON.stringify(hd["border-color"])}, want the accent token`);
      if (!/--accent-light/.test((hd.background || "") + (hd["background-color"] || "")))
        errors.push(
          `cues CSSOM: hover background ${JSON.stringify([hd.background, hd["background-color"]])}, want --accent-light`,
        );
    }
    if (!css.focus || css.focus.decl["border-style"] !== "solid")
      errors.push("cues CSSOM: input.eshop-require-display:focus border-style solid rule missing");
    if (
      !css.requireBase ||
      css.requireBase.decl["border-style"] !== "dashed" ||
      css.requireBase.decl.cursor !== "pointer"
    )
      errors.push(`cues CSSOM: base eshop-require-display rule wrong — ${JSON.stringify(css.requireBase)}`);
    if (css.requireBase) {
      const geometry = ["min-height", "height", "width", "padding", "font-size", "display"].filter(
        (p) => css.requireBase.decl[p],
      );
      if (geometry.length)
        errors.push(
          `parity CSSOM: eshop-require-display still overrides box geometry (${geometry.join("/")}) — Amendment B says geometry inherits from material-input-box-field`,
        );
    }
    if (
      !css.iconBase ||
      !/#e5e7eb|rgb\(229, 231, 235\)/.test(
        (css.iconBase.decl.background || "") + (css.iconBase.decl["background-color"] || ""),
      )
    )
      errors.push(
        `icons CSSOM: base .material-icon grey plate rule missing or changed — ${JSON.stringify(css.iconBase)}`,
      );
    if (
      !css.iconEvent ||
      !/transparent/.test((css.iconEvent.decl.background || "") + (css.iconEvent.decl["background-color"] || ""))
    )
      errors.push(`icons CSSOM: .material-icon--event transparent rule missing — ${JSON.stringify(css.iconEvent)}`);
    /* live :focus flip */
    await page.focus("#goldNeed");
    const focusBorder = await page.evaluate(() => getComputedStyle(document.getElementById("goldNeed")).borderStyle);
    if (focusBorder !== "solid")
      errors.push(`cues live: focused gold Required border-style is ${focusBorder}, want solid`);
    await page.focus("#goldHave");
    const blurBorder = await page.evaluate(() => getComputedStyle(document.getElementById("goldNeed")).borderStyle);
    if (blurBorder !== "dashed")
      errors.push(`cues live: blurred gold Required border-style is ${blurBorder}, want dashed`);

    /* ================= 3. event-native tier cards: standalone icons, names, art ================ */
    for (const currency of CURRENCIES) {
      const tier = tierOfCurrency(currency);
      const td = base.tiers[tier];
      if (td.name !== BUY_ALL_NAMES[currency.id])
        errors.push(
          `tier card: ${tier} material-name is ${JSON.stringify(td.name)}, want ${JSON.stringify(BUY_ALL_NAMES[currency.id])}`,
        );
      if (!td.iconEventClass)
        errors.push(`icons: ${tier} .material-icon did not gain material-icon--event on hydration`);
      if (td.iconBoxBg !== "rgba(0, 0, 0, 0)")
        errors.push(
          `icons: ${tier} event icon plate background is ${JSON.stringify(td.iconBoxBg)}, want transparent rgba(0,0,0,0)`,
        );
      const fg = td.imgs.filter((i) => i.cls.includes("fg-layer"));
      const bg = td.imgs.filter((i) => i.cls.includes("bg-layer"));
      if (fg.length !== 1 || bg.length !== 0)
        errors.push(
          `icons: ${tier} icon box has ${fg.length} fg + ${bg.length} bg img(s), want a single event fg-layer`,
        );
      const src = fg[0] ? fg[0].src : "";
      const wantSrc = `event_shop/${currency.icon.split("/").pop()}?v=`;
      if (!src || !src.includes(wantSrc))
        errors.push(`icons: ${tier} icon src ${JSON.stringify(src)}, want ${JSON.stringify(wantSrc)}…`);
      if (td.heldBox.readOnly !== false || td.bonusBox.readOnly !== false)
        errors.push(
          `tier card: ${tier} Held/Bonus must stay editable (held readOnly=${td.heldBox.readOnly}, bonus readOnly=${td.bonusBox.readOnly})`,
        );
    }
    for (const [quest, drops] of Object.entries(QUEST_DROPS)) {
      const qd = base.quests[quest];
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
        /* Amendment B §5 audit: the drop span must not keep a grey plate either */
        if (qd.icons[`${m}_spanBg`] && qd.icons[`${m}_spanBg`] !== "rgba(0, 0, 0, 0)")
          errors.push(
            `quest drops: ${quest}Quest_${m}_icon span background is ${qd.icons[`${m}_spanBg`]}, want transparent`,
          );
      }
    }

    /* data truth: never trust the UI against itself */
    {
      const wantTruth = refTotals(refClear(ITEMS));
      for (const currency of CURRENCIES) {
        const id = String(currency.id);
        if (wantTruth[id] !== BUY_ALL_TRUTH[id])
          errors.push(
            `data truth: reference buy-all for ${currency.name} (${id}) is ${wantTruth[id]}, the pinned plan truth says ${BUY_ALL_TRUTH[id]} — the snapshot drifted, re-verify before pinning`,
          );
        if (currency.name !== BUY_ALL_NAMES[id])
          errors.push(
            `data truth: currency ${id} is named ${JSON.stringify(currency.name)}, want ${JSON.stringify(BUY_ALL_NAMES[id])}`,
          );
      }
    }

    /* ================= 4. event images actually decode ======================================== */
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
    console.log(
      `NOTE: tier + quest event images decoded ${tierDecoded.length - deadTier.length}/${tierDecoded.length}`,
    );

    /* ================= 5. modal opens from bronze Required; Escape discards =================== */
    if (tierOfCurrency(currencyOf(freeRow)) !== "bronze")
      errors.push(`data sanity: the bronze scene row maps to ${tierOfCurrency(currencyOf(freeRow))}, want bronze`);
    await openTierModal("bronze", "open modal from bronze Required click");
    let modal = await readModal();
    const wantBronzeRows = itemsOfCurrency(String(bronzeCurrency.id));
    if (modal.title !== `${bronzeCurrency.name} — Shop Items`)
      errors.push(`modal title: reads ${JSON.stringify(modal.title)}, want "${bronzeCurrency.name} — Shop Items"`);
    if (modal.rows.length !== wantBronzeRows.length)
      errors.push(
        `modal rows: ${modal.rows.length} draft rows for ${bronzeCurrency.name}, want ${wantBronzeRows.length}`,
      );
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
      if (String(item.cost.itemId) !== String(bronzeCurrency.id))
        draftBad.push(`${row.id}: belongs to another currency, leaked into the draft`);
      if (row.value !== "0")
        draftBad.push(`${row.id}: draft opens at ${JSON.stringify(row.value)}, want storage value "0"`);
      if (row.max !== String(maxRequire(item)))
        draftBad.push(`${row.id}: input max ${row.max}, want ${maxRequire(item)}`);
      if (row.ariaLabel !== `${item.name} require`)
        draftBad.push(`${row.id}: input aria ${JSON.stringify(row.ariaLabel)}`);
      if (row.minusLabel !== `Decrease ${item.name}` || row.plusLabel !== `Increase ${item.name}`)
        draftBad.push(`${row.id}: step labels ${JSON.stringify([row.minusLabel, row.plusLabel])}`);
      const wantMeta =
        `${bronzeCurrency.name} \u00d7${fmtRef(item.cost.amount)} \u00b7 ` +
        (item.limitNum > 0 ? `Limit ${fmtRef(item.limitNum)}` : "Unlimited") +
        (item.setNum > 1 ? ` \u00b7 \u00d7${fmtRef(item.setNum)} per buy` : "");
      if (row.meta !== wantMeta)
        draftBad.push(`${row.id}: meta ${JSON.stringify(row.meta)} want ${JSON.stringify(wantMeta)}`);
      if (row.active) draftBad.push(`${row.id}: active tint on a zero draft`);
      if (num(row.total) !== 0) draftBad.push(`${row.id}: subtotal ${JSON.stringify(row.total)} on a zero draft`);
      if (!row.iconKind) draftBad.push(`${row.id}: draft row has neither an icon nor a fallback`);
    }
    if (draftBad.length)
      errors.push(`modal draft: ${draftBad.length} row(s) wrong — ${draftBad.slice(0, 3).join(" | ")}`);
    await closeBy("Escape", "Escape closes the modal");
    assertPlan(await readTier(), {}, "Escape-discard");

    /* ================= 6. keyboard: Enter and Space open from a focused Required ============== */
    await page.focus(sel.tierNeed("gold"));
    await page.keyboard.press("Enter");
    await modalGate(true, "Enter opens the gold modal from the focused Required");
    modal = await readModal();
    if (!modal.title.startsWith(goldCurrency.name))
      errors.push(`keyboard: Enter on goldNeed opened ${JSON.stringify(modal.title)}, want ${goldCurrency.name}`);
    /* gold draft carries the interesting art: costume + equip + multi-set rows are all gold */
    const artSamples = [costumeRow, equipRow, multiSetRow].filter(Boolean).map((i) => String(i.id));
    if (artSamples.length < 3)
      errors.push(
        `data sanity: costume/equip/multi-set sample rows ${JSON.stringify(artSamples)} — re-verify the art pins against the snapshot`,
      );
    /* the draft list was just built; lazy art decodes as it is painted — wait for it */
    for (let i = 0; i < 60; i++) {
      const artNow = modal.rows.filter((r) => artSamples.includes(r.id));
      if (artNow.length === artSamples.length && artNow.every((r) => r.iconKind === "img" && r.iconW > 0)) break;
      await wait(100);
      modal = await readModal();
    }
    const artRows = artSamples.map((id) => modal.rows.find((r) => r.id === id)).filter(Boolean);
    if (artRows.length < artSamples.length)
      errors.push(
        `modal art: ${artRows.length}/${artSamples.length} sample art rows present in the gold draft — data moved between currencies, re-verify before trusting this pin`,
      );
    const deadArt = artRows.filter((r) => r.iconKind !== "img" || !(r.iconW > 0));
    if (deadArt.length)
      errors.push(
        `modal icons: costume/equip/multi-set draft icon(s) not decoded — ${JSON.stringify(deadArt.map((r) => [r.id, r.iconKind, r.iconW]))}`,
      );
    await closeBy("Escape", "Escape after Enter-open");
    await page.focus(sel.tierNeed("silver"));
    await page.keyboard.press("Space");
    await modalGate(true, "Space opens the silver modal from the focused Required");
    modal = await readModal();
    if (!modal.title.startsWith(silverCurrency.name))
      errors.push(`keyboard: Space on silverNeed opened ${JSON.stringify(modal.title)}, want ${silverCurrency.name}`);
    await closeBy("Escape", "Escape after Space-open");

    /* ================= 7. clamp suite lives INSIDE the modal draft rows ======================= */
    await openTierModal("gold", "open modal for clamp scene");
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
    await safeClick(sel.modalMinus(clampRow.id)); // back to a known low value path (clamped at 0)
    await wait(SETTLE_MS);
    /* Default zeroes the whole draft (write-back through the sync path) */
    await safeClick("#eventShopModalDefaultBtn");
    await wait(SETTLE_MS);
    modal = await readModal();
    const notZero = modal.rows.filter((r) => r.value !== "0" || num(r.total) !== 0);
    if (notZero.length)
      errors.push(`modal Default: ${notZero.length} row(s) survived the zero — ${JSON.stringify(notZero.slice(0, 2))}`);
    /* unlimited rows accept 5000 and cap the subtotal at the schema max */
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
    /* Cancel discards: storage untouched, tier reads stay 0, reopen re-clones from state */
    await closeBy("Cancel", "Cancel discards the draft");
    let tierState = await readTier();
    assertPlan(tierState, {}, "Cancel-discard leaves the plan");
    if (tierState.storage !== null)
      errors.push(
        `Cancel-discard: localStorage was written by draft editing (${JSON.stringify(tierState.storage)}) — nothing publishes before Done`,
      );
    await openTierModal("gold", "reopen after Cancel");
    modal = await readModal();
    const leaked = modal.rows.filter((r) => r.value !== "0");
    if (leaked.length)
      errors.push(
        `draft isolation: after Cancel+reopen, ${leaked.length} row(s) kept draft edits ${JSON.stringify(leaked.slice(0, 2).map((r) => [r.id, r.value]))}, want all "0"`,
      );
    await closeBy("Cancel", "close reopen check");

    /* ================= 8. write discipline: drafts never touch storage, Done writes once ====== */
    await installWriteSpy();
    await openTierModal("bronze", "open modal for write-count scene");
    await typeInto(sel.modalInput(freeRow.id), "12345");
    await safeClick(sel.modalPlus(bronzeSteppable.id));
    await safeClick(sel.modalPlus(bronzeSteppable.id));
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
    tierState = await readTier();
    const plan8 = {
      [String(freeRow.id)]: 12345,
      [String(bronzeSteppable.id)]: Math.min(2, maxRequire(bronzeSteppable)),
    };
    assertPlan(tierState, plan8, "Done commits typed + stepped values");
    assertStorage(tierState.storage, plan8, "Done commit", { exact: true });
    /* committed rows reopen pre-filled with live values and active tint */
    await openTierModal("bronze", "reopen with the committed plan");
    modal = await readModal();
    const cr8 = modal.rows.find((r) => r.id === String(freeRow.id));
    if (!cr8 || cr8.value !== "12345" || !cr8.active)
      errors.push(
        `draft prefill: committed row reads ${JSON.stringify(cr8 && [cr8.value, cr8.active])}, want "12345" + active`,
      );
    await closeBy("Cancel", "close prefill check");

    /* draft isolation ACROSS currencies: another currency's rows are not in this draft */
    await openTierModal("silver", "open SHIMONITA modal for isolation");
    modal = await readModal();
    const silverItems = itemsOfCurrency(String(silverCurrency.id));
    const foreign = modal.rows.filter((r) => !silverItems.some((i) => String(i.id) === r.id));
    if (foreign.length)
      errors.push(
        `draft isolation: the silver draft contains ${foreign.length} foreign row(s) ${JSON.stringify(foreign.slice(0, 2).map((r) => r.id))}`,
      );
    await typeInto(sel.modalInput(String(silverFree.id)), "9");
    await closeBy("Cancel", "cancel silver edit");
    tierState = await readTier();
    assertPlan(tierState, plan8, "silver Cancel leaves the committed plan");
    await openTierModal("silver", "reopen silver after Cancel");
    modal = await readModal();
    const kept9 = modal.rows.filter((r) => r.value === "9");
    if (kept9.length)
      errors.push(
        `draft isolation: Cancelled silver edit survived the reopen (${JSON.stringify(kept9.map((r) => r.id))})`,
      );
    await closeBy("Cancel", "close silver");

    /* ================= 9. Done agreement: storage + tier + legacy all match ================== */
    await resetPlan();
    await openTierModal("bronze", "bronze scene via tier Required");
    await typeInto(sel.modalInput(freeRow.id), "3");
    await clickDone();
    tierState = await readTier();
    const plan9 = { [String(freeRow.id)]: 3 };
    assertPlan(tierState, plan9, "Done agreement — tier Required + legacy state");
    assertStorage(tierState.storage, plan9, "Done agreement — storage blob", { exact: true });
    const legacy9 = tierState.legacyStorage ? JSON.parse(tierState.legacyStorage) : null;
    if (!legacy9 || legacy9.bronzeNeed !== 30)
      errors.push(
        `Done agreement: legacy fgo_calculator_data bronzeNeed is ${legacy9 && legacy9.bronzeNeed}, want the plan total 30`,
      );
    /* a second currency commit must not disturb the first (applyRequires is a merge) */
    await openTierModal("gold", "open gold for merge check");
    await typeInto(sel.modalInput(draftFree.id), "250");
    await clickDone();
    tierState = await readTier();
    const plan9b = { [String(freeRow.id)]: 3, [String(draftFree.id)]: 250 };
    assertPlan(tierState, plan9b, "merge commit keeps the earlier currency");
    assertStorage(tierState.storage, plan9b, "merge commit blob");

    /* ================= 10. Select All = buy-all semantics; whole-plan truth =================== */
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
    tierState = await readTier();
    const buyAll = refClear(ITEMS);
    const wantBuy = assertPlan(tierState, buyAll, "Select All ×3 (buy all)");
    for (const currency of CURRENCIES) {
      const tier = tierOfCurrency(currency);
      if (tierState.tiers[tier].needValue !== String(BUY_ALL_TRUTH[String(currency.id)]))
        errors.push(
          `buy-out truth: ${tier} Required reads ${tierState.tiers[tier].needValue}, the pinned data truth is ${BUY_ALL_TRUTH[String(currency.id)]}`,
        );
      if (wantBuy[String(currency.id)] !== BUY_ALL_TRUTH[String(currency.id)])
        errors.push(`buy-out truth: reference totals disagree with the pinned truth for ${currency.id}`);
    }
    const storedBuy = JSON.parse(tierState.storage);
    for (const item of ITEMS) {
      const want = buyAll[String(item.id)];
      if ((storedBuy.requires || {})[String(item.id)] !== want)
        errors.push(
          `buy-all storage: row ${item.id} stored ${JSON.stringify((storedBuy.requires || {})[String(item.id)])}, want ${want}`,
        );
    }
    console.log(
      `NOTE: buy-all via Select All → ${CURRENCIES.map((c) => `${c.name} ${wantBuy[String(c.id)]}`).join(", ")} (pinned truth ${JSON.stringify(BUY_ALL_TRUTH)})`,
    );

    /* Default on one currency must empty it and leave the others (partial commit) */
    await openTierModal("bronze", "open bronze for Default+Done");
    await safeClick("#eventShopModalDefaultBtn");
    await wait(SETTLE_MS);
    await clickDone();
    tierState = await readTier();
    const partial = { ...buyAll };
    for (const item of bronzeItems) partial[String(item.id)] = 0;
    assertPlan(tierState, partial, "Default+Done empties only its currency");

    /* ================= 11. persistence across reload + legacy-need recompute ================== */
    const persistPlan = { [String(freeRow.id)]: 250 };
    await resetPlan();
    await openTierModal("bronze", "open for persistence scene");
    await typeInto(sel.modalInput(freeRow.id), "250");
    await clickDone();
    await page.reload({ waitUntil: "networkidle0" });
    await ensureEventTab();
    await wait(SETTLE_MS);
    let restored = await readTier();
    assertPlan(restored, persistPlan, "persistence after reload");
    assertStorage(restored.storage, persistPlan, "persistence blob after reload", { exact: true });
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
    restored = await readTier();
    assertPlan(restored, persistPlan, "tampered legacy need is recomputed from the plan on load");

    /* ================= 12. event-id mismatch resets the plan ================================== */
    const mismatchSeed = JSON.stringify({ eventId: EVENT_ID + 7, requires: { [String(freeRow.id)]: 5 } });
    await seedAndReload(mismatchSeed);
    let mismatchTier = await readTier();
    assertPlan(mismatchTier, {}, "event-id mismatch reset");
    if (mismatchTier.storage !== mismatchSeed)
      errors.push(
        `event-id mismatch: the app rewrote storage on load (${JSON.stringify(mismatchTier.storage)}) — it must leave the dead blob alone until a mutation`,
      );
    await openTierModal("bronze", "open after mismatch");
    await clickDone();
    mismatchTier = await readTier();
    const storedMismatch = mismatchTier.storage ? JSON.parse(mismatchTier.storage) : null;
    if (!storedMismatch || storedMismatch.eventId !== EVENT_ID)
      errors.push(
        `event-id mismatch: first mutation stored eventId ${storedMismatch && storedMismatch.eventId}, want the current ${EVENT_ID}`,
      );

    /* ================= 13. hostile localStorage blobs still sanitise ========================== */
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
      const st = await readTier();
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
      for (const t of TIERS) {
        if (!/^\d+$/.test(st.tiers[t].needValue || ""))
          errors.push(
            `garbage storage (${label}): ${t} Required holds non-canonical text ${JSON.stringify(st.tiers[t].needValue)}`,
          );
      }
      /* still usable: the draft opens pre-filled from the sanitised plan, edits commit through Done */
      await openTierModal("gold", `open draft after garbage (${label})`);
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
      const usable = await readTier();
      const usableExpect = { ...expect, [String(clampRow.id)]: Math.min(maxRequire(clampRow), wantDraft + 1) };
      assertPlan(usable, usableExpect, `garbage storage (${label}) then + & Done`);
      if (!usable.storage || usable.storage === raw)
        errors.push(
          `garbage storage (${label}): the commit did not rewrite storage ("${usable.storage && usable.storage.slice(0, 60)}")`,
        );
    }

    /* ================= 14. localStorage quota failure must not crash the Done path ============ */
    await resetPlan();
    await installWriteSpy({ throw: true });
    await openTierModal("bronze", "open modal for quota scene");
    await typeInto(sel.modalInput(freeRow.id), "1");
    const beforeQuotaErrors = pageErrors.length;
    await safeClick("#eventShopModalDoneBtn");
    await modalGate(false, "Done closes even when the save throws");
    await wait(SETTLE_MS);
    const quotaState = await readTier();
    assertPlan(quotaState, { [String(freeRow.id)]: 1 }, "quota failure keeps the plan live (state before persist)");
    /* assertPlan would flag the tier; state truth pins the raw value too */
    if (quotaState.tiers.bronze.needValue !== String(freeRow.cost.amount))
      errors.push(`quota failure: tier Required did not follow the live plan (${quotaState.tiers.bronze.needValue})`);
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
    await openTierModal("bronze", "reopen after quota recovery");
    modal = await readModal();
    const recoveryRow = modal.rows.find((r) => r.id === String(freeRow.id));
    if (recoveryRow && recoveryRow.value !== "1")
      errors.push(
        `quota recovery: the draft lost the in-memory plan (reads ${JSON.stringify(recoveryRow && recoveryRow.value)}, want "1")`,
      );
    await safeClick(sel.modalPlus(freeRow.id));
    await clickDone();
    const afterQuota = await readTier();
    assertPlan(afterQuota, { [String(freeRow.id)]: 2 }, "saving works again once setItem is restored");

    /* ================= 15. backdrop mousedown = Cancel (discard) ============================== */
    await resetPlan();
    await openTierModal("bronze", "open for backdrop check");
    await typeInto(sel.modalInput(freeRow.id), "12");
    await closeBy("backdrop", "backdrop click discards the draft");
    const backdropState = await readTier();
    assertPlan(backdropState, {}, "backdrop-discard leaves the plan");
    if (backdropState.storage !== null)
      errors.push(
        `backdrop-discard: localStorage was written (${JSON.stringify(backdropState.storage)}) — backdrop is Cancel, not Done`,
      );

    /* ================= 16. modal icon fallback: transparent plate, dashed badge =============== */
    /* Refuse ONE shop icon file over the wire (python http.server cannot 404 a real file; CDP
       interception aborts the request exactly like a dead asset). The row must fall back to the
       id badge WITHOUT a grey fill. Memory-cached images never reach the interceptor, so this
       scene also flips the browser cache off for its duration. */
    const fallbackItem = [...bronzeItems].reverse().find((i) => i.icon);
    const blockedFile = fallbackItem ? fallbackItem.icon.split("/").pop() : "___none___.webp";
    let abortedLoads = 0;
    const onRequest = (req) => {
      if (/event_shop/.test(req.url()) && req.url().includes(blockedFile)) {
        abortedLoads++;
        req.abort();
      } else req.continue();
    };
    if (fallbackItem) {
      const cdp = await page.createCDPSession();
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await page.setRequestInterception(true);
      page.on("request", onRequest);
      await openTierModal("bronze", "open modal with one refused icon");
      /* the row sits below the modal's fold: a lazy img only requests once it scrolls in */
      await page.evaluate((id) => {
        const row = document.querySelector(`#eventShopModalList .eshop-item[data-item-id="${id}"]`);
        if (row) row.scrollIntoView({ block: "center" });
      }, String(fallbackItem.id));
      let fallbackRow = null;
      for (let i = 0; i < 40 && !fallbackRow; i++) {
        await wait(100);
        fallbackRow = (await readModal()).rows.find(
          (r) => r.id === String(fallbackItem.id) && r.iconKind === "fallback",
        );
      }
      if (!fallbackRow) {
        errors.push(`modal fallback: row ${fallbackItem.id} never swapped the refused ${blockedFile} for the id badge`);
      } else {
        if (fallbackRow.iconText !== String(fallbackItem.id))
          errors.push(`modal fallback: badge text ${JSON.stringify(fallbackRow.iconText)}, want the item id`);
        const fbStyle = await page.evaluate((id) => {
          const fb = document.querySelector(
            `#eventShopModalList .eshop-item[data-item-id="${id}"] .eshop-item-icon-fallback`,
          );
          if (!fb) return null;
          const cs = getComputedStyle(fb);
          return { bg: cs.backgroundColor, borderStyle: cs.borderStyle, w: fb.offsetWidth, h: fb.offsetHeight };
        }, String(fallbackItem.id));
        if (!fbStyle) errors.push("modal fallback: .eshop-item-icon-fallback node vanished before the style read");
        else {
          if (fbStyle.bg !== "rgba(0, 0, 0, 0)")
            errors.push(
              `modal fallback: badge background ${JSON.stringify(fbStyle.bg)}, want transparent rgba(0,0,0,0)`,
            );
          if (fbStyle.borderStyle !== "dashed")
            errors.push(`modal fallback: badge border-style ${JSON.stringify(fbStyle.borderStyle)}, want dashed`);
          if (!(fbStyle.w >= 40 && fbStyle.h >= 40))
            errors.push(`modal fallback: badge collapsed to ${fbStyle.w}×${fbStyle.h}px`);
        }
        /* the sibling rows still show real, decoded art */
        let survivor = null;
        for (let i = 0; i < 30 && !survivor; i++) {
          survivor = (await readModal()).rows.find(
            (r) => r.id !== String(fallbackItem.id) && r.iconKind === "img" && r.iconW > 0,
          );
          if (!survivor) await wait(100);
        }
        if (!survivor) errors.push("modal fallback: refusing one icon broke the sibling draft rows' art");
      }
      page.off("request", onRequest);
      await page.setRequestInterception(false);
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: false }).catch(() => {});
      await cdp.detach().catch(() => {});
      await closeBy("Cancel", "close after fallback scene");
      /* the aborted URL may now be poison in the memory cache — reload to a clean page state */
      await page.reload({ waitUntil: "networkidle0" });
      await ensureEventTab();
      await wait(SETTLE_MS);
    }

    /* ================= 17. viewports: no sideways overflow, modal fits, no page errors ======== */
    for (const width of [360, 1120]) {
      await page.setViewport({ width, height: 800 });
      const layout = await page.evaluate(() => {
        const doc = document.documentElement;
        const panel = document.getElementById("panel-event");
        const overflowing = [];
        for (const el of panel.querySelectorAll(
          "input, select, button, img, .material-icon, .mini-icon, .material-input-box",
        )) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.right > window.innerWidth + 1 || r.left < -1)
            overflowing.push({ cls: el.className || el.tagName, left: Math.round(r.left), right: Math.round(r.right) });
        }
        return {
          docOverflow: doc.scrollWidth - doc.clientWidth,
          bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
          overflowing: overflowing.slice(0, 4),
        };
      });
      if (layout.docOverflow > 0)
        errors.push(`viewport ${width}px: the page scrolls sideways by ${layout.docOverflow}px`);
      if (layout.bodyOverflow > 0) errors.push(`viewport ${width}px: body overflows by ${layout.bodyOverflow}px`);
      if (layout.overflowing.length)
        errors.push(
          `viewport ${width}px: Event-tab elements past the viewport edge — ${JSON.stringify(layout.overflowing)}`,
        );

      /* modal at this viewport: inside the frame, list scrolls, footer reachable, wheel over the
         content does not move the page (house scroll lock), backdrop gesture closes as a discard */
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
      if (yBefore !== yAfter)
        errors.push(
          `viewport ${width}px modal: wheel over the backdrop scrolled the page behind it ${yBefore} → ${yAfter}`,
        );
      await closeBy("Cancel", `close modal at ${width}px`);
      console.log(
        `NOTE: viewport ${width}px — doc overflow ${layout.docOverflow}px; modal list rows ${modalLayout.rows}, content ${modalLayout.content.r - modalLayout.content.l}px wide inside ${modalLayout.innerW}px`,
      );
    }
    await page.setViewport({ width: 1120, height: 900 });

    /* ================= 18. the untouched tier/run calculator must still be alive ============== */
    const neighbours = await page.evaluate(() => ({
      calculateBtn: !!document.getElementById("calculateBtn"),
      questRows: document.querySelectorAll("#questGrid > *").length,
    }));
    if (!neighbours.calculateBtn)
      errors.push("regression: #calculateBtn (tier/run calculator) is gone from the Event tab");
    if (neighbours.questRows === 0)
      errors.push(
        `regression: #questGrid has ${neighbours.questRows} children — the calculator broke next to the modal`,
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

    /* ================= 19. network hygiene ==================================================== */
    const badResponses = shopResponses.filter((r) => r.status >= 400);
    if (badResponses.length)
      errors.push(
        `shop icons: ${badResponses.length} /event_shop/ response(s) >= 400 — ${JSON.stringify(badResponses.slice(0, 3))}`,
      );
    const versioned = shopResponses.every((r) => /[?&]v=\d+/.test(r.url));
    if (shopResponses.length && !versioned)
      errors.push(`shop icons: ${shopResponses.length} request(s) fetched, some without the ?v= cache buster`);
    if (externalHosts.size)
      errors.push(
        `planner security: runtime fetched ${JSON.stringify([...externalHosts])} — the site must ship zero external resources`,
      );
    console.log(
      `NOTE: ${shopResponses.length} /event_shop/ response(s) seen, all 2xx=${badResponses.length === 0}, external origins ${JSON.stringify([...externalHosts])}`,
    );

    /* the fallback scene deliberately aborts icon loads: the browser logs one
       "Failed to load resource" per abort — tolerate EXACTLY that many of that one message;
       anything else stays red. */
    const knownAbortNoise = "Failed to load resource: net::ERR_FAILED";
    const realConsoleErrors = consoleErrors().filter((text, i, all) => {
      const budget = abortedLoads;
      const isNoise = text === knownAbortNoise && all.slice(0, i).filter((t) => t === knownAbortNoise).length < budget;
      return !isNoise;
    });
    if (realConsoleErrors.length)
      errors.push(
        `console: ${realConsoleErrors.length} error message(s) — ${JSON.stringify(realConsoleErrors.slice(0, 3))}`,
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
  `SUCCESS: event shop ${LEGACY ? "legacy stub fallback" : "Amendment B modal-only surface + tier parity"} verified against ${url}`,
);
