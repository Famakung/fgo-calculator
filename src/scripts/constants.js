export const TIERS = ["bronze", "silver", "gold"];
export const TIER_FIELDS = ["Need", "Have", "Bonus"];
export const MAX_ITERATIONS = 10000;
export const EPSILON = 0.01;
export const DEBOUNCE_MS = 100;
export const SERVANT_MAX_SLOTS = 6;
export const STORAGE_KEY = "fgo_calculator_data";
export const BOND_STORAGE_KEY = "fgo_bond_calculator_data";
export const CEFILTER_STORAGE_KEY = "fgo_ce_filter_data";
export const IMAGE_VERSION = "3";

export const BOND_CONSTANTS = {
  MAX_BOND_NEEDED: 9999999,
  MAX_CUSTOM_BOND: 99999,
  FRONTLINE_SIZE: 3,
  MAX_BOND_BONUS_PCT: 25,
  SUPPORT_BONUS_PCT: 4,
  FRONTLINE_BONUS_PCT: 20,
  FRONTLINE_BONUS_FRACTION: 0.2,
  MIN_BOND_LEVEL: 0,
  MAX_BOND_LEVEL: 16,
  /* Surplus bond points carry from one level to the next up to this level; past it the in-game
     bond cap throws the extra away, so every higher level needs its own whole runs. */
  BOND_CARRY_LIMIT: 10,
  /* The level at which a servant starts granting the +25% all-servant bond bonus. */
  BOND_BONUS_LEVEL: 15,
  /* Essences one slot can wear — two once the player ticks Grand Servant. */
  MAX_CE_SLOTS: 1,
  GRAND_MAX_CE_SLOTS: 2,
  /* Stargazer's Teapot: what one multiplies a run's bond by, and how many the player can hold.
     One teapot is spent per quest run, and a run pays every servant in the party. */
  TEAPOT_MULTIPLIER: 2,
  MAX_TEAPOT_COUNT: 9999,
};

export const TIER_COLORS = {
  bronze: "#cd7f32",
  silver: "#71717a",
  gold: "#eab308",
};

export const QUEST_DROPS = {
  bronze: { primary: "bronze", secondary: "silver" },
  silver: { primary: "silver", secondary: "gold" },
  gold: { primary: "gold", secondary: "bronze" },
};

export const CLASS_FILTERS = {
  standard: [
    { id: "0100", icon: "saber", label: "Saber" },
    { id: "0102", icon: "archer", label: "Archer" },
    { id: "0101", icon: "lancer", label: "Lancer" },
    { id: "0103", icon: "rider", label: "Rider" },
    { id: "0104", icon: "caster", label: "Caster" },
    { id: "0105", icon: "assassin", label: "Assassin" },
    { id: "0106", icon: "berserker", label: "Berserker" },
  ],
  extra: [
    { id: "0107", icon: "shielder", label: "Shielder" },
    { id: "0108", icon: "ruler", label: "Ruler" },
    { id: "0110", icon: "avenger", label: "Avenger" },
    { id: "0115", icon: "mooncancer", label: "Moon Cancer" },
    { id: "0109", icon: "alterego", label: "Alter Ego" },
    { id: "0117", icon: "foreigner", label: "Foreigner" },
    { id: "0120", icon: "pretender", label: "Pretender" },
    { id: "0124", icon: "beast", label: "Beast" },
  ],
};

export const RARITY_FILTERS = [
  { id: "0400", label: "\u26050" },
  { id: "0401", label: "\u26051" },
  { id: "0402", label: "\u26052" },
  { id: "0403", label: "\u26053" },
  { id: "0404", label: "\u26054" },
  { id: "0405", label: "\u26055" },
];

/* The Filter Settings modal's trait chip rows, read by `filter-sections.js` and matched by
   `ServantFilters` (`domain.js`). One entry per axis value; a row with nothing selected is no filter. */
export const ALIGNMENT_LNC_FILTERS = [
  { id: "0300", label: "Lawful" },
  { id: "0302", label: "Neutral" },
  { id: "0301", label: "Chaotic" },
];

/* The second axis, Lawful/Neutral/Chaotic's counterpart. `other` is not a trait id: it is the row's
   complement, the servants with neither Good, Balanced nor Evil \u2014 which is where Madness (0306) and
   Summer (0308) land, because the modal offers no chip for a trait only three or twenty-eight have. */
