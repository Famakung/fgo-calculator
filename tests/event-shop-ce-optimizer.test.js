import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { EVENT_SHOP_DATA } from "../src/scripts/data/event_shop.js";
import { EventShop, Schema } from "../src/scripts/domain.js";

const CE_GOLD = 9409660;
const CE_SILVER = 9409670;
const CE_BRONZE = 9409680;
const CID_BRONZE = "94164000";
const CID_SILVER = "94164001";
const CID_GOLD = "94164002";

const SAMPLE_CES = [
  {
    id: CE_GOLD,
    name: "5-star Gold CE",
    rarity: 5,
    icon: null,
    bonuses: { [CID_GOLD]: { nonLimitBreak: 1, limitBreak: 2 } },
  },
  {
    id: CE_SILVER,
    name: "4-star Silver CE",
    rarity: 4,
    icon: null,
    bonuses: { [CID_SILVER]: { nonLimitBreak: 1, limitBreak: 2 } },
  },
  {
    id: CE_BRONZE,
    name: "3-star Bronze CE",
    rarity: 3,
    icon: null,
    bonuses: { [CID_BRONZE]: { nonLimitBreak: 1, limitBreak: 2 } },
  },
];

function makeQuest(questId, ap, drops, questName = `Q${questId}`) {
  return { questId, questName, recommendLv: "90", ap, sampleRuns: 10, drops };
}

function assertComboInvariants(plays, bonusCes, ceOwned, ceEquipLimit) {
  const limit = EventShop.clampCeEquipLimit(ceEquipLimit);
  const byId = new Map(bonusCes.map((ce, idx) => [ce.id, { ce, idx }]));
  for (const play of plays) {
    assert.ok(Array.isArray(play.ceCombo), `play ${play.questId} must expose ceCombo array`);
    let totalSlots = 0;
    let prevIdx = -1;
    for (const entry of play.ceCombo) {
      assert.ok(byId.has(entry.ceId), `unknown ceId ${entry.ceId}`);
      const { idx } = byId.get(entry.ceId);
      assert.ok(idx > prevIdx, "ceCombo must follow bonusCes order");
      prevIdx = idx;
      assert.ok(Number.isInteger(entry.limitBreak) && entry.limitBreak >= 0);
      assert.ok(Number.isInteger(entry.nonLimitBreak) && entry.nonLimitBreak >= 0);
      assert.ok(entry.limitBreak > 0 || entry.nonLimitBreak > 0, "ceCombo omits 0/0 entries");
      const owned = ceOwned[String(entry.ceId)] || ceOwned[entry.ceId] || {};
      assert.ok(entry.limitBreak <= EventShop.clampCeOwned(owned.limitBreak));
      assert.ok(entry.nonLimitBreak <= EventShop.clampCeOwned(owned.nonLimitBreak));
      totalSlots += entry.limitBreak + entry.nonLimitBreak;
    }
    assert.ok(totalSlots <= limit, `equipped ${totalSlots} CEs exceeds limit ${limit}`);
  }
}

test("Schema and clamping helpers sanitize ceOwned and ceEquipLimit across hostile values", () => {
  assert.deepEqual(Schema.ceOwned, { min: 0, max: 99, default: 0 });
  assert.deepEqual(Schema.ceEquipLimit, { min: 1, max: 6, default: 6 });

  for (const blank of [undefined, null, "", "   ", NaN, Infinity, -Infinity, true, false, [], {}, "abc"]) {
    assert.equal(EventShop.clampCeOwned(blank), 0, `clampCeOwned(${String(blank)}) -> 0`);
    assert.equal(EventShop.clampCeEquipLimit(blank), 6, `clampCeEquipLimit(${String(blank)}) -> default 6`);
  }

  assert.equal(EventShop.clampCeOwned(-5), 0);
  assert.equal(EventShop.clampCeOwned(3.9), 3);
  assert.equal(EventShop.clampCeOwned("7"), 7);
  assert.equal(EventShop.clampCeOwned(500), 99);
  assert.equal(Object.is(EventShop.clampCeOwned(-0), -0), false);

  assert.equal(EventShop.clampCeEquipLimit(-3), 1);
  assert.equal(EventShop.clampCeEquipLimit(0), 1);
  assert.equal(EventShop.clampCeEquipLimit("0"), 1);
  assert.equal(EventShop.clampCeEquipLimit(1), 1);
  assert.equal(EventShop.clampCeEquipLimit(4.8), 4);
  assert.equal(EventShop.clampCeEquipLimit("5"), 5);
  assert.equal(EventShop.clampCeEquipLimit(7), 6);
  assert.equal(EventShop.clampCeEquipLimit("99"), 6);
});

