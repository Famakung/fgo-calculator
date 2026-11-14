import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* validate_data.js imports its datasets by absolute path from the tree it lives in and calls
   process.exit, so the only offline way to hand it a snapshot is a doctored tree: copy the script,
   stub the five data modules, run it as a child process. Same spawn pattern as
   tests/merge-code-only.test.js. */

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALIDATOR = path.join(ROOT_DIR, "scripts", "validate_data.js");

const CURRENCIES = [
  { id: 94164000, name: "MISO", background: "bronze", icon: null },
  { id: 94164001, name: "NEGI", background: "silver", icon: null },
];
const ITEMS = [
  { id: 1, name: "coin", cost: { itemId: 94164000, amount: 10 }, limitNum: 1, setNum: 1, priority: 1, icon: null },
];
const QUEST = {
  questId: 5,
  questName: "q",
  recommendLv: "70",
  ap: 40,
  sampleRuns: 9,
  drops: { 94164000: { dropExpected: 1.5, num: 3 }, 94164001: { dropExpected: 0.5, num: 2 } },
};
const TRADE = { fromId: 94164000, toId: 94164001, costAmount: 10, getNum: 1 };

function farmWith(quests, best) {
  return { quests, best };
}

function runValidator(farm, trades = [TRADE]) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fgo-validate-"));
  try {
    fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
    fs.cpSync(VALIDATOR, path.join(tmp, "scripts", "validate_data.js"));
    const data = path.join(tmp, "src", "scripts", "data");
    fs.mkdirSync(data, { recursive: true });
    const modules = {
      "servants.js": "export const SERVANT_DATA = {};",
      "craft_essences.js": "export const CE_DATA = {};",
      "traits.js": 'export const TRAIT_DATA = { "0100": { name: "Servant" } };',
      "bond_growth.js": "export const BOND_TABLES = {};\nexport const BOND_TABLE_BY_SVT = {};",
      "event_shop.js":
        "export const EVENT_SHOP_DATA = " +
        JSON.stringify({
          events: [
            {
              event: { id: 80639, name: "S", shortName: "S", startedAt: 1794394800 },
              currencies: CURRENCIES,
              items: ITEMS,
              farm,
              trades,
              bonusCes: [],
            },
          ],
        }) +
        ";",
    };
    for (const [name, text] of Object.entries(modules)) fs.writeFileSync(path.join(data, name), text, "utf8");
    const result = spawnSync(process.execPath, [path.join(tmp, "scripts", "validate_data.js")], { encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test("validate_data accepts quests, a best map over them and a positive trade ratio", () => {
  const { status, output } = runValidator(farmWith([QUEST], { 94164000: 5, 94164001: 5 }));
  assert.equal(status, 0, output);
});

test("validate_data rejects a quest drop keyed by a currency the shop does not sell", () => {
  const broken = { ...QUEST, drops: { 99999999: { dropExpected: 1, num: 1 } } };
  const { status, output } = runValidator(farmWith([broken], { 94164000: 5, 94164001: 5 }));
  assert.equal(status, 1, output);
  assert.match(output, /farm quest 5\.drops: key 99999999 is not a shop currency/);
});

test("validate_data rejects a farm quest that drops no shop currency", () => {
  const empty = { ...QUEST, drops: {} };
  const { status, output } = runValidator(farmWith([empty], {}));
  assert.equal(status, 1, output);
  assert.match(output, /farm quest 5: drops must carry at least one shop currency/);
});

test("validate_data rejects a best entry pointing at a quest it never shipped", () => {
  const { status, output } = runValidator(farmWith([QUEST], { 94164000: 4242 }));
  assert.equal(status, 1, output);
  assert.match(output, /farm\.best 94164000: quest 4242 is not in farm\.quests/);
});

test("validate_data rejects a non-positive trade ratio and a trade that leaves the shop", () => {
  const zero = runValidator(farmWith([QUEST], { 94164000: 5, 94164001: 5 }), [{ ...TRADE, costAmount: 0 }]);
  assert.equal(zero.status, 1, zero.output);
  assert.match(zero.output, /costAmount must be a positive integer/);

  const outside = runValidator(farmWith([QUEST], { 94164000: 5, 94164001: 5 }), [{ ...TRADE, toId: 94164099 }]);
  assert.equal(outside.status, 1, outside.output);
  assert.match(outside.output, /toId 94164099 is not a shop currency/);

  const selfTrade = runValidator(farmWith([QUEST], { 94164000: 5, 94164001: 5 }), [{ ...TRADE, toId: TRADE.fromId }]);
  assert.equal(selfTrade.status, 1, selfTrade.output);
  assert.match(selfTrade.output, /fromId and toId are the same currency/);
});

test("validate_data rejects a recommendLv that is neither string nor number", () => {
  const lv = { ...QUEST, recommendLv: true };
  const { status, output } = runValidator(farmWith([lv], { 94164000: 5, 94164001: 5 }));
  assert.equal(status, 1, output);
  assert.match(output, /recommendLv must be a string or number/);
});

test("validate_data rejects a farm that is not the quests/best object", () => {
  for (const junk of [null, [], { quests: {}, best: {} }, { quests: [QUEST] }, { best: {} }]) {
    const { status, output } = runValidator(junk);
    assert.equal(status, 1, `farm ${JSON.stringify(junk)} should be rejected`);
    assert.match(output, /farm must be an object|farm\.quests must be an array|farm\.best must be an object/);
  }
});

test("validate_data rejects a zero drop figure inside a quest", () => {
  const zero = { ...QUEST, drops: { 94164000: { dropExpected: 0, num: 3 } } };
  const { status, output } = runValidator(farmWith([zero], {}));
  assert.equal(status, 1, output);
  assert.match(output, /drops\[94164000\]: dropExpected must be a number above 0/);
});
