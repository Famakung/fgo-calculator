import { test } from "node:test";
import assert from "node:assert/strict";

import { Validator } from "../src/scripts/domain.js";

test("keeps zero-padded servant and CE ids in save order, deduped", () => {
  assert.deepStrictEqual(Validator.validatePicks(["059", "001", "059", "444"]), ["059", "001", "444"]);
  assert.deepStrictEqual(Validator.validatePicks(["1000"]), ["1000"]);
  assert.deepStrictEqual(Validator.validatePicks(["0099", "2945", "0099"]), ["0099", "2945"]);
});

test("drops anything that is not a numeric id string", () => {
  const junk = ["1", "01", 1, "abcd", null, undefined, {}, "00a1", "__proto__"];
  assert.deepStrictEqual(Validator.validatePicks(junk), []);
});

test("returns an empty list for a non-array stored value", () => {
  assert.deepStrictEqual(Validator.validatePicks(undefined), []);
  assert.deepStrictEqual(Validator.validatePicks("001,444"), []);
  assert.deepStrictEqual(Validator.validatePicks({ 0: "001" }), []);
});
