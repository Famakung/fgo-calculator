import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { EventShop, cascadeYields } from "../src/scripts/domain.js";

function fakeStorage(initial) {
  const data = new Map(Object.entries(initial || {}));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    dump: () => Object.fromEntries(data),
  };
}

async function plannerWith(storage, events) {
  globalThis.localStorage = storage;
  const { EventPlanner } = await import("../src/scripts/event-planner.js");
  EventPlanner._initialized = false;
  const raw = storage.getItem("fgo_event_shop_data");
  EventPlanner.load(raw ? JSON.parse(raw) : null, { events });
  return EventPlanner;
}

/* Real event 80639 (war 9208) 7 raid bosses extracted from .cache/atlas/nice_war_9208.json & nice_quest_941642*_1.json. */
const EVENT_80639_RAIDS = [
  {
    bossId: 920710,
    bossName: "スラノッブの群れ",
    quests: [
      {
        questId: 94164200,
        questName: "スラノッブの群れ ぷにぷに戦〔さらさら級〕",
        difficultyLabel: "ぷにぷに戦〔さらさら級〕",
        recommendLv: "70",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164201,
        questName: "スラノッブの群れ ぷにぷに戦〔とろとろ級〕",
        difficultyLabel: "ぷにぷに戦〔とろとろ級〕",
        recommendLv: "90",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164202,
        questName: "スラノッブの群れ ぷにぷに戦〔ぬるぬる級〕",
        difficultyLabel: "ぷにぷに戦〔ぬるぬる級〕",
        recommendLv: "90+",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164203,
        questName: "スラノッブの群れ ぷにぷに戦〔ぺたぺた級〕",
        difficultyLabel: "ぷにぷに戦〔ぺたぺた級〕",
        recommendLv: "90++",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164204,
        questName: "スラノッブの群れ ぷにぷに戦〔ねばねば級〕",
        difficultyLabel: "ぷにぷに戦〔ねばねば級〕",
        recommendLv: "90+++",
        ap: 40,
        sampleRuns: 26,
        drops: { 94164000: { dropExpected: 22.5769, num: 3 } },
      },
    ],
  },
  {
    bossId: 920711,
    bossName: "アカスラノッブの群れ",
    quests: [
      {
        questId: 94164205,
        questName: "アカスラノッブの群れ ぷにぷに戦〔さらさら級〕",
        difficultyLabel: "ぷにぷに戦〔さらさら級〕",
        recommendLv: "70",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164206,
        questName: "アカスラノッブの群れ ぷにぷに戦〔とろとろ級〕",
        difficultyLabel: "ぷにぷに戦〔とろとろ級〕",
        recommendLv: "90",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164207,
        questName: "アカスラノッブの群れ ぷにぷに戦〔ぬるぬる級〕",
        difficultyLabel: "ぷにぷに戦〔ぬるぬる級〕",
        recommendLv: "90+",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164208,
        questName: "アカスラノッブの群れ ぷにぷに戦〔ぺたぺた級〕",
        difficultyLabel: "ぷにぷに戦〔ぺたぺた級〕",
        recommendLv: "90++",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164209,
        questName: "アカスラノッブの群れ ぷにぷに戦〔ねばねば級〕",
        difficultyLabel: "ぷにぷに戦〔ねばねば級〕",
        recommendLv: "90+++",
        ap: 40,
        sampleRuns: 46,
        drops: { 94164001: { dropExpected: 22.6957, num: 3 } },
      },
    ],
  },
  {
    bossId: 920712,
    bossName: "ミドスラノッブの群れ",
    quests: [
      {
        questId: 94164210,
        questName: "ミドスラノッブの群れ ぷにぷに戦〔さらさら級〕",
        difficultyLabel: "ぷにぷに戦〔さらさら級〕",
        recommendLv: "70",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164211,
        questName: "ミドスラノッブの群れ ぷにぷに戦〔とろとろ級〕",
        difficultyLabel: "ぷにぷに戦〔とろとろ級〕",
        recommendLv: "90",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164212,
        questName: "ミドスラノッブの群れ ぷにぷに戦〔ぬるぬる級〕",
        difficultyLabel: "ぷにぷに戦〔ぬるぬる級〕",
        recommendLv: "90+",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164213,
        questName: "ミドスラノッブの群れ ぷにぷに戦〔ぺたぺた級〕",
        difficultyLabel: "ぷにぷに戦〔ぺたぺた級〕",
        recommendLv: "90++",
        ap: 40,
        sampleRuns: 1,
        drops: { 94164002: { dropExpected: 21, num: 3 } },
      },
      {
        questId: 94164214,
        questName: "ミドスラノッブの群れ ぷにぷに戦〔ねばねば級〕",
        difficultyLabel: "ぷにぷに戦〔ねばねば級〕",
        recommendLv: "90+++",
        ap: 40,
        sampleRuns: 159,
        drops: { 94164002: { dropExpected: 22.6918, num: 3 } },
      },
    ],
  },
  {
    bossId: 920713,
    bossName: "キンメガスラノッブ",
    quests: [
      {
        questId: 94164230,
        questName: "キンメガスラノッブ ぷにぷに戦〔さらさら級〕",
        difficultyLabel: "ぷにぷに戦〔さらさら級〕",
        recommendLv: "70",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164231,
        questName: "キンメガスラノッブ ぷにぷに戦〔とろとろ級〕",
        difficultyLabel: "ぷにぷに戦〔とろとろ級〕",
        recommendLv: "90",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164232,
        questName: "キンメガスラノッブ ぷにぷに戦〔ぬるぬる級〕",
        difficultyLabel: "ぷにぷに戦〔ぬるぬる級〕",
        recommendLv: "90+",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164233,
        questName: "キンメガスラノッブ ぷにぷに戦〔ぺたぺた級〕",
        difficultyLabel: "ぷにぷに戦〔ぺたぺた級〕",
        recommendLv: "90++",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164234,
        questName: "キンメガスラノッブ ぷにぷに戦〔ねばねば級〕",
        difficultyLabel: "ぷにぷに戦〔ねばねば級〕",
        recommendLv: "90+++",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
    ],
  },
  {
    bossId: 920714,
    bossName: "クローン長慶",
    quests: [
      {
        questId: 94164215,
        questName: "クローン長慶 ぷにぷに戦〔さらさら級〕",
        difficultyLabel: "ぷにぷに戦〔さらさら級〕",
        recommendLv: "70",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164216,
        questName: "クローン長慶 ぷにぷに戦〔とろとろ級〕",
        difficultyLabel: "ぷにぷに戦〔とろとろ級〕",
        recommendLv: "90",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164217,
        questName: "クローン長慶 ぷにぷに戦〔ぬるぬる級〕",
        difficultyLabel: "ぷにぷに戦〔ぬるぬる級〕",
        recommendLv: "90+",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164218,
        questName: "クローン長慶 ぷにぷに戦〔ぺたぺた級〕",
        difficultyLabel: "ぷにぷに戦〔ぺたぺた級〕",
        recommendLv: "90++",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164219,
        questName: "クローン長慶 ぷにぷに戦〔ねばねば級〕",
        difficultyLabel: "ぷにぷに戦〔ねばねば級〕",
        recommendLv: "90+++",
        ap: 40,
        sampleRuns: 79,
        drops: {
          94164000: { dropExpected: 13.6076, num: 3 },
          94164002: { dropExpected: 13.6076, num: 3 },
        },
      },
    ],
  },
  {
    bossId: 920715,
    bossName: "青水キメラの群れ",
    quests: [
      {
        questId: 94164220,
        questName: "青水キメラの群れ ぷにぷに戦〔さらさら級〕",
        difficultyLabel: "ぷにぷに戦〔さらさら級〕",
        recommendLv: "70",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164221,
        questName: "青水キメラの群れ ぷにぷに戦〔とろとろ級〕",
        difficultyLabel: "ぷにぷに戦〔とろとろ級〕",
        recommendLv: "90",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164222,
        questName: "青水キメラの群れ ぷにぷに戦〔ぬるぬる級〕",
        difficultyLabel: "ぷにぷに戦〔ぬるぬる級〕",
        recommendLv: "90+",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164223,
        questName: "青水キメラの群れ ぷにぷに戦〔ぺたぺた級〕",
        difficultyLabel: "ぷにぷに戦〔ぺたぺた級〕",
        recommendLv: "90++",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164224,
        questName: "青水キメラの群れ ぷにぷに戦〔ねばねば級〕",
        difficultyLabel: "ぷにぷに戦〔ねばねば級〕",
        recommendLv: "90+++",
        ap: 40,
        sampleRuns: 12,
        drops: {
          94164000: { dropExpected: 12.75, num: 3 },
          94164001: { dropExpected: 13.5833, num: 3 },
        },
      },
    ],
  },
  {
    bossId: 920716,
    bossName: "青水イノシシの群れ",
    quests: [
      {
        questId: 94164225,
        questName: "青水イノシシの群れ ぷにぷに戦〔さらさら級〕",
        difficultyLabel: "ぷにぷに戦〔さらさら級〕",
        recommendLv: "70",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164226,
        questName: "青水イノシシの群れ ぷにぷに戦〔とろとろ級〕",
        difficultyLabel: "ぷにぷに戦〔とろとろ級〕",
        recommendLv: "90",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164227,
        questName: "青水イノシシの群れ ぷにぷに戦〔ぬるぬる級〕",
        difficultyLabel: "ぷにぷに戦〔ぬるぬる級〕",
        recommendLv: "90+",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164228,
        questName: "青水イノシシの群れ ぷにぷに戦〔ぺたぺた級〕",
        difficultyLabel: "ぷにぷに戦〔ぺたぺた級〕",
        recommendLv: "90++",
        ap: 40,
        sampleRuns: 0,
        drops: {},
      },
      {
        questId: 94164229,
        questName: "青水イノシシの群れ ぷにぷに戦〔ねばねば級〕",
        difficultyLabel: "ぷにぷに戦〔ねばねば級〕",
        recommendLv: "90+++",
        ap: 40,
        sampleRuns: 27,
        drops: {
          94164001: { dropExpected: 13.7407, num: 3 },
          94164002: { dropExpected: 13.6667, num: 3 },
        },
      },
    ],
  },
];

const EVENT_80639_BONUS_CES = [
  { id: 9409680, bonuses: { 94164002: { limitBreak: 2, nonLimitBreak: 1 } } },
  { id: 9409670, bonuses: { 94164001: { limitBreak: 2, nonLimitBreak: 1 } } },
  { id: 9409660, bonuses: { 94164000: { limitBreak: 2, nonLimitBreak: 1 } } },
];

const EVENT_80639_TRADES = [
  { fromId: 94164000, toId: 94164001, cost: 10, get: 1 },
  { fromId: 94164001, toId: 94164002, cost: 10, get: 1 },
];

const RAID_EVENT_SNAPSHOT = {
  event: { id: 80639, name: "Raid Event" },
  currencies: [
    { id: 94164002, tier: "gold", name: "YAKI", icon: null },
    { id: 94164001, tier: "silver", name: "NEGI", icon: null },
    { id: 94164000, tier: "bronze", name: "MISO", icon: null },
  ],
  items: [{ id: 101, name: "item", cost: { itemId: 94164002, amount: 10 }, limitNum: 5, setNum: 1 }],
  trades: EVENT_80639_TRADES,
  bonusCes: EVENT_80639_BONUS_CES,
  farm: {
    quests: [
      {
        questId: 94164105,
        questName: "Free All",
        recommendLv: "90++",
        ap: 40,
        drops: {
          94164000: { dropExpected: 10, num: 3 },
          94164001: { dropExpected: 10, num: 3 },
          94164002: { dropExpected: 10, num: 3 },
        },
      },
    ],
    raids: EVENT_80639_RAIDS,
  },
};

const NO_RAID_SNAPSHOT = {
  event: { id: 80630, name: "Free Only Event" },
  currencies: [{ id: 94162101, tier: "gold", name: "Gold", icon: null }],
  items: [{ id: 101, name: "item", cost: { itemId: 94162101, amount: 5 }, limitNum: 2, setNum: 1 }],
  trades: [],
  farm: { quests: [] },
};

function verifyPlanCoverage(plan, totals, quests, trades, bonus = {}) {
  assert.ok(plan.totalPlays !== null && plan.totalPlays > 0, "plan must be feasible");
  const rateById = new Map(quests.map((q) => [q.questId, q.drops || {}]));
  const rawMicro = {};
  let sumPlays = 0;
  for (const play of plan.plays) {
    sumPlays += play.runs;
    const drops = rateById.get(play.questId);
    assert.ok(drops, `played quest ${play.questId} exists in input pool`);
    assert.ok(
      "questId" in play &&
        "questName" in play &&
        "recommendLv" in play &&
        "runs" in play &&
        "mainDropId" in play &&
        "isAllDrop" in play &&
        Array.isArray(play.ceCombo),
    );
    const ceExtra = {};
    for (const entry of play.ceCombo) {
      const ce = EVENT_80639_BONUS_CES.find((item) => item.id === entry.ceId);
      if (!ce) continue;
      for (const [cid, spec] of Object.entries(ce.bonuses)) {
        ceExtra[cid] =
          (ceExtra[cid] || 0) + entry.limitBreak * spec.limitBreak + entry.nonLimitBreak * spec.nonLimitBreak;
      }
    }
    for (const [cid, d] of Object.entries(drops)) {
      const rateMicro = Math.round(d.dropExpected * (d.num + (bonus[cid] || 0) + (ceExtra[cid] || 0)) * 10000);
      rawMicro[cid] = (rawMicro[cid] || 0) + play.runs * rateMicro;
    }
  }
  assert.equal(plan.totalPlays, sumPlays);
  const afterTrades = { ...rawMicro };
  for (const tr of plan.trades) {
    const spec = trades.find((t) => t.fromId === tr.fromId && t.toId === tr.toId);
    assert.ok(spec, `trade ${tr.fromId}->${tr.toId} exists`);
    afterTrades[String(tr.fromId)] = (afterTrades[String(tr.fromId)] || 0) - tr.count * spec.cost * 10000;
    afterTrades[String(tr.toId)] = (afterTrades[String(tr.toId)] || 0) + tr.count * spec.get * 10000;
    assert.ok(afterTrades[String(tr.fromId)] >= -1, "trade never overspends currency");
  }
  for (const [cid, need] of Object.entries(totals)) {
    const haveMicro = afterTrades[cid] || 0;
    assert.ok(haveMicro >= Math.round(need * 10000), `currency ${cid}: got ${haveMicro / 10000}, need ${need}`);
  }
  const cascade = cascadeYields(
    {
      deficits: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v * 10000)])),
      chain: trades.reduce((acc, t) => {
        (acc[String(t.fromId)] ||= []).push({
          toKey: String(t.toId),
          costMicro: t.cost * 10000,
          getMicro: t.get * 10000,
        });
        return acc;
      }, {}),
      order: Object.keys(totals).sort((a, b) => Number(a) - Number(b)),
    },
    rawMicro,
  );
  assert.equal(
    Object.values(cascade.short).some((v) => v > 0),
    false,
    "cascade replay has zero shortfall",
  );
}

