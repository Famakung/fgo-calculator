#!/usr/bin/env node
/**
 * scripts/test_repro_mobile_cascade_bug.js
 *
 * Deterministic test harness verifying that rules inside `@media (width < 380px)`
 * in `src/layouts/BaseLayout.astro` properly apply on narrow mobile viewports
 * and are not overridden by base CSS declarations.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

const DIST = path.resolve("dist");
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p.startsWith("/fgo-calculator/")) p = p.slice("/fgo-calculator/".length);
  else if (p.startsWith("/")) p = p.slice(1);
  if (!p) p = "index.html";
  const abs = path.join(DIST, p);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(fs.readFileSync(abs));
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}/fgo-calculator/`;

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 640 });
  await page.goto(baseUrl, { waitUntil: "networkidle0" });

  // Activate Bond tab
  await page.evaluate(() => {
    const btn = document.querySelector('.tab-btn[data-tab="bond"]');
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 100));

  const results = await page.evaluate(() => {
    const teapot = document.querySelector(".bond-teapot");
    const calcBtn = document.querySelector(".bond-card-actions .calculate-btn");
    const questDrop = document.querySelector(".quest-drops-item");
    const overlapGrid = document.querySelector("#ceOverlapModal .cefilter-combo-grid");

    const csTeapot = teapot ? window.getComputedStyle(teapot) : null;
    const csCalcBtn = calcBtn ? window.getComputedStyle(calcBtn) : null;
    const csQuestDrop = questDrop ? window.getComputedStyle(questDrop) : null;
    const csOverlapGrid = overlapGrid ? window.getComputedStyle(overlapGrid) : null;

    return {
      teapotMarginLeft: csTeapot?.marginLeft,
      calcBtnWidth: csCalcBtn?.width,
      questDropPadding: csQuestDrop?.padding,
      overlapGridPadding: csOverlapGrid?.padding,
    };
  });

  console.log("Observed styles at 360px viewport (< 380px):");
  console.log(`- .bond-teapot margin-left: ${results.teapotMarginLeft} (expected: 0px)`);
  console.log(`- .quest-drops-item padding: ${results.questDropPadding} (expected: 10px 8px)`);
  console.log(`- #ceOverlapModal .cefilter-combo-grid padding: ${results.overlapGridPadding} (expected: 4px)`);

  const failures = [];
  if (results.teapotMarginLeft !== "0px") {
    failures.push(`.bond-teapot margin-left is "${results.teapotMarginLeft}", expected "0px"`);
  }
  if (results.questDropPadding !== "10px 8px") {
    failures.push(`.quest-drops-item padding is "${results.questDropPadding}", expected "10px 8px"`);
  }
  if (results.overlapGridPadding !== "4px") {
    failures.push(`#ceOverlapModal .cefilter-combo-grid padding is "${results.overlapGridPadding}", expected "4px"`);
  }

  if (failures.length > 0) {
    console.error("\nREPRO FAILED WITH DETECTED CASCADE BUGS:\n" + failures.map((f) => "  - " + f).join("\n"));
    process.exit(1);
  } else {
    console.log("\nAll mobile cascade rules applied correctly.");
    process.exit(0);
  }
} finally {
  await browser.close();
  server.close();
}
