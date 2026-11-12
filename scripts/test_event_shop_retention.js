#!/usr/bin/env node
/* QA retention pin — browser-level proof of the _retired merge in event-planner.js.
   Scenario: a saved plan for an event the served data no longer lists (a pruned event, seeded
   here as 80630 — the shipped single-event snapshot only offers 80639) must survive a later
   mutation. Unit coverage exists (tests/event-shop.test.js); this pins the SAME contract in the
   real page: hydrate → debounce write → localStorage, through the minified chunk, not the source.
   Run against any copy whose data lacks 80630 (the MAIN patched-site copy on 4173 is the anchor):
     node scripts/test_event_shop_retention.js http://127.0.0.1:4173/fgo-calculator/
   exit 0 = retired plan survived; exit 1 = it was eroded by the mutation (retention regression). */
import puppeteer from "puppeteer";
import { EVENT_SHOP_STORAGE_KEY, DEBOUNCE_MS } from "../src/scripts/constants.js";
import { EVENT_SHOP_DATA } from "../src/scripts/data/event_shop.js";

const url = process.argv[2] || "http://localhost:4173/fgo-calculator/";
const KEY = EVENT_SHOP_STORAGE_KEY;
const RETIRED_ID = "80630";
const LIVE = EVENT_SHOP_DATA.events[0];
if (EVENT_SHOP_DATA.events.some((e) => String(e.event.id) === RETIRED_ID)) {
  console.error(`ABORT: served data still lists ${RETIRED_ID} — nothing is pruned; run against the one-event copy`);
  process.exit(2);
}
const LIVE_ID = String(LIVE.event.id);
const BRONZE = String(LIVE.currencies[0].id);
const RETIRED_PLAN = { requires: { 94050903: 7 }, held: { 94050903: 42 }, bonus: {} };

const errors = [];
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.evaluateOnNewDocument(
  ([key, lid, rid, plan]) => {
    localStorage.setItem(
      key,
      JSON.stringify({ selectedEventId: lid, plans: { [rid]: plan, [lid]: { requires: {}, held: {}, bonus: {} } } }),
    );
  },
  [KEY, LIVE_ID, RETIRED_ID, RETIRED_PLAN],
);

page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
/* main snapshot: all three currencies are tier-mapped, so their boxes are the tier pair
   (#farmHeld* exists only for currencies no tier card owns — MULTI). The tier-box writer flows
   through the same setHeld → _mutatePlan → _persist path, which is what retention must survive. */
await page.goto(url, { waitUntil: "networkidle0" });
await page.click('.tab-btn[data-tab="event"]');
await page.waitForSelector("#bronzeHave", { timeout: 8000 });

/* the mutation: type a Held figure for the LIVE event. The read waits for the debounce flush by
   polling until the live edit lands — reading before the commit would race the 100ms timer and
   make the retired-absence assertion fail falsely. */
await page.click("#bronzeHave", { clickCount: 3 });
await page.type("#bronzeHave", "6");
await page
  .waitForFunction(
    (k, lid, cid) => {
      try {
        return JSON.parse(localStorage.getItem(k))?.plans?.[lid]?.held?.[cid] === 6;
      } catch {
        return false;
      }
    },
    { timeout: 5000 },
    KEY,
    LIVE_ID,
    BRONZE,
  )
  .catch(() => {});

const saved = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY));
const retired = saved?.plans?.[RETIRED_ID];
if (!retired) {
  errors.push(`retention: plans["${RETIRED_ID}"] vanished after one mutation — _retired merge is not holding`);
} else if (JSON.stringify(retired) !== JSON.stringify(RETIRED_PLAN)) {
  errors.push(
    `retention: plans["${RETIRED_ID}"] was rewritten — ${JSON.stringify(retired)}, want ${JSON.stringify(RETIRED_PLAN)} verbatim`,
  );
}
if (saved?.plans?.[LIVE_ID]?.held?.[BRONZE] !== 6) {
  errors.push(
    `control: the live mutation did not persist — held["${BRONZE}"] is ${JSON.stringify(saved?.plans?.[LIVE_ID]?.held)}, want 6 (a dead save proves nothing)`,
  );
}

await browser.close();
if (errors.length) {
  for (const e of errors) console.error(`  [ERROR] ${e}`);
  console.error(`FAILED with ${errors.length} error(s): retention pin against ${url}`);
  process.exit(1);
}
console.log(
  `SUCCESS: pruned event ${RETIRED_ID}'s plan ${JSON.stringify(RETIRED_PLAN)} survived a live mutation (${BRONZE} held 6, debounce ${DEBOUNCE_MS}ms) against ${url}`,
);