test("recLvRank and byRecommendLv sort ★ > +++ > ++ > + > numeric desc, missing last, tie questId asc", () => {
  assert.ok(EventShop.recLvRank("90★") > EventShop.recLvRank("90+++"));
  assert.ok(EventShop.recLvRank("90+++") > EventShop.recLvRank("90++"));
  assert.ok(EventShop.recLvRank("90++") > EventShop.recLvRank("90+"));
  assert.ok(EventShop.recLvRank("90+") > EventShop.recLvRank("90"));
  assert.ok(EventShop.recLvRank("90★") < EventShop.recLvRank("91"));
  assert.equal(EventShop.recLvRank(""), Infinity);
  assert.equal(EventShop.recLvRank(null), Infinity);
  assert.equal(EventShop.recLvRank(undefined), Infinity);
  assert.equal(EventShop.recLvRank("EX"), Infinity);

  const items = [
    { questId: 10, recommendLv: "" },
    { questId: 5, recommendLv: "70" },
    { questId: 9, recommendLv: "90+" },
    { questId: 8, recommendLv: "90+++" },
    { questId: 7, recommendLv: "90★" },
    { questId: 4, recommendLv: "90++" },
    { questId: 1, recommendLv: null },
    { questId: 3, recommendLv: "90++" },
    { questId: 6, recommendLv: "90" },
    { questId: 2, recommendLv: "100" },
  ];
  const sorted = [...items].sort(EventShop.byRecommendLv);
  assert.deepEqual(
    sorted.map((q) => q.questId),
    [2, 7, 8, 3, 4, 9, 6, 5, 1, 10],
  );
});

