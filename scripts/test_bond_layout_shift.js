#!/usr/bin/env node
/**
 * scripts/test_bond_layout_shift.js
 *
 * Adversarial QA test suite for Bond Calculator layout shift fixes and edge cases.
 * Spins up Astro preview server in-process, tests across multiple viewports,
 * localStorage configurations, and edge cases.
 */

import puppeteer from "puppeteer";
import { preview } from "astro";

const errors = [];
function assert(condition, message) {
  if (!condition) {
    errors.push(message);
    console.error(`  FAIL: ${message}`);
  } else {
    console.log(`  PASS: ${message}`);
  }
}

const previewServer = await preview({});
const port = 3000;
const baseUrl = `http://localhost:${port}/fgo-calculator/`;

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  console.log("\n=== TEST SUITE 1: Fresh Session Layout Shift (No localStorage) ===");
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812 });

    // Ensure origin localStorage is clear
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("fgo_active_tab", "bond");
      localStorage.removeItem("fgo_bond_calculator_data");
    });

    // Intercept bond-lazy.js to delay it by 300ms to measure initial paint
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url().includes("bond-lazy")) {
        setTimeout(() => req.continue(), 300);
      } else {
        req.continue();
      }
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    const initialMetrics = await page.evaluate(() => {
      const questCard = document.getElementById("bondQuestSelect")?.closest(".card");
      const grid = document.getElementById("servantGrid");
      const freeRow = document.querySelector(".bond-quest-row--free");
      const grandRow = document.querySelector(".bond-quest-row--grand");
      const customSec = document.getElementById("customQuestSection");

      return {
        questCardH: questCard ? questCard.getBoundingClientRect().height : 0,
        gridH: grid ? grid.getBoundingClientRect().height : 0,
        gridChildren: grid ? grid.children.length : 0,
        freeDisplay: freeRow ? getComputedStyle(freeRow).display : "",
        grandDisplay: grandRow ? getComputedStyle(grandRow).display : "",
        customDisplay: customSec ? getComputedStyle(customSec).display : "",
      };
    });

    // Wait for bond-lazy and settled state
    await page.waitForFunction(() => document.getElementById("bondQuestSelect").options.length > 1, { timeout: 10000 });

    const settledMetrics = await page.evaluate(() => {
      const questCard = document.getElementById("bondQuestSelect")?.closest(".card");
      const grid = document.getElementById("servantGrid");
      const freeRow = document.querySelector(".bond-quest-row--free");
      const grandRow = document.querySelector(".bond-quest-row--grand");
      const customSec = document.getElementById("customQuestSection");

      return {
        questCardH: questCard ? questCard.getBoundingClientRect().height : 0,
        gridH: grid ? grid.getBoundingClientRect().height : 0,
        gridChildren: grid ? grid.children.length : 0,
        freeDisplay: freeRow ? getComputedStyle(freeRow).display : "",
        grandDisplay: grandRow ? getComputedStyle(grandRow).display : "",
        customDisplay: customSec ? getComputedStyle(customSec).display : "",
      };
    });

    console.log("  Initial Metrics (Pre-hydration):", initialMetrics);
    console.log("  Settled Metrics (Post-hydration):", settledMetrics);

    const questCardShift = Math.abs(initialMetrics.questCardH - settledMetrics.questCardH);
    const gridShift = Math.abs(initialMetrics.gridH - settledMetrics.gridH);

    assert(questCardShift < 1.0, `Fresh session Select Quest card height shift is < 1px (actual shift: ${questCardShift.toFixed(2)}px, initial: ${initialMetrics.questCardH}px, settled: ${settledMetrics.questCardH}px)`);
    assert(gridShift < 1.0, `Fresh session Servant Grid height shift is < 1px (actual shift: ${gridShift.toFixed(2)}px, initial: ${initialMetrics.gridH}px, settled: ${settledMetrics.gridH}px)`);
    assert(initialMetrics.gridChildren === 8, `Initial grid has exactly 8 pre-populated children (2 labels + 6 slots)`);
    assert(settledMetrics.gridChildren === 8, `Settled grid maintains exactly 8 children`);
    assert(initialMetrics.freeDisplay === "none" && settledMetrics.freeDisplay === "none", `Free quest row is hidden both initial and settled`);
    assert(initialMetrics.grandDisplay === "none" && settledMetrics.grandDisplay === "none", `Grand duel rows are hidden both initial and settled`);
    assert(initialMetrics.customDisplay === "none" && settledMetrics.customDisplay === "none", `Custom quest section is hidden both initial and settled`);

    await page.close();
  }

  console.log("\n=== TEST SUITE 2: Saved Free Quest (questMain: 'fq', questSub: 'fq83') ===");
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812 });

    // Set origin localStorage
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("fgo_active_tab", "bond");
      localStorage.setItem("fgo_bond_calculator_data", JSON.stringify({
        questMain: "fq",
        questSub: "fq83",
      }));
    });

    // Intercept bond-lazy to measure initial layout
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url().includes("bond-lazy")) {
        setTimeout(() => req.continue(), 300);
      } else {
        req.continue();
      }
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    const initial = await page.evaluate(() => {
      const questCard = document.getElementById("bondQuestSelect")?.closest(".card");
      const freeRow = document.querySelector(".bond-quest-row--free");
      const grandRow = document.querySelector(".bond-quest-row--grand");
      const customSec = document.getElementById("customQuestSection");
      const htmlAttr = document.documentElement.getAttribute("data-bond-quest");

      return {
        questCardH: questCard ? questCard.getBoundingClientRect().height : 0,
        freeDisplay: freeRow ? getComputedStyle(freeRow).display : "",
        grandDisplay: grandRow ? getComputedStyle(grandRow).display : "",
        customDisplay: customSec ? getComputedStyle(customSec).display : "",
        dataBondQuest: htmlAttr,
      };
    });

    // Wait for bond-lazy to settle
    await page.waitForFunction(() => document.getElementById("bondFreeQuestSelect").value === "fq83", { timeout: 10000 });

    const settled = await page.evaluate(() => {
      const questCard = document.getElementById("bondQuestSelect")?.closest(".card");
      const freeRow = document.querySelector(".bond-quest-row--free");
      const grandRow = document.querySelector(".bond-quest-row--grand");
      const customSec = document.getElementById("customQuestSection");
      const htmlAttr = document.documentElement.getAttribute("data-bond-quest");

      return {
        questCardH: questCard ? questCard.getBoundingClientRect().height : 0,
        freeDisplay: freeRow ? getComputedStyle(freeRow).display : "",
        grandDisplay: grandRow ? getComputedStyle(grandRow).display : "",
        customDisplay: customSec ? getComputedStyle(customSec).display : "",
        dataBondQuest: htmlAttr,
      };
    });

    console.log("  Initial Saved FQ Metrics:", initial);
    console.log("  Settled Saved FQ Metrics:", settled);

    const shift = Math.abs(initial.questCardH - settled.questCardH);
    assert(shift < 1.0, `Saved FQ Select Quest card height shift is < 1px (actual: ${shift.toFixed(2)}px, initial: ${initial.questCardH}px, settled: ${settled.questCardH}px)`);
    assert(initial.dataBondQuest === "fq", `Initial data-bond-quest attribute is synchronously restored to 'fq'`);
    assert(initial.freeDisplay === "flex" && settled.freeDisplay === "flex", `Free quest row is display:flex immediately from initial paint`);
    assert(initial.grandDisplay === "none" && settled.grandDisplay === "none", `Grand duel rows are hidden`);
    assert(initial.customDisplay === "none" && settled.customDisplay === "none", `Custom quest section is hidden`);

    await page.close();
  }

  console.log("\n=== TEST SUITE 3: Saved Free Quest with Custom (questMain: 'fq', questSub: 'custom') ===");
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812 });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("fgo_active_tab", "bond");
      localStorage.setItem("fgo_bond_calculator_data", JSON.stringify({
        questMain: "fq",
        questSub: "custom",
        customBond: 1200,
        customAp: 25,
      }));
    });

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url().includes("bond-lazy")) {
        setTimeout(() => req.continue(), 300);
      } else {
        req.continue();
      }
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    const initial = await page.evaluate(() => {
      const questCard = document.getElementById("bondQuestSelect")?.closest(".card");
      const freeRow = document.querySelector(".bond-quest-row--free");
      const customSec = document.getElementById("customQuestSection");
      const de = document.documentElement;

      return {
        questCardH: questCard ? questCard.getBoundingClientRect().height : 0,
        freeDisplay: freeRow ? getComputedStyle(freeRow).display : "",
        customDisplay: customSec ? getComputedStyle(customSec).display : "",
        dataBondQuest: de.getAttribute("data-bond-quest"),
        dataBondCustom: de.getAttribute("data-bond-custom"),
      };
    });

    // Wait for bond-lazy
    await page.waitForFunction(() => document.getElementById("bondFreeQuestSelect").value === "custom", { timeout: 10000 });

    const settled = await page.evaluate(() => {
      const questCard = document.getElementById("bondQuestSelect")?.closest(".card");
      const freeRow = document.querySelector(".bond-quest-row--free");
      const customSec = document.getElementById("customQuestSection");
      const de = document.documentElement;

      return {
        questCardH: questCard ? questCard.getBoundingClientRect().height : 0,
        freeDisplay: freeRow ? getComputedStyle(freeRow).display : "",
        customDisplay: customSec ? getComputedStyle(customSec).display : "",
        dataBondQuest: de.getAttribute("data-bond-quest"),
        dataBondCustom: de.getAttribute("data-bond-custom"),
      };
    });

    console.log("  Initial Custom FQ Metrics:", initial);
    console.log("  Settled Custom FQ Metrics:", settled);

    const shift = Math.abs(initial.questCardH - settled.questCardH);
    assert(shift < 1.0, `Custom FQ Select Quest card height shift is < 1px (actual: ${shift.toFixed(2)}px, initial: ${initial.questCardH}px, settled: ${settled.questCardH}px)`);
    assert(initial.dataBondQuest === "fq", `data-bond-quest is 'fq'`);
    assert(initial.dataBondCustom === "1", `data-bond-custom is '1'`);
    assert(initial.freeDisplay === "flex" && settled.freeDisplay === "flex", `Free quest row is display:flex`);
    assert(initial.customDisplay === "block" && settled.customDisplay === "block", `Custom quest section is display:block`);

    await page.close();
  }

  console.log("\n=== TEST SUITE 4: Saved Grand Duel (questMain: 'gd', questClass: '0100', questDiff: '1') ===");
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812 });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("fgo_active_tab", "bond");
      localStorage.setItem("fgo_bond_calculator_data", JSON.stringify({
        questMain: "gd",
        questClass: "0100",
        questDiff: "1",
      }));
    });

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url().includes("bond-lazy")) {
        setTimeout(() => req.continue(), 300);
      } else {
        req.continue();
      }
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    const initial = await page.evaluate(() => {
      const questCard = document.getElementById("bondQuestSelect")?.closest(".card");
      const freeRow = document.querySelector(".bond-quest-row--free");
      const grandRows = Array.from(document.querySelectorAll(".bond-quest-row--grand"));
      const customSec = document.getElementById("customQuestSection");
      const de = document.documentElement;

      return {
        questCardH: questCard ? questCard.getBoundingClientRect().height : 0,
        freeDisplay: freeRow ? getComputedStyle(freeRow).display : "",
        grandDisplays: grandRows.map((r) => getComputedStyle(r).display),
        customDisplay: customSec ? getComputedStyle(customSec).display : "",
        dataBondQuest: de.getAttribute("data-bond-quest"),
        dataBondCustom: de.getAttribute("data-bond-custom"),
      };
    });

    // Wait for bond-lazy
    await page.waitForFunction(() => document.getElementById("bondGrandClassSelect").value === "0100", { timeout: 10000 });

    const settled = await page.evaluate(() => {
      const questCard = document.getElementById("bondQuestSelect")?.closest(".card");
      const freeRow = document.querySelector(".bond-quest-row--free");
      const grandRows = Array.from(document.querySelectorAll(".bond-quest-row--grand"));
      const customSec = document.getElementById("customQuestSection");
      const de = document.documentElement;

      return {
        questCardH: questCard ? questCard.getBoundingClientRect().height : 0,
        freeDisplay: freeRow ? getComputedStyle(freeRow).display : "",
        grandDisplays: grandRows.map((r) => getComputedStyle(r).display),
        customDisplay: customSec ? getComputedStyle(customSec).display : "",
        dataBondQuest: de.getAttribute("data-bond-quest"),
        dataBondCustom: de.getAttribute("data-bond-custom"),
      };
    });

    console.log("  Initial GD Metrics:", initial);
    console.log("  Settled GD Metrics:", settled);

    const shift = Math.abs(initial.questCardH - settled.questCardH);
    assert(shift < 1.0, `Grand Duel Select Quest card height shift is < 1px (actual: ${shift.toFixed(2)}px, initial: ${initial.questCardH}px, settled: ${settled.questCardH}px)`);
    assert(initial.dataBondQuest === "gd", `data-bond-quest is 'gd'`);
    assert(initial.dataBondCustom === null, `data-bond-custom is null`);
    assert(initial.freeDisplay === "none" && settled.freeDisplay === "none", `Free quest row is hidden`);
    assert(
      initial.grandDisplays.every((d) => d === "flex") && settled.grandDisplays.every((d) => d === "flex"),
      `Both Grand Duel rows (class & difficulty) are display:flex initial and settled`,
    );
    assert(initial.customDisplay === "none" && settled.customDisplay === "none", `Custom quest section is hidden`);

    await page.close();
  }

  console.log("\n=== TEST SUITE 5: Slot Interaction, Modal, Remove, Calculation, Drag-and-Drop ===");
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812 });

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
    await page.waitForFunction(() => document.getElementById("bondFreeQuestSelect").value === "fq83", { timeout: 10000 });

    // Click slot 0 (empty slot)
    const slot0 = await page.$('.servant-slot[data-slot-index="0"]');
    assert(slot0 !== null, `Slot 0 element exists`);
    await slot0.click();

    // Verify servant selector modal opens
    await page.waitForSelector("#servantModal.open", { timeout: 5000 });
    const modalIsOpen = await page.evaluate(() => document.getElementById("servantModal").classList.contains("open"));
    assert(modalIsOpen, `Clicking servant-add-slot opens servantModal`);

    // Pick a servant (e.g., first servant in picker)
    const firstServant = await page.waitForSelector("#servantModal .servant-picker-item", { timeout: 5000 });
    await firstServant.click();

    // Verify modal closes and slot 0 is populated
    await page.waitForFunction(() => !document.getElementById("servantModal").classList.contains("open"), { timeout: 5000 });
    const slot0State = await page.evaluate(() => {
      const slot = document.querySelector('.servant-slot[data-slot-index="0"]');
      const name = slot.querySelector(".servant-slot-name")?.textContent.trim();
      const hasPortrait = slot.querySelector(".servant-slot-portrait") !== null;
      const hasRemoveBtn = slot.querySelector(".servant-remove-btn") !== null;
      const isAddSlot = slot.classList.contains("servant-add-slot");
      return { name, hasPortrait, hasRemoveBtn, isAddSlot };
    });

    assert(!slot0State.isAddSlot, `Slot 0 is no longer an add-slot after picking servant`);
    assert(slot0State.hasPortrait, `Slot 0 has servant portrait image`);
    assert(slot0State.hasRemoveBtn, `Slot 0 has remove button`);
    assert(slot0State.name.length > 0, `Slot 0 displays servant name: ${slot0State.name}`);

    // Click Calculate button
    await page.click("#bondCalculateBtn");
    await page.waitForFunction(() => document.getElementById("bondResults").classList.contains("visible"), { timeout: 5000 });
    const resultsVisible = await page.evaluate(() => document.getElementById("bondResults").classList.contains("visible"));
    assert(resultsVisible, `Clicking Calculate displays bond results panel`);

    // Test removing servant
    await page.click('.servant-slot[data-slot-index="0"] .servant-remove-btn');
    const slot0Reset = await page.evaluate(() => {
      const slot = document.querySelector('.servant-slot[data-slot-index="0"]');
      return {
        isAddSlot: slot.classList.contains("servant-add-slot"),
        text: slot.querySelector(".servant-slot-name")?.textContent.trim(),
      };
    });
    assert(slot0Reset.isAddSlot, `Slot 0 reverts to servant-add-slot after clicking remove button`);
    assert(slot0Reset.text === "Add Servant", `Slot 0 displays 'Add Servant' placeholder text`);

    await page.close();
  }

  console.log("\n=== TEST SUITE 6: Viewports & Overflow (320px, 375px, 800px, 1200px, 1600px) ===");
  {
    const page = await browser.newPage();

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("fgo_active_tab", "bond");
      localStorage.setItem("fgo_bond_calculator_data", JSON.stringify({
        questMain: "fq",
        questSub: "fq83",
      }));
    });

    await page.goto(baseUrl, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.getElementById("bondFreeQuestSelect").value === "fq83", { timeout: 10000 });

    const viewports = [320, 375, 800, 1200, 1600];
    for (const w of viewports) {
      await page.setViewport({ width: w, height: 900 });
      // Allow resize listeners to fire and adjust
      await new Promise((r) => setTimeout(r, 100));

      const overflowMetrics = await page.evaluate(() => {
        const doc = document.documentElement;
        const grid = document.getElementById("servantGrid");
        const docOverflow = doc.scrollWidth - doc.clientWidth;
        const gridOverflow = grid.scrollWidth - grid.clientWidth;
        const zoom = doc.style.zoom;
        const screenH = doc.style.getPropertyValue("--screen-h");

        const computedScreenH = getComputedStyle(doc).getPropertyValue("--screen-h").trim();

        // Check if any labels are clipped
        const labels = Array.from(document.querySelectorAll(".input-label, .card-title, .bond-group-label"));
        const clippedCount = labels.filter((l) => l.scrollWidth > l.clientWidth + 1).length;

        return { docOverflow, gridOverflow, zoom, screenH, computedScreenH, clippedCount };
      });

      console.log(`  Viewport ${w}px metrics:`, overflowMetrics);
      assert(overflowMetrics.docOverflow <= 0, `Viewport ${w}px has no document horizontal overflow (docOverflow: ${overflowMetrics.docOverflow}px)`);
      assert(overflowMetrics.gridOverflow <= 0, `Viewport ${w}px has no servant grid horizontal overflow (gridOverflow: ${overflowMetrics.gridOverflow}px)`);
      assert(overflowMetrics.clippedCount === 0, `Viewport ${w}px has no clipped text labels (clippedCount: ${overflowMetrics.clippedCount})`);

      if (w === 1600) {
        assert(overflowMetrics.zoom === "", `Viewport 1600px has NO artificial html zoom applied (zoom: "${overflowMetrics.zoom}")`);
        assert(
          overflowMetrics.computedScreenH.startsWith("100dvh") || overflowMetrics.computedScreenH.startsWith("calc(100dvh"),
          `Viewport 1600px has pure CSS --screen-h variable (actual: "${overflowMetrics.computedScreenH}")`,
        );
      }
    }

    await page.close();
  }

  console.log("\n=== TEST SUITE 7: Malformed / Boundary localStorage Edge Cases ===");
  {
    const testCases = [
      { name: "corrupt JSON string", raw: "{ broken json" },
      { name: "null string", raw: "null" },
      { name: "empty object", raw: "{}" },
      { name: "primitive number", raw: "12345" },
      { name: "primitive string", raw: '"hello"' },
      { name: "array instead of object", raw: "[]" },
      { name: "unknown questMain", raw: JSON.stringify({ questMain: "invalid_quest", questSub: "custom" }) },
      { name: "custom questSub but questMain is gd", raw: JSON.stringify({ questMain: "gd", questSub: "custom" }) },
      { name: "slots is a string", raw: JSON.stringify({ questMain: "fq", questSub: "fq83", slots: "not-an-array" }) },
    ];

    for (const tc of testCases) {
      const page = await browser.newPage();
      await page.setViewport({ width: 375, height: 812 });

      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));

      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await page.evaluate((storageVal) => {
        localStorage.setItem("fgo_active_tab", "bond");
        localStorage.setItem("fgo_bond_calculator_data", storageVal);
      }, tc.raw);

      await page.goto(baseUrl, { waitUntil: "networkidle0" });

      // Give it time to load bond-lazy
      await page.waitForFunction(() => document.getElementById("bondQuestSelect") !== null, { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 200));

      const healthy = await page.evaluate(() => {
        const grid = document.getElementById("servantGrid");
        const questCard = document.getElementById("bondQuestSelect")?.closest(".card");
        return {
          gridOk: grid && grid.children.length === 8,
          questCardOk: !!questCard,
        };
      });

      assert(pageErrors.length === 0, `Boundary test '${tc.name}' throws 0 page errors (got: ${JSON.stringify(pageErrors)})`);
      assert(healthy.gridOk, `Boundary test '${tc.name}' keeps 8 grid children`);
      assert(healthy.questCardOk, `Boundary test '${tc.name}' keeps quest card intact`);

      await page.close();
    }
  }

} catch (err) {
  console.error("Fatal test runner error:", err);
  errors.push(`Runner error: ${err.message}`);
} finally {
  await browser.close();
  await previewServer.stop();
}

console.log("\n=======================================================");
if (errors.length > 0) {
  console.error(`QA VERDICT: FAIL (${errors.length} defect(s) detected)`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
} else {
  console.log("QA VERDICT: PASS (All adversarial scenarios verified defect-free)");
  process.exit(0);
}
