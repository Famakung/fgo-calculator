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
const ENTRY = { questId: 5, questName: "q", recommendLv: "70", ap: 40, num: 3, sampleRuns: 9, dropExpected: 1.5 };

function farmWith(secondaryByCurrency) {
  const farm = {};
  for (const currency of CURRENCIES) {
    farm[String(currency.id)] = { ...ENTRY, secondary: secondaryByCurrency[String(currency.id)] };
  }
  return farm;
}

function runValidator(farm) {
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

test("validate_data accepts a farm map whose secondary is a different currency", () => {
  const farm = farmWith({ 94164000: { currencyId: 94164001, dropExpected: 1, num: 2 }, 94164001: null });
  const { status, output } = runValidator(farm);
  assert.equal(status, 0, output);
});

test("validate_data rejects a secondary that repeats its own currency", () => {
  const farm = farmWith({ 94164000: { currencyId: 94164000, dropExpected: 1, num: 2 }, 94164001: null });
  const { status, output } = runValidator(farm);
  assert.equal(status, 1, output);
  assert.match(
    output,
    /farm entry 94164000\.secondary: currencyId 94164000 is this entry's own currency, not a second one/,
  );
});