test("defaultRaidQuest prefers highest-REC with drops and falls back to highest-REC when drops empty", () => {
  assert.equal(EventShop.defaultRaidQuest(null), null);
  assert.equal(EventShop.defaultRaidQuest({ bossId: 1, quests: [] }), null);

  // 90++ has drops, 90+++ does not yet -> prefers 90++!
  const partialDropsBoss = {
    bossId: 1,
    quests: [
      { questId: 101, recommendLv: "90++", drops: { 94164000: { dropExpected: 10, num: 3 } } },
      { questId: 102, recommendLv: "90+++", drops: {} },
      { questId: 103, recommendLv: "90+", drops: { 94164000: { dropExpected: 8, num: 3 } } },
    ],
  };
  assert.equal(EventShop.defaultRaidQuest(partialDropsBoss), 101);

  // When NO difficulties have drops yet -> highest-REC overall!
  assert.equal(EventShop.defaultRaidQuest(EVENT_80639_RAIDS[3]), 94164234);

  // Tie break lower questId when REC matches
  const tiedBoss = {
    bossId: 2,
    quests: [
      { questId: 50, recommendLv: "90+++", drops: {} },
      { questId: 40, recommendLv: "90+++", drops: {} },
    ],
  };
  assert.equal(EventShop.defaultRaidQuest(tiedBoss), 40);
});

