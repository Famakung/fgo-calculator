import { test } from "node:test";
import assert from "node:assert/strict";
import { ServantSort } from "../src/scripts/domain.js";

/* The picker rows carry only the base trait list, the same list its class and rarity filters read, so a
   sort key must come out of that and nothing else. */
const saber5 = { id: "002", traits: ["0001", "0100", "0405"] };
const archer4 = { id: "003", traits: ["0002", "0102", "0404"] };
const caster3 = { id: "010", traits: ["0001", "0104", "0403"] };
const noRarity = { id: "011", traits: ["0100"] };
const roster = [caster3, archer4, saber5];

const ids = (list) => list.map((s) => s.id).join(",");

test("rarity reads the 04xx trait, and a servant without one is 0", () => {
  assert.equal(ServantSort.rarity(saber5.traits), 5);
  assert.equal(ServantSort.rarity(archer4.traits), 4);
  assert.equal(ServantSort.rarity(noRarity.traits), 0);
  assert.equal(ServantSort.rarity(undefined), 0);
});

test("class index follows the order the picker's class rows show", () => {
  assert.equal(ServantSort.classIndex(saber5.traits), 0);
  assert.ok(ServantSort.classIndex(archer4.traits) > ServantSort.classIndex(saber5.traits));
  assert.equal(ServantSort.classIndex(caster3.traits), 4);
  assert.equal(ServantSort.classIndex(["2821"]), 99);
});

test("id sorts numerically, asc and desc are mirrors", () => {
  assert.equal(ids(ServantSort.sorted(roster, "id", "asc")), "002,003,010");
  assert.equal(ids(ServantSort.sorted(roster, "id", "desc")), "010,003,002");
});

test("rarity and class sort by their key, ID breaks every tie", () => {
  const low = { id: "004", traits: ["0100", "0401"] };
  assert.equal(ids(ServantSort.sorted([...roster, low], "rarity", "asc")), "004,010,003,002");
  assert.equal(ids(ServantSort.sorted([caster3, archer4, saber5], "class", "asc")), "002,003,010");
});

test("an unknown key or order falls back to id ascending", () => {
  assert.equal(ids(ServantSort.sorted(roster, "bond", "sideways")), "002,003,010");
  assert.equal(ids(ServantSort.sorted(roster)), "002,003,010");
});

test("a caller whose rows are not servants says where the id and the traits live", () => {
  // A Bond Gain CE result card: the servant sits under `servant`, its traits come from one ascension.
  const card = (id, traits) => ({ servant: { id }, traits });
  const rows = [card("010", caster3.traits), card("002", saber5.traits)];
  const idOf = (row) => row.servant.id;
  assert.equal(
    ServantSort.sorted(rows, "rarity", "asc", idOf, (row) => row.traits)
      .map(idOf)
      .join(","),
    "010,002",
  );
});

test("sorting returns a copy and never reorders the caller's list", () => {
  const list = [caster3, archer4, saber5];
  assert.equal(ids(ServantSort.sorted(list, "id", "asc")), "002,003,010");
  assert.equal(ids(list), "010,003,002");
});