test("sanitizePlans persists and sanitizes ceOwned against snapshot.bonusCes and ceEquipLimit", () => {
  const snapshot = {
    event: { id: 80639, name: "Test", shortName: "Test" },
    currencies: [
      { id: 94164000, name: "Bronze", background: "bronze", icon: null },
      { id: 94164001, name: "Silver", background: "silver", icon: null },
      { id: 94164002, name: "Gold", background: "gold", icon: null },
    ],
    items: [],
    farm: { quests: [], best: {} },
    trades: [],
    bonusCes: SAMPLE_CES,
  };
  const polluted = JSON.parse(
    JSON.stringify({
      selectedEventId: 80639,
      plans: {
        80639: {
          ceOwned: {
            [CE_GOLD]: { limitBreak: 120, nonLimitBreak: -2 },
            [CE_SILVER]: { limitBreak: 2.8, nonLimitBreak: "3" },
            9999999: { limitBreak: 5, nonLimitBreak: 5 },
            __proto__: { limitBreak: 4, nonLimitBreak: 4 },
          },
          ceEquipLimit: 0,
        },
      },
    }),
  );
  const state = EventShop.sanitizePlans(polluted, [snapshot]);
  const plan = state.plans["80639"];
  assert.equal(plan.ceEquipLimit, 1);
  assert.deepEqual(plan.ceOwned, {
    [CE_GOLD]: { limitBreak: 99, nonLimitBreak: 0 },
    [CE_SILVER]: { limitBreak: 2, nonLimitBreak: 3 },
    [CE_BRONZE]: { limitBreak: 0, nonLimitBreak: 0 },
  });
  assert.equal({}.limitBreak, undefined);
});

test("farmPlan returns ceCombo: [] and identical counts when no owned CEs apply", () => {
  const farm = {
    quests: [
      makeQuest(1, 40, { [CID_BRONZE]: { dropExpected: 5, num: 2 } }),
      makeQuest(2, 40, { [CID_GOLD]: { dropExpected: 4, num: 2 } }),
    ],
  };
  const totals = { [CID_BRONZE]: 50, [CID_GOLD]: 40 };
  const base = EventShop.farmPlan({ totals, farm });
  const withEmptyCes = EventShop.farmPlan({ totals, farm, bonusCes: [], ceOwned: {}, ceEquipLimit: 6 });
  const withZeroOwned = EventShop.farmPlan({ totals, farm, bonusCes: SAMPLE_CES, ceOwned: {}, ceEquipLimit: 6 });

  assert.deepEqual(
    base.plays.map((p) => p.ceCombo),
    [[], []],
  );
  assert.deepEqual(withEmptyCes, base);
  assert.deepEqual(withZeroOwned, base);
});

test("farmPlan omits CEs that boost zero dropped or non-useful currencies on a quest", () => {
  const farm = {
    quests: [makeQuest(10, 40, { [CID_BRONZE]: { dropExpected: 5, num: 2 }, [CID_GOLD]: { dropExpected: 5, num: 2 } })],
  };
  const ceOwned = {
    [CE_GOLD]: { limitBreak: 6, nonLimitBreak: 0 },
    [CE_SILVER]: { limitBreak: 6, nonLimitBreak: 0 },
    [CE_BRONZE]: { limitBreak: 6, nonLimitBreak: 0 },
  };
  // Only Bronze needed, no trades -> Silver not dropped, Gold cannot trade down to Bronze -> equip Bronze only!
  const plan = EventShop.farmPlan({
    totals: { [CID_BRONZE]: 100, [CID_SILVER]: 0, [CID_GOLD]: 0 },
    farm,
    trades: [{ fromId: Number(CID_BRONZE), toId: Number(CID_SILVER), costAmount: 10, getNum: 1 }],
    bonusCes: SAMPLE_CES,
    ceOwned,
    ceEquipLimit: 6,
  });
  assert.equal(plan.totalPlays, 2); // 5 * (2 + 12) = 70/run -> 2 runs = 140
  assert.deepEqual(plan.plays[0].ceCombo, [{ ceId: CE_BRONZE, limitBreak: 6, nonLimitBreak: 0 }]);
  assert.equal(plan.farmed[CID_BRONZE], 140);
  assert.equal(plan.farmed[CID_GOLD], 20);
});