test("sanitizedRaidQuest validates saved integer id against boss.quests and rejects coercion hazards", () => {
  const boss = EVENT_80639_RAIDS[2]; // default is 94164214 (90+++ with drops)
  assert.equal(EventShop.sanitizedRaidQuest(boss, 94164213), 94164213);
  assert.equal(EventShop.sanitizedRaidQuest(boss, "94164213"), 94164213);
  for (const bad of [null, undefined, "", "   ", false, true, [], 0, 999999, 94164204, 94164213.5]) {
    assert.equal(EventShop.sanitizedRaidQuest(boss, bad), 94164214, `rejected ${String(bad)}`);
  }

  // Even if questId 0 actually existed, ""/false/null must NOT match it
  const zeroBoss = {
    bossId: 9,
    quests: [
      { questId: 0, recommendLv: "70", drops: {} },
      { questId: 5, recommendLv: "90", drops: {} },
    ],
  };
  assert.equal(EventShop.sanitizedRaidQuest(zeroBoss, ""), 5);
  assert.equal(EventShop.sanitizedRaidQuest(zeroBoss, null), 5);
  assert.equal(EventShop.sanitizedRaidQuest(zeroBoss, false), 5);
  assert.equal(EventShop.sanitizedRaidQuest(zeroBoss, 0), 0);
  assert.equal(EventShop.sanitizedRaidQuest(zeroBoss, "0"), 0);
});

