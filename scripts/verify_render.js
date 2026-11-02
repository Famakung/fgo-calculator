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

  const lazyRequests = [];
  page.on("request", (req) => {
    if (/bond-lazy/.test(req.url())) lazyRequests.push(req.url());
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
  await page.click('.tab-btn[data-tab="bond"]');
  let bondSlots = 0;
  try {
    await page.waitForFunction(() => document.querySelectorAll("#servantGrid > *").length > 0, { timeout: 15000 });
    bondSlots = await page.evaluate(() => document.querySelectorAll("#servantGrid > *").length);
  } catch {
    errors.push("bond tab: #servantGrid never rendered any children");
  }
  if (bondSlots > 0) console.log(`NOTE: bond tab rendered ${bondSlots} grid children from ${lazyRequests.length} bond-lazy request(s)`);
  if (lazyRequests.length === 0) errors.push("bond tab: no network request for bond-lazy — the lazy import never fired");

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
