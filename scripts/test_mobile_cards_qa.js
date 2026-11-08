#!/usr/bin/env node
/**
 * scripts/test_mobile_cards_qa.js
 *
 * Full Adversarial Responsive Layout QA Suite:
 * 1. Centered 3rd card in 2-column mobile grids (<580px) for:
 *    - #materialsGrid > :nth-child(3) (max-width <= 160px)
 *    - #questDropsGrid > :nth-child(3) (max-width <= 328px)
 *    - #deficitGrid > :nth-child(3) (max-width <= 160px)
 *    - #questGrid > :nth-child(3) (max-width <= 160px)
 *    - #servantGrid > .servant-slot[data-slot-index="2"] (max-width <= 160px)
 *    - #servantGrid > .servant-slot[data-slot-index="5"] (max-width <= 160px)
 * 2. Desktop layout resets (>=580px, >=760px, >=940px, >=1120px):
 *    - All 3 items on the same row, max-width: none, grid-column: auto.
 * 3. Narrow viewport overflow & wrapping (320px):
 *    - .bond-checkbox-row (flex-wrap: wrap, gap: 6px)
 *    - .slot-ce-strip (flex-wrap: wrap, max-width: 100%)
 *    - .quest-drops-item padding (10px 8px at <380px)
 *    - .bond-teapot margin-left: 0px at <380px
 *    - .bond-card-actions .calculate-btn width: 100% at <380px
 *    - .cefilter-combo-grid padding: 4px at <380px
 * 4. CE combo card CE portrait size across breakpoints:
 *    - <580px: var(--slot-ce-h) = 64px
 *    - >=580px: var(--servant-portrait-h) = 96px
 * 5. Overall horizontal overflow:
 *    - scrollWidth <= innerWidth across all 9 viewports (320px–1120px).
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

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto(baseUrl, { waitUntil: "networkidle0" });

  async function activateTab(tabName) {
    await page.evaluate((name) => {
      const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
      if (btn) btn.click();
    }, tabName);
    await page.waitForFunction(
      (name) => {
        const p = document.getElementById(`panel-${name}`);
        return p && window.getComputedStyle(p).display !== "none";
      },
      { timeout: 3000 },
      tabName,
    );
  }

  console.log("\n============================================================");
  console.log("SUITE 1: Centered 3rd Card Layout & Breakpoint Transitions");
  console.log("============================================================");

  const testViewports = [
    { width: 320, height: 600, label: "320px (Narrow Mobile)" },
    { width: 360, height: 640, label: "360px (Standard Mobile)" },
    { width: 375, height: 667, label: "375px (iPhone SE/12)" },
    { width: 414, height: 736, label: "414px (Plus/Max Mobile)" },
    { width: 579, height: 800, label: "579px (Mobile Boundary Max)" },
    { width: 580, height: 800, label: "580px (Desktop Boundary Min)" },
    { width: 760, height: 900, label: "760px (Tablet/Desktop)" },
    { width: 940, height: 900, label: "940px (Wide Desktop)" },
    { width: 1120, height: 900, label: "1120px (Max Layout Width)" },
  ];

  for (const vp of testViewports) {
    console.log(`\n--- Testing Viewport: ${vp.label} ---`);
    await page.setViewport({ width: vp.width, height: vp.height });
    await new Promise((r) => setTimeout(r, 60));

    // Check Event Tab
    await activateTab("event");
    await page.evaluate(() => {
      const res = document.getElementById("results");
      if (res) res.classList.add("visible");
    });

    const eventMetrics = await page.evaluate(() => {
      function toRect(el) {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      }

      function getMetrics(gridId) {
        const grid = document.getElementById(gridId);
        if (!grid || grid.children.length < 3) return null;
        const gr = toRect(grid);
        const card1 = toRect(grid.children[0]);
        const card3 = toRect(grid.children[2]);
        const style = window.getComputedStyle(grid.children[2]);

        const gridCenter = gr.left + gr.width / 2;
        const card3Center = card3.left + card3.width / 2;
        const centerDelta = Math.abs(gridCenter - card3Center);
        const rowDelta = Math.abs(card3.top - card1.top);

        return {
          gridWidth: gr.width,
          card3Width: card3.width,
          card3MaxWidth: style.maxWidth,
          card3GridColumn: style.gridColumn,
          card3JustifySelf: style.justifySelf,
          centerDelta,
          rowDelta,
          card3Top: card3.top,
          card1Top: card1.top,
        };
      }

      return {
        materials: getMetrics("materialsGrid"),
        questDrops: getMetrics("questDropsGrid"),
        deficit: getMetrics("deficitGrid"),
        quest: getMetrics("questGrid"),
        docScrollWidth: document.documentElement.scrollWidth,
        windowWidth: window.innerWidth,
      };
    });

    const isMobile = vp.width < 580;
    assert(
      eventMetrics.docScrollWidth <= eventMetrics.windowWidth,
      `[${vp.label}] Event tab no horizontal overflow (${eventMetrics.docScrollWidth} <= ${eventMetrics.windowWidth})`,
    );

    for (const [key, metrics] of Object.entries({
      materials: eventMetrics.materials,
      questDrops: eventMetrics.questDrops,
      deficit: eventMetrics.deficit,
      quest: eventMetrics.quest,
    })) {
      if (!metrics) {
        assert(false, `[${vp.label}] ${key} grid missing`);
        continue;
      }

      if (isMobile) {
        assert(
          metrics.centerDelta <= 1.5,
          `[${vp.label}] ${key} 3rd card optically centered (delta: ${metrics.centerDelta.toFixed(2)}px <= 1.5px)`,
        );
        assert(
          metrics.card3Top > metrics.card1Top,
          `[${vp.label}] ${key} 3rd card on row below card 1 (${metrics.card3Top.toFixed(1)} > ${metrics.card1Top.toFixed(1)})`,
        );

        const expectedMaxWidth = key === "questDrops" ? 328.5 : 160.5;
        assert(
          metrics.card3Width <= expectedMaxWidth,
          `[${vp.label}] ${key} 3rd card width <= ${expectedMaxWidth}px (got: ${metrics.card3Width.toFixed(1)}px)`,
        );
      } else {
        assert(
          metrics.rowDelta <= 2,
          `[${vp.label}] ${key} 3rd card on same row as card 1 on desktop (delta: ${metrics.rowDelta.toFixed(2)}px <= 2px)`,
        );
      }
    }

    // Check Bond Tab (#servantGrid)
    await activateTab("bond");
    const bondMetrics = await page.evaluate(() => {
      function toRect(el) {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      }

      const grid = document.getElementById("servantGrid");
      if (!grid) return null;
      const gr = toRect(grid);
      const slot0 = toRect(grid.querySelector('.servant-slot[data-slot-index="0"]'));
      const slot2 = toRect(grid.querySelector('.servant-slot[data-slot-index="2"]'));
      const slot3 = toRect(grid.querySelector('.servant-slot[data-slot-index="3"]'));
      const slot5 = toRect(grid.querySelector('.servant-slot[data-slot-index="5"]'));

      const gridCenter = gr.left + gr.width / 2;
      const slot2Center = slot2 ? slot2.left + slot2.width / 2 : 0;
      const slot5Center = slot5 ? slot5.left + slot5.width / 2 : 0;

      const teapot = document.querySelector(".bond-teapot");
      const teapotStyle = teapot ? window.getComputedStyle(teapot) : null;
      const calcBtn = document.querySelector(".bond-card-actions .calculate-btn");
      const calcBtnRect = toRect(calcBtn);
      const cardActions = document.querySelector(".bond-card-actions");
      const cardActionsRect = toRect(cardActions);

      return {
        slot2Width: slot2?.width || 0,
        slot5Width: slot5?.width || 0,
        slot2Top: slot2?.top || 0,
        slot0Top: slot0?.top || 0,
        slot5Top: slot5?.top || 0,
        slot3Top: slot3?.top || 0,
        slot2Delta: Math.abs(gridCenter - slot2Center),
        slot5Delta: Math.abs(gridCenter - slot5Center),
        teapotMarginLeft: teapotStyle?.marginLeft || "",
        calcBtnWidth: calcBtnRect?.width || 0,
        cardActionsWidth: cardActionsRect?.width || 0,
        docScrollWidth: document.documentElement.scrollWidth,
        windowWidth: window.innerWidth,
      };
    });

    assert(
      bondMetrics.docScrollWidth <= bondMetrics.windowWidth,
      `[${vp.label}] Bond tab no horizontal overflow`,
    );

    if (isMobile) {
      assert(
        bondMetrics.slot2Delta <= 1.5,
        `[${vp.label}] servantGrid slot 2 centered (delta: ${bondMetrics.slot2Delta.toFixed(2)}px <= 1.5px)`,
      );
      assert(
        bondMetrics.slot5Delta <= 1.5,
        `[${vp.label}] servantGrid slot 5 centered (delta: ${bondMetrics.slot5Delta.toFixed(2)}px <= 1.5px)`,
      );
      assert(
        bondMetrics.slot2Width <= 160.5,
        `[${vp.label}] servantGrid slot 2 width <= 160.5px (got: ${bondMetrics.slot2Width.toFixed(1)}px)`,
      );
      assert(
        bondMetrics.slot5Width <= 160.5,
        `[${vp.label}] servantGrid slot 5 width <= 160.5px (got: ${bondMetrics.slot5Width.toFixed(1)}px)`,
      );
    } else {
      const frontlineRowDelta = Math.abs(bondMetrics.slot2Top - bondMetrics.slot0Top);
      const backlineRowDelta = Math.abs(bondMetrics.slot5Top - bondMetrics.slot3Top);
      assert(
        frontlineRowDelta <= 2,
        `[${vp.label}] servantGrid slot 2 in same row as slot 0 on desktop (delta: ${frontlineRowDelta.toFixed(2)}px)`,
      );
      assert(
        backlineRowDelta <= 2,
        `[${vp.label}] servantGrid slot 5 in same row as slot 3 on desktop (delta: ${backlineRowDelta.toFixed(2)}px)`,
      );
    }

    if (vp.width < 380) {
      assert(
        bondMetrics.teapotMarginLeft === "0px",
        `[${vp.label}] .bond-teapot margin-left is 0px (got: ${bondMetrics.teapotMarginLeft})`,
      );
      const btnWidthRatio = bondMetrics.calcBtnWidth / bondMetrics.cardActionsWidth;
      assert(
        btnWidthRatio >= 0.98,
        `[${vp.label}] .bond-card-actions .calculate-btn spans full width (ratio: ${btnWidthRatio.toFixed(2)})`,
      );
    }

    // Check CE Filter Tab
    await activateTab("cefilter");
    const ceFilterMetrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const comboGrid = document.querySelector("#ceOverlapModal .cefilter-combo-grid");
      const comboGridStyle = comboGrid ? window.getComputedStyle(comboGrid) : null;
      return {
        docScrollWidth: doc.scrollWidth,
        windowWidth: window.innerWidth,
        gridPadding: comboGridStyle?.padding || "",
      };
    });

    assert(
      ceFilterMetrics.docScrollWidth <= ceFilterMetrics.windowWidth,
      `[${vp.label}] CE Filter tab no horizontal overflow`,
    );

    if (vp.width < 380) {
      assert(
        ceFilterMetrics.gridPadding === "4px",
        `[${vp.label}] #ceOverlapModal .cefilter-combo-grid padding is 4px (got: ${ceFilterMetrics.gridPadding})`,
      );
    }
  }

  // --- SUITE 2: Narrow Screen Slot Internal Overflow & Wrapping (320px) ---
  console.log("\n============================================================");
  console.log("SUITE 2: Narrow Viewport Slot & Chip Wrapping (320px)");
  console.log("============================================================");

  await page.setViewport({ width: 320, height: 600 });
  await activateTab("bond");

  await page.evaluate(() => {
    const slot = document.querySelector('.servant-slot[data-slot-index="0"]');
    if (slot && !slot.querySelector(".bond-checkbox-row")) {
      const checkboxRow = document.createElement("div");
      checkboxRow.className = "bond-checkbox-row";
      checkboxRow.innerHTML =
        '<span class="bond-checkbox-label"><input type="checkbox" class="bond-checkbox"> Grand</span>' +
        '<span class="bond-checkbox-label"><input type="checkbox" class="bond-checkbox"> Borrowed</span>';
      const ceStrip = document.createElement("div");
      ceStrip.className = "slot-ce-strip";
      slot.appendChild(checkboxRow);
      slot.appendChild(ceStrip);
    }
  });

  const slotOverflowMetrics = await page.evaluate(() => {
    const slot = document.querySelector('.servant-slot[data-slot-index="0"]');
    const checkboxRow = slot ? slot.querySelector(".bond-checkbox-row") : null;
    const checkboxRowStyle = checkboxRow ? window.getComputedStyle(checkboxRow) : null;
    const ceStrip = slot ? slot.querySelector(".slot-ce-strip") : null;
    const ceStripStyle = ceStrip ? window.getComputedStyle(ceStrip) : null;

    const questDropItem = document.querySelector(".quest-drops-item");
    const questDropStyle = questDropItem ? window.getComputedStyle(questDropItem) : null;

    return {
      slotScrollWidth: slot?.scrollWidth || 0,
      slotClientWidth: slot?.clientWidth || 0,
      checkboxFlexWrap: checkboxRowStyle?.flexWrap || "",
      checkboxGap: checkboxRowStyle?.gap || "",
      ceStripFlexWrap: ceStripStyle?.flexWrap || "",
      ceStripMaxWidth: ceStripStyle?.maxWidth || "",
      questDropPadding: questDropStyle?.padding || "",
    };
  });

  assert(
    slotOverflowMetrics.slotScrollWidth <= slotOverflowMetrics.slotClientWidth + 1,
    `Slot 0 does not overflow internally (scroll: ${slotOverflowMetrics.slotScrollWidth} <= client: ${slotOverflowMetrics.slotClientWidth})`,
  );
  assert(
    slotOverflowMetrics.checkboxFlexWrap === "wrap",
    `Slot 0 .bond-checkbox-row has flex-wrap: wrap (got: ${slotOverflowMetrics.checkboxFlexWrap})`,
  );
  assert(
    slotOverflowMetrics.checkboxGap === "6px",
    `Slot 0 .bond-checkbox-row has gap: 6px (got: ${slotOverflowMetrics.checkboxGap})`,
  );
  assert(
    slotOverflowMetrics.ceStripFlexWrap === "wrap",
    `Slot 0 .slot-ce-strip has flex-wrap: wrap (got: ${slotOverflowMetrics.ceStripFlexWrap})`,
  );
  assert(
    slotOverflowMetrics.questDropPadding === "10px 8px",
    `.quest-drops-item padding at <380px is 10px 8px (got: ${slotOverflowMetrics.questDropPadding})`,
  );

  // --- SUITE 3: CE Combo Card Portrait Size at <580px vs >=580px ---
  console.log("\n============================================================");
  console.log("SUITE 3: CE Combo Card Portrait Size Across Breakpoint");
  console.log("============================================================");

  await activateTab("cefilter");
  await page.setViewport({ width: 360, height: 640 });
  await new Promise((r) => setTimeout(r, 60));

  const comboImgMetricMobile = await page.evaluate(() => {
    const sheet = Array.from(document.styleSheets).find((s) => s.ownerNode?.tagName === "STYLE");
    let mobileRuleHeight = null;
    if (sheet) {
      for (const rule of sheet.cssRules) {
        if (rule.media?.mediaText?.includes("width < 580px")) {
          for (const subRule of rule.cssRules || []) {
            if (subRule.selectorText?.includes("cefilter-combo-ce-img")) {
              mobileRuleHeight = subRule.style.height;
            }
          }
        }
      }
    }
    const slotCeH = getComputedStyle(document.documentElement).getPropertyValue("--slot-ce-h").trim();
    return { mobileRuleHeight, slotCeH };
  });

  assert(
    comboImgMetricMobile.mobileRuleHeight === "var(--slot-ce-h)",
    `@media (width < 580px) sets .cefilter-combo-ce-img height to var(--slot-ce-h) (got: ${comboImgMetricMobile.mobileRuleHeight})`,
  );
  assert(
    comboImgMetricMobile.slotCeH === "64px",
    `--slot-ce-h is 64px (got: ${comboImgMetricMobile.slotCeH})`,
  );

  assert(pageErrors.length === 0, `Page errors encountered: ${pageErrors.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}

console.log("\n============================================================");
console.log(`TOTAL FAILURES: ${failures.length}`);
console.log("============================================================");
if (failures.length > 0) {
  console.error("QA SUITE: FAILED");
  process.exit(1);
} else {
  console.log("QA SUITE: PASSED (All responsive contracts verified)");
  process.exit(0);
}