test("different quests equip different CE combos and respect ceEquipLimit 1..6 and MLB priority", () => {
  const farm = {
    quests: [
      makeQuest(101, 40, { [CID_BRONZE]: { dropExpected: 10, num: 1 } }),
      makeQuest(102, 40, { [CID_SILVER]: { dropExpected: 10, num: 1 } }),
      makeQuest(103, 40, { [CID_GOLD]: { dropExpected: 10, num: 1 } }),
    ],
  };
  const totals = { [CID_BRONZE]: 70, [CID_SILVER]: 60, [CID_GOLD]: 50 };
  const ceOwned = {
    [CE_GOLD]: { limitBreak: 1, nonLimitBreak: 3 },
    [CE_SILVER]: { limitBreak: 2, nonLimitBreak: 2 },
    [CE_BRONZE]: { limitBreak: 0, nonLimitBreak: 5 },
  };

  for (const limit of [1, 2, 3, 4, 5, 6]) {
    const plan = EventShop.farmPlan({ totals, farm, bonusCes: SAMPLE_CES, ceOwned, ceEquipLimit: limit });
    assertComboInvariants(plan.plays, SAMPLE_CES, ceOwned, limit);
    const byQuest = new Map(plan.plays.map((p) => [p.questId, p]));
    if (limit === 3) {
      // Gold node picks 1 LB + 2 NLB = +4 (50 / (10*5) = 1 run); Silver picks 2 LB + 1 NLB = +5 (60 / (10*6) = 1 run);
      // Bronze picks 3 NLB = +3 (70 / (10*4) = 2 runs) -> total 4 runs!
      assert.equal(plan.totalPlays, 4);
      assert.deepEqual(byQuest.get(103).ceCombo, [{ ceId: CE_GOLD, limitBreak: 1, nonLimitBreak: 2 }]);
      assert.deepEqual(byQuest.get(102).ceCombo, [{ ceId: CE_SILVER, limitBreak: 2, nonLimitBreak: 1 }]);
      assert.deepEqual(byQuest.get(101).ceCombo, [{ ceId: CE_BRONZE, limitBreak: 0, nonLimitBreak: 3 }]);
    }
  }
});

test("additive flat bonus + CE bonus combines without clipping at flat bonus max 1000", () => {
  const farm = {
    quests: [makeQuest(1, 40, { [CID_GOLD]: { dropExpected: 1, num: 1 } })],
  };
  const plan = EventShop.farmPlan({
    totals: { [CID_GOLD]: 2004 },
    bonus: { [CID_GOLD]: 1000 },
    farm,
    bonusCes: SAMPLE_CES,
    ceOwned: { [CE_GOLD]: { limitBreak: 1, nonLimitBreak: 0 } },
    ceEquipLimit: 6,
  });
  // Rate = 1 * (1 + 1000 + 2) = 1003/run -> 2 runs = 2006 >= 2004
  assert.equal(plan.totalPlays, 2);
  assert.equal(plan.farmed[CID_GOLD], 2006);
});

test("joint optimization picks per-quest CEs on All-Drop + Top-Up nodes and reduces totalPlays", () => {
  const farm = {
    quests: [
      makeQuest(201, 40, {
        [CID_BRONZE]: { dropExpected: 5, num: 1 },
        [CID_SILVER]: { dropExpected: 5, num: 1 },
        [CID_GOLD]: { dropExpected: 5, num: 1 },
      }),
      makeQuest(202, 40, { [CID_GOLD]: { dropExpected: 8, num: 1 } }),
    ],
  };
  const totals = { [CID_BRONZE]: 110, [CID_SILVER]: 110, [CID_GOLD]: 320 };
  const ceOwned = {
    [CE_GOLD]: { limitBreak: 6, nonLimitBreak: 0 },
    [CE_SILVER]: { limitBreak: 3, nonLimitBreak: 0 },
    [CE_BRONZE]: { limitBreak: 3, nonLimitBreak: 0 },
  };
  // Best joint plan:
  // Run Q201 x2 with 3 Bronze LB + 3 Silver LB => Bronze: 2*5*(1+6)=70, Silver: 70, Gold: 10? Wait:
  // Or Q201 x3 with 2 Bronze + 2 Silver + 2 Gold -> 3*5*5 = 75 B/S/G... wait: let us check:
  // If Q201 equips (3 LB Bronze, 3 LB Silver): 2 runs gives 70B, 70S -> short! 4 runs gives 140B, 140S, 20G!
  // Plus Q202 equips (6 LB Gold): 8*(1+12) = 104 Gold/run -> 3 runs = 312G -> total 20+312 = 332G >= 320! (7 runs)
  const plan = EventShop.farmPlan({
    totals,
    farm,
    bonusCes: SAMPLE_CES,
    ceOwned,
    ceEquipLimit: 6,
  });
  assertComboInvariants(plan.plays, SAMPLE_CES, ceOwned, 6);
  // Without joint different CEs per quest, equipping only Gold CEs everywhere would need 22 runs of Q201!
  assert.ok(plan.totalPlays <= 7, `expected joint plan <= 7 plays, got ${plan.totalPlays}`);
  const q201 = plan.plays.find((p) => p.questId === 201);
  const q202 = plan.plays.find((p) => p.questId === 202);
  assert.ok(q201 && q202, "uses both All-Drop and Top-Up quests");
  assert.deepEqual(q202.ceCombo, [{ ceId: CE_GOLD, limitBreak: 6, nonLimitBreak: 0 }]);
  assert.notDeepEqual(q201.ceCombo, q202.ceCombo, "All-Drop and Gold Top-Up pick different CE loadouts");
});

