#!/usr/bin/env node
/**
 * scripts/validate_data.js
 * Validates data integrity for FGO Calculator:
 * - Checks SERVANT_DATA, CE_DATA, and TRAIT_DATA consistency.
 * - Verifies trait formats, ascending sort order, and trait dictionary coverage.
 * - Confirms existence of all referenced WebP images in public/servants and public/craft_essences.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// Dynamic imports from src/scripts/data/
const { SERVANT_DATA } = await import(path.join(ROOT_DIR, "src/scripts/data/servants.js"));
const { CE_DATA } = await import(path.join(ROOT_DIR, "src/scripts/data/craft_essences.js"));
const { TRAIT_DATA } = await import(path.join(ROOT_DIR, "src/scripts/data/traits.js"));
const { BOND_TABLES, BOND_TABLE_BY_SVT } = await import(path.join(ROOT_DIR, "src/scripts/data/bond_growth.js"));
const { EVENT_SHOP_DATA } = await import(path.join(ROOT_DIR, "src/scripts/data/event_shop.js"));

let errors = [];
let warnings = [];

function checkAscending(arr, context) {
  for (let i = 1; i < arr.length; i++) {
    const prev = String(arr[i - 1]);
    const curr = String(arr[i]);
    if (prev.localeCompare(curr, undefined, { numeric: true }) > 0) {
      errors.push(`${context}: Trait array is not sorted ascending: [${prev}] should be before [${curr}]`);
    }
  }
}

function validateTraitId(tid, context) {
  const s = String(tid);
  if (!(s in TRAIT_DATA)) {
    warnings.push(`${context}: Trait ID "${s}" is not explicitly registered in TRAIT_DATA`);
  }
}

// 1. Validate TRAIT_DATA
console.log("Validating TRAIT_DATA...");
const traitKeys = Object.keys(TRAIT_DATA);
if (traitKeys.length === 0) {
  errors.push("TRAIT_DATA is empty");
}

// 2. Validate SERVANT_DATA
console.log(`Validating SERVANT_DATA (${Object.keys(SERVANT_DATA).length} entries)...`);
for (const [id, svt] of Object.entries(SERVANT_DATA)) {
  const ctx = `Servant ${id}`;
  if (!svt || typeof svt !== "object") {
    errors.push(`${ctx}: Invalid servant entry`);
    continue;
  }
  if (!/^\d{5,7}$/.test(id)) {
    errors.push(`${ctx}: Key must be numeric Atlas svt ID (5-7 digits)`);
  }
  if (!svt.name || typeof svt.name !== "string") {
    errors.push(`${ctx}: Missing or invalid name`);
  }
  if (typeof svt.collectionNo !== "number" || svt.collectionNo <= 0) {
    errors.push(`${ctx}: Missing or invalid collectionNo (expected positive integer)`);
  }

  // Validate traits
  const rawTraits = svt.traits;
  if (Array.isArray(rawTraits)) {
    checkAscending(rawTraits, `${ctx} (flat traits)`);
    rawTraits.forEach((t) => validateTraitId(t, `${ctx} (flat traits)`));
  } else if (typeof rawTraits === "object" && rawTraits !== null) {
    if (!rawTraits.base || !Array.isArray(rawTraits.base)) {
      errors.push(`${ctx}: Multi-ascension traits missing base array`);
    } else {
      checkAscending(rawTraits.base, `${ctx} (base traits)`);
      rawTraits.base.forEach((t) => validateTraitId(t, `${ctx} (base traits)`));
    }
    for (const [stage, arr] of Object.entries(rawTraits)) {
      if (stage === "base") continue;
      if (Array.isArray(arr)) {
        checkAscending(arr, `${ctx} (ascension ${stage})`);
        arr.forEach((t) => validateTraitId(t, `${ctx} (ascension ${stage})`));
      }
    }
  } else {
    errors.push(`${ctx}: Missing or invalid traits field`);
  }

  // Validate default face image
  const defaultImg = path.join(ROOT_DIR, "public", "servants", String(id), "000.webp");
  if (!fs.existsSync(defaultImg)) {
    errors.push(`${ctx}: Missing default image at public/servants/${id}/000.webp`);
  }

  // Validate unified dual-portrait for servant 467
  if (svt.altId) {
    const altImg = path.join(ROOT_DIR, "public", "servants", String(svt.altId), "000.webp");
    if (!fs.existsSync(altImg)) {
      errors.push(`${ctx}: Missing alt image for unified servant at public/servants/${svt.altId}/000.webp`);
    }
  }

  // Check ascension images if multi-ascension
  const hasAscensions =
    typeof rawTraits === "object" && !Array.isArray(rawTraits) && Object.keys(rawTraits).some((k) => k !== "base");
  if (hasAscensions) {
    const standard = ["001", "002"];
    const custom = Object.keys(rawTraits).filter((k) => k !== "base" && !standard.includes(k) && k !== "000");
    if (svt.optionLabels) {
      Object.keys(svt.optionLabels).forEach((k) => {
        if (!standard.includes(k) && k !== "000" && !custom.includes(k)) custom.push(k);
      });
    }
    for (const stage of [...standard, ...custom]) {
      const ascImg = path.join(ROOT_DIR, "public", "servants", String(id), `${stage}.webp`);
      if (!fs.existsSync(ascImg)) {
        errors.push(`${ctx}: Ascension stage "${stage}" image missing at public/servants/${id}/${stage}.webp`);
      }
    }
  }
}

// 2b. Validate bond point tables (Bond Calculator level costs)
console.log(
  `Validating BOND_TABLES (${Object.keys(BOND_TABLES).length} tables over ${Object.keys(BOND_TABLE_BY_SVT).length} servants)...`,
);
for (const [key, table] of Object.entries(BOND_TABLES)) {
  if (!Array.isArray(table) || table.length !== 16 || !table.every((v) => Number.isInteger(v) && v > 0)) {
    errors.push(`Bond table ${key}: expected 16 positive integers`);
  }
}
for (const [id, key] of Object.entries(BOND_TABLE_BY_SVT)) {
  if (!BOND_TABLES[key]) {
    errors.push(`Bond table ${id}: key "${key}" is missing from BOND_TABLES`);
  }
}
for (const id of Object.keys(SERVANT_DATA)) {
  if (!BOND_TABLE_BY_SVT[id]) {
    errors.push(`Servant ${id}: no bond point table`);
  }
}

// 3. Validate CE_DATA
console.log(`Validating CE_DATA (${Object.keys(CE_DATA).length} entries)...`);
for (const [id, ce] of Object.entries(CE_DATA)) {
  const ctx = `CE ${id}`;
  if (!/^\d{5,8}$/.test(id)) {
    errors.push(`${ctx}: Key must be numeric Atlas equip ID (5-8 digits)`);
  }
  if (!ce || typeof ce !== "object") {
    errors.push(`${ctx}: Invalid CE entry`);
    continue;
  }
  if (!ce.name) {
    errors.push(`${ctx}: Missing CE name`);
  }
  if (typeof ce.collectionNo !== "number" || ce.collectionNo <= 0) {
    errors.push(`${ctx}: Missing or invalid collectionNo (expected positive integer)`);
  }

  // Check CEs image
  if (ce.isGroup && ce.options) {
    for (const [optId, opt] of Object.entries(ce.options)) {
      if (!/^\d{5,8}$/.test(optId)) {
        errors.push(`${ctx}: Group option key "${optId}" must be numeric Atlas equip ID (5-8 digits)`);
      }
      if (!opt || typeof opt.collectionNo !== "number" || opt.collectionNo <= 0) {
        errors.push(`${ctx}: Group option "${optId}" missing or invalid collectionNo (expected positive integer)`);
      }
      const optImg = path.join(ROOT_DIR, "public", "craft_essences", `${optId}.webp`);
      if (!fs.existsSync(optImg)) {
        errors.push(`${ctx}: Group option image missing at public/craft_essences/${optId}.webp`);
      }
    }
  } else {
    const ceImg = path.join(ROOT_DIR, "public", "craft_essences", `${id}.webp`);
    if (!fs.existsSync(ceImg)) {
      errors.push(`${ctx}: Image missing at public/craft_essences/${id}.webp`);
    }
  }
}

// 4. Validate EVENT_SHOP_DATA — { events: [ { event, currencies, items, farm } ] } (Amendment G)
function checkShopIcon(entry, what) {
  if (entry.icon === null || entry.icon === undefined) return;
  const publicDir = path.join(ROOT_DIR, "public");
  const iconPath = path.join(publicDir, entry.icon);
  if (!iconPath.startsWith(publicDir + path.sep) || !fs.existsSync(iconPath)) {
    errors.push(
      `Event Shop ${what} ${entry.id}: icon must be null or an existing file under public/ (got "${entry.icon}")`,
    );
  }
}

function checkShopName(entry, what) {
  if (typeof entry.name !== "string") {
    errors.push(`Event Shop ${what} ${entry.id}: name must be a string (got ${JSON.stringify(entry.name)})`);
  } else if (!entry.name) {
    warnings.push(`Event Shop ${what} ${entry.id}: name is empty`);
  }
}

function validateEventShopCurrencies(currencies, ctx) {
  if (!Array.isArray(currencies)) {
    errors.push(`${ctx}: currencies must be an array (got ${JSON.stringify(currencies)})`);
    return [];
  }
  const currencyIds = new Set();
  currencies.forEach((cur, i) => {
    if (!Number.isInteger(cur.id) || cur.id <= 0) {
      errors.push(`Event Shop currency ${cur.id}: id must be a positive integer`);
    }
    if (currencyIds.has(cur.id)) errors.push(`Event Shop currency ${cur.id}: duplicate id`);
    currencyIds.add(cur.id);
    if (i > 0 && currencies[i - 1].id > cur.id) {
      errors.push(`${ctx}: currencies not sorted ascending at ${cur.id}`);
    }
    /* background carries Atlas' own vocabulary — event 80292 ships "zero" (QP) live — so only
       emptiness is an error here: the tier map ignores strings it cannot name and the CSS
       :where() fallback absorbs them. A closed set would reject the next value Atlas invents. */
    if (typeof cur.background !== "string" || !cur.background) {
      errors.push(
        `Event Shop currency ${cur.id}: background must be a non-empty string (got ${JSON.stringify(cur.background)})`,
      );
    }
    checkShopName(cur, "currency");
    checkShopIcon(cur, "currency");
  });
  return currencyIds;
}

