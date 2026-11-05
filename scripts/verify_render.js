#!/usr/bin/env node
/**
 * scripts/verify_render.js
 *
 * Renders the PRODUCTION build in a real browser and asserts the parts a static
 * check cannot see: the lazy tab modules actually load, the Bond Gain CE worker
 * actually computes, the critical CSS actually applies, the stale-version poller
 * is still in the page, and the saved sub-tab is correct from the first painted
 * frame (not merely after the module wakes up).
 *
 * Run it against `astro preview` only:
 *   npm run build
 *   npx astro preview
 *   node scripts/verify_render.js
 *
 * WARNING: the HMR dev server is not a valid target. It creates duplicate module
 * instances, so what it renders is not what ships (see the verify-fgo-ui skill).
 * Anything other than the preview build can pass here while the deployed site is
 * broken.
 *
 * Exits 1 with one `[ERROR] <check>` line per failed check.
 */

import puppeteer from "puppeteer";

const url = process.argv[2] || "http://localhost:3000/fgo-calculator/";
const errors = [];

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // Wrap Worker before any app code runs, so the CE match results are visible
  // from outside the module that created it.
  await page.evaluateOnNewDocument(() => {
    const Native = self.Worker;
    self.__workerMessages = [];
    self.Worker = function (url, opts) {
      const w = new Native(url, opts);
      w.addEventListener("message", (e) => self.__workerMessages.push(e.data));
      return w;
    };
  });

  // Lazy chunks are asserted by response status, not by request: a request still
  // fires when the chunk 404s, which is precisely the failure being caught.
  // event-lazy is also preloaded while idle, so it can be fetched before the tab
  // is ever clicked — record it from page load instead of waiting on the click.
  const eventFetched = new Promise((resolve) => {
    page.on("response", (res) => {
      if (/event-lazy/.test(res.url())) resolve(res.status());
    });
    setTimeout(() => resolve("never"), 20000).unref();
  });

  await page.goto(url, { waitUntil: "networkidle0" });

  // Critical CSS must have painted — an unstyled body keeps the default transparent background.
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (bodyBg === "rgba(0, 0, 0, 0)") errors.push("body background is transparent: critical CSS did not apply");

  const hasPoller = await page.evaluate(() =>
    Array.from(document.scripts).some((s) => (s.textContent || "").includes("fgo_build_etag")),
  );
  if (!hasPoller) errors.push("no inline script contains fgo_build_etag: stale-version prompt is gone");

  // Bond tab must pull its lazy module and render its slots.
  const [bondRes] = await Promise.all([
    page.waitForResponse((r) => /bond-lazy/.test(r.url()), { timeout: 15000 }).catch(() => null),
    page.click('.tab-btn[data-tab="bond"]'),
  ]);
  let bondSlots = 0;
  try {
    await page.waitForFunction(() => document.querySelectorAll("#servantGrid > *").length > 0, { timeout: 15000 });
    bondSlots = await page.evaluate(() => document.querySelectorAll("#servantGrid > *").length);
  } catch {
    errors.push("bond tab: #servantGrid never rendered any children");
  }
  console.log(
    `NOTE: bond tab rendered ${bondSlots} grid children, bond-lazy responded ${bondRes ? bondRes.status() : "never"}`,
  );
  if (!bondRes || bondRes.status() !== 200) {
    errors.push(
      `bond tab: bond-lazy was not fetched successfully (status ${bondRes ? bondRes.status() : "no request"})`,
    );
  }

  // Event tab is lazily imported on first visit and preloaded while idle, so the
  // chunk has to actually come back: a 404 request would still be a request.
  await page.click(".tab-btn[data-tab=event]");
  const eventStatus = await eventFetched;
  const questRows = await page.evaluate(() => document.querySelectorAll("#questGrid > *").length);
  console.log(`NOTE: event tab shows ${questRows} quest-grid node(s), event-lazy responded ${eventStatus}`);
  if (eventStatus !== 200) errors.push(`event tab: event-lazy was not fetched successfully (status ${eventStatus})`);

  // Bond Gain CE tab: the worker computes, the results grid fills.
  await page.click('.tab-btn[data-tab="cefilter"]');
  let cards = 0;
  try {
    await page.waitForFunction(
      () => document.querySelectorAll("#cefilterResults > .cefilter-servant-card").length > 0,
      {
        timeout: 15000,
      },
    );
    cards = await page.evaluate(() => document.querySelectorAll("#cefilterResults > .cefilter-servant-card").length);
  } catch {
    errors.push("ce filter: #cefilterResults never filled with .cefilter-servant-card");
  }
  const workerResults = await page.evaluate(
    () => (self.__workerMessages || []).filter((d) => d && Array.isArray(d.results) && d.results.length > 0).length,
  );
  console.log(`NOTE: ${cards} Bond Gain CE card(s), ${workerResults} worker result message(s)`);
  if (workerResults === 0) errors.push("ce filter: worker sent no message carrying a non-empty results array");

  // Servant Select sub-tab: the reverse direction. The sub-tab bar sits in the top-right corner
  // of the controls card (its own right-aligned row below 760px), and both cards swap panels
  // together by data-subpanel.
  await page.click('button.cefilter-subtab-btn[data-subtab="servant"]');
  // Notes paint inside ServantSelect.render()'s double rAF, so give it a frame before reading.
  try {
    await page.waitForFunction(() => !document.getElementById("cefilterComboEmpty").hidden, { timeout: 15000 });
  } catch {
    /* falls through to the hint check below */
  }
  const panels = await page.evaluate(() => {
    const visible = (name) =>
      Array.from(document.querySelectorAll(`.cefilter-subpanel[data-subpanel="${name}"]`)).filter((p) => !p.hidden)
        .length;
    return {
      ce: visible("ce"),
      servant: visible("servant"),
      titles: Array.from(
        document.querySelectorAll("#panel-cefilter > .card .card-inner > .cefilter-subpanel:not([hidden]) .card-title"),
      ).map((t) => t.textContent.trim()),
      activeTab: document.querySelector(".cefilter-subtab-btn.active")?.dataset.subtab,
      tabStyledLikeNavbar: document.querySelector(".cefilter-subtab-btn")?.classList.contains("tab-btn"),
      hintHidden: document.getElementById("cefilterComboEmpty").hidden,
      hintText: document.getElementById("cefilterComboEmpty").textContent.trim(),
    };
  });
  if (panels.activeTab !== "servant") errors.push(`sub-tab: active button is ${panels.activeTab}, expected servant`);
  if (panels.ce !== 0) errors.push(`sub-tab: ${panels.ce} Craft Essence Select panel(s) still visible`);
  if (panels.servant !== 2) errors.push(`sub-tab: expected 2 Servant Select panels visible, saw ${panels.servant}`);
  if (!panels.tabStyledLikeNavbar) errors.push("sub-tab: buttons do not carry the navbar tab style (.tab-btn)");
  if (!panels.titles.includes("Servants") || !panels.titles.includes("Shared Craft Essences")) {
    errors.push(`sub-tab: Servant Select card titles wrong: ${JSON.stringify(panels.titles)}`);
  }
  // With nothing picked the card has to say what to do instead of sitting blank.
  if (panels.hintHidden || !panels.hintText.includes("two or more servants")) {
    errors.push(`sub-tab: no how-to line with an empty pick list (hidden=${panels.hintHidden}, "${panels.hintText}")`);
  }

  // Picking marks items and keeps the modal open, like the CE picker. 444 U-Olga Marie has
  // ascension-different traits, so she also proves the ascension prompt is bypassed here.
  const pickInModal = (servantId) =>
    page.evaluate((id) => {
      const item = Array.from(document.querySelectorAll("#servantPickerGrid .servant-picker-item")).find((el) =>
        el.querySelector("img")?.getAttribute("src")?.includes(`servants/${id}/`),
      );
      if (item) item.click();
      return item ? { found: true, selected: item.classList.contains("selected") } : { found: false, selected: false };
    }, servantId);
  const openModal = async () => {
    await page.click("#cefilterServantAddBtn");
    await page.waitForFunction(() => document.getElementById("servantModal").classList.contains("open"), {
      timeout: 15000,
    });
  };
  const closeModal = async () => {
    await page.click("#servantModalClose");
    await page.waitForFunction(() => !document.getElementById("servantModal").classList.contains("open"), {
      timeout: 15000,
    });
  };
  await openModal();
  await page.waitForFunction(() => document.getElementById("servantModal").classList.contains("open"), {
    timeout: 15000,
  });
  let solo = null;
  for (const servantId of ["001", "444"]) {
    const picked = await pickInModal(servantId);
    if (!picked.found) errors.push(`servant select: picker grid has no servant ${servantId}`);
    if (!picked.selected) errors.push(`servant select: ${servantId} picked but not marked selected`);
    if (servantId === "001") {
      // One servant has nobody to share with: the line must ask for one more, and must not name the
      // lone pick as unshared. The note is already visible from the empty-list paint, so waiting on
      // its hidden flag proves nothing — yield the two frames ServantSelect.render() paints on.
      let settled = true;
      try {
        await page.waitForFunction(
          () => document.querySelectorAll("#cefilterServantChips > .cefilter-chip").length === 1,
          { timeout: 15000 },
        );
      } catch {
        settled = false;
      }
      // ServantSelect.render() paints on a double rAF, so let the pick's frame budget run out
      // before reading the note.
      await new Promise((r) => setTimeout(r, 300));
      if (!settled) errors.push("servant select: the first pick never reached #cefilterServantChips");
      solo = await page.evaluate(() => ({
        chips: document.querySelectorAll("#cefilterServantChips > .cefilter-chip").length,
        hidden: document.getElementById("cefilterComboEmpty").hidden,
        text: document.getElementById("cefilterComboEmpty").textContent.trim(),
        unsharedHidden: document.getElementById("cefilterComboUnshared").hidden,
        unsharedText: document.getElementById("cefilterComboUnshared").textContent.trim(),
      }));
    }
    const stateAfter = await page.evaluate(() => ({
      modalOpen: document.getElementById("servantModal").classList.contains("open"),
      ascensionOpen: document.getElementById("ascensionModal").classList.contains("open"),
    }));
    if (!stateAfter.modalOpen) errors.push(`servant select: picking ${servantId} closed the modal`);
    if (stateAfter.ascensionOpen) errors.push(`servant select: picking ${servantId} opened the ascension prompt`);
  }
  await closeModal();

  if (solo?.chips === 1) {
    if (solo.hidden || !solo.text.includes("Add one more servant")) {
      errors.push(`servant select: one-pick line wrong (hidden=${solo.hidden}, "${solo.text}")`);
    }
    if (!solo.unsharedHidden) {
      errors.push(`servant select: lone pick named as unshared ("${solo.unsharedText}")`);
    }
  }

  try {
    await page.waitForFunction(
      () => document.querySelectorAll("#cefilterComboResults .cefilter-combo-card").length > 0,
      {
        timeout: 15000,
      },
    );
  } catch {
    errors.push("servant select: #cefilterComboResults never filled with .cefilter-combo-card");
  }
  const combos = await page.evaluate(() => ({
    chips: document.querySelectorAll("#cefilterServantChips > .cefilter-chip").length,
    chipHasName: !!document.querySelector("#cefilterServantChips .cefilter-chip span"),
    chipRemove: document.querySelectorAll("#cefilterServantChips .cefilter-chip-remove").length,
    cards: document.querySelectorAll("#cefilterComboResults .cefilter-combo-card").length,
    cardWidth: document.querySelector(".cefilter-combo-card")?.getBoundingClientRect().width || 0,
    onComboGrid: !!document.querySelector("#cefilterComboResults > .cefilter-combo-grid"),
    ceImages: document.querySelectorAll("#cefilterComboResults .cefilter-combo-ce-img").length,
    ceImageHeight: document.querySelector(".cefilter-combo-ce-img")?.getBoundingClientRect().height || 0,
    // No count line, no "N CE shared" caption, no CE name text: the card is portraits + badges.
    ceNames: document.querySelectorAll("#cefilterComboResults .cefilter-combo-ce-name").length,
    captions: document.querySelectorAll("#cefilterComboResults .cefilter-combo-caption").length,
    countEl: !!document.getElementById("cefilterComboCount"),
    servantBadges: document.querySelectorAll("#cefilterComboResults .cefilter-combo-servant-badge").length,
    emptyHidden: document.getElementById("cefilterComboEmpty").hidden,
    unsharedHidden: document.getElementById("cefilterComboUnshared").hidden,
  }));
  console.log(
    // These px figures are measured element sizes at the default 800x600 viewport, not viewport widths.
    `NOTE: servant select ${combos.chips} chip(s), ${combos.cards} card(s) ${Math.round(combos.cardWidth)}px wide, ${combos.ceImages} CE image(s) ${Math.round(combos.ceImageHeight)}px tall, ${combos.servantBadges} servant badge(s)`,
  );
  if (combos.chips !== 2) errors.push(`servant select: expected 2 chips, saw ${combos.chips}`);
  if (combos.cards < 1) errors.push("servant select: Mash and U-Olga Marie share 4 CEs but no card rendered");
  if (!combos.onComboGrid) errors.push("servant select: cards are not inside .cefilter-combo-grid");
  if (combos.ceImages === 0) errors.push("servant select: no CE portraits rendered in the card");
  if (combos.ceNames > 0 || combos.captions > 0 || combos.countEl) {
    errors.push(
      `servant select: card still shows text (names ${combos.ceNames}, captions ${combos.captions}, count line ${combos.countEl})`,
    );
  }
  if (Math.abs(combos.ceImageHeight - 96) > 6) {
    errors.push(`servant select: CE portrait is ${Math.round(combos.ceImageHeight)}px tall, expected 96px`);
  }
  if (combos.cardWidth < 280) {
    errors.push(
      `servant select: card is ${Math.round(combos.cardWidth)}px wide, expected ~2x the 160px CE Select card`,
    );
  }
  if (combos.servantBadges === 0)
    errors.push("servant select: no servant badges rendered (servants must be the badge row)");
  if (combos.emptyHidden === false) errors.push("servant select: empty-state note shown while cards are rendered");
  if (combos.unsharedHidden === false)
    errors.push("servant select: both servants share CEs but the unshared line showed");
  if (combos.chipHasName) errors.push("servant chip shows a visible name; the CE-side chip shape has none");
  if (combos.chipRemove !== combos.chips)
    errors.push(`servant chips: ${combos.chips} chip(s) but ${combos.chipRemove} remove button(s)`);

  // Review Focus 1: 020 Cú Chulainn (Prototype) can use no CE at all, so she must be named,
  // not silently missing. Toggling her back off must clear the note again.
  // The note repaints inside ServantSelect.render()'s double rAF and its input can come back from
  // the worker, so read it only once it has settled: against a deployed target these three reads
  // landed on the previous frame and reported both the stale name and a note that was already gone.
  const waitForUnshared = (shown) =>
    page
      .waitForFunction(
        (want) => document.getElementById("cefilterComboUnshared").hidden === !want,
        { timeout: 15000 },
        shown,
      )
      .catch(() => {});
  await openModal();
  const oddPicked = await pickInModal("020");
  await closeModal();
  await waitForUnshared(true);
  if (!oddPicked.found) errors.push("servant select: picker grid has no servant 020");
  const withOdd = await page.evaluate(() => ({
    chips: document.querySelectorAll("#cefilterServantChips > .cefilter-chip").length,
    unshared: document.getElementById("cefilterComboUnshared").hidden
      ? null
      : document.getElementById("cefilterComboUnshared").textContent,
    cards: document.querySelectorAll("#cefilterComboResults .cefilter-combo-card").length,
  }));
  if (withOdd.chips !== 3) errors.push(`servant select: expected 3 chips after adding 020, saw ${withOdd.chips}`);
  if (withOdd.unshared === null || !/Cú Chulainn \(Prototype\)/.test(withOdd.unshared)) {
    errors.push(
      `servant select: a servant matching no CE was not named as unshared (${JSON.stringify(withOdd.unshared)})`,
    );
  }
  if (withOdd.cards < 1) errors.push("servant select: the two sharing servants lost their card when a third was added");

  await openModal();
  await pickInModal("020");
  await closeModal();
  await waitForUnshared(false);
  const afterUntoggle = await page.evaluate(() => ({
    chips: document.querySelectorAll("#cefilterServantChips > .cefilter-chip").length,
    unsharedHidden: document.getElementById("cefilterComboUnshared").hidden,
    unsharedText: document.getElementById("cefilterComboUnshared").textContent,
  }));
  if (afterUntoggle.chips !== 2) errors.push(`servant select: untoggle left ${afterUntoggle.chips} chips, expected 2`);
  if (!afterUntoggle.unsharedHidden) errors.push("servant select: unshared note still shown after untoggle");
  if (afterUntoggle.unsharedText !== "")
    errors.push(`servant select: hidden unshared note kept stale text "${afterUntoggle.unsharedText}"`);

  // Clicking a CE badge hands over to Craft Essence Select with that CE selected.
  const ceName = await page.evaluate(() => document.querySelector(".cefilter-combo-ce-img")?.getAttribute("alt"));
  await page.evaluate(() => document.querySelector(".cefilter-combo-ce")?.click());
  const handoff = await page.evaluate((name) => {
    const visible = (n) =>
      Array.from(document.querySelectorAll(`.cefilter-subpanel[data-subpanel="${n}"]`)).filter((p) => !p.hidden).length;
    return {
      servantVisible: visible("servant"),
      ceVisible: visible("ce"),
      // Chips are portrait-only on both sub-tabs, so the name is carried by the image's alt.
      chips: Array.from(document.querySelectorAll("#cefilterChips .cefilter-chip img")).map((i) =>
        i.getAttribute("alt"),
      ),
      cards: document.querySelectorAll("#cefilterResults > .cefilter-servant-card").length,
      name,
    };
  }, ceName);
  if (handoff.ceVisible !== 2 || handoff.servantVisible !== 0) {
    errors.push(`CE hand-off did not switch both cards: ce=${handoff.ceVisible} servant=${handoff.servantVisible}`);
  }
  if (!handoff.chips.some((t) => t.includes(handoff.name))) {
    errors.push(`CE hand-off: ${handoff.name} not selected in Craft Essence Select (${JSON.stringify(handoff.chips)})`);
  }
  if (handoff.cards === 0) errors.push("sub-tab: Craft Essence Select lost its results after the hand-off");

  // The CE side owns the same chip shape plus Clear all, so check it where a CE is actually selected.
  const ceChips = await page.evaluate(() => ({
    count: document.querySelectorAll("#cefilterChips > .cefilter-chip").length,
    hasName: !!document.querySelector("#cefilterChips .cefilter-chip span"),
    removeLabels: Array.from(document.querySelectorAll("#cefilterChips .cefilter-chip-remove")).map((b) =>
      b.getAttribute("aria-label"),
    ),
    clearHidden: document.getElementById("cefilterClearBtn").hidden,
    clearLabel: document.getElementById("cefilterClearBtn").textContent.trim(),
  }));
  console.log(
    `NOTE: ce chips ${ceChips.count} chip(s), label "${ceChips.clearLabel}", visible name ${ceChips.hasName}`,
  );
  if (ceChips.count === 0) errors.push("ce chips: no chip after the hand-off");
  if (ceChips.hasName) errors.push("ce chip shows a visible name; chips are portrait-only on both sub-tabs");
  if (ceChips.removeLabels.length !== ceChips.count || ceChips.removeLabels.some((l) => !l)) {
    errors.push(`ce chips: remove buttons are not all labelled (${JSON.stringify(ceChips.removeLabels)})`);
  }
  if (ceChips.clearHidden) errors.push("ce clear: #cefilterClearBtn hidden while CEs are selected");
  if (ceChips.clearLabel !== `Clear all (${ceChips.count})`) {
    errors.push(`ce clear: label is "${ceChips.clearLabel}", expected "Clear all (${ceChips.count})"`);
  }

  await page.click("#cefilterClearBtn");
  try {
    await page.waitForFunction(() => document.querySelectorAll("#cefilterChips > .cefilter-chip").length === 0, {
      timeout: 15000,
    });
  } catch {
    /* falls through to the checks below */
  }
  const ceCleared = await page.evaluate(() => ({
    chips: document.querySelectorAll("#cefilterChips > .cefilter-chip").length,
    clearHidden: document.getElementById("cefilterClearBtn").hidden,
    clearLabel: document.getElementById("cefilterClearBtn").textContent.trim(),
    cards: document.querySelectorAll("#cefilterResults > .cefilter-servant-card").length,
  }));
  if (ceCleared.chips !== 0) errors.push(`ce clear: ${ceCleared.chips} chip(s) left after Clear all`);
  if (!ceCleared.clearHidden) errors.push("ce clear: button still shown with an empty selection");
  if (ceCleared.clearLabel !== "Clear all") errors.push(`ce clear: label stayed "${ceCleared.clearLabel}"`);
  if (ceCleared.cards === 0) errors.push("ce clear: the servant grid emptied instead of falling back to all servants");

  // Re-select a CE from a card badge so the reload below also proves Craft Essence Select persists.
  await page.evaluate(() => document.querySelector("#cefilterResults .cefilter-match-badge")?.click());

  // Picks survive a refresh (the sub-tab does not), and Clear all empties the list in one click.
  await page.reload({ waitUntil: "networkidle0" });
  await page.click('button.cefilter-subtab-btn[data-subtab="servant"]');
  // Rows paint inside the panel's double rAF, so wait on the cards, not the chips.
  try {
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#cefilterServantChips > .cefilter-chip").length > 0 &&
        document.querySelectorAll("#cefilterComboResults .cefilter-combo-card").length > 0,
      { timeout: 15000 },
    );
  } catch {
    /* falls through to the checks below */
  }
  const restored = await page.evaluate(() => ({
    ceChips: document.querySelectorAll("#cefilterChips > .cefilter-chip").length,
    chips: document.querySelectorAll("#cefilterServantChips > .cefilter-chip").length,
    clearHidden: document.getElementById("cefilterServantClearBtn").hidden,
    clearLabel: document.getElementById("cefilterServantClearBtn").textContent.trim(),
    cards: document.querySelectorAll("#cefilterComboResults .cefilter-combo-card").length,
    subTab: document.querySelector(".cefilter-subtab-btn.active")?.dataset.subtab,
  }));
  console.log(
    `NOTE: after reload — ${restored.ceChips} CE chip(s), ${restored.chips} servant chip(s), ` +
      `"${restored.clearLabel}", ${restored.cards} card(s)`,
  );
  if (restored.chips !== 2) errors.push(`persistence: expected 2 restored chips after reload, saw ${restored.chips}`);
  if (restored.ceChips !== 1) {
    errors.push(`persistence: expected 1 restored CE chip after reload, saw ${restored.ceChips}`);
  }
  if (restored.cards < 1) errors.push("persistence: restored picks rendered no shared-CE card");
  if (restored.subTab !== "servant") errors.push("persistence: sub-tab did not follow the explicit click");
  if (restored.clearHidden) errors.push(`clear all: button stayed hidden with ${restored.chips} picks`);
  if (!/\(\s*2\s*\)/.test(restored.clearLabel)) {
    errors.push(`clear all: label should carry the pick count, reads "${restored.clearLabel}"`);
  }

  await page.click("#cefilterServantClearBtn");
  try {
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#cefilterServantChips > .cefilter-chip").length === 0 &&
        document.querySelectorAll("#cefilterComboResults .cefilter-combo-card").length === 0,
      { timeout: 15000 },
    );
  } catch {
    /* falls through to the checks below */
  }
  const cleared = await page.evaluate(() => ({
    chips: document.querySelectorAll("#cefilterServantChips > .cefilter-chip").length,
    cards: document.querySelectorAll("#cefilterComboResults .cefilter-combo-card").length,
    clearHidden: document.getElementById("cefilterServantClearBtn").hidden,
    stored: localStorage.getItem("fgo_ce_filter_data"),
  }));
  if (cleared.chips !== 0) errors.push(`clear all: ${cleared.chips} chip(s) left after clicking`);
  if (cleared.cards !== 0) errors.push(`clear all: ${cleared.cards} card(s) left after clicking`);
  if (!cleared.clearHidden) errors.push("clear all: button still shown with an empty pick list");
  // Both sub-tabs share this key, so each write has to be read-modify-write: the servant Clear all
  // must empty servantPicks and leave the CE side's picks standing.
  let clearedStore = {};
  try {
    clearedStore = JSON.parse(cleared.stored || "{}");
  } catch {
    errors.push(`clear all: stored blob is not JSON: "${cleared.stored}"`);
  }
  if (clearedStore.servantPicks?.length !== 0) {
    errors.push(`clear all: servantPicks not emptied — stored "${cleared.stored}"`);
  }
  if (clearedStore.cePicks?.length !== 1) {
    errors.push(`clear all: the servant write clobbered cePicks — stored "${cleared.stored}"`);
  }

  // The sub-tab restore has to survive a reload and be right before any script runs: Chrome paints
  // while it parses, so panel visibility comes from CSS keyed on <html data-subtab>, which the head
  // script sets. Recording every panel at the instant it first exists catches a restore that only
  // works once the module is awake. The button highlight is the one part JS-only (the is:inline
  // script after #cefilterSubtabs, which no linter covers), so its class and aria state are checked
  // here too.
  await page.evaluateOnNewDocument(() => {
    self.__firstSight = [];
    const seen = new Set();
    new MutationObserver(() => {
      document.querySelectorAll(".cefilter-subpanel").forEach((p) => {
        if (seen.has(p)) return;
        seen.add(p);
        self.__firstSight.push({
          name: p.dataset.subpanel,
          display: getComputedStyle(p).display,
          attr: document.documentElement.getAttribute("data-subtab"),
        });
      });
    }).observe(document, { subtree: true, childList: true });
  });

  await page.evaluate(() => {
    let st = {};
    try {
      st = JSON.parse(localStorage.getItem("fgo_ce_filter_data")) || {};
    } catch {
      /* a corrupt blob is treated as empty, same as CEFilterStore.read() */
    }
    st.subTab = "servant";
    localStorage.setItem("fgo_ce_filter_data", JSON.stringify(st));
  });
  await page.reload({ waitUntil: "networkidle0" });

  const subtabRestore = await page.evaluate(() => {
    const visible = (name) =>
      Array.from(document.querySelectorAll(`.cefilter-subpanel[data-subpanel="${name}"]`)).filter(
        (p) => getComputedStyle(p).display !== "none",
      ).length;
    return {
      firstSight: self.__firstSight,
      attr: document.documentElement.dataset.subtab,
      ce: visible("ce"),
      servant: visible("servant"),
      buttons: Array.from(document.querySelectorAll(".cefilter-subtab-btn")).map((b) => ({
        subtab: b.dataset.subtab,
        active: b.classList.contains("active"),
        pressed: b.getAttribute("aria-pressed"),
      })),
    };
  });
  if (subtabRestore.firstSight.length !== 4) {
    errors.push(`sub-tab restore: recorded ${subtabRestore.firstSight.length} panel(s) at first sight, expected 4`);
  }
  const wrongPaint = subtabRestore.firstSight.filter(
    (f) => (f.name === "ce") !== (f.display === "none") || f.attr !== "servant",
  );
  if (wrongPaint.length) {
    errors.push(`sub-tab restore: CSS was wrong while the page was still parsing: ${JSON.stringify(wrongPaint)}`);
  }
  if (subtabRestore.attr !== "servant") {
    errors.push(`sub-tab restore: <html data-subtab> is "${subtabRestore.attr}" after load`);
  }
  if (subtabRestore.ce !== 0 || subtabRestore.servant !== 2) {
    errors.push(
      `sub-tab restore: after reload ce=${subtabRestore.ce} servant=${subtabRestore.servant} visible, want 0/2`,
    );
  }
  const activeBtns = subtabRestore.buttons.filter((b) => b.active).map((b) => b.subtab);
  if (activeBtns.join() !== "servant") {
    errors.push(`sub-tab restore: active button(s) ${JSON.stringify(activeBtns)}, want servant`);
  }
  for (const b of subtabRestore.buttons) {
    if (b.pressed !== String(b.active)) {
      errors.push(`sub-tab restore: ${b.subtab} button aria-pressed=${b.pressed} but class says ${b.active}`);
    }
  }
  console.log(
    `NOTE: sub-tab restored — <html data-subtab>="${subtabRestore.attr}", ` +
      `${subtabRestore.firstSight.filter((f) => f.display === "none").length}/${subtabRestore.firstSight.length}` +
      ` panel(s) already hidden the moment they were parsed, buttons ` +
      JSON.stringify(subtabRestore.buttons),
  );

  // The bond slot's point-box label sits inside a 160px card, where the earlier longer
  // labels collided. It only exists once a slot holds a servant, so fill one, then assert
  // the shipped text and that nothing clips or overflows at each layout tier.
  await page.click('.tab-btn[data-tab="bond"]');
  await page.waitForSelector(".servant-add-slot");
  await page.click(".servant-add-slot");
  await page.waitForSelector("#servantModal.open .servant-picker-item");
  await page.click("#servantModal .servant-picker-item");
  await page.waitForFunction(() => document.querySelectorAll(".bond-input-box-label").length > 0, { timeout: 15000 });
  for (const width of [320, 800, 1120]) {
    await page.setViewport({ width, height: 800 });
    const m = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll(".bond-input-box-label"));
      const grid = document.querySelector("#servantGrid");
      return {
        texts: [...new Set(labels.map((l) => l.textContent))],
        clipped: labels.filter((l) => l.scrollWidth > l.clientWidth + 1).length,
        gridOverflow: grid.scrollWidth - grid.clientWidth,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    if (!m.texts.includes("Next Lv. Required")) {
      errors.push(`bond slot @${width}px: labels ${JSON.stringify(m.texts)}, want "Next Lv. Required"`);
    }
    if (m.clipped) errors.push(`bond slot @${width}px: ${m.clipped} label(s) clipped`);
    if (m.docOverflow > 0) errors.push(`bond slot @${width}px: page scrolls sideways by ${m.docOverflow}px`);
    console.log(
      `NOTE: bond slot @${width}px — ${m.texts.join(" / ")} — ${m.clipped} clipped, ` +
        `grid +${m.gridOverflow}px, doc +${m.docOverflow}px`,
    );
  }
  await page.setViewport({ width: 800, height: 600 });

  /* The essences belong to the card: a bordered Craft Essence block under the point box, holding one
     64px portrait chip (two when Grand Servant is ticked) and none of the old name/bonus lines, while
     the separate Craft Essences Bonus card is gone. A blank card carries no block at all. */
  const chipState = () =>
    page.evaluate(() => {
      const block = document.querySelector(".servant-slot .slot-ce-block");
      const chips = block ? [...block.querySelectorAll(".ce-chip")] : [];
      return {
        present: !!block,
        chips: chips.length,
        addTiles: chips.filter((c) => c.classList.contains("ce-chip--add")).length,
        removeBtns: chips.filter((c) => c.querySelector(".ce-chip-x")).length,
        /* What each chip shows, so the survivor of an untick can be recognised: an equipped essence
           carries its name (alt) or its id (fallback text), a blank position carries nothing. */
        keys: chips.map((c) => {
          const img = c.querySelector("img");
          const fb = c.querySelector(".ce-chip-fallback");
          return img ? img.alt : fb ? fb.textContent : "";
        }),
        chipH: chips.length ? Math.round(chips[0].getBoundingClientRect().height) : 0,
      };
    });

  const ce = await page.evaluate(() => {
    const card = document.querySelector(".servant-slot:not(.servant-add-slot)");
    const block = card && card.querySelector(".slot-ce-block");
    const pointBox = card && card.querySelector(".bond-input-box");
    const chips = block ? block.querySelectorAll(".ce-chip").length : 0;
    return {
      grid: !!document.getElementById("ceGrid"),
      inCard: !!block,
      afterPointBox:
        !!block && !!pointBox && Boolean(block.compareDocumentPosition(pointBox) & Node.DOCUMENT_POSITION_PRECEDING),
      chipH: chips ? Math.round(block.querySelector(".ce-chip").getBoundingClientRect().height) : 0,
      chips,
      names: block ? block.querySelectorAll(".ce-slot-name, .ce-slot-bonus").length : -1,
      labels: block
        ? [...block.querySelectorAll(".bond-input-box-label, .bond-checkbox-label")].map((l) => l.textContent)
        : [],
      blankBlocks: document.querySelectorAll(".servant-add-slot .slot-ce-block").length,
    };
  });
  if (ce.grid) errors.push("bond slot CEs: #ceGrid is still in the page — the Craft Essences Bonus card must be gone");
  if (!ce.inCard) errors.push("bond slot CEs: no .slot-ce-block inside the servant slot");
  if (!ce.afterPointBox) errors.push("bond slot CEs: the essence block does not sit after the point box");
  if (ce.chipH !== 64) errors.push(`bond slot CEs: chip measures ${ce.chipH}px tall, want 64px`);
  if (ce.chips !== 1) errors.push(`bond slot CEs: a normal slot shows ${ce.chips} chip(s), want 1`);
  if (ce.names !== 0) errors.push(`bond slot CEs: ${ce.names} name/bonus element(s) inside the block, want 0`);
  if (!ce.labels.includes("Craft Essence")) {
    errors.push(`bond slot CEs: block labels ${JSON.stringify(ce.labels)}, want a "Craft Essence" label`);
  }
  if (!ce.labels.includes("Grand Servant")) {
    errors.push(`bond slot CEs: block labels ${JSON.stringify(ce.labels)}, want a "Grand Servant" checkbox`);
  }
  if (ce.blankBlocks !== 0) errors.push(`bond slot CEs: ${ce.blankBlocks} essence block(s) on an empty slot, want 0`);

  // Equip through the picker, which the card now owns: one filled chip, still removable.
  await page.click(".servant-slot .slot-ce-block .ce-chip--add");
  await page.waitForSelector("#ceModal.open .servant-picker-item");
  await page.click("#ceModal .servant-picker-item");
  const groupPick = await page.evaluate(() => !!document.querySelector("#ceSubModal.open"));
  if (groupPick) await page.click("#ceSubModal .servant-picker-item");
  await page.waitForFunction(() => document.querySelectorAll(".servant-slot .slot-ce-block .ce-chip-x").length === 1, {
    timeout: 15000,
  });
  const equipped = await chipState();
  if (equipped.chips !== 1 || equipped.addTiles !== 0) {
    errors.push(
      `bond slot CEs: after equipping, ${equipped.chips} chip(s) / ${equipped.addTiles} blank tile(s), want 1 filled`,
    );
  }
  if (!equipped.keys[0]) errors.push("bond slot CEs: the equipped chip shows no portrait");

  // Grand raises the capacity to two; unticking drops the second and keeps the first.
  await page.click(".servant-slot .slot-ce-block .bond-checkbox");
  await page.waitForFunction(() => document.querySelectorAll(".servant-slot .slot-ce-block .ce-chip").length === 2, {
    timeout: 15000,
  });
  const grand = await chipState();
  if (grand.chips !== 2 || grand.addTiles !== 1 || grand.keys[0] !== equipped.keys[0]) {
    errors.push(
      `bond slot CEs: ticking Grand gave ${grand.chips} chip(s) (${grand.addTiles} blank), first=${JSON.stringify(grand.keys[0])}`,
    );
  }
  await page.click(".servant-slot .slot-ce-block .bond-checkbox");
  await page.waitForFunction(() => document.querySelectorAll(".servant-slot .slot-ce-block .ce-chip").length === 1, {
    timeout: 15000,
  });
  const trimmed = await chipState();
  if (trimmed.chips !== 1 || trimmed.keys[0] !== equipped.keys[0]) {
    errors.push(
      `bond slot CEs: unticking Grand left ${trimmed.chips} chip(s) first=${JSON.stringify(trimmed.keys[0])}`,
    );
  }

  // And the card's own remove button empties it again.
  await page.click(".servant-slot .slot-ce-block .ce-chip-x");
  await page.waitForFunction(() => document.querySelectorAll(".servant-slot .slot-ce-block .ce-chip-x").length === 0, {
    timeout: 15000,
  });
  const removed = await chipState();
  if (removed.chips !== 1 || removed.addTiles !== 1) {
    errors.push(
      `bond slot CEs: removing the essence left ${removed.chips} chip(s) / ${removed.addTiles} blank tile(s), want 1 blank`,
    );
  }

  /* Support and Max Bond cards must stop reserving the height of the fields they hide: those elements
     leave the layout entirely, the essence block stays the card's last element, and switching back to
     Normal brings the player's own figures with it. The tick row is read as a direct child of the info
     column so the Grand Servant row inside the essence block cannot be mistaken for it. */
  const slotInfo = (index) =>
    page.evaluate((i) => {
      const slot = document.querySelector(`.servant-slot[data-slot-index="${i}"]`);
      const info = slot && slot.querySelector(".servant-slot-info");
      const block = info && info.querySelector(".slot-ce-block");
      const box = info.querySelector(":scope > .bond-input-box input");
      return {
        collapsed: !!block && block === info.lastElementChild,
        chips: block ? block.querySelectorAll(".ce-chip").length : 0,
        levelRow: !!info.querySelector(":scope > .bond-level-row"),
        pointBox: !!info.querySelector(":scope > .bond-input-box"),
        tickRow: !!info.querySelector(":scope > .bond-checkbox-row"),
        points: box ? box.value : "",
        height: Math.round(slot.getBoundingClientRect().height),
      };
    }, index);

  const TICK_ROW = '.servant-slot[data-slot-index="0"] .servant-slot-info > .bond-checkbox-row .bond-checkbox';

  // Max Bond keeps its tick row (the tick has to stay undoable) and loses the level selects and the box.
  // Every handler rebuilds the cards synchronously, so there is nothing to wait for after a click.
  const normal = await slotInfo(0);
  await page.click(TICK_ROW);
  const maxBond = await slotInfo(0);
  if (maxBond.levelRow || maxBond.pointBox) {
    errors.push(`bond slot Max Bond: level row=${maxBond.levelRow} point box=${maxBond.pointBox}, want both gone`);
  }
  if (!maxBond.tickRow) errors.push("bond slot Max Bond: the Max Bond / Bond ≥15 row disappeared — the tick is stuck");
  if (!maxBond.collapsed) errors.push("bond slot Max Bond: the essence block is no longer the card's last element");
  if (maxBond.chips !== normal.chips) errors.push(`bond slot Max Bond: ${maxBond.chips} chip(s), want ${normal.chips}`);
  if (!(maxBond.height < normal.height)) {
    errors.push(`bond slot Max Bond: card is ${maxBond.height}px, no shorter than Normal ${normal.height}px`);
  }

  await page.click(TICK_ROW);

  // Support has no tick row at all, and still wears its essences.
  await page.select("#slotType_0", "support");
  const support = await slotInfo(0);
  if (support.levelRow || support.pointBox) {
    errors.push(`bond slot Support: level row=${support.levelRow} point box=${support.pointBox}, want both gone`);
  }
  if (support.tickRow) errors.push("bond slot Support: the Max Bond / Bond ≥15 row is still reserved");
  if (!support.collapsed) errors.push("bond slot Support: the essence block is no longer the card's last element");
  if (support.chips !== normal.chips) {
    errors.push(
      `bond slot Support: ${support.chips} chip(s), want ${normal.chips} — collapsing fields must keep the essences`,
    );
  }
  if (!(support.height < normal.height)) {
    errors.push(`bond slot Support: card is ${support.height}px, no shorter than Normal ${normal.height}px`);
  }

  // Back to Normal: the fields come back, with the figures the player had.
  await page.select("#slotType_0", "normal");
  const backToNormal = await slotInfo(0);
  if (!backToNormal.levelRow || !backToNormal.pointBox || !backToNormal.tickRow) {
    errors.push(
      `bond slot back to Normal: level row=${backToNormal.levelRow} point box=${backToNormal.pointBox} tick row=${backToNormal.tickRow}`,
    );
  }
  console.log(
    `NOTE: bond slot card height — Normal ${normal.height}px, Max Bond ${maxBond.height}px, ` +
      `Support ${support.height}px, back to Normal ${backToNormal.height}px (${backToNormal.points} pts in the box)`,
  );
  if (backToNormal.points !== normal.points) {
    errors.push(
      `bond slot back to Normal: point box shows ${JSON.stringify(backToNormal.points)}, was ${JSON.stringify(normal.points)}`,
    );
  }

  /* The Bond tab reads quest first, then the party it is spent on, and the calculate button belongs to
     the party card — bottom right of it, not a full-width bar across the page. The Event Shop button is
     measured too, because it shares .calculate-btn and must keep stretching. */
  const order = await page.evaluate(() => {
    const quest = document.getElementById("bondQuestSelect").closest(".card");
    const party = document.getElementById("servantGrid").closest(".card");
    const btn = document.getElementById("bondCalculateBtn");
    const partyInner = party.querySelector(".card-inner");
    return {
      questFirst: Boolean(quest.compareDocumentPosition(party) & Node.DOCUMENT_POSITION_FOLLOWING),
      inPartyCard: partyInner.contains(btn),
      label: btn.textContent.trim(),
      ratio: btn.getBoundingClientRect().width / btn.parentElement.clientWidth,
    };
  });
  if (!order.questFirst) errors.push("bond order: the Select Quest card does not come before the Party Setup card");
  if (!order.inPartyCard) errors.push("bond order: #bondCalculateBtn is not inside the Party Setup card");
  if (order.label !== "Calculate Quest Runs") {
    errors.push(`bond order: the button reads ${JSON.stringify(order.label)}, want "Calculate Quest Runs"`);
  }
  if (!(order.ratio > 0 && order.ratio <= 0.5)) {
    errors.push(`bond order: the button spans ${(order.ratio * 100).toFixed(0)}% of its row, want at most half`);
  }

  await page.click('.tab-btn[data-tab="event"]');
  const eventRatio = await page.evaluate(() => {
    const btn = document.getElementById("calculateBtn");
    return btn.getBoundingClientRect().width / btn.parentElement.clientWidth;
  });
  await page.click('.tab-btn[data-tab="bond"]');
  if (!(eventRatio > 0.9)) {
    errors.push(`event tab: #calculateBtn spans ${(eventRatio * 100).toFixed(0)}% of its row, want full width`);
  }
  console.log(
    `NOTE: bond tab order — quest card first, button ${JSON.stringify(order.label)} at ` +
      `${(order.ratio * 100).toFixed(0)}% of the party card; event button ${(eventRatio * 100).toFixed(0)}%`,
  );

  /* An essence worn by a borrowed support servant pays that CE's friend-side rate: 0910 Chaldea Teatime
     gives +5% when your own servant wears it and +15% when you borrow a servant wearing it. The state is
     seeded the way a returning player's save arrives (loadState() -> buildServantSlots), so a stripped
     `supportBonus` field in CEList, a pool that forgets whose servant wears the essence, or a label that
     stops reading SlotCEs.rate all fail here — the picker path above never equips a Support slot. */
  await page.evaluate(() =>
    localStorage.setItem(
      "fgo_bond_calculator_data",
      JSON.stringify({
        slots: [
          { servantId: "001", bondNeeded: 5000, type: "normal", bondLevel: 0, targetLevel: 1, ces: ["0910"] },
          { servantId: "002", type: "support", ces: ["0910"] },
        ],
        selectedQuest: "custom",
        customBond: 1000,
      }),
    ),
  );
  await page.reload({ waitUntil: "networkidle0" });
  await page.click('.tab-btn[data-tab="bond"]');
  try {
    await page.waitForFunction(
      () => document.querySelectorAll(".servant-slot .slot-ce-block .ce-chip-x").length === 2,
      { timeout: 15000 },
    );
  } catch {
    errors.push("support CE rate: neither slot restored its 0910 essence after reload");
  }
  await page.click("#bondCalculateBtn");
  await page.waitForSelector("#bondResultContent .bond-result-servant-card", { timeout: 15000 });
  const split = await page.evaluate(() => {
    const chips = [...document.querySelectorAll(".servant-slot .slot-ce-block .ce-chip")].map((c) => c.title);
    const badges = Array.from(document.querySelectorAll("#bondResultContent .bond-result-ce-img"))
      .map((i) => i.getAttribute("title"))
      .filter((t) => t && t.includes("Teatime"));
    const info = document.querySelector("#bondResultContent .bond-result-bond-info");
    return { chips, badges, bonus: info ? (info.textContent.match(/\(\+([\d,]+)\)/) || [])[1] : null };
  });
  const chipWants = ["Chaldea Teatime · +5% All", "Chaldea Teatime · +15% All"];
  if (JSON.stringify(split.chips.slice(0, 2)) !== JSON.stringify(chipWants)) {
    errors.push(
      `support CE rate: slot chips read ${JSON.stringify(split.chips.slice(0, 2))}, want ${JSON.stringify(chipWants)}`,
    );
  }
  if (JSON.stringify([...split.badges].sort()) !== JSON.stringify(["Chaldea Teatime +15%", "Chaldea Teatime +5%"])) {
    errors.push(
      `support CE rate: the result card shows ${JSON.stringify(split.badges)}, want one +5% and one +15% badge`,
    );
  }
  // 5%+15% = 200 of the 1,000-point base, x1.24 frontline (one borrowed support in the first three),
  // +200 frontline flat and +40 for that support's +4%. Both essences boost the one calculated servant.
  const wantBonus = Math.floor(200 * 1.24) + 200 + 40;
  const gotBonus = Number((split.bonus || "").replace(/,/g, ""));
  if (gotBonus !== wantBonus) {
    errors.push(
      `support CE rate: bond bonus is ${split.bonus} per run, want ${wantBonus} ` +
        "(both essences paid self rate, both paid friend rate, or one was dropped)",
    );
  }
  console.log(
    `NOTE: support CE rate — chips ${JSON.stringify(split.chips.slice(0, 2))}, badges ${JSON.stringify(split.badges)}, ` +
      `bonus +${split.bonus}/run`,
  );

  /* Stargazer's Teapot doubles what a run pays while the party still holds one, and the plan splits
     where the stock runs out: the boosted stretch, a centred "Out of Stargazer's Teapot" chip, then
     the ordinary rate for what is left — and both stretches name their own bond levels. Slot 0 is Mash
     on a 1,000-point quest: 1,200 bond a run ordinary, 2,400 on a teapot run, 2,500 typed at Lv.0,
     Lv.3 wanted. One teapot pays a single boosted run and leaves two ordinary ones behind it. */
  await page.evaluate(() =>
    localStorage.setItem(
      "fgo_bond_calculator_data",
      JSON.stringify({
        slots: [{ servantId: "001", bondNeeded: 2500, type: "normal", bondLevel: 0, targetLevel: 3, ces: [] }],
        selectedQuest: "custom",
        customBond: 1000,
      }),
    ),
  );
  await page.reload({ waitUntil: "networkidle0" });
  await page.click('.tab-btn[data-tab="bond"]');
  await page.waitForFunction(() => Boolean(document.getElementById("slotBond_0")), { timeout: 15000 });

  /* The teapot controls belong beside the button that spends them, not parked on the far side of the
     row: one line, and only the flex gap between them. */
  const teapotPlace = await page.evaluate(() => {
    const t = document.querySelector(".bond-teapot").getBoundingClientRect();
    const b = document.getElementById("bondCalculateBtn").getBoundingClientRect();
    return { gap: Math.round(b.left - t.right), sameLine: Math.abs(b.top - t.top) < 8 };
  });
  if (!teapotPlace.sameLine || teapotPlace.gap > 16) {
    errors.push(`teapot: the settings are not beside #bondCalculateBtn (${JSON.stringify(teapotPlace)})`);
  }

  const readTeapot = () =>
    page.evaluate(() => {
      const grid = (el) => {
        if (!el) return null;
        const card = el.querySelector(".bond-result-servant-card");
        if (!card) return null;
        return {
          info: card.querySelector(".bond-result-bond-info").textContent,
          runs: card.querySelector(".bond-result-runs").textContent,
          teapot: [...card.querySelectorAll(".bond-result-ce-img")].some((i) => (i.alt || "").includes("Teapot")),
          levels: [...card.querySelectorAll(".bond-result-level-label")].map((l) => l.textContent),
          levelRuns: [...card.querySelectorAll(".bond-result-level-runs")].map((r) => r.textContent),
        };
      };
      const grids = [...document.querySelectorAll("#bondResultContent .bond-result-servant-grid")];
      const btn = document.querySelector(".bond-teapot-remove");
      const chipImg = btn ? btn.querySelector("img") : null;
      return {
        grids: grids.length,
        boosted: grid(grids[0]),
        plain: grid(grids[1]),
        exhaust: btn
          ? {
              label: btn.textContent.trim(),
              img: Boolean(chipImg),
              imgH: chipImg ? Math.round(chipImg.getBoundingClientRect().height) : 0,
            }
          : null,
      };
    });
  const setTeapotCount = (n) =>
    page.evaluate((value) => {
      const box = document.getElementById("teapotCountInput");
      box.value = String(value);
      box.dispatchEvent(new Event("change"));
    }, n);

  await setTeapotCount(1);
  await page.click("#teapotToggle");
  if (!(await page.evaluate(() => document.getElementById("teapotToggle").checked))) {
    errors.push("teapot: clicking the switch did not leave #teapotToggle checked");
  }
  await page.click("#bondCalculateBtn");
  await page.waitForSelector("#bondResultContent .bond-result-servant-card", { timeout: 15000 });
  const teapotSplit = await readTeapot();
  if (teapotSplit.grids !== 2) {
    errors.push(
      `teapot: ${teapotSplit.grids} result grid(s) with 1 teapot held, want the boosted plan and the continuation`,
    );
  }
  if (!teapotSplit.exhaust || teapotSplit.exhaust.label !== "Out of Stargazer's Teapot" || !teapotSplit.exhaust.img) {
    errors.push(
      `teapot: the stock ran out and no centred "Out of Stargazer's Teapot" + image was drawn (${JSON.stringify(teapotSplit.exhaust)})`,
    );
  }
  if (teapotSplit.exhaust && teapotSplit.exhaust.imgH !== 48) {
    errors.push(
      `teapot: the "Out of" chip draws its teapot ${teapotSplit.exhaust.imgH}px tall, want 48px (--ce-badge-h)`,
    );
  }
  // The one teapot buys one 2,400-point run, which does not clear Lv.0->1 — so it names no level at all.
  if (
    !teapotSplit.boosted ||
    teapotSplit.boosted.info !== "1,000(+1,400)" ||
    teapotSplit.boosted.runs !== "1 run" ||
    !teapotSplit.boosted.teapot ||
    teapotSplit.boosted.levels.length !== 0
  ) {
    errors.push(
      `teapot: the boosted block reads ${JSON.stringify(teapotSplit.boosted)}, want "1,000(+1,400)", "1 run", ` +
        `teapot badge and NO level row (the run cleared no level)`,
    );
  }
  // The continuation keeps the bond levels the teapots never got through, and their own run counts.
  if (
    !teapotSplit.plain ||
    teapotSplit.plain.info !== "1,000(+200)" ||
    teapotSplit.plain.runs !== "2 runs" ||
    teapotSplit.plain.teapot ||
    JSON.stringify(teapotSplit.plain.levels) !== JSON.stringify(["Bond Lv.0->2", "Bond Lv.2->3"]) ||
    JSON.stringify(teapotSplit.plain.levelRuns) !== JSON.stringify(["1 run", "1 run"])
  ) {
    errors.push(
      `teapot: the continuation reads ${JSON.stringify(teapotSplit.plain)}, want "1,000(+200)" / "2 runs" ` +
        `with Lv.0->2 (1 run) and Lv.2->3 (1 run)`,
    );
  }

  await page.click(".bond-teapot-remove");
  const teapotRemoved = await readTeapot();
  const afterRemove = await page.evaluate(() => ({
    checked: document.getElementById("teapotToggle").checked,
    saved: JSON.parse(localStorage.getItem("fgo_bond_calculator_data")).teapotOn,
  }));
  if (afterRemove.checked || afterRemove.saved) {
    errors.push(`teapot: Remove left the switch on (dom ${afterRemove.checked}, saved ${afterRemove.saved})`);
  }
  if (
    teapotRemoved.grids !== 1 ||
    teapotRemoved.exhaust ||
    !teapotRemoved.boosted ||
    teapotRemoved.boosted.info !== "1,000(+200)" ||
    teapotRemoved.boosted.runs !== "4 runs" ||
    teapotRemoved.boosted.teapot ||
    JSON.stringify(teapotRemoved.boosted.levels) !== JSON.stringify(["Bond Lv.0->2", "Bond Lv.2->3"])
  ) {
    errors.push(
      `teapot: after Remove it drew ${JSON.stringify(teapotRemoved)}, want one plain grid "1,000(+200)" / "4 runs" ` +
        `over Lv.0->2 and Lv.2->3`,
    );
  }

  /* Turning the teapot on must NOT re-price by itself: results stay as the last Calculate left them
     (the plain 4-run plan above) until the button is pressed. */
  await setTeapotCount(99);
  await page.click("#teapotToggle");
  const idle = await readTeapot();
  if (idle.boosted && idle.boosted.info === "1,000(+1,400)") {
    errors.push("teapot: flipping the switch re-priced the plan without a Calculate click");
  }

  /* A stock that reaches the end of the plan pays every run, so one boosted block, its own level
     breakdown, and no Remove row — but only once Calculate is clicked. */
  await page.click("#bondCalculateBtn");
  const enough = await readTeapot();
  if (
    enough.grids !== 1 ||
    enough.exhaust ||
    !enough.boosted ||
    enough.boosted.info !== "1,000(+1,400)" ||
    enough.boosted.runs !== "2 runs" ||
    !enough.boosted.teapot ||
    JSON.stringify(enough.boosted.levels) !== JSON.stringify(["Bond Lv.0->3"]) ||
    JSON.stringify(enough.boosted.levelRuns) !== JSON.stringify(["2 runs"])
  ) {
    errors.push(
      `teapot: with the stock covering the plan it drew ${JSON.stringify(enough)}, ` +
        `want one boosted grid "1,000(+1,400)" / "2 runs" with its Lv.0->3 row`,
    );
  }
  console.log(
    `NOTE: teapot — 1 held: ${JSON.stringify(teapotSplit.boosted)} then ${JSON.stringify(teapotSplit.plain)}, ` +
      `chip ${JSON.stringify(teapotSplit.exhaust)}; after the chip click: ${JSON.stringify(teapotRemoved.boosted)}; ` +
      `99 held: ${JSON.stringify(enough.boosted)}`,
  );

  if (pageErrors.length) for (const e of pageErrors) errors.push(`pageerror: ${e}`);
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(`\nFAILED with ${errors.length} error(s):`);
  for (const e of errors) console.error(`  [ERROR] ${e}`);
  process.exit(1);
}

console.log("SUCCESS: rendered UI verified");