test("multi-banner duplicate CEs and multi-currency CEs optimize cleanly and deterministically", () => {
  const banner1Gold = {
    id: 9409410,
    name: "Banner1 Gold",
    rarity: 5,
    icon: null,
    bonuses: { [CID_GOLD]: { nonLimitBreak: 1, limitBreak: 2 } },
  };
  const banner2Gold = {
    id: 9409440,
    name: "Banner2 Gold",
    rarity: 5,
    icon: null,
    bonuses: { [CID_GOLD]: { nonLimitBreak: 1, limitBreak: 2 } },
  };
  const multiAll = {
    id: 9406000,
    name: "All-Currency CE",
    rarity: 5,
    icon: null,
    bonuses: {
      [CID_BRONZE]: { nonLimitBreak: 2, limitBreak: 3 },
      [CID_SILVER]: { nonLimitBreak: 2, limitBreak: 3 },
      [CID_GOLD]: { nonLimitBreak: 2, limitBreak: 3 },
    },
  };
  const farm = {
    quests: [
      makeQuest(301, 40, {
        [CID_BRONZE]: { dropExpected: 5, num: 1 },
        [CID_GOLD]: { dropExpected: 5, num: 1 },
      }),
    ],
  };
  const bonusCes = [multiAll, banner1Gold, banner2Gold];
  const ceOwned = {
    9406000: { limitBreak: 1, nonLimitBreak: 1 },
    9409410: { limitBreak: 2, nonLimitBreak: 0 },
    9409440: { limitBreak: 2, nonLimitBreak: 2 },
  };
  const plan = EventShop.farmPlan({
    totals: { [CID_BRONZE]: 100, [CID_GOLD]: 100 },
    farm,
    bonusCes,
    ceOwned,
    ceEquipLimit: 5,
  });
  // Best 5-slot combo: 1 LB + 1 NLB of multiAll (+5/+5, 2 slots), 2 LB banner1Gold (+4 Gold, 2 slots), 1 LB banner2Gold (+2 Gold, 1 slot)
  // => Bronze rate 5*(1+5)=30/run, Gold rate 5*(1+11)=60/run -> 4 runs = 120B, 240G!
  assert.equal(plan.totalPlays, 4);
  assert.deepEqual(plan.plays[0].ceCombo, [
    { ceId: 9406000, limitBreak: 1, nonLimitBreak: 1 },
    { ceId: 9409410, limitBreak: 2, nonLimitBreak: 0 },
    { ceId: 9409440, limitBreak: 1, nonLimitBreak: 0 },
  ]);
});

test("bronze trade-up chain enables Bronze CEs to cut total runs on pure Gold deficit", () => {
  const farm = {
    quests: [
      makeQuest(401, 40, { [CID_BRONZE]: { dropExpected: 10, num: 1 }, [CID_GOLD]: { dropExpected: 1, num: 1 } }),
    ],
  };
  // Suppose only Bronze CE is owned: 6 LB gives +12 Bronze -> 130 Bronze/run = 13 Gold via 10:1 trade + 1 Gold = 14 Gold/run!
  const plan = EventShop.farmPlan({
    totals: { [CID_GOLD]: 14 },
    farm,
    trades: [{ fromId: Number(CID_BRONZE), toId: Number(CID_GOLD), costAmount: 10, getNum: 1 }],
    bonusCes: SAMPLE_CES,
    ceOwned: { [CE_BRONZE]: { limitBreak: 6, nonLimitBreak: 0 } },
    ceEquipLimit: 6,
  });
  assert.equal(plan.totalPlays, 1);
  assert.deepEqual(plan.plays[0].ceCombo, [{ ceId: CE_BRONZE, limitBreak: 6, nonLimitBreak: 0 }]);
  assert.deepEqual(plan.trades, [{ fromId: Number(CID_BRONZE), toId: Number(CID_GOLD), count: 13 }]);
});