function validateEventShopItems(items, currencyIds, ctx) {
  if (!Array.isArray(items)) {
    errors.push(`${ctx}: items must be an array (got ${JSON.stringify(items)})`);
    return;
  }
  items.forEach((item, i) => {
    const itemCtx = `Event Shop item ${item.id}`;
    const amount = (item.cost || {}).amount;
    if (!currencyIds.has(item.cost && item.cost.itemId)) {
      errors.push(`${itemCtx}: cost.itemId ${JSON.stringify(item.cost && item.cost.itemId)} is not a known currency`);
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      errors.push(`${itemCtx}: cost.amount must be a positive integer`);
    }
    for (const field of ["limitNum", "setNum", "priority"]) {
      if (!Number.isInteger(item[field]) || item[field] < 0) {
        errors.push(`${itemCtx}: ${field} must be a non-negative integer`);
      }
    }
    if (i > 0) {
      const prev = items[i - 1];
      if (prev.priority > item.priority || (prev.priority === item.priority && prev.id > item.id)) {
        errors.push(`${itemCtx}: items not sorted by (priority, id)`);
      }
    }
    checkShopName(item, "item");
    checkShopIcon(item, "item");
  });
}

/* farm = { quests: [ { questId, questName, recommendLv, ap, sampleRuns, drops: { [currencyId]:
   { dropExpected, num } } } ], best: { [currencyId]: questId } } (Amendment L2). quests are the
   repeatable quests that pay at least one shop currency on repeat runs; best names the top quest per
   currency. recommendLv stays the string Atlas gives ("70"), but a number is equally readable.
   trades = [ { fromId, toId, costAmount, getNum } ] (Amendment L8): the shop's upgrade exchanges,
   both endpoints shop currencies and the ratio costAmount/getNum strictly positive. */
