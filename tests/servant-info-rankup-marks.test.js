import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis.window || { innerWidth: 1280 };
globalThis.document = globalThis.document || {
  getElementById: () => null,
  createElement: () => ({
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    appendChild() {},
    append() {},
    addEventListener() {},
    replaceChildren() {},
    style: {},
    dataset: {},
    children: [],
  }),
  createTextNode: (text) => ({ textContent: text }),
  createDocumentFragment: () => ({ nodeType: 11, children: [], appendChild() {}, append() {} }),
  addEventListener: () => {},
};

const { annotateRankUpEffects, appendHighlightedEffect, getCooldownRankUpCount, getCooldownRankUpTiers } =
  await import("../src/scripts/servant-info-app.js");

test("base tier only produces no rank up marks", () => {
  const res = annotateRankUpEffects([["Increase Arts Card effectiveness by 21-35% (1 turn) for yourself"]]);
  assert.deepEqual(res, ["Increase Arts Card effectiveness by 21-35% (1 turn) for yourself"]);
});

test("#011 Emiya S3 Rank Up 1 marks new effects at end and buffed base % inline with yellow [▲1]", () => {
  const t0 = ["Increase Arts Card effectiveness by 21-35% (1 turn) for yourself"];
  const t1 = [
    "Increase Quick Card effectiveness by 25-40% (1 turn) for yourself",
    "Increase Arts Card effectiveness by 25-40% (1 turn) for yourself",
    "Increase Buster Card effectiveness by 25-40% (1 turn) for yourself",
  ];
  assert.deepEqual(annotateRankUpEffects([t0, t1]), [
    "Increase Quick Card effectiveness by 25-40% (1 turn) for yourself [\u25b21]",
    "Increase Arts Card effectiveness by 25-40% [\u25b21] (1 turn) for yourself",
    "Increase Buster Card effectiveness by 25-40% (1 turn) for yourself [\u25b21]",
  ]);
});

test("#011 Emiya S3 Rank Up 2 uses yellow [▲1] then orange [▲2] for 2-rank-up effects and orange [▲2] for RU2 new effect", () => {
  const t0 = ["Increase Arts Card effectiveness by 21-35% (1 turn) for yourself"];
  const t1 = [
    "Increase Quick Card effectiveness by 25-40% (1 turn) for yourself",
    "Increase Arts Card effectiveness by 25-40% (1 turn) for yourself",
    "Increase Buster Card effectiveness by 25-40% (1 turn) for yourself",
  ];
  const t2 = [
    "Increase Quick Card effectiveness by 30-50% (1 turn) for yourself",
    "Increase Arts Card effectiveness by 30-50% (1 turn) for yourself",
    "Increase Buster Card effectiveness by 30-50% (1 turn) for yourself",
    "Change NP Card type to [Arts or Buster] (1 turn) for yourself",
  ];
  assert.deepEqual(annotateRankUpEffects([t0, t1, t2]), [
    "Increase Quick Card effectiveness by 30-50% (1 turn) for yourself [\u25b21][\u25b22]",
    "Increase Arts Card effectiveness by 30-50% [\u25b21][\u25b22] (1 turn) for yourself",
    "Increase Buster Card effectiveness by 30-50% (1 turn) for yourself [\u25b21][\u25b22]",
    "Change NP Card type to [Arts or Buster] (1 turn) for yourself [\u25b22]",
  ]);
});

test("#190 Mecha Eli-chan S3 marks turn duration increase after turns", () => {
  const t0 = ["Increase NP Strength by 40-60% (1 turn) for yourself"];
  const t1 = ["Increase NP Strength by 40-60% (3 turns) for yourself"];
  assert.deepEqual(annotateRankUpEffects([t0, t1]), [
    "Increase NP Strength by 40-60% (3 turns [\u25b21]) for yourself",
  ]);
});