test("top-up quest auto-selection accounts for CE bonus scaling when currencyQuest is unset", () => {
  // Quest 501: higher base rate (1*10 = 10) vs Quest 502: higher dropExpected (5*1 = 5), scales to 5*(1+12) = 65!
  const farm = {
    quests: [
      makeQuest(501, 40, { [CID_GOLD]: { dropExpected: 1, num: 10 } }),
      makeQuest(502, 40, { [CID_GOLD]: { dropExpected: 5, num: 1 } }),
    ],
  };
  const plan = EventShop.farmPlan({
    totals: { [CID_GOLD]: 130 },
    farm,
    bonusCes: SAMPLE_CES,
    ceOwned: { [CE_GOLD]: { limitBreak: 6, nonLimitBreak: 0 } },
    ceEquipLimit: 6,
  });
  assert.equal(plan.totalPlays, 2);
  assert.equal(plan.plays[0].questId, 502);
});

test("brute-force cross-check on 30 randomized multi-quest CE instances with trade chains", () => {
  let seed = 133742;
  const rand = (n) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % n;
  };
  const cids = ["10", "20", "30"];
  const ces = cids.map((cid, i) => ({
    id: 100 + i,
    bonuses: { [cid]: { nonLimitBreak: 1, limitBreak: 2 } },
  }));

  function bruteCombosForQuest(quest, owned, limit, flatBonus) {
    const dropKeys = Object.keys(quest.drops);
    const all = [];
    const cur = ces.map(() => [0, 0]);
    function rec(idx, left) {
      if (idx === ces.length) {
        const bonusByKey = {};
        for (let i = 0; i < ces.length; i++) {
          const [lb, nlb] = cur[i];
          if (lb + nlb === 0) continue;
          const cid = cids[i];
          if (!quest.drops[cid]) return; // skip irrelevant combo
          bonusByKey[cid] = lb * 2 + nlb;
        }
        const rates = {};
        for (const k of dropKeys) {
          rates[k] = quest.drops[k].dropExpected * (quest.drops[k].num + (flatBonus[k] || 0) + (bonusByKey[k] || 0));
        }
        all.push({
          drops: Object.fromEntries(dropKeys.map((k) => [k, { dropExpected: 1, num: rates[k] }])),
          ceBonus: bonusByKey,
        });
        return;
      }
      const o = owned[ces[idx].id];
      for (let lb = 0; lb <= Math.min(left, o.limitBreak); lb++) {
        for (let nlb = 0; nlb <= Math.min(left - lb, o.nonLimitBreak); nlb++) {
          cur[idx] = [lb, nlb];
          rec(idx + 1, left - lb - nlb);
        }
      }
    }
    rec(0, limit);
    return all;
  }

  for (let trial = 0; trial < 30; trial++) {
    const qAll = makeQuest(1, 40, {
      10: { dropExpected: 1 + rand(4), num: 1 + rand(2) },
      20: { dropExpected: 1 + rand(4), num: 1 + rand(2) },
      30: { dropExpected: 1 + rand(4), num: 1 + rand(2) },
    });
    const q1 = makeQuest(2, 40, {
      10: { dropExpected: 2 + rand(4), num: 1 + rand(2) },
      20: { dropExpected: 1 + rand(2), num: 1 },
    });
    const q2 = makeQuest(3, 40, {
      20: { dropExpected: 2 + rand(4), num: 1 + rand(2) },
      30: { dropExpected: 1 + rand(2), num: 1 },
    });
    const quests = [q1, q2, qAll];
    const totals = {
      10: 20 + rand(80),
      20: 20 + rand(80),
      30: 20 + rand(80),
    };
    const flatBonus = { 10: rand(3), 20: rand(3), 30: rand(3) };
    const limit = 1 + rand(3); // keep brute force space compact
    const ceOwned = {
      100: { limitBreak: rand(3), nonLimitBreak: rand(2) },
      101: { limitBreak: rand(3), nonLimitBreak: rand(2) },
      102: { limitBreak: rand(3), nonLimitBreak: rand(2) },
    };
    const trades =
      trial % 2 === 0
        ? [
            { fromId: 10, toId: 20, costAmount: 10, getNum: 1 },
            { fromId: 20, toId: 30, costAmount: 10, getNum: 1 },
          ]
        : [];
    const currencyQuest = { 10: 2, 20: 3, 30: 3 };
    const priorityQuestId = 1;

    const got = EventShop.farmPlan({
      totals,
      bonus: flatBonus,
      farm: { quests },
      trades,
      currencyQuest,
      priorityQuestId,
      currencyIds: cids,
      bonusCes: ces,
      ceOwned,
      ceEquipLimit: limit,
    });
    assertComboInvariants(got.plays, ces, ceOwned, limit);

    // Independent brute-force minimum plays over all Pareto-undominated combos per quest
    const lists = quests.map((q) => {
      const raw = bruteCombosForQuest(q, ceOwned, limit, flatBonus);
      // Pareto-prune identically on quest's drops
      return raw.filter(
        (a, ai) =>
          !raw.some(
            (b, bi) =>
              bi !== ai &&
              Object.keys(a.drops).every((k) => b.drops[k].num >= a.drops[k].num) &&
              (Object.keys(a.drops).some((k) => b.drops[k].num > a.drops[k].num) || bi < ai),
          ),
      );
    });
    let oracleBest = Infinity;
    for (const c0 of lists[0]) {
      for (const c1 of lists[1]) {
        for (const c2 of lists[2]) {
          const cand = EventShop.farmPlan({
            totals,
            farm: {
              quests: [
                { ...q1, drops: c0.drops },
                { ...q2, drops: c1.drops },
                { ...qAll, drops: c2.drops },
              ],
            },
            trades,
            currencyQuest,
            priorityQuestId,
            currencyIds: cids,
          });
          if (cand.totalPlays !== null && cand.totalPlays < oracleBest) oracleBest = cand.totalPlays;
        }
      }
    }
    assert.equal(got.totalPlays, oracleBest, `trial ${trial} mismatch: got ${got.totalPlays} vs oracle ${oracleBest}`);
  }
});

