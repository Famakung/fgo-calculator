#!/usr/bin/env node
/**
 * scripts/test_qa_viewport_modal_bounds.js
 *
 * Adversarial Software QA Test Suite:
 * Validates layout bounds and modal sizing across extreme viewports following the
 * removal of the JS zoom hack and introduction of pure CSS `--screen-h: 100dvh`.
 *
 * Viewports probed:
 * - 375x667 (Mobile iPhone SE)
 * - 375x812 (Mobile iPhone X/12)
 * - 1536x864 (Desktop 16:9 standard)
 * - 1920x1080 (Wide Desktop FHD)
 * - 2560x1440 (Ultrawide / QHD 2K)
 * - 2560x1080 (21:9 Ultrawide)
 * - 800x500 (Extreme Short Screen stress test)
 *
 * Sinks & Assertions:
 * 1. `--screen-h` custom property evaluates to 100dvh with NO inline JS zoom on <html>
 * 2. `calc(var(--screen-h) * 0.8)` caps `.servant-modal-content` height <= 0.8 * viewportHeight
 * 3. Modal close buttons and headers remain strictly on-screen and clickable
 * 4. Zero document horizontal overflow (doc.scrollWidth <= doc.clientWidth) across all tabs
 * 5. Dynamic resize robustness (2560px -> 375px -> 1920px) without layout breakage
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
  let p = req.url.split("?")[0].replace(/^\/fgo-calculator\//, "").replace(/^\//, "");
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

const failures = [];
function assert(condition, message) {
  if (!condition) {
    failures.push(message);
    console.error(`  ❌ FAIL: ${message}`);
  } else {
    console.log(`  ✅ PASS: ${message}`);
  }
}

const VIEWPORTS = [
  { name: "Mobile iPhone SE", width: 375, height: 667 },
  { name: "Mobile iPhone X/12", width: 375, height: 812 },
  { name: "Desktop 1536px", width: 1536, height: 864 },
  { name: "Wide Desktop 1920px", width: 1920, height: 1080 },
  { name: "Ultrawide 2560x1440", width: 2560, height: 1440 },
  { name: "Ultrawide 2560x1080", width: 2560, height: 1080 },
  { name: "Short Screen 800x500", width: 800, height: 500 },
];

try {
  console.log("\n============================================================");
  console.log("SUITE 1: CSS Variables & No JS Zoom Verification Across Viewports");
  console.log("============================================================");

  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  for (const vp of VIEWPORTS) {
    await page.setViewport({ width: vp.width, height: vp.height });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    const tokens = await page.evaluate(() => {
      const de = document.documentElement;
      const cs = getComputedStyle(de);
      return {
        screenH: cs.getPropertyValue("--screen-h").trim(),
        inlineZoom: de.style.zoom,
        inlineScreenH: de.style.getPropertyValue("--screen-h"),
        bodyMinH: getComputedStyle(document.body).minHeight,
        docScrollW: de.scrollWidth,
        docClientW: de.clientWidth,
      };
    });

    console.log(`\n--- Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);
    assert(
      tokens.screenH.startsWith("100dvh") || tokens.screenH.startsWith("calc(100dvh"),
      `[${vp.name}] --screen-h is pure CSS dynamic viewport height (got: "${tokens.screenH}")`,
    );
    assert(!tokens.inlineZoom, `[${vp.name}] No inline zoom hack applied to <html> (got: "${tokens.inlineZoom}")`);
    assert(!tokens.inlineScreenH, `[${vp.name}] No inline --screen-h override on <html> (got: "${tokens.inlineScreenH}")`);
    assert(tokens.docScrollW <= tokens.docClientW, `[${vp.name}] Document horizontal overflow is 0 (scrollW: ${tokens.docScrollW} <= clientW: ${tokens.docClientW})`);
  }

  await page.close();

  console.log("\n============================================================");
  console.log("SUITE 2: Modal Bounds & calc(var(--screen-h) * 0.8) Verification");
  console.log("============================================================");

  for (const vp of VIEWPORTS) {
    console.log(`\n--- Testing Modals on: ${vp.name} (${vp.width}x${vp.height}) ---`);
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height });

    // Open on bond tab to test servant modal
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("fgo_active_tab", "bond");
      localStorage.setItem("fgo_bond_calculator_data", JSON.stringify({
        questMain: "fq",
        questSub: "fq83",
      }));
    });
    await page.goto(baseUrl, { waitUntil: "networkidle0" });

    // Wait for bond-lazy initialization
    await page.waitForFunction(() => document.getElementById("bondFreeQuestSelect")?.value === "fq83", { timeout: 10000 });

    // 1. Servant Modal (#servantModal)
    const slot0 = await page.$('.servant-slot[data-slot-index="0"]');
    await slot0.click();
    await page.waitForSelector("#servantModal.open", { timeout: 5000 });

    const servantModalMetrics = await page.evaluate((vpHeight) => {
      const modal = document.getElementById("servantModal");
      const content = modal.querySelector(".servant-modal-content");
      const closeBtn = document.getElementById("servantModalClose");
      const grid = modal.querySelector(".servant-picker-grid");
      const rect = content.getBoundingClientRect();
      const closeRect = closeBtn.getBoundingClientRect();
      const contentCS = getComputedStyle(content);
      const gridCS = getComputedStyle(grid);

      return {
        height: rect.height,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        maxHeightCss: contentCS.maxHeight,
        closeTop: closeRect.top,
        closeBottom: closeRect.bottom,
        gridOverflowY: gridCS.overflowY,
        gridOverscroll: gridCS.overscrollBehavior,
      };
    }, vp.height);

    const maxAllowedH = vp.height * 0.8 + 1.5; // subpixel tolerance
    assert(
      servantModalMetrics.height <= maxAllowedH,
      `[${vp.name}] #servantModal content height ${servantModalMetrics.height.toFixed(1)}px <= 80vh bound ${maxAllowedH.toFixed(1)}px`,
    );
    assert(servantModalMetrics.top >= 0, `[${vp.name}] #servantModal top (${servantModalMetrics.top.toFixed(1)}px) >= 0 (no top clipping)`);
    assert(servantModalMetrics.bottom <= vp.height + 1, `[${vp.name}] #servantModal bottom (${servantModalMetrics.bottom.toFixed(1)}px) <= viewport height ${vp.height}px`);
    assert(servantModalMetrics.left >= 0, `[${vp.name}] #servantModal left (${servantModalMetrics.left.toFixed(1)}px) >= 0`);
    assert(servantModalMetrics.right <= vp.width + 1, `[${vp.name}] #servantModal right (${servantModalMetrics.right.toFixed(1)}px) <= viewport width ${vp.width}px`);
    assert(servantModalMetrics.closeTop >= 0 && servantModalMetrics.closeBottom <= vp.height, `[${vp.name}] #servantModal close button is fully visible in viewport`);
    assert(servantModalMetrics.gridOverscroll === "contain", `[${vp.name}] #servantModal grid has overscroll-behavior: contain`);

    // 2. Servant Filter Sub-Modal (#servantFilterModal)
    const servantFilterBtn = await page.waitForSelector("#servantPickerFilterBtn", { timeout: 5000 });
    await servantFilterBtn.click();
    await page.waitForSelector("#servantFilterModal.open", { timeout: 5000 });

    const servantFilterMetrics = await page.evaluate((vpHeight) => {
      const modal = document.getElementById("servantFilterModal");
      const content = modal.querySelector(".servant-modal-content");
      const rect = content.getBoundingClientRect();
      return {
        height: rect.height,
        top: rect.top,
        bottom: rect.bottom,
      };
    }, vp.height);

    assert(servantFilterMetrics.height <= maxAllowedH, `[${vp.name}] #servantFilterModal height ${servantFilterMetrics.height.toFixed(1)}px <= 80vh bound`);
    assert(servantFilterMetrics.top >= 0 && servantFilterMetrics.bottom <= vp.height + 1, `[${vp.name}] #servantFilterModal is vertically contained`);

    // Close servant filter sub-modal
    await page.click("#servantFilterModalClose");
    await page.waitForFunction(() => !document.getElementById("servantFilterModal").classList.contains("open"), { timeout: 5000 });

    // Close servant modal
    await page.click("#servantModalClose");
    await page.waitForFunction(() => !document.getElementById("servantModal").classList.contains("open"), { timeout: 5000 });

    // 3. CE Filter Modal (#cefilterFilterModal)
    // Switch to cefilter tab
    await page.evaluate(() => {
      document.querySelector('.tab-btn[data-tab="cefilter"]').click();
    });
    await page.waitForSelector("#panel-cefilter.active, html[data-tab='cefilter'] #panel-cefilter", { timeout: 5000 });

    const filterBtn = await page.waitForSelector("#cefilterFilterBtn", { timeout: 5000 });
    await filterBtn.click();
    await page.waitForSelector("#cefilterFilterModal.open", { timeout: 5000 });

    const filterModalMetrics = await page.evaluate((vpHeight) => {
      const modal = document.getElementById("cefilterFilterModal");
      const content = modal.querySelector(".servant-modal-content");
      const body = modal.querySelector(".cefilter-modal-body");
      const closeBtn = document.getElementById("cefilterFilterModalClose");
      const rect = content.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const closeRect = closeBtn.getBoundingClientRect();
      const bodyCS = getComputedStyle(body);

      return {
        contentHeight: rect.height,
        top: rect.top,
        bottom: rect.bottom,
        bodyHeight: bodyRect.height,
        bodyMaxHeightCss: bodyCS.maxHeight,
        bodyOverflowY: bodyCS.overflowY,
        bodyOverscroll: bodyCS.overscrollBehavior,
        closeTop: closeRect.top,
        closeBottom: closeRect.bottom,
      };
    }, vp.height);

    assert(
      filterModalMetrics.contentHeight <= maxAllowedH,
      `[${vp.name}] #cefilterFilterModal content height ${filterModalMetrics.contentHeight.toFixed(1)}px <= 80vh bound ${maxAllowedH.toFixed(1)}px`,
    );
    assert(filterModalMetrics.top >= 0, `[${vp.name}] #cefilterFilterModal top >= 0`);
    assert(filterModalMetrics.bottom <= vp.height + 1, `[${vp.name}] #cefilterFilterModal bottom <= viewport height`);
    assert(filterModalMetrics.bodyOverflowY === "auto", `[${vp.name}] #cefilterFilterModal body has overflow-y: auto`);
    assert(filterModalMetrics.bodyOverscroll === "contain", `[${vp.name}] #cefilterFilterModal body has overscroll-behavior: contain`);
    assert(filterModalMetrics.closeTop >= 0 && filterModalMetrics.closeBottom <= vp.height, `[${vp.name}] #cefilterFilterModal close button visible on-screen`);

    // Close filter modal
    await page.click("#cefilterFilterModalClose");
    await page.waitForFunction(() => !document.getElementById("cefilterFilterModal").classList.contains("open"), { timeout: 5000 });

    // 4. CE Picker Modal (#ceFilterModal)
    const addCeBtn = await page.waitForSelector("#cefilterAddBtn", { timeout: 5000 });
    await addCeBtn.click();
    await page.waitForSelector("#ceFilterModal.open", { timeout: 5000 });

    const cePickerMetrics = await page.evaluate((vpHeight) => {
      const modal = document.getElementById("ceFilterModal");
      const content = modal.querySelector(".servant-modal-content");
      const rect = content.getBoundingClientRect();
      return {
        height: rect.height,
        top: rect.top,
        bottom: rect.bottom,
      };
    }, vp.height);

    assert(cePickerMetrics.height <= maxAllowedH, `[${vp.name}] #ceFilterModal height <= 80vh bound`);
    assert(cePickerMetrics.top >= 0 && cePickerMetrics.bottom <= vp.height + 1, `[${vp.name}] #ceFilterModal is vertically contained`);

    // Close CE picker
    await page.click("#ceFilterModalClose");
    await page.waitForFunction(() => !document.getElementById("ceFilterModal").classList.contains("open"), { timeout: 5000 });

    await page.close();
  }

  console.log("\n============================================================");
  console.log("SUITE 3: Layout Bounds & Tab Navigation Verification");
  console.log("============================================================");

  const testPage = await browser.newPage();
  await testPage.goto(baseUrl, { waitUntil: "networkidle0" });

  for (const vp of VIEWPORTS) {
    console.log(`\n--- Layout Checks: ${vp.name} (${vp.width}x${vp.height}) ---`);
    await testPage.setViewport({ width: vp.width, height: vp.height });
    await new Promise((r) => setTimeout(r, 100));

    for (const tab of ["bond", "cefilter", "event"]) {
      await testPage.evaluate((tabName) => {
        const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
        if (btn) btn.click();
      }, tab);
      await new Promise((r) => setTimeout(r, 150));

      const layout = await testPage.evaluate(() => {
        const de = document.documentElement;
        const container = document.querySelector(".container");
        const cRect = container ? container.getBoundingClientRect() : null;
        return {
          docScrollW: de.scrollWidth,
          docClientW: de.clientWidth,
          containerW: cRect ? cRect.width : 0,
          containerMaxW: container ? getComputedStyle(container).maxWidth : "",
        };
      });

      assert(
        layout.docScrollW <= layout.docClientW,
        `[${vp.name} / ${tab} tab] No document horizontal overflow (scrollW: ${layout.docScrollW} <= clientW: ${layout.docClientW})`,
      );

      const maxContainerW = vp.width >= 1400 ? Math.min(2, vp.width / 1400) * 1120 + 2 : 1120;
      if (vp.width >= 1400) {
        assert(
          layout.containerW <= maxContainerW,
          `[${vp.name} / ${tab} tab] Container width <= ${Math.round(maxContainerW)}px dynamic zoom rail (actual: ${layout.containerW}px)`,
        );
      } else if (vp.width >= 1120) {
        assert(layout.containerW <= 1120, `[${vp.name} / ${tab} tab] Container width <= 1120px max-width rail (actual: ${layout.containerW}px)`);
      } else if (vp.width < 380) {
        assert(layout.containerW <= vp.width, `[${vp.name} / ${tab} tab] Container fits within small mobile width (actual: ${layout.containerW}px)`);
      }
    }
  }

  await testPage.close();

  console.log("\n============================================================");
  console.log("SUITE 4: Dynamic Resize Resilience & Rapid Transitions");
  console.log("============================================================");
  {
    const dynamicPage = await browser.newPage();
    await dynamicPage.goto(baseUrl, { waitUntil: "networkidle0" });

    // Sequence of dynamic viewport resizing
    const resizeSequence = [
      { w: 2560, h: 1440 },
      { w: 375, h: 812 },
      { w: 1920, h: 1080 },
      { w: 1536, h: 864 },
      { w: 320, h: 568 },
      { w: 1120, h: 900 },
    ];

    for (const target of resizeSequence) {
      await dynamicPage.setViewport({ width: target.w, height: target.h });
      await new Promise((r) => setTimeout(r, 80));

      const resMetrics = await dynamicPage.evaluate((h) => {
        const de = document.documentElement;
        const cs = getComputedStyle(de);
        return {
          screenH: cs.getPropertyValue("--screen-h").trim(),
          zoom: de.style.zoom,
          overflow: de.scrollWidth - de.clientWidth,
        };
      }, target.h);

      assert(
        resMetrics.screenH.startsWith("100dvh") || resMetrics.screenH.startsWith("calc(100dvh"),
        `Dynamic resize to ${target.w}x${target.h}: --screen-h is pure CSS viewport height (got: "${resMetrics.screenH}")`,
      );
      assert(!resMetrics.zoom, `Dynamic resize to ${target.w}x${target.h}: No zoom property set`);
      assert(resMetrics.overflow <= 0, `Dynamic resize to ${target.w}x${target.h}: No horizontal overflow`);
    }

    assert(pageErrors.length === 0, `Total page errors thrown across all suites: ${pageErrors.length} (got: ${JSON.stringify(pageErrors)})`);
    await dynamicPage.close();
  }

  console.log("\n============================================================");
  console.log("SUITE 5: Stepped Desktop Scaling Contracts (1536px & 1920px)");
  console.log("============================================================");
  {
    const steppedVps = [
      {
        name: "Laptop 1.25x (1536px)",
        width: 1536,
        height: 864,
        cardW: 176,
        maxW: "176px",
        portraitH: "105px",
        ceBadgeH: "53px",
        slotCeH: "70px",
        fontSize: "17.55px",
      },
      {
        name: "Desktop 1.0x (1920px)",
        width: 1920,
        height: 1080,
        cardW: 220,
        maxW: "220px",
        portraitH: "132px",
        ceBadgeH: "66px",
        slotCeH: "88px",
        fontSize: "21.94px",
      },
    ];

    for (const svp of steppedVps) {
      console.log(`\n--- Verifying Stepped Scaling: ${svp.name} (${svp.width}x${svp.height}) ---`);
      const sPage = await browser.newPage();
      await sPage.setViewport({ width: svp.width, height: svp.height });
      await sPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await sPage.evaluate(() => {
        localStorage.setItem("fgo_bond_calculator_data", JSON.stringify({
          questMain: "fq",
          questSub: "fq83",
        }));
      });
      await sPage.goto(baseUrl, { waitUntil: "networkidle0" });

      // 1. Verify dynamic pure CSS zoom scales proportionally
      const zoomMetrics = await sPage.evaluate(() => {
        const rootCS = getComputedStyle(document.documentElement);
        return {
          zoom: parseFloat(rootCS.zoom) || 1,
          screenH: rootCS.getPropertyValue("--screen-h").trim(),
        };
      });
      const expectedZoom = Math.min(2, svp.width / 1400);
      assert(
        Math.abs(zoomMetrics.zoom - expectedZoom) <= 0.01,
        `[${svp.name}] dynamic CSS zoom evaluated to ${expectedZoom.toFixed(4)} (got: ${zoomMetrics.zoom.toFixed(4)})`,
      );
      assert(
        zoomMetrics.screenH.startsWith("calc(100dvh"),
        `[${svp.name}] --screen-h scales dynamically via calc(100dvh) (got: "${zoomMetrics.screenH}")`,
      );

      // 2. Switch to CE Filter tab and verify results grid cards expand
      await sPage.evaluate(() => {
        const btn = document.querySelector('.tab-btn[data-tab="cefilter"]');
        if (btn) btn.click();
      });
      await sPage.waitForSelector(".cefilter-servant-card", { timeout: 10000 });

      const ceCardMetrics = await sPage.evaluate(() => {
        const de = document.documentElement;
        const grid = document.getElementById("cefilterResults");
        const cards = Array.from(grid?.querySelectorAll(".cefilter-servant-card") || []);
        const firstCardRect = cards[0]?.getBoundingClientRect();
        const gridCS = grid ? getComputedStyle(grid) : null;
        const colCount = gridCS ? gridCS.gridTemplateColumns.trim().split(/\s+/).length : 0;
        return {
          cardCount: cards.length,
          firstCardWidth: firstCardRect ? firstCardRect.width : 0,
          colCount,
          docScrollW: de.scrollWidth,
          docClientW: de.clientWidth,
        };
      });

      assert(ceCardMetrics.cardCount > 0, `[${svp.name}] CE Filter renders servant cards`);
      assert(
        ceCardMetrics.colCount === 6,
        `[${svp.name}] CE Filter results grid computes to 6 columns (actual: ${ceCardMetrics.colCount})`,
      );
      assert(
        Math.abs(ceCardMetrics.firstCardWidth - svp.cardW) <= 1.0,
        `[${svp.name}] CE Filter grid card width expands to ${svp.cardW}px (actual: ${ceCardMetrics.firstCardWidth.toFixed(2)}px)`,
      );
      assert(
        ceCardMetrics.docScrollW <= ceCardMetrics.docClientW,
        `[${svp.name}] CE Filter tab has no document horizontal overflow (scrollW: ${ceCardMetrics.docScrollW} <= clientW: ${ceCardMetrics.docClientW})`,
      );

      // 3. Verify Event Shop material-card max-width expands
      await sPage.evaluate(() => {
        document.querySelector('.tab-btn[data-tab="event"]').click();
      });
      await new Promise((r) => setTimeout(r, 150));

      const eventCardMetrics = await sPage.evaluate(() => {
        const de = document.documentElement;
        const matCards = Array.from(document.querySelectorAll(".material-card"));
        const firstMatCard = matCards[0];
        const maxW = firstMatCard ? getComputedStyle(firstMatCard).maxWidth : "";
        const width = firstMatCard ? firstMatCard.getBoundingClientRect().width : 0;
        return {
          matCardCount: matCards.length,
          maxWidth: maxW,
          width,
          docScrollW: de.scrollWidth,
          docClientW: de.clientWidth,
        };
      });

      assert(eventCardMetrics.matCardCount > 0, `[${svp.name}] Event Shop renders material cards`);
      assert(
        Math.abs(eventCardMetrics.width - svp.cardW) <= 1.5,
        `[${svp.name}] Event Shop material card width expands to ${svp.cardW}px (actual: ${eventCardMetrics.width.toFixed(2)}px)`,
      );
      assert(
        eventCardMetrics.docScrollW <= eventCardMetrics.docClientW,
        `[${svp.name}] Event Shop tab has no document horizontal overflow (scrollW: ${eventCardMetrics.docScrollW} <= clientW: ${eventCardMetrics.docClientW})`,
      );

      // 4. Verify Bond Calculator results grid cards expand
      await sPage.evaluate(() => {
        document.querySelector('.tab-btn[data-tab="bond"]').click();
      });
      await new Promise((r) => setTimeout(r, 150));

      // Wait for bond-lazy and populate a slot to calculate
      await sPage.waitForFunction(() => document.getElementById("bondFreeQuestSelect")?.value === "fq83", { timeout: 10000 });
      await sPage.click('.servant-slot[data-slot-index="0"]');
      await sPage.waitForSelector("#servantModal.open", { timeout: 5000 });
      const firstServant = await sPage.waitForSelector("#servantModal .servant-picker-item", { timeout: 5000 });
      await firstServant.click();
      await sPage.waitForFunction(() => !document.getElementById("servantModal").classList.contains("open"), { timeout: 5000 });

      // Click Calculate
      await sPage.click("#bondCalculateBtn");
      await sPage.waitForSelector(".bond-result-servant-card", { timeout: 5000 });

      const bondResultMetrics = await sPage.evaluate(() => {
        const de = document.documentElement;
        const resGrid = document.querySelector(".bond-result-servant-grid");
        const resCard = resGrid?.querySelector(".bond-result-servant-card");
        const rect = resCard ? resCard.getBoundingClientRect() : null;
        return {
          cardWidth: rect ? rect.width : 0,
          docScrollW: de.scrollWidth,
          docClientW: de.clientWidth,
        };
      });

      assert(
        Math.abs(bondResultMetrics.cardWidth - svp.cardW) <= 1.0,
        `[${svp.name}] Bond Calculator result card width expands to ${svp.cardW}px (actual: ${bondResultMetrics.cardWidth.toFixed(2)}px)`,
      );
      assert(
        bondResultMetrics.docScrollW <= bondResultMetrics.docClientW,
        `[${svp.name}] Bond Calculator results have no document horizontal overflow (scrollW: ${bondResultMetrics.docScrollW} <= clientW: ${bondResultMetrics.docClientW})`,
      );

      // 5. Verify Modals fit strictly within calc(var(--screen-h) * 0.8) at stepped desktop viewports
      const maxAllowedH = svp.height * 0.8 + 1.5;

      // Servant Modal (click empty add-slot 1)
      await sPage.click('.servant-slot[data-slot-index="1"]');
      await sPage.waitForSelector("#servantModal.open", { timeout: 5000 });
      const modalMetrics = await sPage.evaluate(() => {
        const modal = document.getElementById("servantModal");
        const content = modal.querySelector(".servant-modal-content");
        const rect = content.getBoundingClientRect();
        return { height: rect.height, top: rect.top, bottom: rect.bottom };
      });

      assert(
        modalMetrics.height <= maxAllowedH,
        `[${svp.name}] #servantModal content height ${modalMetrics.height.toFixed(1)}px <= 80vh bound ${maxAllowedH.toFixed(1)}px`,
      );
      assert(modalMetrics.top >= 0 && modalMetrics.bottom <= svp.height + 1, `[${svp.name}] #servantModal is fully on-screen vertically`);

      await sPage.click("#servantModalClose");
      await sPage.waitForFunction(() => !document.getElementById("servantModal").classList.contains("open"), { timeout: 5000 });

      await sPage.close();
    }
  }

} catch (err) {
  console.error("Fatal runner error:", err);
  failures.push(`Runner error: ${err.message}`);
} finally {
  await browser?.close();
  server?.close();
}

console.log("\n============================================================");
if (failures.length > 0) {
  console.error(`QA VERDICT: FAIL (${failures.length} defect(s) detected)`);
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
} else {
  console.log("QA VERDICT: PASS (All viewport extremes and modal bounds verified defect-free)");
  process.exit(0);
}
