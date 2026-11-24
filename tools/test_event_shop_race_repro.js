#!/usr/bin/env node
/**
 * scripts/test_event_shop_race_repro.js
 *
 * MINIMAL FAILING REPRO (kept red until fixed): a Held figure typed into a tier box is silently
 * LOST when the Event Select changes inside the house DEBOUNCE_MS (100ms) window.
 *
 * Fail path: event-shop.js bindPlanBox (line ~383) attaches a DEBOUNCE_MS-debounced `input`
 * listener that resolves the currency AT FLUSH TIME from EventPlanner.activeEvent() and reads the
 * value from the box AT FLUSH TIME. event-lazy.js select-change → EventPlanner.select() →
 * App.rehydrate() rewrites the tier boxes from the NEW event's plan BEFORE the pending flush
 * fires, so the flush writes the new event's displayed 0 under the new event's currency, and the
 * figure the user typed for the old event never reaches any plan.
 *
 * Contract broken (plan of record, Amendment G #4/#5, frozen): "Event mode: Held/Bonus inputs
 * read/write the ACTIVE event's plan (App delegates through EventPlanner)" — the write made while
 * event A was active must land in A's plan, and each event's plan stays isolated.
 *
 * Control scene (same typing, switch AFTER the debounce window) proves the write path itself
 * works — only the timing window loses the figure. Not a harness artifact: both scenes drive the
 * page with real keystrokes and a real select change, nothing is mocked.
 *
 * Run against the static dist on the spare port (3000 is the owner's — never gate there):
 *   node scripts/test_event_shop_race_repro.js http://127.0.0.1:4174/fgo-calculator/
 *
 * Amendment J pruned the shipped snapshot to ONE farm event, and a switch race needs two events to
 * switch between, so the repro runs against the QA patched MULTI copy (same chunks, same code, extra
 * events in the data literal). The fixture is the oracle for the ids/currency — the script refuses to
 * run if the SERVED page does not actually list both events, so the scene can never go vacuous.
 *   --fixture <path> overrides the fixture (default /tmp/opencode/qa/fixtures/multi_events.json).
 *
 * Exits 1 with one `[ERROR] <check>` line per failed check.
 */

import puppeteer from "puppeteer";
import fs from "node:fs";
import { EVENT_SHOP_DATA } from "../src/scripts/data/event_shop.js";
import { EVENT_SHOP_STORAGE_KEY, STORAGE_KEY } from "../src/scripts/constants.js";

const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith("--")) || "http://127.0.0.1:4174/fgo-calculator/";
const fixtureArg = argv.findIndex((a) => a === "--fixture");
const FIXTURE = fixtureArg >= 0 ? argv[fixtureArg + 1] : "/tmp/opencode/qa/fixtures/multi_events.json";
const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const LIVE = Array.isArray(EVENT_SHOP_DATA.events) ? EVENT_SHOP_DATA.events : [];
let EVENTS = LIVE;
if (LIVE.length < 2) {
  if (!fs.existsSync(FIXTURE)) {
    console.error(`[ERROR] repro: the shipped snapshot has ${LIVE.length} event(s) and no fixture at ${FIXTURE} — nothing to switch between`);
    process.exit(1);
  }
  EVENTS = JSON.parse(fs.readFileSync(FIXTURE, "utf8")).events;
}
const A = EVENTS.find((e) => e.event.id === 80639) || EVENTS[0];
const B = EVENTS.find((e) => e.event.id === 80630) || EVENTS.find((e) => e !== A);
if (!A || !B) {
  console.error("[ERROR] repro: snapshot has no two events to switch between");
  process.exit(1);
}
const goldCurrency = A.currencies.find((c) => c.background === "gold");

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1120, height: 900 });
  const fresh = async () => {
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.evaluate(
      (k, lk) => {
        localStorage.removeItem(k);
        localStorage.removeItem(lk);
      },
      EVENT_SHOP_STORAGE_KEY,
      STORAGE_KEY,
    );
    await page.reload({ waitUntil: "networkidle0" });
    await page.click('.tab-btn[data-tab="event"]');
    await wait(900);
  };
  const typeHeld = async (text) => {
    await page.focus("#goldHave");
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(text);
  };

  /* --- control: switch AFTER the debounce window — the figure must persist in A's plan --- */
  await fresh();
  const served = await page.evaluate(() => [...document.querySelectorAll("#eventSelect option")].map((o) => o.value));
  if (!served.includes(String(A.event.id)) || !served.includes(String(B.event.id)))
    errors.push(
      `repro: the served page offers ${JSON.stringify(served)}, want both ${A.event.id} and ${B.event.id} — run this against the MULTI patched copy, a one-event page cannot show a switch race`,
    );
  await typeHeld("1000");
  await wait(400); // > DEBOUNCE_MS: the write flushes while A is still active
  await page.select("#eventSelect", String(B.event.id));
  await wait(400);
  const ctl = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), EVENT_SHOP_STORAGE_KEY);
  const ctlHeld = (ctl.plans[String(A.event.id)] || {}).held || {};
  if (ctlHeld[String(goldCurrency.id)] !== 1000) {
    errors.push(
      `control (switch after debounce): A held ${goldCurrency.id} is ${JSON.stringify(ctlHeld[String(goldCurrency.id)])}, want 1000 — the write path itself must work (if THIS is red the harness/timing assumption broke, not the race)`,
    );
  }

  /* --- race: switch INSIDE the debounce window — the typed figure must still land on A --- */
  await fresh();
  await typeHeld("1000");
  await page.select("#eventSelect", String(B.event.id)); // no wait: inside DEBOUNCE_MS
  await wait(700); // let any pending flush fire, then read
  const race = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), EVENT_SHOP_STORAGE_KEY);
  const raceA = (race.plans[String(A.event.id)] || {}).held || {};
  const raceB = (race.plans[String(B.event.id)] || {}).held || {};
  if (raceA[String(goldCurrency.id)] !== 1000) {
    errors.push(
      `race (switch within DEBOUNCE_MS): held ${goldCurrency.id} typed as 1000 while event ${A.event.id} was ACTIVE reads ${JSON.stringify(raceA[String(goldCurrency.id)])} in plans["${A.event.id}"] after switching to ${B.event.id} — the figure is silently lost (bindPlanBox resolves currency+value at flush time, after rehydrate rewrote the box)`,
    );
  }
  if (raceB && Object.values(raceB).some((v) => v > 0)) {
    errors.push(
      `race: event B's plan carries A's figure — ${JSON.stringify(raceB)} — per-event isolation broken (Amendment G #4)`,
    );
  }
  console.log(
    `NOTE: control A held=${JSON.stringify(ctlHeld)} | race A held=${JSON.stringify(raceA)} B held=${JSON.stringify(raceB)}`,
  );
} catch (e) {
  errors.push(`repro aborted: ${e.message.split("\n")[0]}`);
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(`\nFAILED with ${errors.length} error(s):`);
  for (const e of errors) console.error(`  [ERROR] ${e}`);
  process.exit(1);
}
console.log(`SUCCESS: held-figure survives a switch inside the debounce window against ${url}`);