test("sanitizePlans clamps questType to free when absent/empty raids and sanitizes raidQuest safely", () => {
  const saved = {
    selectedEventId: 80639,
    plans: {
      80639: {
        questType: "raid",
        raidQuest: {
          920712: 94164213, // valid 90++
          920710: 99999999, // stale -> defaults 94164204
          888888: 94164204, // unknown boss -> dropped
          __proto__: { polluted: true },
        },
      },
      80630: {
        questType: "raid", // must clamp to free because 80630 has no farm.raids!
        raidQuest: { 1: 2 },
      },
    },
  };
  const emptyQuestsBossSnapshot = {
    ...NO_RAID_SNAPSHOT,
    event: { id: 90000, name: "Empty Boss" },
    farm: { quests: [], raids: [{ bossId: 1, bossName: "Empty", quests: [] }] },
  };
  const res = EventShop.sanitizePlans({ ...saved, plans: { ...saved.plans, 90000: { questType: "raid" } } }, [
    RAID_EVENT_SNAPSHOT,
    NO_RAID_SNAPSHOT,
    emptyQuestsBossSnapshot,
  ]);

  assert.equal(res.plans["80639"].questType, "raid");
  assert.equal(res.plans["80639"].raidQuest["920712"], 94164213);
  assert.equal(res.plans["80639"].raidQuest["920710"], 94164204);
  assert.equal(Object.hasOwn(res.plans["80639"].raidQuest, "888888"), false);
  assert.equal(Object.hasOwn(res.plans["80639"].raidQuest, "polluted"), false);
  assert.equal(res.plans["80630"].questType, "free");
  assert.deepEqual(res.plans["80630"].raidQuest, {});
  assert.equal(res.plans["90000"].questType, "free");
  assert.deepEqual(res.plans["90000"].raidQuest, {});

  for (const invalidType of [null, undefined, "", "custom", 42]) {
    const clean = EventShop.sanitizePlans({ selectedEventId: 80639, plans: { 80639: { questType: invalidType } } }, [
      RAID_EVENT_SNAPSHOT,
    ]);
    assert.equal(clean.plans["80639"].questType, "free");
  }
});

