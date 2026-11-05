import { test } from "node:test";
import assert from "node:assert/strict";
import { SlotCEs } from "../src/scripts/domain.js";

/* bond-app.js pulls in the data and DOM modules but only touches them inside its render methods, so a
   Map-backed localStorage is enough to drive loadState()/saveState(). */
const blobs = new Map();
globalThis.localStorage = {
  getItem: (key) => (blobs.has(key) ? blobs.get(key) : null),
  setItem: (key, value) => blobs.set(key, String(value)),
};

const { BondApp } = await import("../src/scripts/bond-app.js");
const KEY = "fgo_bond_calculator_data";

const slot = (ces, grand) => ({ ces, grand });

test("capacity is one, or two for a grand servant", () => {
  assert.equal(SlotCEs.capacity(slot(["2645"], false)), 1);
  assert.equal(SlotCEs.capacity(slot(["2645", "2198"], true)), 2);
});

test("unticking grand keeps the first essence and drops the second", () => {
  const trimmed = SlotCEs.trim(slot(["2645", "2198"], false));
  assert.deepEqual(trimmed.ces, ["2645"]);
});

test("trim never touches a list already inside its capacity", () => {
  assert.deepEqual(SlotCEs.trim(slot(["2645"], true)).ces, ["2645"]);
  assert.deepEqual(SlotCEs.trim(slot([], false)).ces, []);
});

test("the party pool keeps every slot's essence, in slot then position order", () => {
  const slots = [slot(["2645", "2198"], true), slot([], false), slot(["3031"], false)];
  assert.deepEqual(
    SlotCEs.partyPool(slots).map((pooled) => pooled.entry),
    ["2645", "2198", "3031"],
  );
});

test("a support slot's essence still joins the pool, tagged as borrowed", () => {
  const slots = [slot(["2645"], false), slot(["3031"], false)];
  slots[1].type = "support";
  assert.deepEqual(
    SlotCEs.partyPool(slots).map((pooled) => [pooled.entry, pooled.isSupport]),
    [
      ["2645", false],
      ["3031", true],
    ],
  );
});

test("a borrowed essence pays the friend-side rate, a self-worn one its own", () => {
  const teatime = { bonus: 5, supportBonus: 15 };
  assert.equal(SlotCEs.rate(teatime, true), 15);
  assert.equal(SlotCEs.rate(teatime, false), 5);
  assert.equal(SlotCEs.rate({ bonus: 10 }, true), 10); // no friend-side rate on this essence
});

test("a missing or non-array list sanitises to empty", () => {
  assert.deepEqual(SlotCEs.sanitize(undefined, false), { ces: [], grand: false });
  assert.deepEqual(SlotCEs.sanitize("2645", true), { ces: [], grand: true });
});

test("sanitize drops malformed entries and keeps ids and group options", () => {
  const raw = ["2645", "", null, 42, { groupId: "0330", optionId: "0331" }, { groupId: "0330" }];
  assert.deepEqual(SlotCEs.sanitize(raw, "yes").ces, ["2645", { groupId: "0330", optionId: "0331" }]);
  assert.equal(SlotCEs.sanitize(raw, "yes").grand, true);
});

test("sanitize clamps a saved list to the slot's capacity, keeping the first", () => {
  assert.deepEqual(SlotCEs.sanitize(["2645", "2198", "3031"], false).ces, ["2645"]);
  assert.deepEqual(SlotCEs.sanitize(["2645", "2198", "3031"], true).ces, ["2645", "2198"]);
});

test("the old top-level pool is dropped, not dealt out to the slots", () => {
  blobs.set(KEY, JSON.stringify({ slots: [{ servantId: "105", ces: ["2645"], grand: true }], ces: ["2198", "3031"] }));
  const state = BondApp.loadState();
  assert.equal(state.ces, undefined);
  assert.deepEqual(state.slots[0].ces, ["2645"]);
  // No quest in the save, so this is the shared party — and the shared party cannot be grand.
  assert.equal(state.slots[0].grand, false);
  assert.deepEqual(state.slots[1].ces, []);
  assert.equal(state.slots[1].grand, false);
});

/* The tick became Grand Duel's own, so loadState() sanitizes each party by its own key: an old save that
   ticked it under Free Quest must not come back wearing an essence no tick can untick, while the Grand
   Duel racks that can use the flag keep it and both essences. */
test("a shared party loses grand and the second essence, a Grand Duel party keeps both", () => {
  const rack = [{ servantId: "105", ces: ["2645", "2198"], grand: true }];
  blobs.set(
    KEY,
    JSON.stringify({
      slots: rack,
      parties: { all: rack.map((s) => ({ ...s })) },
      questMain: "fq",
      questSub: "fq83",
    }),
  );
  const state = BondApp.loadState();
  assert.deepEqual(state.slots[0].ces, ["2645"]);
  assert.equal(state.slots[0].grand, false);
  assert.deepEqual(state.parties.all[0].ces, ["2645", "2198"]);
  assert.equal(state.parties.all[0].grand, true);
});

test("a save holding more essences than the slot fits comes back clamped, and stays clamped", () => {
  blobs.set(KEY, JSON.stringify({ slots: [{ servantId: "105", ces: ["2645", "2198", "3031"], grand: false }] }));
  BondApp.state = BondApp.loadState();
  assert.deepEqual(BondApp.state.slots[0].ces, ["2645"]);

  BondApp.saveState();
  assert.deepEqual(JSON.parse(blobs.get(KEY)).slots[0].ces, ["2645"]);
});
