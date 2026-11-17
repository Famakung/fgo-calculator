import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTradeRatio, buildResultsFragment } from "../src/scripts/event-shop-farm-results.js";

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

function stubEl(tag) {
  const classes = new Set();
  return {
    tagName: tag.toUpperCase(),
    className: "",
    textContent: "",
    children: [],
    style: {},
    dataset: {},
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      contains: (name) => classes.has(name),
    },
    setAttribute() {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
  };
}

test("buildResultsFragment hides Quests to Play and Item Receive when result is trade-only", () => {
  const prevDocument = globalThis.document;
  globalThis.document = {
    createElement: stubEl,
    createDocumentFragment: () => stubEl("fragment"),
  };
  try {
    const snapshot = {
      currencies: [
        { id: 94164001, name: "Bronze", background: "bronze", icon: null },
        { id: 94164002, name: "Silver", background: "silver", icon: null },
      ],
      trades: SNAPSHOT_TRADES,
    };
    const frag = buildResultsFragment(snapshot, {
      result: {
        plays: [],
        trades: [{ fromId: 94164001, toId: 94164002, count: 50 }],
        farmed: { 94164001: 0, 94164002: 0 },
        totalPlays: 0,
      },
    });
    const hasClass = (cls) =>
      frag.children.some((node) => node.className.split(" ").includes(cls) || node.classList.contains(cls));
    assert.ok(!hasClass("farm-res-quests"), "Quests to Play omitted on trade-only");
    assert.ok(!hasClass("farm-res-receive"), "Item Receive omitted on trade-only");
    assert.ok(hasClass("farm-res-trades"), "Shop Trades rendered on trade-only");
  } finally {
    globalThis.document = prevDocument;
  }
});