function validateEventShopFarm(farm, currencyIds, ctx) {
  if (!farm || typeof farm !== "object" || Array.isArray(farm)) {
    errors.push(`${ctx}: farm must be an object with quests and best (got ${JSON.stringify(farm)})`);
    return;
  }
  if (!Array.isArray(farm.quests)) {
    errors.push(`${ctx}: farm.quests must be an array (got ${JSON.stringify(farm.quests)})`);
    return;
  }
  const questIds = new Set();
  farm.quests.forEach((quest) => validateFarmQuest(ctx, quest, currencyIds, questIds));
  validateFarmBest(ctx, farm.best, currencyIds, questIds);
}

function validateFarmQuest(ctx, quest, currencyIds, questIds) {
  const what = `${ctx} farm quest ${quest && quest.questId}`;
  if (!quest || typeof quest !== "object" || Array.isArray(quest)) {
    errors.push(`${what}: farm quest must be an object (got ${JSON.stringify(quest)})`);
    return;
  }
  if (!Number.isInteger(quest.questId) || quest.questId <= 0)
    errors.push(`${what}: questId must be a positive integer`);
  if (questIds.has(quest.questId)) errors.push(`${what}: duplicate farm questId`);
  questIds.add(quest.questId);
  if (typeof quest.questName !== "string") errors.push(`${what}: questName must be a string`);
  if (typeof quest.recommendLv !== "string" && typeof quest.recommendLv !== "number") {
    errors.push(`${what}: recommendLv must be a string or number (got ${JSON.stringify(quest.recommendLv)})`);
  }
  for (const field of ["ap", "sampleRuns"]) {
    if (!Number.isInteger(quest[field]) || quest[field] < 0)
      errors.push(`${what}: ${field} must be a non-negative integer`);
  }
  const keys = validateFarmDrops(what, quest.drops, currencyIds);
  if (!keys.length) errors.push(`${what}: drops must carry at least one shop currency`);
}