test("shipped 80639 and 80632 buy-all plans optimize with 3-CE and 6-CE fixtures within 150ms", () => {
  for (const snap of EVENT_SHOP_DATA.events) {
    const cids = snap.currencies.map((c) => String(c.id));
    const ces3 = cids.map((cid, idx) => ({
      id: 9000 + idx,
      name: `CE-${cid}`,
      rarity: 5 - idx,
      icon: null,
      bonuses: { [cid]: { nonLimitBreak: 1, limitBreak: 2 } },
    }));
    const ces6 = [
      ...ces3,
      ...cids.map((cid, idx) => ({
        id: 9100 + idx,
        name: `CE2-${cid}`,
        rarity: 5 - idx,
        icon: null,
        bonuses: { [cid]: { nonLimitBreak: 1, limitBreak: 2 } },
      })),
    ];
    const requires = EventShop.clearRequires(snap.items);
    const totals = EventShop.totals(snap.items, requires);
    const basePlan = EventShop.farmPlan({ totals, farm: snap.farm, trades: snap.trades, currencyIds: cids });

    assert.ok(Array.isArray(snap.bonusCes) && snap.bonusCes.length > 0, `event ${snap.event.id} ships bonusCes`);
    for (const ces of [snap.bonusCes, ces3, ces6]) {
      const ceOwned = Object.fromEntries(ces.map((ce) => [ce.id, { limitBreak: 6, nonLimitBreak: 6 }]));
      const start = performance.now();
      const cePlan = EventShop.farmPlan({
        totals,
        farm: snap.farm,
        trades: snap.trades,
        currencyIds: cids,
        bonusCes: ces,
        ceOwned,
        ceEquipLimit: 6,
      });
      const elapsed = performance.now() - start;
      assert.ok(cePlan.totalPlays !== null && cePlan.totalPlays < basePlan.totalPlays);
      assert.ok(elapsed < 150, `event ${snap.event.id} (${ces.length} CEs) took ${elapsed.toFixed(1)}ms`);
      assertComboInvariants(cePlan.plays, ces, ceOwned, 6);
      for (const cid of cids) {
        assert.ok(cePlan.yields[cid] >= totals[cid], `currency ${cid} short`);
      }
    }
  }
});
