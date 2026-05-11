export const TIERS = ["bronze", "silver", "gold"];
export const TIER_FIELDS = ["Need", "Have", "Bonus"];
export const MAX_ITERATIONS = 10000;
export const EPSILON = 0.01;
export const DEBOUNCE_MS = 100;
export const SERVANT_MAX_SLOTS = 6;
export const STORAGE_KEY = "fgo_calculator_data";
export const BOND_STORAGE_KEY = "fgo_bond_calculator_data";
export const CEFILTER_STORAGE_KEY = "fgo_ce_filter_data";

export const BOND_CONSTANTS = {
  MAX_BOND_NEEDED: 9999999,
  MAX_CUSTOM_BOND: 99999,
  FRONTLINE_SIZE: 3,
  MAX_BOND_BONUS_PCT: 25,
  SUPPORT_BONUS_PCT: 4,
  FRONTLINE_BONUS_PCT: 20,
  FRONTLINE_BONUS_FRACTION: 0.2,
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
  { id: "0400", label: "0 \u2605" },
  { id: "0401", label: "1 \u2605" },
  { id: "0402", label: "2 \u2605" },
  { id: "0403", label: "3 \u2605" },
  { id: "0404", label: "4 \u2605" },
  { id: "0405", label: "5 \u2605" },
];

export const BOND_QUESTS = [
  { key: "fq83", name: "Free Quest Lv.83", bond: 835 },
  { key: "fq84", name: "Free Quest Lv.84", bond: 855 },
  { key: "gd100", name: "Grand Duel Lv.100\u2605\u2605\u2605", bond: 4748 },
];