function validateFarmDrops(what, drops, currencyIds) {
  if (!drops || typeof drops !== "object" || Array.isArray(drops)) {
    errors.push(`${what}.drops: must be an object of currency id to drop figures (got ${JSON.stringify(drops)})`);
    return [];
  }
  for (const [key, drop] of Object.entries(drops)) {
    if (!currencyIds.has(Number(key))) errors.push(`${what}.drops: key ${key} is not a shop currency`);
    if (!drop || typeof drop !== "object" || Array.isArray(drop)) {
      errors.push(`${what}.drops[${key}]: must be an object (got ${JSON.stringify(drop)})`);
      continue;
    }
    if (typeof drop.dropExpected !== "number" || !(drop.dropExpected > 0)) {
      errors.push(`${what}.drops[${key}]: dropExpected must be a number above 0`);
    }
    if (!Number.isInteger(drop.num) || drop.num <= 0)
      errors.push(`${what}.drops[${key}]: num must be a positive integer`);
  }
  return Object.keys(drops);
}

function validateFarmBest(ctx, best, currencyIds, questIds) {
  if (!best || typeof best !== "object" || Array.isArray(best)) {
    errors.push(`${ctx}: farm.best must be an object of currency id to quest id (got ${JSON.stringify(best)})`);
    return;
  }
  for (const [key, questId] of Object.entries(best)) {
    if (!currencyIds.has(Number(key))) errors.push(`${ctx}: farm.best key ${key} is not a shop currency`);
    if (!Number.isInteger(questId) || questId <= 0) {
      errors.push(`${ctx}: farm.best ${key}: questId must be a positive integer (got ${JSON.stringify(questId)})`);
      continue;
    }
    if (!questIds.has(questId)) errors.push(`${ctx}: farm.best ${key}: quest ${questId} is not in farm.quests`);
  }
}

function validateEventShopTrades(trades, currencyIds, ctx) {
  if (!Array.isArray(trades)) {
    errors.push(`${ctx}: trades must be an array (got ${JSON.stringify(trades)})`);
    return;
  }
  trades.forEach((trade) => {
    const what = `${ctx} trade ${JSON.stringify(trade && [trade.fromId, trade.toId])}`;
    if (!trade || typeof trade !== "object" || Array.isArray(trade)) {
      errors.push(`${what}: trade must be an object`);
      return;
    }
    if (!currencyIds.has(Number(trade.fromId)))
      errors.push(`${what}: fromId ${JSON.stringify(trade.fromId)} is not a shop currency`);
    if (!currencyIds.has(Number(trade.toId)))
      errors.push(`${what}: toId ${JSON.stringify(trade.toId)} is not a shop currency`);
    if (Number(trade.fromId) === Number(trade.toId)) errors.push(`${what}: fromId and toId are the same currency`);
    for (const field of ["costAmount", "getNum"]) {
      if (!Number.isInteger(trade[field]) || trade[field] <= 0)
        errors.push(`${what}: ${field} must be a positive integer`);
    }
  });
}