test("#209 Okita Souji (Alter) S3 marks times increase after times", () => {
  const t0 = ["Apply Evade (1 time, 3 turns) for yourself"];
  const t1 = ["Apply Evade (2 times, 3 turns) for yourself"];
  assert.deepEqual(annotateRankUpEffects([t0, t1]), ["Apply Evade (2 times [\u25b21], 3 turns) for yourself"]);
});

test("(1 turn) to (3 times, 3 turns) places one mark only after turns", () => {
  const t0 = ["Apply Invincible (1 turn) for yourself"];
  const t1 = ["Apply Invincible (3 times, 3 turns) for yourself"];
  assert.deepEqual(annotateRankUpEffects([t0, t1]), ["Apply Invincible (3 times, 3 turns [\u25b21]) for yourself"]);
});

test("#126 Bedivere S1 marks both percentage and turns inline", () => {
  const t0 = ["Increase NP Strength by 8-16% (1 turn) for all allies"];
  const t1 = ["Increase NP Strength by 10-20% (3 turns) for all allies"];
  assert.deepEqual(annotateRankUpEffects([t0, t1]), [
    "Increase NP Strength by 10-20% [\u25b21] (3 turns [\u25b21]) for all allies",
  ]);
});

test("#26 Boudica S1 marks expanded target inline", () => {
  const t0 = ["Apply Special Attack [Roman] by 40-60% (3 turns) for yourself"];
  const t1 = ["Apply Special Attack [Roman] by 40-60% (3 turns) for all allies"];
  assert.deepEqual(annotateRankUpEffects([t0, t1]), [
    "Apply Special Attack [Roman] by 40-60% (3 turns) for all allies [\u25b21]",
  ]);
});

test("#238 Kingprotea S1 keeps RU1 yellow mark and marks RU2 effects and cooldown drop orange", () => {
  const t0 = [
    'Inflict Infinite Growth <Apply a state that "Increase Max HP by 2000-3000 for yourself" at turn end> (10 turns) for yourself',
  ];
  const t1 = [
    'Inflict Infinite Growth <Apply a state that "Increase Max HP by 2000-4000 for yourself & Increase Special Defense [NP] by 8% for yourself" at turn end> (10 turns) for yourself',
  ];
  const t2 = [
    'Inflict Infinite Growth <Apply a state that "Increase Max HP by 2000-4000 for yourself & Increase Special Defense [NP] by 8% for yourself" at turn end> (10 turns) for yourself',
    "Increase Buff Removal Resist by 50-100% (1 time, 10 turns) for yourself",
    "Increase NP Gauge by 20-30% for yourself",
  ];
  assert.deepEqual(annotateRankUpEffects([t0, t1, t2]), [
    'Inflict Infinite Growth <Apply a state that "Increase Max HP by 2000-4000 [\u25b21] for yourself & Increase Special Defense [NP] by 8% for yourself [\u25b21]" at turn end> (10 turns) for yourself',
    "Increase Buff Removal Resist by 50-100% (1 time, 10 turns) for yourself [\u25b22]",
    "Increase NP Gauge by 20-30% for yourself [\u25b22]",
  ]);
  assert.deepEqual(getCooldownRankUpTiers(["Cooldown 12-10 turns", "Cooldown 12-10 turns", "Cooldown 8-6 turns"]), [2]);
  assert.equal(getCooldownRankUpCount(["Cooldown 12-10 turns", "Cooldown 12-10 turns", "Cooldown 8-6 turns"]), 1);
});