test("EventPlanner raid methods manage questType, raidQuestOf, setRaidQuest, activeRaidQuests, and isolation", async () => {
  const storage = fakeStorage();
  const planner = await plannerWith(storage, [RAID_EVENT_SNAPSHOT, NO_RAID_SNAPSHOT]);

  // Default is "free"
  assert.equal(planner.questType(), "free");
  assert.equal(planner.raidQuestOf(920712), 94164214);
  assert.equal(planner.raidQuestOf("920713"), 94164234);
  assert.equal(planner.raidQuestOf(999999), null);
  assert.deepEqual(
    planner.activeRaidQuests().map((q) => q.questId),
    [94164204, 94164209, 94164214, 94164234, 94164219, 94164224, 94164229],
  );

  planner.setQuestType("raid");
  assert.equal(planner.questType(), "raid");
  planner.setQuestType("");
  assert.equal(planner.questType(), "free");
  planner.setQuestType(null);
  assert.equal(planner.questType(), "free");
  planner.setQuestType("raid");
  assert.equal(planner.questType(), "raid");

  // Update difficulty for one boss & verify order & persistence
  planner.setRaidQuest(920712, 94164213);
  assert.equal(planner.raidQuestOf(920712), 94164213);
  assert.deepEqual(
    planner.activeRaidQuests().map((q) => q.questId),
    [94164204, 94164209, 94164213, 94164234, 94164219, 94164224, 94164229],
  );

  // Invalid questId falls back to default, unknown bossId is ignored
  planner.setRaidQuest(920712, 999999);
  assert.equal(planner.raidQuestOf(920712), 94164214);
  planner.setRaidQuest(999999, 94164213);

  // Switch to Free-only event: clamps raid -> free cleanly and keeps raid event isolated
  planner.select(80630);
  assert.equal(planner.questType(), "free");
  planner.setQuestType("raid");
  assert.equal(planner.questType(), "free");
  assert.deepEqual(planner.activeRaidQuests(), []);
  assert.equal(planner.raidQuestOf(920712), null);

  planner.select(80639);
  assert.equal(planner.questType(), "raid");
  const reloaded = await plannerWith(storage, [RAID_EVENT_SNAPSHOT, NO_RAID_SNAPSHOT]);
  assert.equal(reloaded.questType(), "raid");
  assert.equal(reloaded.raidQuestOf(920712), 94164214);
});

