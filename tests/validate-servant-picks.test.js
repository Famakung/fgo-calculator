import { test } from "node:test";
import assert from "node:assert/strict";

import { Validator } from "../src/scripts/domain.js";

test("keeps zero-padded servant ids in save order, deduped", () => {
  assert.deepStrictEqual(Validator.validateServantPicks(["059", "001", "059", "444"]), ["059", "001", "444"]);
  assert.deepStrictEqual(Validator.validateServantPicks(["1000"]), ["1000"]);
});

test("drops anything that is not a numeric id string", () => {
  const junk = ["1", "01", 1, "abcd", null, undefined, {}, "00a1", "__proto__"];
  assert.deepStrictEqual(Validator.validateServantPicks(junk), []);
});

test("returns an empty list for a non-array stored value", () => {
  assert.deepStrictEqual(Validator.validateServantPicks(undefined), []);
  assert.deepStrictEqual(Validator.validateServantPicks("001,444"), []);
  assert.deepStrictEqual(Validator.validateServantPicks({ 0: "001" }), []);
});
