#!/usr/bin/env node
/**
 * scripts/verify_render.js
 *
 * Renders the PRODUCTION build in a real browser and asserts the parts a static
 * check cannot see: the lazy tab modules actually load, the CE Filter worker
 * actually computes, the critical CSS actually applies, and the stale-version
 * poller is still in the page.
 *
 * Run it against `astro preview` only:
 *   npm run build
 *   npx astro preview --port 4173 &
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

const url = process.argv[2] || "http://localhost:4173/fgo-calculator/";
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

  // CE Filter tab: the worker computes, the results grid fills.
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
  console.log(`NOTE: ${cards} CE filter card(s), ${workerResults} worker result message(s)`);
  if (workerResults === 0) errors.push("ce filter: worker sent no message carrying a non-empty results array");

  // Servant Select sub-tab: the reverse direction. The sub-tab bar sits inside the controls
  // card above its title, and both cards swap panels together by data-subpanel.
  await page.click('button.cefilter-subtab-btn[data-subtab="servant"]');
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
    };
  });
  if (panels.activeTab !== "servant") errors.push(`sub-tab: active button is ${panels.activeTab}, expected servant`);
  if (panels.ce !== 0) errors.push(`sub-tab: ${panels.ce} Craft Essence Select panel(s) still visible`);
  if (panels.servant !== 2) errors.push(`sub-tab: expected 2 Servant Select panels visible, saw ${panels.servant}`);
  if (!panels.tabStyledLikeNavbar) errors.push("sub-tab: buttons do not carry the navbar tab style (.tab-btn)");
  if (!panels.titles.includes("Servants") || !panels.titles.includes("Shared Craft Essences")) {
    errors.push(`sub-tab: Servant Select card titles wrong: ${JSON.stringify(panels.titles)}`);
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
  for (const servantId of ["001", "444"]) {
    const picked = await pickInModal(servantId);
    if (!picked.found) errors.push(`servant select: picker grid has no servant ${servantId}`);
    if (!picked.selected) errors.push(`servant select: ${servantId} picked but not marked selected`);
    const stateAfter = await page.evaluate(() => ({
      modalOpen: document.getElementById("servantModal").classList.contains("open"),
      ascensionOpen: document.getElementById("ascensionModal").classList.contains("open"),
    }));
    if (!stateAfter.modalOpen) errors.push(`servant select: picking ${servantId} closed the modal`);
    if (stateAfter.ascensionOpen) errors.push(`servant select: picking ${servantId} opened the ascension prompt`);
  }
  await closeModal();

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
    `NOTE: servant select ${combos.chips} chip(s), ${combos.cards} card(s) at ${Math.round(combos.cardWidth)}px, ${combos.ceImages} CE image(s) at ${Math.round(combos.ceImageHeight)}px, ${combos.servantBadges} servant badge(s)`,
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
  await openModal();
  const oddPicked = await pickInModal("020");
  await closeModal();
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
      chips: Array.from(document.querySelectorAll("#cefilterChips .cefilter-chip")).map((c) => c.textContent.trim()),
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