export const ALIGNMENT_GBE_FILTERS = [
  { id: "0303", label: "Good" },
  { id: "0305", label: "Balanced" },
  { id: "0304", label: "Evil" },
  { id: null, label: "Other", other: true },
];

export const SUB_ATTR_FILTERS = [
  { id: "0200", label: "Heaven" },
  { id: "0201", label: "Earth" },
  { id: "0202", label: "Human" },
  { id: "0203", label: "Star" },
  { id: "0204", label: "Beast" },
];

/* Gender, the row under Sub-Attribute: the `00xx` family every servant carries (164 male, 288 female, 23
   unknown), read by `filter-sections.js` and matched by `ServantFilters`. */
export const GENDER_FILTERS = [
  { id: "0001", label: "Male" },
  { id: "0002", label: "Female" },
  { id: "0003", label: "Unknown" },
];

/* The quest a Bond plan is priced on. The player picks a family first, then one choice inside it:
   Free Quest names a single quest (or its own custom figure), Grand Duel names a class group and then
   the Rank-Up Training Battle level of that class. */
export const QUEST_FAMILIES = [
  { key: "fq", name: "Free Quest" },
  { key: "gd", name: "Grand Duel" },
];

export const FREE_QUESTS = [
  { key: "fq83", name: "Free Quest Lv.83", bond: 845 },
  { key: "fq84", name: "Free Quest Lv.84", bond: 855 },
];

/* Grand Duel party classes. `classes` is the set of class trait ids the party is limited to; null means
   every class is allowed, so the picker keeps its own class filter. The extra rows group the eight
   non-standard classes: Extra I and Extra II are the halves, Extra is both. */
export const GRAND_EXTRA_I = ["0107", "0108", "0110", "0115"]; // Shielder, Ruler, Avenger, Moon Cancer
export const GRAND_EXTRA_II = ["0109", "0117", "0120", "0124"]; // Alter Ego, Foreigner, Pretender, Beast

/* The Filter Settings modal's Class (Group) row, read by `ServantFilters.rowScope`. Four chips tile the
   fifteen classes: the three knight classes, the four cavalry classes, and Grand Duel's two Extra halves.
   Only the two Extra groups are the Grand Duel party groups — this row is a filter, not a quest. */
export const CLASS_GROUPS = [
  { key: "knight", label: "Three Knights", classes: ["0100", "0102", "0101"] }, // Saber, Archer, Lancer
  { key: "cavalry", label: "Four Cavalries", classes: ["0103", "0104", "0105", "0106"] }, // Rider…Berserker
  { key: "extra1", label: "Extra I", classes: GRAND_EXTRA_I },
  { key: "extra2", label: "Extra II", classes: GRAND_EXTRA_II },
];

export const GRAND_CLASSES = [
  { key: "all", name: "All", classes: null },
  ...CLASS_FILTERS.standard.map((c) => ({ key: c.id, name: c.label, classes: [c.id] })),
  { key: "extra1", name: "Extra I", classes: GRAND_EXTRA_I },
  { key: "extra2", name: "Extra II", classes: GRAND_EXTRA_II },
  { key: "extra", name: "Extra", classes: [...GRAND_EXTRA_I, ...GRAND_EXTRA_II] },
];

/* The seven Rank-Up Training Battle levels. Each pays more bond than the one below it, so the level is
   the only thing a Grand Duel plan needs besides the class. */
export const GRAND_DIFFICULTIES = [
  { key: "1", roman: "I", lv: "Lv.100", bond: 3164 },
  { key: "2", roman: "II", lv: "Lv.100+", bond: 3385 },
  { key: "3", roman: "III", lv: "Lv.100++", bond: 3622 },
  { key: "4", roman: "IV", lv: "Lv.100+++", bond: 3876 },
  { key: "5", roman: "V", lv: "Lv.100\u2605", bond: 4147 },
  { key: "6", roman: "VI", lv: "Lv.100\u2605\u2605", bond: 4438 },
  { key: "7", roman: "VII", lv: "Lv.100\u2605\u2605\u2605", bond: 4748 },
];
