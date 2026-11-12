import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTradeRatio } from "../src/scripts/event-shop-farm-results.js";

/* The plan's trades carry only { fromId, toId, count }; the Shop Trades row reads its ratio figures
   off the event snapshot's trade list. Without that resolution the row printed "0 <from> → 0 <to>". */
const SNAPSHOT_TRADES = [
  { fromId: 94164001, toId: 94164002, costAmount: 10, getNum: 1 },
  { fromId: 94164002, toId: 94164003, costAmount: 10, getNum: 1 },
];

test("resolveTradeRatio finds the snapshot ratio by both ends of the pair", () => {
  assert.deepEqual(resolveTradeRatio(SNAPSHOT_TRADES, { fromId: "94164001", toId: 94164002, count: 16 }), {
    costAmount: 10,
    getNum: 1,
  });
  assert.deepEqual(resolveTradeRatio(SNAPSHOT_TRADES, { fromId: 94164002, toId: "94164003", count: 202 }), {
    costAmount: 10,
    getNum: 1,
  });
});

test("resolveTradeRatio returns null for a pair or figures the snapshot does not sell", () => {
  assert.equal(resolveTradeRatio(SNAPSHOT_TRADES, { fromId: 1, toId: 2, count: 3 }), null);
  assert.equal(resolveTradeRatio(undefined, { fromId: 94164001, toId: 94164002, count: 1 }), null);
  assert.equal(resolveTradeRatio([{ fromId: 1, toId: 2, costAmount: 0, getNum: 1 }], { fromId: 1, toId: 2 }), null);
});
