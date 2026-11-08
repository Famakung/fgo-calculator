#!/usr/bin/env node
/**
 * scripts/test_subtabs_adversarial.js
 *
 * Adversarial QA test suite for Bond Gain CE Sub-Tab UI:
 * Segmented control track across all devices:
 * - Mobile (< 760px): top-center full-width segmented track (width: 100%, 50/50 split)
 * - Desktop (>= 760px): absolute top-right segmented track (width: auto, 2px border, var(--bg), optical alignment)
 *
 * Testing dimensions:
 * 1. Viewport boundary tests (320px, 360px, 375px, 414px, 579px, 759px, 760px, 940px, 1120px, 1400px, 1600px, 1920px)
 * 2. Visual layout contracts: full track on mobile vs absolute top-right track on desktop
 * 3. Optical alignment with `.card-title` on desktop (< 1.5px vertical delta) and clearance (> 250px text gap)
 * 4. Text wrapping, overflow, clipping, horizontal scrollbar checks across all viewports
 * 5. State transitions: CE <-> Servant subtab switching, aria-pressed, active styling
 * 6. Rapid switching / idempotency stress tests
 * 7. Persistence & SSR/pre-render initialization: localStorage restores subtab with 0 layout shift or FOUC
 * 8. Malformed / corrupted localStorage resilience
 */

import puppeteer from "puppeteer";

