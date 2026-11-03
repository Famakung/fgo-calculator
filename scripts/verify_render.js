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
  console.log(`NOTE: bond tab rendered ${bondSlots} grid children, bond-lazy responded ${bondRes ? bondRes.status() : "never"}`);
  if (!bondRes || bondRes.status() !== 200) {
    errors.push(`bond tab: bond-lazy was not fetched successfully (status ${bondRes ? bondRes.status() : "no request"})`);
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
    await page.waitForFunction(() => document.querySelectorAll("#cefilterResults > .cefilter-servant-card").length > 0, {
      timeout: 15000,
    });
    cards = await page.evaluate(() => document.querySelectorAll("#cefilterResults > .cefilter-servant-card").length);
  } catch {
    errors.push("ce filter: #cefilterResults never filled with .cefilter-servant-card");
  }
  const workerResults = await page.evaluate(() =>
    (self.__workerMessages || []).filter((d) => d && Array.isArray(d.results) && d.results.length > 0).length,
  );
  console.log(`NOTE: ${cards} CE filter card(s), ${workerResults} worker result message(s)`);
  if (workerResults === 0) errors.push("ce filter: worker sent no message carrying a non-empty results array");

  // Servant Select sub-tab: the reverse direction. Switch panels, pick two servants in
  // one click each, and get at least one shared-CE row back.
  await page.click('button.cefilter-subtab-btn[data-subtab="servant"]');
  const panels = await page.evaluate(() => ({
    ceHidden: document.getElementById("cefilterSubCE").hidden,
    servantHidden: document.getElementById("cefilterSubServant").hidden,
    activeTab: document.querySelector(".cefilter-subtab-btn.active")?.dataset.subtab,
  }));
  if (panels.activeTab !== "servant") errors.push(`sub-tab: active button is ${panels.activeTab}, expected servant`);
  if (!panels.ceHidden) errors.push("sub-tab: #cefilterSubCE stayed visible after switching to Servant Select");
  if (panels.servantHidden) errors.push("sub-tab: #cefilterSubServant stayed hidden after switching to Servant Select");

  // 444 U-Olga Marie has ascension-different traits: picking her must not open the
  // ascension prompt, because this tab unions every ascension's traits anyway.
  for (const servantId of ["001", "444"]) {
    await page.click("#cefilterServantAddBtn");
    await page.waitForFunction(() => document.getElementById("servantModal").classList.contains("open"), { timeout: 15000 });
    const clicked = await page.evaluate((id) => {
      const item = Array.from(document.querySelectorAll("#servantPickerGrid .servant-picker-item")).find((el) =>
        el.querySelector("img")?.getAttribute("src")?.includes(`servants/${id}/`),
      );
      if (item) item.click();
      return Boolean(item);
    }, servantId);
    if (!clicked) errors.push(`servant select: picker grid has no servant ${servantId}`);
    await page
      .waitForFunction(() => !document.getElementById("servantModal").classList.contains("open"), { timeout: 15000 })
      .catch(() => errors.push(`servant select: picking ${servantId} left #servantModal open`));
    const ascensionOpen = await page.evaluate(() => document.getElementById("ascensionModal").classList.contains("open"));
    if (ascensionOpen) errors.push(`servant select: picking ${servantId} opened the ascension prompt`);
  }

  try {
    await page.waitForFunction(() => document.querySelectorAll("#cefilterComboResults .cefilter-combo-group").length > 0, {
      timeout: 15000,
    });
  } catch {
    errors.push("servant select: #cefilterComboResults never filled with .cefilter-combo-group");
  }
  const combos = await page.evaluate(() => ({
    chips: document.querySelectorAll("#cefilterServantChips > .cefilter-servant-chip").length,
    rows: document.querySelectorAll("#cefilterComboResults .cefilter-combo-group").length,
    sections: Array.from(document.querySelectorAll(".cefilter-combo-size")).map((h) => h.textContent),
    count: document.getElementById("cefilterComboCount").textContent,
    emptyHidden: document.getElementById("cefilterComboEmpty").hidden,
    unsharedHidden: document.getElementById("cefilterComboUnshared").hidden,
  }));
  console.log(
    `NOTE: servant select ${combos.chips} chip(s), ${combos.rows} combo row(s), sections ${JSON.stringify(combos.sections)}, count "${combos.count}"`,
  );
  if (combos.chips !== 2) errors.push(`servant select: expected 2 chips, saw ${combos.chips}`);
  if (combos.rows < 1) errors.push("servant select: Mash and U-Olga Marie share 4 CEs but no combo row rendered");
  if (combos.sections.some((s) => /0 group/.test(s))) {
    errors.push(`servant select: a CE-count section printed with no groups: ${combos.sections.join(" | ")}`);
  }
  if (combos.emptyHidden === false) errors.push("servant select: empty-state note shown while groups are rendered");
  if (combos.unsharedHidden === false) errors.push("servant select: both servants share CEs but the unshared line showed");

  // Back to Craft Essence Select: the original panel has to work again.
  await page.click('button.cefilter-subtab-btn[data-subtab="ce"]');
  const backPanels = await page.evaluate(() => ({
    ceHidden: document.getElementById("cefilterSubCE").hidden,
    servantHidden: document.getElementById("cefilterSubServant").hidden,
    cards: document.querySelectorAll("#cefilterResults > .cefilter-servant-card").length,
  }));
  if (backPanels.ceHidden || !backPanels.servantHidden) errors.push("sub-tab: switching back to Craft Essence Select did not restore the panels");
  if (backPanels.cards === 0) errors.push("sub-tab: Craft Essence Select lost its results after returning from Servant Select");

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
