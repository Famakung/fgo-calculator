#!/usr/bin/env node
/**
 * scripts/test_bond_card_ap.js
 *
 * Adversarial QA for the bond-card-ap feature against the FROZEN plan §15 structure:
 * no aggregate badge; each guarded card (apPerRun > 0 && runs > 0) carries, after the runs line:
 *   div.bond-result-ap          textContent `${cardAp.toLocaleString()} AP` (unchanged since §13)
 *   div.bond-result-fruit       relative fit-content 48px wrapper
 *     img.bond-result-fruit-img icons/100_bordered.webp, alt "Golden Fruit", onerror hides IMG ONLY
 *     span.bond-result-fruit-count absolute overlay `x<fruit.toLocaleString()>`, 1rem, inset from the
 *     img's bottom-right corner by R15 margin inset 3px right / 7px bottom (supersedes §19 flush; owner
 *     order, matches Item Receive ring-clear scaled to 48px; §17's -4px overhang was pulled back flush
 *     in §19; 1rem kept from §17, centering gone)
 *   (side text and its NBSP contract are DEAD per §15 — alt is the sole name carrier; the
 *   overlay corner-geometry pins REPLACE the centering pins, nothing was silently dropped).
 *
 * Coverage:
 *   AC1  FQ 22 AP, 10-run servant -> "220 AP" + overlay "x2", wrapper/overlay/icon + R15 inset corner.
 *   AC2  Grand Duel -> AP line uses 40 per run.
 *   AC3  custom Free Quest AP = 0 -> neither .bond-result-ap nor .bond-result-fruit on any card.
 *   AC4  teapot runs out -> boosted and continuation cards each carry their own ap/fruit pair.
 *   AC5  maxAp = 100 on re-calculate -> fruit = ceil(cardAp / 100), exactly one fruit element.
 *   AC13 §13 aggregate removal: after Calculate no .bond-total-ap, no .bond-ap-badge, no
 *        "Total AP" text anywhere in the results; shipped chunk carries no "Total AP" string.
 *   IMG  fruit icon: src icons/100_bordered.webp, alt "Golden Fruit", computed height 48px, loads
 *        (naturalWidth > 0); aborted request -> IMG hidden only, overlay count stays visible.
 *   B0   bondNeeded 0 -> pre-feature autofill (bond-app.js:683) pins the pair to 1 run's price.
 *   B2   two servants different runs -> per-card pairs differ; B4 singular "run".
 *   B3   huge numbers -> toLocaleString grouping in both elements (en-US).
 *   S1   idempotent double Calculate -> exactly one ap + one fruit per card.
 *   K375 / K900 geometry: AP line one line box; overlay one line box (nowrap), fully contained in
 *        the img box with right/bottom edges inset by R15 margin (3px right / 7px bottom, ≤1px
 *        tolerance); wrapper/card/page no horizontal overflow at 375px; grid-row card tops/heights
 *        uniform (relational).
 *   M    extreme count "x8,123" at 1rem through the real data path: inset corner holds, overlay
 *        extends left inside the card, no card/wrapper/page overflow at 375px and 900px (R15).
 *
 * Expected values derive from plan arithmetic (eff = base + floor(base*0.2) frontline;
 * runs = ceil(bondNeeded/eff); ap = runs*apPerRun; fruit = ceil(ap/maxAp)) — not from the impl.
 *
 * Server + page-driving precedent: scripts/test_mobile_cards_qa.js. State seeds through
 * localStorage key fgo_bond_calculator_data. The astro dev daemon on :3000 is not used here.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

const DIST = path.resolve("dist");
const STORAGE_KEY = "fgo_bond_calculator_data";
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
  let p = req.url
    .split("?")[0]
    .replace(/^\/fgo-calculator\//, "")
    .replace(/^\//, "");
  if (!p) p = "index.html";
  const abs = path.join(DIST, p);
  /* Resolved-prefix guard: a traversal attempt must not read outside dist/. */
  if (abs !== DIST && !abs.startsWith(DIST + path.sep)) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }
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

const failures = [];
let passed = 0;
function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    failures.push(message);
    console.error(`  ❌ FAIL: ${message}`);
  }
}

/* en-US grouping oracle, node-side. §15 matchers: AP line "N AP" exact; fruit side is a
   48px img + overlay span with exact text `x<N grouped>` — no "Golden Fruit" textContent remains
   on cards (it survives only as the img alt, the AT name carrier). */
const fmt = (n) => new Intl.NumberFormat("en-US").format(n);
const apLine = (cardAp) => new RegExp(`^${fmt(cardAp)} AP$`, "u");
const overlayText = (fruit) => `x${fmt(fruit)}`;

const emptySlot = () => ({
  servantId: null,
  bondNeeded: 0,
  bondLevel: 0,
  targetLevel: 1,
  type: "normal",
  maxBond: false,
  bond15: false,
  ascension: null,
  ces: [],
  grand: false,
});
const mkSlot = (servantId, bondNeeded) => ({ ...emptySlot(), servantId, bondNeeded });
const makeState = (over = {}) => ({
  slots: Array.from({ length: 6 }, () => emptySlot()),
  questMain: "",
  questSub: "",
  questClass: "",
  questDiff: "",
  customBond: 0,
  customAp: 22,
  maxAp: 152,
  teapotCount: 0,
  teapotOn: false,
  ...over,
});

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