function validateEventShopBonusCes(bonusCes, currencyIds, ctx) {
  if (!Array.isArray(bonusCes)) {
    errors.push(`${ctx}: bonusCes must be an array (got ${JSON.stringify(bonusCes)})`);
    return;
  }
  const ceIds = new Set();
  bonusCes.forEach((ce, i) => {
    const what = `${ctx} bonus CE ${ce && ce.id}`;
    if (!ce || typeof ce !== "object" || Array.isArray(ce)) {
      errors.push(`${ctx}: bonusCes[${i}] must be an object`);
      return;
    }
    if (!Number.isInteger(ce.id) || ce.id <= 0) {
      errors.push(`${what}: id must be a positive integer`);
    }
    if (ceIds.has(ce.id)) errors.push(`${what}: duplicate bonus CE id`);
    ceIds.add(ce.id);
    if (!Number.isInteger(ce.rarity) || ce.rarity < 1 || ce.rarity > 5) {
      errors.push(`${what}: rarity must be an integer 1..5 (got ${JSON.stringify(ce.rarity)})`);
    }
    if (i > 0) {
      const prev = bonusCes[i - 1];
      if (prev.rarity > ce.rarity || (prev.rarity === ce.rarity && prev.id >= ce.id)) {
        errors.push(`${ctx}: bonusCes not sorted by (rarity asc, id asc) at ${ce.id}`);
      }
    }
    checkShopName(ce, "bonus CE");
    checkShopIcon(ce, "bonus CE");
    if (!ce.bonuses || typeof ce.bonuses !== "object" || Array.isArray(ce.bonuses)) {
      errors.push(`${what}: bonuses must be an object`);
      return;
    }
    const bonusEntries = Object.entries(ce.bonuses);
    if (!bonusEntries.length) {
      errors.push(`${what}: bonuses must include at least one shop currency`);
    }
    for (const [cidKey, bonus] of bonusEntries) {
      if (!currencyIds.has(Number(cidKey))) {
        errors.push(`${what}.bonuses: key ${cidKey} is not a shop currency`);
      }
      if (!bonus || typeof bonus !== "object" || Array.isArray(bonus)) {
        errors.push(`${what}.bonuses[${cidKey}]: must be an object`);
        continue;
      }
      if (!Number.isInteger(bonus.nonLimitBreak) || bonus.nonLimitBreak <= 0) {
        errors.push(`${what}.bonuses[${cidKey}]: nonLimitBreak must be a positive integer`);
      }
      if (!Number.isInteger(bonus.limitBreak) || bonus.limitBreak < (bonus.nonLimitBreak || 1)) {
        errors.push(`${what}.bonuses[${cidKey}]: limitBreak must be an integer >= nonLimitBreak`);
      }
    }
  });
}

function validateEventShopSnapshot(snapshot, index, total) {
  if (!snapshot || typeof snapshot.event !== "object" || snapshot.event === null) {
    errors.push(`Event Shop: events[${index}].event must be an object (got ${JSON.stringify(snapshot)})`);
    return;
  }
  const event = snapshot.event;
  const ctx = `Event Shop event ${event.id}`;
  if (!Number.isInteger(event.id) || event.id <= 0) {
    errors.push(`Event Shop: events[${index}].event.id must be a positive integer (got ${JSON.stringify(event.id)})`);
  }
  checkShopName(event, "event");
  const currencyIds = validateEventShopCurrencies(snapshot.currencies, ctx);
  validateEventShopItems(snapshot.items, currencyIds, ctx);
  validateEventShopFarm(snapshot.farm, currencyIds, ctx);
  validateEventShopTrades(snapshot.trades, currencyIds, ctx);
  validateEventShopBonusCes(snapshot.bonusCes, currencyIds, ctx);
  if (index > 0) {
    const prev = total[index - 1];
    if ((prev.event.startedAt || 0) < (event.startedAt || 0)) {
      errors.push(`${ctx}: events not sorted by startedAt descending`);
    }
  }
}

function validateEventShop(data) {
  if (!Array.isArray(data.events)) {
    errors.push(`Event Shop: events must be an array (got ${JSON.stringify(data.events)})`);
    return;
  }
  data.events.forEach((snapshot, index) => validateEventShopSnapshot(snapshot, index, data.events));
}

console.log(`Validating EVENT_SHOP_DATA...`);
const shop = EVENT_SHOP_DATA || {};
if (!Array.isArray(shop.events) || shop.events.length === 0) {
  console.log("  events: [] — empty stub, shop checks skipped.");
} else {
  validateEventShop(shop);
}

// Summary
console.log("--------------------------------------------------");
if (warnings.length > 0) {
  console.log(`Warnings (${warnings.length}):`);
  warnings.slice(0, 10).forEach((w) => console.warn(`  [WARN] ${w}`));
  if (warnings.length > 10) {
    console.warn(`  ... and ${warnings.length - 10} more warnings.`);
  }
}

if (errors.length > 0) {
  console.error(`\nFAILED with ${errors.length} error(s):`);
  errors.forEach((e) => console.error(`  [ERROR] ${e}`));
  process.exit(1);
} else {
  console.log("SUCCESS: All data, traits, and images validated cleanly.");
  process.exit(0);
}