test("inner-skill additions and buffs mark changed inner clauses recursively", () => {
  const miyu0 = [
    'Inflict Protection of Sakatsuki <Apply a state that "Increase NP Gauge by 10% for all allies & Restore HP by 500 for all allies & Gain Critical Stars by 5-25" at turn end> (3 turns) for yourself <effect increases with Overcharge>',
  ];
  const miyu1 = [
    'Inflict Protection of Sakatsuki <Apply a state that "Increase NP Gauge by 10% for all allies & Restore HP by 1000 for all allies & Increase ATK by 10% (3 turns) for all allies & Gain Critical Stars by 5-25" at turn end> (3 turns) for yourself <effect increases with Overcharge>',
  ];
  assert.deepEqual(annotateRankUpEffects([miyu0, miyu1]), [
    'Inflict Protection of Sakatsuki <Apply a state that "Increase NP Gauge by 10% for all allies & Restore HP by 1000 [\u25b21] for all allies & Increase ATK by 10% (3 turns) for all allies [\u25b21] & Gain Critical Stars by 5-25" at turn end> (3 turns) for yourself <effect increases with Overcharge>',
  ]);

  const vanGogh0 = [
    'Apply a state that "Remove 1 Curse for yourself & Increase ATK by 10% (3 turns) for yourself" when Quick attacking after damage (3 turns) for yourself',
  ];
  const vanGogh1 = [
    'Apply a state that "Remove 1 Curse for yourself & Increase ATK by 10% (3 turns) for yourself & Increase NP Gauge by 10-20% for yourself" when Quick attacking after damage (3 turns) for yourself',
  ];
  assert.deepEqual(annotateRankUpEffects([vanGogh0, vanGogh1]), [
    'Apply a state that "Remove 1 Curse for yourself & Increase ATK by 10% (3 turns) for yourself & Increase NP Gauge by 10-20% for yourself [\u25b21]" when Quick attacking after damage (3 turns) for yourself',
  ]);

  const kirei0 = [
    'Apply a state that "Increase NP Strength by 20% (5 turns) for yourself" when Guts is activated (3 turns) for yourself',
  ];
  const kirei1 = [
    'Apply a state that "Increase NP Strength by 20% (5 turns) for all allies" when Guts is activated (3 turns) for yourself',
    'Apply a state that "Increase Critical Strength by 10% (5 turns) for yourself" when damaged (3 turns) for yourself',
  ];
  assert.deepEqual(annotateRankUpEffects([kirei0, kirei1]), [
    'Apply a state that "Increase NP Strength by 20% (5 turns) for all allies [\u25b21]" when Guts is activated (3 turns) for yourself',
    'Apply a state that "Increase Critical Strength by 10% (5 turns) for yourself" when damaged (3 turns) for yourself [\u25b21]',
  ]);
});