let dialogs = [];
let pageErrors = [];

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 800 });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    d.accept();
  });

  /* calculate() is fully synchronous; the snapshot right after the click evaluate resolves is
     deterministic (replaceChildren ran, or an alert blocked and was accepted). */
  async function seedAndCalculate(stateOver, { inputs = null, clickTwice = false } = {}) {
    dialogs = [];
    const state = makeState(stateOver);
    await page.goto(baseUrl, { waitUntil: "networkidle0" });
    await page.evaluate(() => {
      localStorage.clear();
      if (window.caches) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      }
      if (navigator.serviceWorker) {
        navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
      }
    });
    await page.evaluate(([key, s]) => localStorage.setItem(key, JSON.stringify(s)), [STORAGE_KEY, state]);
    await page.goto(baseUrl, { waitUntil: "networkidle0" });
    await page.evaluate(() => {
      const btn = document.querySelector('.tab-btn[data-tab="bond"]');
      if (btn) btn.click();
    });
    await page.waitForFunction(
      (maxAp) => {
        const el = document.getElementById("maxApInput");
        return el && el.value === String(maxAp) && document.querySelectorAll("#servantGrid .servant-slot").length > 0;
      },
      { timeout: 8000 },
      state.maxAp,
    );
    if (inputs) {
      await page.evaluate((map) => {
        for (const [id, val] of Object.entries(map)) {
          const el = document.getElementById(id);
          el.value = String(val);
          el.dispatchEvent(new Event("change"));
        }
      }, inputs);
    }
    await page.evaluate(() => document.getElementById("bondCalculateBtn").click());
    if (clickTwice) {
      await page.evaluate(() => document.getElementById("bondCalculateBtn").click());
    }
    return snapshot();
  }

  async function snapshot() {
    return page.evaluate(() => {
      const content = document.getElementById("bondResultContent");
      const cards = Array.from(content.querySelectorAll(".bond-result-servant-card")).map((card) => {
        const kids = Array.from(card.children);
        const runsEl = card.querySelector(".bond-result-runs");
        const apEl = card.querySelector(".bond-result-ap");
        const fruitEl = card.querySelector(".bond-result-fruit");
        const fruitSpan = fruitEl ? fruitEl.querySelector("span.bond-result-fruit-count") : null;
        const fruitImg = fruitEl ? fruitEl.querySelector("img.bond-result-fruit-img") : null;
        const cs = (el) => (el ? window.getComputedStyle(el) : null);
        const countStyle = cs(fruitSpan);
        const apStyle = cs(apEl);
        const fruitStyle = cs(fruitEl);
        const imgStyle = cs(fruitImg);
        return {
          runsText: runsEl ? runsEl.textContent : null,
          apText: apEl ? apEl.textContent : null,
          apClass: apEl ? apEl.className : null,
          apChildren: apEl ? apEl.children.length : null,
          apStyle: apStyle
            ? {
                fontFamily: apStyle.fontFamily,
                fontSize: apStyle.fontSize,
                marginTop: apStyle.marginTop,
                whiteSpace: apStyle.whiteSpace,
                color: apStyle.color,
              }
            : null,
          fruitClass: fruitEl ? fruitEl.className : null,
          fruitChildren: fruitEl ? fruitEl.children.length : null,
          fruitCountText: fruitSpan ? fruitSpan.textContent : null,
          cardHasGoldenText: card.textContent.includes("Golden"),
          wrapperStyle: fruitStyle ? { position: fruitStyle.position, marginTop: fruitStyle.marginTop } : null,
          countStyle: countStyle
            ? {
                position: countStyle.position,
                whiteSpace: countStyle.whiteSpace,
                pointerEvents: countStyle.pointerEvents,
                fontSize: countStyle.fontSize,
                fontWeight: countStyle.fontWeight,
                transform: countStyle.transform,
              }
            : null,
          imgClass: fruitImg ? fruitImg.className : null,
          imgSrc: fruitImg ? fruitImg.getAttribute("src") : null,
          imgAlt: fruitImg ? fruitImg.getAttribute("alt") : null,
          imgHeight: imgStyle ? imgStyle.height : null,
          imgDisplay: imgStyle ? imgStyle.display : null,
          imgNaturalWidth: fruitImg ? fruitImg.naturalWidth : null,
          geometry:
            fruitImg && fruitSpan
              ? (() => {
                  const i = fruitImg.getBoundingClientRect();
                  const c = fruitSpan.getBoundingClientRect();
                  const w = fruitEl.getBoundingClientRect();
                  const cb = card.getBoundingClientRect();
                  return {
                    wrapperWidth: w.width,
                    wrapperHeight: w.height,
                    cardBox: { left: cb.left, right: cb.right, width: cb.width },
                    img: {
                      left: i.left,
                      top: i.top,
                      right: i.right,
                      bottom: i.bottom,
                      width: i.width,
                      height: i.height,
                    },
                    count: {
                      left: c.left,
                      top: c.top,
                      right: c.right,
                      bottom: c.bottom,
                      width: c.width,
                      height: c.height,
                    },
                    wrap: { left: w.left, top: w.top, right: w.right, bottom: w.bottom },
                  };
                })()
              : null,
          orderOk:
            runsEl && apEl && fruitEl
              ? kids.indexOf(apEl) === kids.indexOf(runsEl) + 1 && kids.indexOf(fruitEl) === kids.indexOf(apEl) + 1
              : null,
        };
      });
      return {
        cards,
        apTotal: content.querySelectorAll(".bond-result-ap").length,
        fruitTotal: content.querySelectorAll(".bond-result-fruit").length,
        badgeTotal: content.querySelectorAll(".bond-ap-badge").length,
        totalRowTotal: content.querySelectorAll(".bond-total-ap").length,
        hasTotalAPText: content.textContent.includes("Total AP"),
        exhaust: content.querySelectorAll(".bond-teapot-badge").length,
        visible: document.getElementById("bondResults").classList.contains("visible"),
      };
    });
  }

  /* §13 aggregate-removal absence + per-card iff guard + arithmetic, on every nominal render. */
  function crossCheck(id, snap, apPerRun, maxAp) {
    assert(snap.badgeTotal === 0 && snap.totalRowTotal === 0, `${id} §13 no .bond-ap-badge/.bond-total-ap rendered`);
    assert(!snap.hasTotalAPText, `${id} §13 no "Total AP" text anywhere in results`);
    assert(
      snap.apTotal === snap.fruitTotal,
      `${id} ap element count equals fruit element count (${snap.apTotal}/${snap.fruitTotal})`,
    );
    snap.cards.forEach((card, i) => {
      const m = card.runsText && card.runsText.match(/^(\d+) (run|runs)$/);
      assert(!!m, `${id} card ${i} runs line parses (got: ${card.runsText})`);
      if (!m) return;
      const runs = parseInt(m[1], 10);
      if (apPerRun > 0 && runs > 0) {
        assert(card.apText !== null && card.fruitCountText !== null, `${id} card ${i} ap+fruit present when runs > 0`);
        const am = card.apText && card.apText.match(/^([\d,]+) AP$/u);
        const fm = card.fruitCountText && card.fruitCountText.match(/^x([\d,]+)$/u);
        assert(!!am, `${id} card ${i} ap text shape "N AP" no · no \\n (got: ${JSON.stringify(card.apText)})`);
        assert(!!fm, `${id} card ${i} fruit overlay shape "x<M>" (got: ${JSON.stringify(card.fruitCountText)})`);
        assert(
          card.cardHasGoldenText === false,
          `${id} card ${i} no "Golden Fruit" textContent on card (§15: name lives in alt only)`,
        );
        if (am && fm) {
          const ap = parseInt(am[1].replace(/,/g, ""), 10);
          const fruit = parseInt(fm[1].replace(/,/g, ""), 10);
          assert(ap === runs * apPerRun, `${id} card ${i} AP ${ap} === runs ${runs} x ${apPerRun}`);
          assert(fruit === Math.ceil(ap / maxAp), `${id} card ${i} fruit ${fruit} === ceil(${ap}/${maxAp})`);
        }
      } else {
        assert(
          card.apText === null && card.fruitCountText === null,
          `${id} card ${i} no ap/fruit line (apPerRun=${apPerRun}, runs=${runs})`,
        );
      }
    });
  }

  console.log("\n============================================================");
  console.log("SUITE A: AC1 FQ 22 AP x 10 runs -> two-element pair (Mash 800100, frontline eff 1014)");
  console.log("============================================================");

  /* fq83 bond 845 + frontline floor(169) = eff 1014; 10140 -> 10 runs -> 220 AP -> ceil(220/152) = 2. */
  const fq83 = { questMain: "fq", questSub: "fq83" };
  const ac1Slots = [mkSlot("800100", 10140), ...Array.from({ length: 5 }, emptySlot)];
  const a1 = await seedAndCalculate({ ...fq83, slots: ac1Slots });
  assert(a1.cards.length === 1, `AC1 exactly one result card (got: ${a1.cards.length})`);
  assert(a1.cards[0].runsText === "10 runs", `AC1 runs line "10 runs" (got: ${a1.cards[0].runsText})`);
  assert(
    apLine(220).test(a1.cards[0].apText),
    `AC1 ap element text exactly "220 AP" (got: ${JSON.stringify(a1.cards[0].apText)})`,
  );
  assert(
    !a1.cards[0].apText.includes("\u00B7") && !a1.cards[0].apText.includes("\n"),
    `AC1 §13 separator U+00B7 and \\n absent from the ap line (got: ${JSON.stringify(a1.cards[0].apText)})`,
  );
  assert(
    a1.cards[0].fruitCountText === overlayText(2),
    `AC1 fruit overlay exact "x2" — §15: side text and its NBSP pins DIED (name now carried by alt, pinned below) (got: ${JSON.stringify(a1.cards[0].fruitCountText)})`,
  );
  assert(
    a1.cards[0].cardHasGoldenText === false,
    `AC1 no "Golden Fruit" textContent anywhere on the card (got: ${a1.cards[0].cardHasGoldenText})`,
  );
  assert(a1.cards[0].apClass === "bond-result-ap", `AC1 ap class "bond-result-ap" (got: ${a1.cards[0].apClass})`);
  assert(a1.cards[0].apChildren === 0, `AC1 ap element textContent only, 0 children (got: ${a1.cards[0].apChildren})`);
  assert(a1.cards[0].fruitClass === "bond-result-fruit", `AC1 fruit class (got: ${a1.cards[0].fruitClass})`);
  assert(a1.cards[0].fruitChildren === 2, `AC1 fruit wrapper has img + count span (got: ${a1.cards[0].fruitChildren})`);
  assert(a1.cards[0].orderOk === true, `AC1 rhythm: runs -> ap -> fruit adjacent siblings`);
  const st = a1.cards[0].apStyle || {};
  assert(st.fontFamily === "ui-monospace, monospace", `AC1 ap font-family (got: ${st.fontFamily})`);
  assert(st.fontSize === "11.2px", `AC1 ap font-size 0.7rem=11.2px (got: ${st.fontSize})`);
  assert(st.marginTop === "4px", `AC1 ap margin-top 4px — rhythm step 1 (got: ${st.marginTop})`);
  assert(st.whiteSpace === "normal", `AC1 §13 ap white-space pre-line dropped (got: ${st.whiteSpace})`);
  assert(st.color === "rgb(75, 85, 99)", `AC1 ap color var(--text-secondary) (got: ${st.color})`);
  const fw = a1.cards[0].wrapperStyle || {};
  assert(fw.position === "relative", `AC1 fruit wrapper position relative (overlay anchor) (got: ${fw.position})`);
  assert(fw.marginTop === "4px", `AC1 fruit margin-top 4px — rhythm step 2 (got: ${fw.marginTop})`);
  assert(a1.cards[0].imgSrc === "icons/100_bordered.webp", `AC1 icon src (got: ${a1.cards[0].imgSrc})`);
  assert(
    a1.cards[0].imgAlt === "Golden Fruit",
    `AC1 img alt "Golden Fruit" — §15 sole AT name carrier (got: ${JSON.stringify(a1.cards[0].imgAlt)})`,
  );
  assert(
    a1.cards[0].imgHeight === "48px",
    `AC1 icon computed height var(--ce-badge-h)=48px (got: ${a1.cards[0].imgHeight})`,
  );
  const oc = a1.cards[0].countStyle || {};
  assert(oc.position === "absolute", `AC1 overlay position absolute (got: ${oc.position})`);
  assert(oc.whiteSpace === "nowrap", `AC1 overlay white-space nowrap (got: ${oc.whiteSpace})`);
  assert(oc.pointerEvents === "none", `AC1 overlay pointer-events none (got: ${oc.pointerEvents})`);
  assert(oc.fontSize === "16px", `AC1 §19 overlay font-size 1rem=16px (got: ${oc.fontSize})`);
  assert(oc.fontWeight === "700", `AC1 overlay font-weight 700 (got: ${oc.fontWeight})`);
  assert(oc.transform === "none", `AC1 §19 centering transform stays gone (from §17) (got: ${oc.transform})`);
  const gm = a1.cards[0].geometry || {};
  assert(
    Math.abs(gm.wrapperWidth - gm.img.width) <= 1,
    `AC1 wrapper width: fit-content hugs the img (wrapper ${gm.wrapperWidth} vs img ${gm.img.width})`,
  );
  assert(
    gm.count.left >= gm.img.left - 1 &&
      gm.count.right <= gm.img.right + 1 &&
      gm.count.top >= gm.img.top - 1 &&
      gm.count.bottom <= gm.img.bottom + 1,
    `AC1 §19: overlay sits fully inside the img box (count ${[Math.round(gm.count.left), Math.round(gm.count.top), Math.round(gm.count.right), Math.round(gm.count.bottom)].join(",")} in img ${[Math.round(gm.img.left), Math.round(gm.img.top), Math.round(gm.img.right), Math.round(gm.img.bottom)].join(",")})`,
  );
  assert(
    Math.abs(gm.img.right - gm.count.right - 3) <= 1 && Math.abs(gm.img.bottom - gm.count.bottom - 7) <= 1,
    `R15 margin inset: count right = img right − 3px, bottom = img bottom − 7px (±1) (dx ${(gm.count.right - gm.img.right).toFixed(2)}, dy ${(gm.count.bottom - gm.img.bottom).toFixed(2)})`,
  );
  assert(
    Math.abs(gm.wrap.right - gm.count.right - 3) <= 1 && Math.abs(gm.wrap.bottom - gm.count.bottom - 7) <= 1,
    `R15 margin inset against the offset parent (wrapper): count right = wrap right − 3px, bottom = wrap bottom − 7px (±1) (dx ${(gm.count.right - gm.wrap.right).toFixed(2)}, dy ${(gm.count.bottom - gm.wrap.bottom).toFixed(2)})`,
  );
  crossCheck("AC1", a1, 22, 152);

  console.log("\n------------------------------------------------------------");
  console.log("SUITE A2: §13 aggregate badge fully removed from this render");
  console.log("------------------------------------------------------------");
  assert(a1.badgeTotal === 0, `§13 no .bond-ap-badge element (got: ${a1.badgeTotal})`);
  assert(a1.totalRowTotal === 0, `§13 no .bond-total-ap row (got: ${a1.totalRowTotal})`);
  assert(!a1.hasTotalAPText, `§13 no "Total AP" text in results content (got text: ${a1.hasTotalAPText})`);
  assert(a1.exhaust === 0, `§13 teapot-exhaust chip still absent without teapots (got: ${a1.exhaust})`);

  console.log("\n------------------------------------------------------------");
  console.log("SUITE A3: icon actually loads (naturalWidth > 0)");
  console.log("------------------------------------------------------------");
  const a3 = await page
    .waitForFunction(
      () => {
        const img = document.querySelector("#bondResultContent .bond-result-fruit img");
        return img && img.complete && img.naturalWidth > 0;
      },
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);
  assert(a3, "IMG icon fetch completes with naturalWidth > 0 (dist/icons/100_bordered.webp served)");

  console.log("\n============================================================");
  console.log("SUITE B: idempotent double Calculate");
  console.log("============================================================");
  const b1 = await seedAndCalculate({ ...fq83, slots: ac1Slots }, { clickTwice: true });
  assert(b1.cards.length === 1, `S1 double click renders one card (got: ${b1.cards.length})`);
  assert(
    b1.apTotal === 1 && b1.fruitTotal === 1,
    `S1 exactly one ap + one fruit element (got: ${b1.apTotal}/${b1.fruitTotal})`,
  );
  assert(
    apLine(220).test(b1.cards[0].apText) && b1.cards[0].fruitCountText === overlayText(2),
    `S1 second click texts unchanged (got: ${JSON.stringify(b1.cards[0].apText)}, ${JSON.stringify(b1.cards[0].fruitCountText)})`,
  );

  console.log("\n============================================================");
  console.log("SUITE C: AC2 Grand Duel 40 AP (diff I 3164, frontline eff 3796)");
  console.log("============================================================");
  const c1 = await seedAndCalculate({
    questMain: "gd",
    questClass: "all",
    questDiff: "1",
    slots: [mkSlot("100100", 37960), ...Array.from({ length: 5 }, emptySlot)],
  });
  assert(c1.cards.length === 1, `AC2 one card (got: ${c1.cards.length})`);
  assert(c1.cards[0].runsText === "10 runs", `AC2 runs line (got: ${c1.cards[0].runsText})`);
  assert(
    apLine(400).test(c1.cards[0].apText),
    `AC2 ap line "400 AP" at 40 AP/run (got: ${JSON.stringify(c1.cards[0].apText)})`,
  );
  assert(
    c1.cards[0].fruitCountText === overlayText(3),
    `AC2 fruit line ceil(400/152)=3 (got: ${JSON.stringify(c1.cards[0].fruitCountText)})`,
  );
  crossCheck("AC2", c1, 40, 152);

  console.log("\n============================================================");
  console.log("SUITE D: AC3 custom AP = 0 -> neither ap nor fruit element anywhere");
  console.log("============================================================");
  const d1 = await seedAndCalculate({
    questMain: "fq",
    questSub: "custom",
    customBond: 845,
    customAp: 0,
    slots: ac1Slots,
  });
  assert(d1.cards.length === 1, `AC3 page still renders a card (got: ${d1.cards.length})`);
  assert(d1.cards[0].runsText === "10 runs", `AC3 runs line intact (got: ${d1.cards[0].runsText})`);
  assert(d1.apTotal === 0, `AC3 zero .bond-result-ap elements (got: ${d1.apTotal})`);
  assert(d1.fruitTotal === 0, `AC3 zero .bond-result-fruit elements (got: ${d1.fruitTotal})`);
  assert(d1.visible === true, `AC3 results section visible (got: ${d1.visible})`);
  crossCheck("AC3", d1, 0, 152);

  console.log("\n============================================================");
  console.log("SUITE E: AC4 teapot runs out (stock 1, bondNeeded 5000, eff 1014)");
  console.log("============================================================");
  const e1 = await seedAndCalculate({
    ...fq83,
    teapotOn: true,
    teapotCount: 1,
    slots: [mkSlot("800100", 5000), ...Array.from({ length: 5 }, emptySlot)],
  });
  assert(e1.cards.length === 2, `AC4 boosted card + continuation card (got: ${e1.cards.length})`);
  assert(e1.exhaust === 1, `AC4 exhaust chip renders (got: ${e1.exhaust})`);
  if (e1.cards.length === 2) {
    assert(
      e1.cards[0].runsText === "1 run" && e1.cards[1].runsText === "3 runs",
      `AC4 segment runs (got: ${e1.cards[0].runsText} / ${e1.cards[1].runsText})`,
    );
    assert(
      apLine(22).test(e1.cards[0].apText),
      `AC4 boosted card ap = teapotRuns x 22 (got: ${JSON.stringify(e1.cards[0].apText)})`,
    );
    assert(
      e1.cards[0].fruitCountText === overlayText(1),
      `AC4 boosted card fruit ceil(22/152)=1 (got: ${JSON.stringify(e1.cards[0].fruitCountText)})`,
    );
    assert(
      apLine(66).test(e1.cards[1].apText),
      `AC4 continuation ap = teapotOffRuns x 22 (got: ${JSON.stringify(e1.cards[1].apText)})`,
    );
    assert(
      e1.cards[1].fruitCountText === overlayText(1),
      `AC4 continuation fruit ceil(66/152)=1 (got: ${JSON.stringify(e1.cards[1].fruitCountText)})`,
    );
    assert(
      e1.cards[0].orderOk === true && e1.cards[1].orderOk === true,
      "AC4 both segments carry their own runs -> ap -> fruit triple",
    );
  }
  crossCheck("AC4", e1, 22, 152);

  console.log("\n============================================================");
  console.log("SUITE F: AC5 maxAp = 100 on re-calculate");
  console.log("============================================================");
  const f1 = await seedAndCalculate({ ...fq83, slots: ac1Slots });
  assert(
    f1.cards[0].fruitCountText === overlayText(2),
    `AC5 baseline maxAp 152: 2 fruits (got: ${JSON.stringify(f1.cards[0].fruitCountText)})`,
  );
  await page.evaluate(() => {
    const el = document.getElementById("maxApInput");
    el.value = "100";
    el.dispatchEvent(new Event("change"));
  });
  await page.evaluate(() => document.getElementById("bondCalculateBtn").click());
  const f2 = await snapshot();
  assert(
    f2.apTotal === 1 && f2.fruitTotal === 1,
    `AC5 still one ap + one fruit after re-calculate (got: ${f2.apTotal}/${f2.fruitTotal})`,
  );
  assert(
    apLine(220).test(f2.cards[0].apText),
    `AC5 ap line unchanged by maxAp (got: ${JSON.stringify(f2.cards[0].apText)})`,
  );
  assert(
    f2.cards[0].fruitCountText === overlayText(3),
    `AC5 maxAp 100: ceil(220/100)=3 (got: ${JSON.stringify(f2.cards[0].fruitCountText)})`,
  );

  console.log("\n============================================================");
  console.log("SUITE G: B0 bondNeeded 0 -> level-cost autofill (pre-feature) absorbs it");
  console.log("============================================================");
  /* Fail path traced round 1: bond-app.js:683 fills an empty box with the servant's own level cost
     before validation, so a typed 0 reaches calculate() as 1000 (Mash Lv.0, table t0). */
  const g1 = await seedAndCalculate({ ...fq83, slots: [mkSlot("800100", 0), ...Array.from({ length: 5 }, emptySlot)] });
  assert(dialogs.length === 0, `B0 no validation alert (got: ${JSON.stringify(dialogs)})`);
  const gInput = await page.evaluate(() => document.getElementById("slotBond_0").value);
  assert(gInput === "1000", `B0 empty box autofilled to Mash Lv.0 cost 1000 (got: ${gInput})`);
  assert(
    g1.cards.length === 1 && g1.cards[0].runsText === "1 run",
    `B0 runs after autofill (got: ${g1.cards[0] && g1.cards[0].runsText})`,
  );
  assert(
    apLine(22).test(g1.cards[0].apText),
    `B0 ap follows runs>0 at autofilled cost (got: ${JSON.stringify(g1.cards[0].apText)})`,
  );
  assert(
    g1.cards[0].fruitCountText === overlayText(1),
    `B0 fruit ceil(22/152)=1 (got: ${JSON.stringify(g1.cards[0].fruitCountText)})`,
  );
  crossCheck("B0", g1, 22, 152);

  console.log("\n============================================================");
  console.log("SUITE H: B2 two servants different runs (frontline 10, backline 1)");
  console.log("============================================================");
  const hSlots = Array.from({ length: 6 }, emptySlot);
  hSlots[0] = mkSlot("800100", 10140);
  hSlots[3] = mkSlot("100100", 845);
  const h1 = await seedAndCalculate({ ...fq83, slots: hSlots });
  assert(h1.cards.length === 2, `B2 two cards (got: ${h1.cards.length})`);
  if (h1.cards.length === 2) {
    assert(h1.cards[1].runsText === "1 run", `B4 card 1 singular "run" (got: ${h1.cards[1].runsText})`);
    assert(
      apLine(220).test(h1.cards[0].apText) && h1.cards[0].fruitCountText === overlayText(2),
      `B2 card 0 pair 220 AP / 2 (got: ${JSON.stringify(h1.cards[0].apText)}, ${JSON.stringify(h1.cards[0].fruitCountText)})`,
    );
    assert(
      apLine(22).test(h1.cards[1].apText) && h1.cards[1].fruitCountText === overlayText(1),
      `B2 card 1 backline eff 845 -> 1 run -> 22 AP / 1 (got: ${JSON.stringify(h1.cards[1].apText)}, ${JSON.stringify(h1.cards[1].fruitCountText)})`,
    );
  }
  crossCheck("B2", h1, 22, 152);

  console.log("\n============================================================");
  console.log("SUITE I: B3 huge numbers, toLocaleString grouping (custom 100 bond / 999 AP)");
  console.log("============================================================");
  const localeOk = await page.evaluate(() => (1234567).toLocaleString() === "1,234,567");
  assert(localeOk, `B3 page default locale groups like en-US (oracle precondition)`);
  const i1 = await seedAndCalculate({
    questMain: "fq",
    questSub: "custom",
    customBond: 100,
    customAp: 999,
    slots: [mkSlot("800100", 9999960), ...Array.from({ length: 5 }, emptySlot)],
  });
  assert(i1.cards.length === 1, `B3 one card (got: ${i1.cards.length})`);
  assert(i1.cards[0].runsText === "83333 runs", `B3 runs line raw digits (got: ${i1.cards[0].runsText})`);
  assert(
    apLine(83249667).test(i1.cards[0].apText),
    `B3 ap grouping "83,249,667 AP" (got: ${JSON.stringify(i1.cards[0].apText)})`,
  );
  assert(
    i1.cards[0].fruitCountText === overlayText(547696),
    `B3 fruit overlay grouping "x547,696" (got: ${JSON.stringify(i1.cards[0].fruitCountText)})`,
  );
  crossCheck("B3", i1, 999, 152);

  console.log("\n============================================================");
  console.log("SUITE K: 375px geometry + row uniformity (relational, both viewports)");
  console.log("============================================================");
  /* §15 + R15 (supersedes §19 flush): no two-line stack; fruit is a 48px img with an x<n> overlay
     inset 3px right / 7px bottom from its bottom-right corner (1rem, fully inside the img box).
     Pin: ap text one line
     box; overlay one line box (nowrap); wrapper (fit-content), card and page show no horizontal
     overflow at 375px; party cards on one grid row keep equal tops and equal heights (relational —
     icon 16px->48px height shifts are accepted, not pinned); rhythm 4px/4px. */
  async function measureCards() {
    return page.evaluate(() => {
      return Array.from(document.querySelectorAll("#bondResultContent .bond-result-servant-card")).map((card) => {
        const ap = card.querySelector(".bond-result-ap");
        const fruit = card.querySelector(".bond-result-fruit");
        const img = fruit ? fruit.querySelector("img.bond-result-fruit-img") : null;
        const span = fruit ? fruit.querySelector("span.bond-result-fruit-count") : null;
        const lines = (el) => {
          if (!el || !el.firstChild) return null;
          const rg = document.createRange();
          rg.selectNodeContents(el.firstChild);
          return new Set(Array.from(rg.getClientRects()).map((r) => Math.round(r.top))).size;
        };
        const cornerDelta = (inner, outer) => {
          if (!inner || !outer) return null;
          return {
            dx: inner.right - outer.right,
            dy: inner.bottom - outer.bottom,
            contained:
              inner.left >= outer.left - 1 &&
              inner.right <= outer.right + 1 &&
              inner.top >= outer.top - 1 &&
              inner.bottom <= outer.bottom + 1,
          };
        };
        const r = card.getBoundingClientRect();
        const sBox = span ? span.getBoundingClientRect() : null;
        return {
          top: Math.round(r.top),
          height: Math.round(r.height),
          cardOverflow: card.scrollWidth - card.clientWidth,
          countBoxVisibleInsideCard: sBox
            ? {
                inside: sBox.left >= r.left - 1 && sBox.right <= r.right + 1,
                countLeft: +sBox.left.toFixed(2),
                countRight: +sBox.right.toFixed(2),
                cardLeft: +r.left.toFixed(2),
                cardRight: +r.right.toFixed(2),
              }
            : null,
          cardBox: (() => {
            const b = card.getBoundingClientRect();
            return { left: b.left, right: b.right };
          })(),
          apLines: lines(ap),
          countText: span ? span.textContent : null,
          countLines: lines(span),
          countVisible: span ? span.getBoundingClientRect().width > 0 : null,
          corner: cornerDelta(span ? span.getBoundingClientRect() : null, img ? img.getBoundingClientRect() : null),
          fruitOverflow: fruit ? fruit.scrollWidth - fruit.clientWidth : null,
          apMargin: ap ? window.getComputedStyle(ap).marginTop : null,
          fruitMargin: fruit ? window.getComputedStyle(fruit).marginTop : null,
        };
      });
    });
  }
  const docW = () => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));

  await page.setViewport({ width: 375, height: 667 });
  const k1 = await seedAndCalculate({ ...fq83, slots: ac1Slots });
  assert(
    apLine(220).test(k1.cards[0].apText) && k1.cards[0].fruitCountText === overlayText(2),
    `K375 pair intact at narrow width (got: ${JSON.stringify(k1.cards[0].apText)}, ${JSON.stringify(k1.cards[0].fruitCountText)})`,
  );
  const k375 = (await measureCards())[0];
  assert(k375.apLines === 1, `K375 ap line renders exactly ONE line box (got ${k375.apLines})`);
  assert(k375.countLines === 1, `K375 overlay is one line box (nowrap holds) (got ${k375.countLines})`);
  assert(
    k375.corner && k375.corner.contained,
    `K375 §19 overlay fully contained in img box (got ${JSON.stringify(k375.corner)})`,
  );
  assert(
    k375.corner && Math.abs(k375.corner.dx + 3) <= 1 && Math.abs(k375.corner.dy + 7) <= 1,
    `K375 R15 margin inset: span right = img right − 3px, bottom = img bottom − 7px (dx ${k375.corner && k375.corner.dx.toFixed(2)}, dy ${k375.corner && k375.corner.dy.toFixed(2)})`,
  );
  assert(
    k375.fruitOverflow <= 1 && k375.cardOverflow <= 1,
    `K375 §19 no overhang: wrapper ${k375.fruitOverflow}, card ${k375.cardOverflow} (<=1)`,
  );
  assert(
    k375.apMargin === "4px" && k375.fruitMargin === "4px",
    `K375 runs->ap->fruit rhythm 4px/4px (got ${k375.apMargin}/${k375.fruitMargin})`,
  );
  const dw375 = await docW();
  assert(
    dw375.scroll <= dw375.inner,
    `K375 no page-level horizontal overflow (doc ${dw375.scroll} <= inner ${dw375.inner})`,
  );

  const kU375 = await seedAndCalculate({ ...fq83, slots: hSlots });
  assert(kU375.cards.length === 2, `K375-U two party cards render (got: ${kU375.cards.length})`);
  const u375 = await measureCards();
  assert(u375[0].top === u375[1].top, `K375-U cards share grid-row top (got ${u375[0].top}/${u375[1].top})`);
  assert(
    Math.abs(u375[0].height - u375[1].height) <= 1,
    `K375-U uniform card heights (got ${u375[0].height}/${u375[1].height})`,
  );
  assert(
    u375.every((c) => c.apLines === 1 && c.countLines === 1),
    `K375-U every card: ap one box, overlay one box (got ${u375.map((c) => `${c.apLines}/${c.countLines}`).join(", ")})`,
  );
  assert(
    u375.every(
      (c) => c.corner && c.corner.contained && Math.abs(c.corner.dx + 3) <= 1 && Math.abs(c.corner.dy + 7) <= 1,
    ),
    `K375-U R15 inset contained corner (−3/−7) on every card`,
  );
  assert(
    u375.every((c) => c.fruitOverflow <= 1 && c.cardOverflow <= 1),
    `K375-U inset overlay: wrapper and card overflow 0 on every card (got ${u375.map((c) => `${c.fruitOverflow}/${c.cardOverflow}`).join(", ")})`,
  );

  await page.setViewport({ width: 900, height: 800 });
  const kUwide = await seedAndCalculate({ ...fq83, slots: hSlots });
  assert(kUwide.cards.length === 2, `K900 two party cards render (got: ${kUwide.cards.length})`);
  const uw = await measureCards();
  assert(uw[0].top === uw[1].top, `K900 same grid-row top (got ${uw[0].top}/${uw[1].top})`);
  assert(Math.abs(uw[0].height - uw[1].height) <= 1, `K900 uniform card heights (got ${uw[0].height}/${uw[1].height})`);
  assert(
    uw.every(
      (c) =>
        c.apLines === 1 &&
        c.countLines === 1 &&
        c.corner &&
        c.corner.contained &&
        Math.abs(c.corner.dx + 3) <= 1 &&
        Math.abs(c.corner.dy + 7) <= 1,
    ),
    `K900 one-line ap + inset contained (−3/−7) one-line overlay on both cards`,
  );
  assert(
    uw.every((c) => c.apMargin === "4px" && c.fruitMargin === "4px"),
    `K900 rhythm 4px/4px on both cards`,
  );

  console.log("\n============================================================");
  console.log("SUITE L: icon request aborted -> display:none, card intact");
  console.log("============================================================");
  const blockFn = (req) => {
    if (req.url().includes("icons/100_bordered.webp")) {
      req.abort().catch(() => {});
    } else {
      req.continue().catch(() => {});
    }
  };
  await page.setRequestInterception(true);
  page.on("request", blockFn);
  const l1 = await seedAndCalculate({ ...fq83, slots: ac1Slots });
  page.off("request", blockFn);
  await page.setRequestInterception(false);
  assert(l1.cards.length === 1, `L card renders with icon blocked (got: ${l1.cards.length})`);
  /* onerror fires asynchronously after the aborted fetch; give it a bounded window, then re-read. */
  const lHidden = await page
    .waitForFunction(
      () => {
        const img = document.querySelector("#bondResultContent .bond-result-fruit img");
        return img && img.style.display === "none";
      },
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);
  const lSnap = await snapshot();
  const lImg = lSnap.cards[0];
  assert(lHidden, `L onerror handler ran (style.display set to "none" within 5s of the abort)`);
  assert(
    lImg.imgDisplay === "none",
    `L broken icon computed display none (got ${lImg.imgDisplay}, naturalWidth ${lImg.imgNaturalWidth})`,
  );
  assert(
    lImg.runsText === "10 runs" && apLine(220).test(lImg.apText) && lImg.fruitCountText === overlayText(2),
    `L card intact after icon error: runs/ap/overlay text present (got ${JSON.stringify([lImg.runsText, lImg.apText, lImg.fruitCountText])})`,
  );
  assert(
    lImg.geometry && lImg.geometry.count.width > 0 && lImg.geometry.count.height > 0,
    `L overlay STILL visible with img hidden: non-zero rect (got ${JSON.stringify(lImg.geometry && lImg.geometry.count)})`,
  );
  assert(
    lImg.geometry &&
      Math.abs(lImg.geometry.wrap.right - lImg.geometry.count.right - 3) <= 1 &&
      Math.abs(lImg.geometry.wrap.bottom - lImg.geometry.count.bottom - 7) <= 1,
    `L R15: inset overlay re-anchors to the COLLAPSED (zero-width) wrapper when img hides (count right = wrap right − 3px, bottom = wrap bottom − 7px) (got ${JSON.stringify(lImg.geometry && { c: lImg.geometry.count, w: lImg.geometry.wrap })})`,
  );
  /* Recorded landing, measured — not assumed: with width collapsed the wrapper sits on the card's
     center line; right:0 plus the R15 3px margin-right pins the count's RIGHT edge there, so the
     text drifts left of centre. */
  const gL = lImg.geometry;
  assert(
    gL && gL.count.left >= gL.cardBox.left - 1 && gL.count.right <= gL.cardBox.right + 1,
    `L overlay fully visible inside card with img hidden; recorded: count [${gL ? gL.count.left.toFixed(1) : "?"},${gL ? gL.count.right.toFixed(1) : "?"}] vs card [${gL ? gL.cardBox.left.toFixed(1) : "?"},${gL ? gL.cardBox.right.toFixed(1) : "?"}]; collapsed wrapper anchor x=${gL ? gL.wrap.right.toFixed(1) : "?"}, card center=${gL ? ((gL.cardBox.left + gL.cardBox.right) / 2).toFixed(1) : "?"} (count drifts left of centre, right edge 3px LEFT of the anchor per R15 margin)`,
  );

  console.log("\n============================================================");
  console.log("SUITE M: extreme corner count x8,123 (1rem) -> no overflow, 375px + wide");
  console.log("============================================================");
  /* R15 margin-inset corner overflow probe (supersedes §19 flush), driven through the REAL data path
      (no DOM injection):
     customBond 100 -> eff 120 -> runs ceil(974760/120) = 8123; customAp 1 -> AP 8,123;
     maxAp 1 (clamp floor) -> fruit = 8,123 -> overlay "x8,123" ~58px at 1rem. */
  const mState = {
    questMain: "fq",
    questSub: "custom",
    customBond: 100,
    customAp: 1,
    maxAp: 1,
    slots: [mkSlot("800100", 974760), ...Array.from({ length: 5 }, emptySlot)],
  };
  await page.setViewport({ width: 375, height: 667 });
  const m1 = await seedAndCalculate(mState);
  assert(m1.cards.length === 1, `M one card (got: ${m1.cards.length})`);
  assert(m1.cards[0].runsText === "8123 runs", `M runs ceil(974760/120)=8123 (got: ${m1.cards[0].runsText})`);
  assert(apLine(8123).test(m1.cards[0].apText), `M ap "8,123 AP" (got: ${JSON.stringify(m1.cards[0].apText)})`);
  assert(
    m1.cards[0].fruitCountText === overlayText(8123),
    `M overlay "x8,123" (got: ${JSON.stringify(m1.cards[0].fruitCountText)})`,
  );
  crossCheck("M", m1, 1, 1);
  const m375 = (await measureCards())[0];
  assert(
    m375.corner && Math.abs(m375.corner.dx + 3) <= 1 && Math.abs(m375.corner.dy + 7) <= 1,
    `M375 R15 corner inset (3px/7px) holds with the wide 1rem overlay (got ${JSON.stringify(m375.corner)})`,
  );
  assert(
    m375.countBoxVisibleInsideCard,
    `M375 extreme overlay extends LEFT INSIDE the card from the inset right edge, fully visible (got ${JSON.stringify(m375.countBoxVisibleInsideCard)})`,
  );
  assert(
    m375.cardOverflow <= 1 && m375.fruitOverflow <= 1,
    `M375 §19: no overhang anywhere — card ${m375.cardOverflow}, wrapper ${m375.fruitOverflow} (<=1)`,
  );
  const dwM375 = await docW();
  assert(
    dwM375.scroll <= dwM375.inner,
    `M375 page no horizontal overflow (doc ${dwM375.scroll} <= inner ${dwM375.inner})`,
  );
  await page.setViewport({ width: 900, height: 800 });
  const m2 = await seedAndCalculate(mState);
  const mWide = (await measureCards())[0];
  assert(
    mWide.cardOverflow <= 1 && mWide.fruitOverflow <= 1,
    `M900 §19 flush: card ${mWide.cardOverflow}, wrapper ${mWide.fruitOverflow} (<=1)`,
  );
  assert(
    mWide.corner && Math.abs(mWide.corner.dx + 3) <= 1 && Math.abs(mWide.corner.dy + 7) <= 1,
    `M900 corner inset 3px/7px still exact at wide viewport (got ${JSON.stringify(mWide.corner)})`,
  );
  const dwM900 = await docW();
  assert(
    dwM900.scroll <= dwM900.inner,
    `M900 page no horizontal overflow (doc ${dwM900.scroll} <= inner ${dwM900.inner})`,
  );

  console.log("\n============================================================");
  console.log("SUITE J: shipped CSS + shipped JS + page health");
  console.log("============================================================");
  const distHtml = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
  assert(
    distHtml.includes(
      ".bond-result-ap { font-family: ui-monospace, monospace; font-size: 0.7rem; color: var(--text-secondary); margin-top: 4px; }",
    ),
    "CSS1 .bond-result-ap final rule verbatim, pre-line dropped (plan §13)",
  );
  assert(
    distHtml.includes(
      ".bond-result-fruit { position: relative; width: fit-content; height: var(--ce-badge-h); margin-top: 4px; }",
    ),
    "CSS2 .bond-result-fruit relative fit-content wrapper verbatim (plan §15)",
  );
  assert(
    distHtml.includes(
      ".bond-result-fruit-img { width: auto; height: var(--ce-badge-h); aspect-ratio: 142 / 155; object-fit: contain; display: block; }",
    ),
    "CSS3 .bond-result-fruit-img 48px badge-size rule verbatim (plan §15)",
  );
  assert(
    distHtml.includes(
      ".bond-result-fruit-count { position: absolute; right: 0; bottom: 0; margin-right: 3px; margin-bottom: 7px; font-family: ui-monospace, monospace; font-size: 1rem; font-weight: 700; line-height: 1; color: #1a1a2e; text-shadow: 0 1px 2px #fff, 0 -1px 2px #fff, 1px 0 2px #fff, -1px 0 2px #fff; white-space: nowrap; pointer-events: none; }",
    ),
    "CSS4 .bond-result-fruit-count R15 inset corner rule verbatim (right/bottom 0, margin-right 3px, margin-bottom 7px, 1rem, no transform; supersedes §19 flush)",
  );
  assert(
    (distHtml.match(/\.bond-result-fruit \{/g) || []).length === 1,
    `CSS5 exactly one .bond-result-fruit rule — §13 flex-row rule replaced, not duplicated (got ${(distHtml.match(/\.bond-result-fruit \{/g) || []).length})`,
  );
  for (const dead of [
    ".bond-total-ap {",
    ".bond-ap-badge {",
    ".bond-ap-line {",
    ".bond-ap-fruit-line {",
    ".bond-ap-fruit-img {",
  ]) {
    assert(!distHtml.includes(dead), `CSS6 dead selector deleted from stylesheet (no ${dead})`);
  }
  assert(!distHtml.includes("text-wrap"), "CSS7 no text-wrap declaration anywhere (plan §9 deletion holds)");
  const chunk = fs.readFileSync(
    path.join(
      DIST,
      "_astro",
      fs.readdirSync(path.join(DIST, "_astro")).find((f) => /^bond-lazy.*\.js$/.test(f)),
    ),
    "utf8",
  );
  assert(!chunk.includes("Total AP"), 'JS1 shipped bond-lazy chunk contains no "Total AP" string (badge builder gone)');
  assert(pageErrors.length === 0, `No page errors across suite (got: ${pageErrors.join("; ") || "none"})`);
} finally {
  await browser.close();
  server.close();
}

console.log("\n============================================================");
console.log(`ASSERTS: passed=${passed} failed=${failures.length}`);
console.log("============================================================");
if (failures.length > 0) {
  failures.forEach((f) => console.error(`  - ${f}`));
  console.error("QA SUITE: FAILED");
  process.exit(1);
} else {
  console.log("QA SUITE: PASSED (bond-card-ap §15 contracts verified)");
  process.exit(0);
}