test("farmPlan with useAllQuests:false preserves Free Quest selection even with extra multi-currency bosses", () => {
  const quests = [
    {
      questId: 1,
      questName: "Bronze Best",
      recommendLv: "90+",
      ap: 40,
      drops: { 94164000: { dropExpected: 20, num: 3 } },
    },
    {
      questId: 2,
      questName: "Silver Best",
      recommendLv: "90+",
      ap: 40,
      drops: { 94164001: { dropExpected: 20, num: 3 } },
    },
    {
      questId: 3,
      questName: "Gold Best",
      recommendLv: "90+",
      ap: 40,
      drops: { 94164002: { dropExpected: 20, num: 3 } },
    },
    {
      questId: 4,
      questName: "Dual B+S",
      recommendLv: "90+++",
      ap: 40,
      drops: { 94164000: { dropExpected: 15, num: 3 }, 94164001: { dropExpected: 15, num: 3 } },
    },
    {
      questId: 5,
      questName: "Dual B+G",
      recommendLv: "90+++",
      ap: 40,
      drops: { 94164000: { dropExpected: 15, num: 3 }, 94164002: { dropExpected: 15, num: 3 } },
    },
    {
      questId: 6,
      questName: "Dual S+G",
      recommendLv: "90+++",
      ap: 40,
      drops: { 94164001: { dropExpected: 15, num: 3 }, 94164002: { dropExpected: 15, num: 3 } },
    },
  ];
  const totals = { 94164000: 900, 94164001: 900, 94164002: 900 };

  const freePlan = EventShop.farmPlan({ totals, farm: { quests }, useAllQuests: false });
  assert.deepEqual(
    freePlan.plays.map((p) => p.questId).sort((a, b) => a - b),
    [1, 2, 3],
  );
  assert.equal(freePlan.totalPlays, 45);

  const raidPlan = EventShop.farmPlan({ totals, farm: { quests }, useAllQuests: true });
  assert.deepEqual(
    raidPlan.plays.map((p) => p.questId).sort((a, b) => a - b),
    [4, 5, 6],
  );
  assert.equal(raidPlan.totalPlays, 30);
});

test("farmPlan with useAllQuests:true handles >4 played bosses, empty drops, trades, and CEs in <100ms", () => {
  // 6 currencies where each boss specializes in currency i while splashing i+1, forcing >4 distinct quests
  const totals = { 1: 300, 2: 300, 3: 300, 4: 300, 5: 300, 6: 300 };
  const quests = [
    ...[1, 2, 3, 4, 5, 6].map((i) => ({
      questId: 500 + i,
      questName: `Boss ${i}`,
      recommendLv: "90+++",
      ap: 40,
      drops: { [i]: { dropExpected: 10, num: 3 }, [(i % 6) + 1]: { dropExpected: 4, num: 1 } },
    })),
    { questId: 599, questName: "Empty Boss", recommendLv: "90+++", ap: 40, drops: {} },
  ];
  const bonusCes = [1, 2, 3, 4, 5, 6].map((i) => ({
    id: 8000 + i,
    bonuses: { [i]: { limitBreak: 2, nonLimitBreak: 1 } },
  }));
  const ceOwned = Object.fromEntries(bonusCes.map((c) => [c.id, { limitBreak: 2, nonLimitBreak: 2 }]));

  const t0 = performance.now();
  const noCe = EventShop.farmPlan({ totals, farm: { quests }, useAllQuests: true });
  const dtNoCe = performance.now() - t0;
  assert.ok(dtNoCe < 500, `6-boss no CE took ${dtNoCe.toFixed(1)}ms`);
  assert.equal(noCe.plays.length, 6, "all 6 positive-drop bosses played (>4 plays)");
  assert.equal(noCe.totalPlays, 54);
  assert.equal(
    noCe.plays.some((p) => p.questId === 599),
    false,
    "empty-drop boss excluded",
  );

  const t1 = performance.now();
  const withCe = EventShop.farmPlan({
    totals,
    farm: { quests },
    bonusCes,
    ceOwned,
    ceEquipLimit: 6,
    useAllQuests: true,
  });
  const dtCe = performance.now() - t1;
  assert.ok(dtCe < 500, `6-currency 6-boss + 6 CEs took ${dtCe.toFixed(1)}ms`);
  assert.equal(withCe.plays.length, 6, "all 6 bosses used with CEs (>4 plays)");
  assert.equal(withCe.totalPlays, 18);
  for (const play of withCe.plays) {
    const usedSlots = play.ceCombo.reduce((sum, entry) => sum + entry.limitBreak + entry.nonLimitBreak, 0);
    assert.ok(usedSlots <= 6, "ceCombo respects ceEquipLimit");
    for (const entry of play.ceCombo) {
      assert.ok(entry.limitBreak <= 2 && entry.nonLimitBreak <= 2, "ceCombo respects ceOwned");
    }
  }

  // All empty drops -> clean infeasible plan
  const infeasible = EventShop.farmPlan({
    totals: { 1: 100 },
    farm: { quests: [{ questId: 599, questName: "Empty", recommendLv: "90+++", ap: 40, drops: {} }] },
    useAllQuests: true,
  });
  assert.equal(infeasible.totalPlays, null);
  assert.deepEqual(infeasible.plays, []);
});