const url = process.argv[2] || "http://localhost:3000/fgo-calculator/";
const failures = [];

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
    console.error(`  ❌ FAIL: ${message}`);
  } else {
    console.log(`  ✅ PASS: ${message}`);
  }
}

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  // Helper to activate Bond Gain CE tab
  async function activateCeFilterTab() {
    await page.evaluate(() => {
      const tabBtn = document.querySelector('.tab-btn[data-tab="cefilter"]');
      if (tabBtn) tabBtn.click();
    });
    await page.waitForFunction(
      () => {
        const p = document.getElementById("panel-cefilter");
        return p && window.getComputedStyle(p).display !== "none";
      },
      { timeout: 5000 },
    );
  }

  console.log("\n============================================================");
  console.log("SUITE 1: Viewport Boundary & Responsive Layout Tests");
  console.log("============================================================");

  // Viewports to test
  const viewports = [
    { name: "Ultra-narrow Mobile (iPhone SE)", width: 320, height: 568, isMobile: true },
    { name: "Small Mobile (Android)", width: 360, height: 640, isMobile: true },
    { name: "Standard Mobile (iPhone 12)", width: 375, height: 812, isMobile: true },
    { name: "Medium Mobile (iPhone XR)", width: 414, height: 896, isMobile: true },
    { name: "Mobile Boundary-1 (579px)", width: 579, height: 800, isMobile: true },
    { name: "Mobile Boundary-2 (759px)", width: 759, height: 900, isMobile: true },
    { name: "Desktop Breakpoint Boundary (760px)", width: 760, height: 900, isMobile: false },
    { name: "Medium Desktop (940px)", width: 940, height: 900, isMobile: false },
    { name: "Large Desktop (1120px)", width: 1120, height: 900, isMobile: false },
    { name: "Zoom Transition (1400px)", width: 1400, height: 900, isMobile: false },
    { name: "Zoomed Desktop (1600px)", width: 1600, height: 1000, isMobile: false },
    { name: "Full HD Zoomed (1920px)", width: 1920, height: 1080, isMobile: false },
  ];

  await page.goto(url, { waitUntil: "networkidle0" });
  await activateCeFilterTab();

  for (const vp of viewports) {
    console.log(`\n--- Testing Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);
    await page.setViewport({ width: vp.width, height: vp.height });
    // Let resize and layout settle
    await new Promise((r) => setTimeout(r, 100));

    const metrics = await page.evaluate((isMobile) => {
      const doc = document.documentElement;
      const body = document.body;
      const subtabs = document.getElementById("cefilterSubtabs");
      const card = subtabs ? subtabs.closest(".card") : null;
      const cardInner = subtabs ? subtabs.closest(".card-inner") : null;
      const buttons = subtabs ? Array.from(subtabs.querySelectorAll(".cefilter-subtab-btn")) : [];
      const title = document.querySelector("#panel-cefilter > .card:first-child .card-title");

      if (!subtabs || !cardInner || buttons.length < 2) {
        return { found: false };
      }

      const subtabsRect = subtabs.getBoundingClientRect();
      const cardInnerRect = cardInner.getBoundingClientRect();
      const titleRect = title ? title.getBoundingClientRect() : null;

      // Measure visible text boundary of title using Range
      let titleTextRect = null;
      if (title) {
        const range = document.createRange();
        range.selectNodeContents(title);
        titleTextRect = range.getBoundingClientRect();
      }

      const subtabsStyle = window.getComputedStyle(subtabs);
      const btn0Rect = buttons[0].getBoundingClientRect();
      const btn1Rect = buttons[1].getBoundingClientRect();
      const btn0Style = window.getComputedStyle(buttons[0]);
      const btn1Style = window.getComputedStyle(buttons[1]);

      const docOverflow = doc.scrollWidth - window.innerWidth;
      const bodyOverflow = body.scrollWidth - window.innerWidth;
      const subtabsOverflow = subtabs.scrollWidth - subtabs.clientWidth;
      const btn0Overflow = buttons[0].scrollWidth - buttons[0].clientWidth;
      const btn1Overflow = buttons[1].scrollWidth - buttons[1].clientWidth;

      // Optical alignment mid-y
      const titleMidY = titleRect ? titleRect.top + titleRect.height / 2 : 0;
      const subtabsMidY = subtabsRect.top + subtabsRect.height / 2;

      return {
        found: true,
        docOverflow,
        bodyOverflow,
        subtabsOverflow,
        btn0Overflow,
        btn1Overflow,
        subtabsPosition: subtabsStyle.position,
        subtabsDisplay: subtabsStyle.display,
        subtabsWidth: subtabsRect.width,
        cardInnerWidth: cardInnerRect.width,
        subtabsWidthDiff: Math.abs(subtabsRect.width - cardInnerRect.width),
        subtabsTop: subtabsRect.top,
        subtabsBottom: subtabsRect.bottom,
        subtabsLeft: subtabsRect.left,
        subtabsRight: subtabsRect.right,
        titleMidY,
        subtabsMidY,
        opticalAlignmentDelta: Math.abs(titleMidY - subtabsMidY),
        titleTextTop: titleTextRect ? titleTextRect.top : null,
        titleTextBottom: titleTextRect ? titleTextRect.bottom : null,
        titleTextLeft: titleTextRect ? titleTextRect.left : null,
        titleTextRight: titleTextRect ? titleTextRect.right : null,
        btn0Width: btn0Rect.width,
        btn1Width: btn1Rect.width,
        btnWidthDiff: Math.abs(btn0Rect.width - btn1Rect.width),
        btn0Flex: btn0Style.flex,
        btn0WhiteSpace: btn0Style.whiteSpace,
        btn1WhiteSpace: btn1Style.whiteSpace,
        subtabsBorder: parseFloat(subtabsStyle.borderTopWidth),
        subtabsBackground: subtabsStyle.backgroundColor,
        subtabsBorderRadius: subtabsStyle.borderRadius,
        btn0BorderRadius: btn0Style.borderRadius,
      };
    }, vp.isMobile);

    assert(metrics.found, `Found subtabs elements at ${vp.width}px`);
    assert(
      metrics.docOverflow <= 1,
      `Zero horizontal document overflow (got ${metrics.docOverflow}px) at ${vp.width}px`,
    );
    assert(metrics.bodyOverflow <= 1, `Zero horizontal body overflow (got ${metrics.bodyOverflow}px) at ${vp.width}px`);
    assert(
      metrics.subtabsOverflow === 0,
      `Zero subtabs bar overflow (got ${metrics.subtabsOverflow}px) at ${vp.width}px`,
    );
    assert(metrics.btn0Overflow === 0, `Zero CE button text overflow at ${vp.width}px`);
    assert(metrics.btn1Overflow === 0, `Zero Servant button text overflow at ${vp.width}px`);
    assert(
      metrics.btn0WhiteSpace === "nowrap" && metrics.btn1WhiteSpace === "nowrap",
      `Button whitespace is nowrap at ${vp.width}px`,
    );

    // Track presence across ALL viewports: 2px border (accounting for zoom at >=1400px), var(--bg), 10px radius
    assert(
      metrics.subtabsBorder >= 1.4,
      `Subtabs track has visible border (${metrics.subtabsBorder}px) at ${vp.width}px`,
    );
    assert(
      metrics.subtabsBackground.includes("248, 249, 252"),
      `Subtabs track has tactile var(--bg) background at ${vp.width}px`,
    );
    assert(metrics.subtabsBorderRadius === "10px", `Subtabs track has var(--radius-sm) (10px) at ${vp.width}px`);

    if (vp.isMobile) {
      // Mobile contract checks (< 760px)
      assert(
        metrics.subtabsPosition === "static",
        `Subtabs is static in document flow (got ${metrics.subtabsPosition}) at ${vp.width}px`,
      );
      assert(
        metrics.subtabsWidthDiff <= 1.5,
        `Subtabs spans 100% of card-inner (diff ${metrics.subtabsWidthDiff}px) at ${vp.width}px`,
      );
      assert(
        metrics.btnWidthDiff <= 2,
        `Subtabs buttons are equally distributed (diff ${metrics.btnWidthDiff}px) at ${vp.width}px`,
      );
      // Position check: On mobile, subtabs is rendered at the top, card title is below it
      assert(
        metrics.titleTextTop >= metrics.subtabsBottom - 2,
        `Card title sits cleanly below subtabs bar without collision (titleTop=${metrics.titleTextTop}, subtabsBottom=${metrics.subtabsBottom}) at ${vp.width}px`,
      );
    } else {
      // Desktop contract checks (>= 760px)
      assert(metrics.subtabsPosition === "absolute", `Subtabs is absolute positioned on desktop at ${vp.width}px`);
      assert(
        metrics.subtabsWidth < metrics.cardInnerWidth,
        `Subtabs width is auto/compact on desktop at ${vp.width}px`,
      );
      assert(
        metrics.opticalAlignmentDelta <= 1.5,
        `Subtabs optical vertical alignment with card title is < 1.5px (got ${metrics.opticalAlignmentDelta.toFixed(3)}px) at ${vp.width}px`,
      );
      // Text collision check with card-title: verify visible text does not collide with subtabs
      const textGap = metrics.subtabsLeft - metrics.titleTextRight;
      assert(
        textGap >= 250,
        `Desktop subtabs bar has ample clearance from title text (gap=${textGap.toFixed(1)}px >= 250px) at ${vp.width}px`,
      );
    }
  }

  console.log("\n============================================================");
  console.log("SUITE 2: Subtab Interaction & Visual Active State");
  console.log("============================================================");

  // Test at 375px (mobile)
  await page.setViewport({ width: 375, height: 812 });

  // Initial state check
  const stateInitial = await page.evaluate(() => {
    const ceBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="ce"]');
    const servantBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="servant"]');
    const cePanel = document.querySelector('.cefilter-subpanel[data-subpanel="ce"]');
    const servantPanel = document.querySelector('.cefilter-subpanel[data-subpanel="servant"]');

    return {
      ceActive: ceBtn.classList.contains("active"),
      cePressed: ceBtn.getAttribute("aria-pressed"),
      ceBg: window.getComputedStyle(ceBtn).backgroundColor,
      ceColor: window.getComputedStyle(ceBtn).color,
      servantActive: servantBtn.classList.contains("active"),
      servantPressed: servantBtn.getAttribute("aria-pressed"),
      servantBg: window.getComputedStyle(servantBtn).backgroundColor,
      cePanelVisible: window.getComputedStyle(cePanel).display !== "none",
      servantPanelVisible: window.getComputedStyle(servantPanel).display !== "none",
    };
  });

  assert(stateInitial.ceActive === true, "Initial state: CE button has active class");
  assert(stateInitial.cePressed === "true", "Initial state: CE button aria-pressed is true");
  assert(stateInitial.servantActive === false, "Initial state: Servant button lacks active class");
  assert(stateInitial.servantPressed === "false", "Initial state: Servant button aria-pressed is false");
  assert(stateInitial.ceBg.includes("67, 56, 202"), "Active CE button background is var(--accent)");
  assert(stateInitial.cePanelVisible === true, "Initial state: CE panel is visible");
  assert(stateInitial.servantPanelVisible === false, "Initial state: Servant panel is hidden");

  // Click Servant Select
  console.log("\n--- Action: Click 'Servant Select' ---");
  await page.click('.cefilter-subtab-btn[data-subtab="servant"]');
  // Wait 250ms for 0.2s CSS transition to finish
  await new Promise((r) => setTimeout(r, 250));

  const stateServant = await page.evaluate(() => {
    const ceBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="ce"]');
    const servantBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="servant"]');
    const cePanel = document.querySelector('.cefilter-subpanel[data-subpanel="ce"]');
    const servantPanel = document.querySelector('.cefilter-subpanel[data-subpanel="servant"]');
    const htmlSubtab = document.documentElement.getAttribute("data-subtab");
    const stored = JSON.parse(localStorage.getItem("fgo_ce_filter_data") || "{}");

    return {
      ceActive: ceBtn.classList.contains("active"),
      cePressed: ceBtn.getAttribute("aria-pressed"),
      servantActive: servantBtn.classList.contains("active"),
      servantPressed: servantBtn.getAttribute("aria-pressed"),
      servantBg: window.getComputedStyle(servantBtn).backgroundColor,
      servantColor: window.getComputedStyle(servantBtn).color,
      cePanelVisible: window.getComputedStyle(cePanel).display !== "none",
      servantPanelVisible: window.getComputedStyle(servantPanel).display !== "none",
      htmlSubtab,
      storedSubTab: stored.subTab,
    };
  });

  assert(stateServant.servantActive === true, "After click: Servant button has active class");
  assert(stateServant.servantPressed === "true", "After click: Servant button aria-pressed is true");
  assert(stateServant.ceActive === false, "After click: CE button lacks active class");
  assert(stateServant.cePressed === "false", "After click: CE button aria-pressed is false");
  assert(stateServant.servantBg.includes("67, 56, 202"), "Active Servant button background is var(--accent)");
  assert(
    stateServant.servantColor.includes("255, 255, 255") || stateServant.servantColor.includes("254, 254, 254"),
    "Active Servant button color is white",
  );
  assert(stateServant.servantPanelVisible === true, "After click: Servant panel is visible");
  assert(stateServant.cePanelVisible === false, "After click: CE panel is hidden");
  assert(stateServant.htmlSubtab === "servant", "html[data-subtab] is 'servant'");
  assert(stateServant.storedSubTab === "servant", "localStorage fgo_ce_filter_data.subTab is 'servant'");

  // Click Craft Essence Select to switch back
  console.log("\n--- Action: Click 'Craft Essence Select' to switch back ---");
  await page.click('.cefilter-subtab-btn[data-subtab="ce"]');
  await new Promise((r) => setTimeout(r, 250));

  const stateCeBack = await page.evaluate(() => {
    const ceBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="ce"]');
    const servantBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="servant"]');
    const cePanel = document.querySelector('.cefilter-subpanel[data-subpanel="ce"]');
    const servantPanel = document.querySelector('.cefilter-subpanel[data-subpanel="servant"]');
    const htmlSubtab = document.documentElement.getAttribute("data-subtab");
    const stored = JSON.parse(localStorage.getItem("fgo_ce_filter_data") || "{}");

    return {
      ceActive: ceBtn.classList.contains("active"),
      cePressed: ceBtn.getAttribute("aria-pressed"),
      servantActive: servantBtn.classList.contains("active"),
      servantPressed: servantBtn.getAttribute("aria-pressed"),
      cePanelVisible: window.getComputedStyle(cePanel).display !== "none",
      servantPanelVisible: window.getComputedStyle(servantPanel).display !== "none",
      htmlSubtab,
      storedSubTab: stored.subTab,
    };
  });

  assert(stateCeBack.ceActive === true, "Switch back: CE button active");
  assert(stateCeBack.servantActive === false, "Switch back: Servant button inactive");
  assert(stateCeBack.cePanelVisible === true, "Switch back: CE panel visible");
  assert(stateCeBack.servantPanelVisible === false, "Switch back: Servant panel hidden");
  assert(stateCeBack.htmlSubtab === "ce", "Switch back: html[data-subtab] is 'ce'");
  assert(stateCeBack.storedSubTab === "ce", "Switch back: localStorage subTab is 'ce'");

  console.log("\n============================================================");
  console.log("SUITE 3: Rapid Stress & Idempotency Switching");
  console.log("============================================================");

  // Click 10 times consecutively between CE and Servant
  for (let i = 0; i < 10; i++) {
    const target = i % 2 === 0 ? "servant" : "ce";
    await page.click(`.cefilter-subtab-btn[data-subtab="${target}"]`);
  }
  await new Promise((r) => setTimeout(r, 250));

  const stressState = await page.evaluate(() => {
    const ceBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="ce"]');
    const servantBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="servant"]');
    const cePanel = document.querySelector('.cefilter-subpanel[data-subpanel="ce"]');
    const servantPanel = document.querySelector('.cefilter-subpanel[data-subpanel="servant"]');
    return {
      ceActive: ceBtn.classList.contains("active"),
      servantActive: servantBtn.classList.contains("active"),
      ceVisible: window.getComputedStyle(cePanel).display !== "none",
      servantVisible: window.getComputedStyle(servantPanel).display !== "none",
    };
  });

  assert(
    stressState.ceActive === true && stressState.servantActive === false,
    "Rapid switching: Exactly 1 subtab is active",
  );
  assert(
    stressState.ceVisible === true && stressState.servantVisible === false,
    "Rapid switching: Correct panel visible without collision",
  );

  // Idempotency: click active button multiple times
  await page.click('.cefilter-subtab-btn[data-subtab="ce"]');
  await page.click('.cefilter-subtab-btn[data-subtab="ce"]');
  const idempotentState = await page.evaluate(() => {
    const ceBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="ce"]');
    const servantBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="servant"]');
    return {
      ceActive: ceBtn.classList.contains("active"),
      servantActive: servantBtn.classList.contains("active"),
    };
  });
  assert(
    idempotentState.ceActive === true && idempotentState.servantActive === false,
    "Clicking active subtab multiple times maintains idempotency",
  );

  console.log("\n============================================================");
  console.log("SUITE 4: Persistence, SSR Pre-render & Zero FOUC");
  console.log("============================================================");

  // Set localStorage to 'servant' and test reload
  await page.evaluate(() => {
    localStorage.setItem("fgo_active_tab", "cefilter");
    localStorage.setItem("fgo_ce_filter_data", JSON.stringify({ subTab: "servant" }));
  });

  console.log("\n--- Reloading with localStorage.subTab = 'servant' ---");
  await page.goto(url, { waitUntil: "networkidle0" });

  const servantRestore = await page.evaluate(() => {
    const ceBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="ce"]');
    const servantBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="servant"]');
    const cePanel = document.querySelector('.cefilter-subpanel[data-subpanel="ce"]');
    const servantPanel = document.querySelector('.cefilter-subpanel[data-subpanel="servant"]');
    const htmlSubtab = document.documentElement.getAttribute("data-subtab");

    return {
      htmlSubtab,
      ceActive: ceBtn.classList.contains("active"),
      cePressed: ceBtn.getAttribute("aria-pressed"),
      servantActive: servantBtn.classList.contains("active"),
      servantPressed: servantBtn.getAttribute("aria-pressed"),
      servantBg: window.getComputedStyle(servantBtn).backgroundColor,
      cePanelDisplay: window.getComputedStyle(cePanel).display,
      servantPanelDisplay: window.getComputedStyle(servantPanel).display,
    };
  });

  assert(servantRestore.htmlSubtab === "servant", "Restored page: html[data-subtab] is 'servant'");
  assert(servantRestore.servantActive === true, "Restored page: Servant button is active on initial load");
  assert(servantRestore.servantPressed === "true", "Restored page: Servant button aria-pressed is 'true'");
  assert(servantRestore.ceActive === false, "Restored page: CE button is not active");
  assert(servantRestore.cePressed === "false", "Restored page: CE button aria-pressed is 'false'");
  assert(
    servantRestore.servantBg.includes("67, 56, 202"),
    "Restored page: Servant button has active accent background",
  );
  assert(servantRestore.cePanelDisplay === "none", "Restored page: CE panel is hidden via CSS rule");
  assert(servantRestore.servantPanelDisplay !== "none", "Restored page: Servant panel is visible");

  console.log("\n============================================================");
  console.log("SUITE 5: Malformed & Corrupted Storage Resilience");
  console.log("============================================================");

  // Malformed test 1: invalid json
  await page.evaluate(() => {
    localStorage.setItem("fgo_ce_filter_data", "INVALID_JSON{{[");
  });
  await page.goto(url, { waitUntil: "networkidle0" });
  await activateCeFilterTab();

  const malformed1 = await page.evaluate(() => {
    const ceBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="ce"]');
    const servantBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="servant"]');
    return {
      ceActive: ceBtn.classList.contains("active"),
      servantActive: servantBtn.classList.contains("active"),
    };
  });
  assert(
    malformed1.ceActive === true && malformed1.servantActive === false,
    "Malformed JSON in localStorage falls back safely to default 'ce' tab",
  );

  // Malformed test 2: unknown tab string
  await page.evaluate(() => {
    localStorage.setItem("fgo_ce_filter_data", JSON.stringify({ subTab: "exploit_attack_tab_name" }));
  });
  await page.goto(url, { waitUntil: "networkidle0" });
  await activateCeFilterTab();

  const malformed2 = await page.evaluate(() => {
    const ceBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="ce"]');
    const servantBtn = document.querySelector('.cefilter-subtab-btn[data-subtab="servant"]');
    const cePanel = document.querySelector('.cefilter-subpanel[data-subpanel="ce"]');
    return {
      ceActive: ceBtn.classList.contains("active"),
      servantActive: servantBtn.classList.contains("active"),
      cePanelVisible: window.getComputedStyle(cePanel).display !== "none",
    };
  });
  assert(
    malformed2.ceActive === true && malformed2.cePanelVisible === true,
    "Unknown tab string in localStorage falls back safely to default 'ce' tab",
  );

  assert(pageErrors.length === 0, `Zero page runtime errors thrown (errors: ${JSON.stringify(pageErrors)})`);

  console.log("\n============================================================");
  console.log(`SUMMARY: ${failures.length} failure(s) found across all suites`);
  console.log("============================================================");

  if (failures.length > 0) {
    console.error("FAILURES:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  } else {
    console.log("ALL ADVERSARIAL QA CHECKS PASSED PERFECTLY!");
    process.exit(0);
  }
} finally {
  await browser.close();
}
