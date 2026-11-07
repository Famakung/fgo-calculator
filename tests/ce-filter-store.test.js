import { test } from "node:test";
import assert from "node:assert/strict";

/* ce-servant-select.js pulls in the data and DOM modules, but only touches them inside its
   methods, so a Map-backed localStorage is enough to drive the store. */
const blobs = new Map();
globalThis.localStorage = {
  getItem: (key) => (blobs.has(key) ? blobs.get(key) : null),
  setItem: (key, value) => blobs.set(key, String(value)),
};

const KEY = "fgo_ce_filter_data";
const { CEFilterStore } = await import("../src/scripts/ce-servant-select.js");
const { CEFilterApp } = await import("../src/scripts/ce-filter-app.js");

test("a write from one sub-tab keeps the other sub-tab's field", () => {
  blobs.clear();
  CEFilterStore.write({ servantPicks: ["001", "444"] });
  CEFilterStore.write({ cePicks: ["0099"], ceMode: "any" });

  const stored = CEFilterStore.read();
  assert.deepStrictEqual(stored.servantPicks, ["001", "444"]);
  assert.deepStrictEqual(stored.cePicks, ["0099"]);
  assert.equal(stored.ceMode, "any");
});

test("read returns {} for missing, unparseable or non-object storage", () => {
  blobs.clear();
  assert.deepStrictEqual(CEFilterStore.read(), {});

  blobs.set(KEY, "not json");
  assert.deepStrictEqual(CEFilterStore.read(), {});

  blobs.set(KEY, '["001"]');
  assert.deepStrictEqual(CEFilterStore.read(), {});
});

test("a repeated write replaces its own fields, nothing else", () => {
  blobs.clear();
  CEFilterStore.write({ servantPicks: ["001"] });
  CEFilterStore.write({ cePicks: ["0099"], ceMode: "all" });
  CEFilterStore.write({ cePicks: ["0100"], ceMode: "custom" });

  assert.deepStrictEqual(CEFilterStore.read(), {
    servantPicks: ["001"],
    cePicks: ["0100"],
    ceMode: "custom",
  });
});

test("CEFilterApp._loadPicks migrates legacy 4-digit cePicks to Atlas equip IDs", () => {
  blobs.clear();
  CEFilterStore.write({ cePicks: ["1949", "0099"], ceMode: "all" });
  CEFilterApp._loadPicks();
  assert.deepStrictEqual(CEFilterApp.state.selectedCEs, ["9407480", "9400970"]);
});