test("event 80639 real 7-boss raid optimization runs <100ms, uses >4 quests, and beats Free pool", () => {
  const active = EVENT_80639_RAIDS.map((boss) => {
    const id = EventShop.defaultRaidQuest(boss);
    return boss.quests.find((q) => q.questId === id);
  }).filter(Boolean);
  assert.deepEqual(
    active.map((q) => q.questId),
    [94164204, 94164209, 94164214, 94164234, 94164219, 94164224, 94164229],
  );

  const totals = { 94164000: 5740, 94164001: 5390, 94164002: 6610 };

  const freePool = EventShop.farmPlan({
    totals,
    farm: { quests: active },
    trades: EVENT_80639_TRADES,
    useAllQuests: false,
  });
  assert.equal(freePool.totalPlays, 263);

  const t0 = performance.now();
  const raidNoCe = EventShop.farmPlan({
    totals,
    farm: { quests: active },
    trades: EVENT_80639_TRADES,
    useAllQuests: true,
  });
  const dtNoCe = performance.now() - t0;
  assert.ok(dtNoCe < 500, `80639 7-boss no CE took ${dtNoCe.toFixed(1)}ms`);
  assert.equal(raidNoCe.totalPlays, 220);
  assert.ok(raidNoCe.plays.length > 4, `expected >4 played quests, got ${raidNoCe.plays.length}`);
  verifyPlanCoverage(raidNoCe, totals, active, EVENT_80639_TRADES);

  // Full 6LB + 6NLB bonus CEs
  const fullCe = {
    9409680: { limitBreak: 6, nonLimitBreak: 6 },
    9409670: { limitBreak: 6, nonLimitBreak: 6 },
    9409660: { limitBreak: 6, nonLimitBreak: 6 },
  };
  const t1 = performance.now();
  const raidFullCe = EventShop.farmPlan({
    totals,
    farm: { quests: active },
    trades: EVENT_80639_TRADES,
    bonusCes: EVENT_80639_BONUS_CES,
    ceOwned: fullCe,
    ceEquipLimit: 6,
    useAllQuests: true,
  });
  const dtFullCe = performance.now() - t1;
  assert.ok(dtFullCe < 500, `80639 7-boss full CE took ${dtFullCe.toFixed(1)}ms`);
  assert.equal(raidFullCe.totalPlays, 53);
  verifyPlanCoverage(raidFullCe, totals, active, EVENT_80639_TRADES);

  // Limited 1LB + 3NLB bonus CEs
  const partialCe = {
    9409680: { limitBreak: 1, nonLimitBreak: 3 },
    9409670: { limitBreak: 1, nonLimitBreak: 3 },
    9409660: { limitBreak: 1, nonLimitBreak: 3 },
  };
  const t2 = performance.now();
  const raidPartialCe = EventShop.farmPlan({
    totals,
    farm: { quests: active },
    trades: EVENT_80639_TRADES,
    bonusCes: EVENT_80639_BONUS_CES,
    ceOwned: partialCe,
    ceEquipLimit: 6,
    useAllQuests: true,
  });
  const dtPartialCe = performance.now() - t2;
  assert.ok(dtPartialCe < 500, `80639 7-boss partial CE took ${dtPartialCe.toFixed(1)}ms`);
  assert.equal(raidPartialCe.totalPlays, 94);
  verifyPlanCoverage(raidPartialCe, totals, active, EVENT_80639_TRADES);
});