test("NP marks appear after <effect...> notes, and #222 MHXX NP emits single mark", () => {
  const emiyaBuster0 = [
    "Deal heavy DEF-ignoring damage by 300-500% <effect increases with Level> to all enemies",
    "Decrease ATK by 10-30% (3 turns) for all enemies <effect increases with Overcharge>",
  ];
  const emiyaBuster1 = [
    "Deal heavy DEF-ignoring damage by 400-600% <effect increases with Level> to all enemies",
    "Decrease ATK by 10-30% (3 turns) for all enemies <effect increases with Overcharge>",
  ];
  assert.deepEqual(annotateRankUpEffects([emiyaBuster0, emiyaBuster1]), [
    "Deal heavy DEF-ignoring damage by 400-600% <effect increases with Level> [\u25b21] to all enemies",
    "Decrease ATK by 10-30% (3 turns) for all enemies <effect increases with Overcharge>",
  ]);

  const bunyan0 = [
    "Deal significant damage <STR increases by 5% based on the number of [Likes!] states (Max 10) on yourself> by 600-1000% <effect increases with Level> to a single enemy",
    "Decrease DEF by 10-30% (3 turns) for one enemy <effect increases with Overcharge>",
  ];
  const bunyan1 = [
    "Deal significant damage <STR increases by 5% based on the number of [Likes!] states (Max 10) on yourself> by 800-1200% <effect increases with Level> to a single enemy",
    "Decrease DEF by 10-30% (3 turns) for one enemy <effect increases with Overcharge>",
    "Gain Critical Stars by 20",
  ];
  assert.deepEqual(annotateRankUpEffects([bunyan0, bunyan1]), [
    "Deal significant damage <STR increases by 5% based on the number of [Likes!] states (Max 10) on yourself> by 800-1200% <effect increases with Level> [\u25b21] to a single enemy",
    "Decrease DEF by 10-30% (3 turns) for one enemy <effect increases with Overcharge>",
    "Gain Critical Stars by 20 [\u25b21]",
  ]);

  assert.deepEqual(
    annotateRankUpEffects([
      ["Restore HP by 2000-6000 <effect increases with Overcharge> for all allies"],
      ["Restore HP by 3000-7000 <effect increases with Overcharge> for all allies"],
    ]),
    ["Restore HP by 3000-7000 <effect increases with Overcharge> [\u25b21] for all allies"],
  );

  assert.deepEqual(
    annotateRankUpEffects([
      [
        "Increase ATK by 20-40% (1 turn) for yourself <effect increases with Overcharge>",
        "Deal significant Special Attack [Saber-class Servant] by 150% damage by 900-1500% <effect increases with Level> to a single enemy",
      ],
      [
        "Increase ATK by 20-40% (1 turn) for yourself <effect increases with Overcharge>",
        "Deal significant Special Attack [Saber-class Servant] by 200% damage by 1200-1800% <effect increases with Level> to a single enemy",
      ],
    ]),
    [
      "Increase ATK by 20-40% (1 turn) for yourself <effect increases with Overcharge>",
      "Deal significant Special Attack [Saber-class Servant] by 200% [\u25b21] damage by 1200-1800% <effect increases with Level> [\u25b21] to a single enemy",
    ],
  );

  assert.deepEqual(
    annotateRankUpEffects([
      [
        "Deal significant Special Attack [Female] by 120-170% damage <Special Attack damage increases with Overcharge> by 600-1000% <effect increases with Level> to a single enemy",
      ],
      [
        "Deal significant Special Attack [Female] by 150-200% damage <Special Attack damage increases with Overcharge> by 800-1200% <effect increases with Level> to a single enemy",
      ],
    ]),
    [
      "Deal significant Special Attack [Female] by 150-200% damage <Special Attack damage increases with Overcharge> [\u25b21] by 800-1200% <effect increases with Level> [\u25b21] to a single enemy",
    ],
  );
});

test("#052 Vlad III NP Tier 2 marks 2x NP damage [▲1][▲2] and RU2 Arts res down [▲2]", () => {
  const t0 = ["Deal significant damage by 600-1000% <effect increases with Level> to a single enemy"];
  const t1 = [
    "Deal significant damage by 900-1500% <effect increases with Level> to a single enemy",
    "Gain Critical Stars by 20-40 <effect increases with Overcharge>",
  ];
  const t2 = [
    "Deal significant damage by 1200-1800% <effect increases with Level> to a single enemy",
    "Decrease Arts Card resistance by 20% (3 turns) for one enemy",
    "Gain Critical Stars by 20-40 <effect increases with Overcharge>",
  ];
  assert.deepEqual(annotateRankUpEffects([t0, t1, t2]), [
    "Deal significant damage by 1200-1800% <effect increases with Level> [\u25b21][\u25b22] to a single enemy",
    "Decrease Arts Card resistance by 20% (3 turns) for one enemy [\u25b22]",
    "Gain Critical Stars by 20-40 <effect increases with Overcharge> [\u25b21]",
  ]);
});

test("#008 Altera S2 Tier 2 distinguishes RU1 [▲1] vs RU2 [▲2] effects", () => {
  const t0 = ["Increase ATK Debuffs Resist by 40-80% (3 turns) for yourself", "Restore HP by 500-2500 for yourself"];
  const t1 = [
    "Increase ATK Debuffs Resist by 60-120% (3 turns) for yourself",
    "Restore HP by 1000-3000 for yourself",
    "Increase Critical Star Gather Rate by 100-300% (1 turn) for yourself",
  ];
  const t2 = [
    "Increase NP Gauge by 20-30% for yourself",
    "Increase Critical Strength by 20-30% (3 turns) for yourself",
    "Increase ATK Debuffs Resist by 60-120% (3 turns) for yourself",
    "Restore HP by 1000-3000 for yourself",
    "Increase Critical Star Gather Rate by 100-300% (1 turn) for yourself",
  ];
  assert.deepEqual(annotateRankUpEffects([t0, t1, t2]), [
    "Increase NP Gauge by 20-30% for yourself [\u25b22]",
    "Increase Critical Strength by 20-30% (3 turns) for yourself [\u25b22]",
    "Increase ATK Debuffs Resist by 60-120% [\u25b21] (3 turns) for yourself",
    "Restore HP by 1000-3000 [\u25b21] for yourself",
    "Increase Critical Star Gather Rate by 100-300% (1 turn) for yourself [\u25b21]",
  ]);
});

test("#413 Aozaki Aoko S1 marks bracketed stack count increase inline before target", () => {
  const normal0 = ["Apply 3 [Magic Bullets] for yourself", "Gain Critical Stars by 10-20"];
  const normal1 = [
    "Apply 5 [Magic Bullets] for yourself",
    "Increase NP Gauge by 10-20% for yourself",
    "Gain Critical Stars by 10-20",
  ];
  assert.deepEqual(annotateRankUpEffects([normal0, normal1]), [
    "Apply 5 [Magic Bullets] [\u25b21] for yourself",
    "Increase NP Gauge by 10-20% for yourself [\u25b21]",
    "Gain Critical Stars by 10-20",
  ]);
});

test("chance percentage increase places mark after chance", () => {
  const t0 = ["60-80% Chance to Inflict Stun (1 turn) for one enemy"];
  const t1 = ["80-100% Chance to Inflict Stun (1 turn) for one enemy"];
  assert.deepEqual(annotateRankUpEffects([t0, t1]), [
    "80-100% Chance [\u25b21] to Inflict Stun (1 turn) for one enemy",
  ]);
});

test("rank-up mark placed near {{icon:...}} renders icon before mark", () => {
  const t0 = ["Apply 3 [Magic Bullets] {{icon:bufficon_398}} for yourself"];
  const t1 = ["Apply 5 [Magic Bullets] {{icon:bufficon_398}} for yourself"];
  assert.deepEqual(annotateRankUpEffects([t0, t1]), [
    "Apply 5 [Magic Bullets] {{icon:bufficon_398}} [\u25b21] for yourself",
  ]);
});

test("inline {{icon:...}} tokens preserve rank-up diffing and render 24px img elements", () => {
  const t0 = ["Increase DEF {{icon:bufficon_301}} by 15-20% (3 turns) for yourself"];
  const t1 = ["Increase DEF {{icon:bufficon_301}} by 20-30% (3 turns) for yourself"];
  assert.deepEqual(annotateRankUpEffects([t0, t1]), [
    "Increase DEF {{icon:bufficon_301}} by 20-30% [\u25b21] (3 turns) for yourself",
  ]);

  const origCreateElement = globalThis.document.createElement;
  const created = [];
  globalThis.document.createElement = (tag) => {
    const attrs = {};
    const node = {
      tagName: tag.toUpperCase(),
      className: "",
      textContent: "",
      attrs,
      children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute(k, v) {
        attrs[k] = v;
      },
      appendChild(child) {
        this.children.push(child);
      },
      addEventListener() {},
      style: {},
    };
    created.push(node);
    return node;
  };
  try {
    const container = globalThis.document.createElement("li");
    appendHighlightedEffect(container, "Increase DEF {{icon:bufficon_301}} by 15-20%");
    const imgs = container.children.filter((c) => c.tagName === "IMG");
    assert.equal(imgs.length, 1);
    assert.equal(imgs[0].className, "f-buff-icon");
    assert.equal(imgs[0].attrs.src, "buff_icons/bufficon_301.webp");
    assert.equal(imgs[0].attrs.width, "24");
    assert.equal(imgs[0].attrs.height, "24");
    assert.equal(container.children[0].textContent, "Increase DEF ");
    assert.equal(container.children[2].textContent, " by 15-20%");
  } finally {
    globalThis.document.createElement = origCreateElement;
  }
});
