#!/usr/bin/env node
/**
 * scripts/validate_data.js
 * Validates data integrity for FGO Calculator:
 * - Checks SERVANT_DATA, CE_DATA, and TRAIT_DATA consistency.
 * - Verifies trait formats, ascending sort order, and trait dictionary coverage.
 * - Confirms existence of all referenced WebP images in public/servants and public/craft_essences.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Dynamic imports from src/scripts/data/
const { SERVANT_DATA } = await import(path.join(ROOT_DIR, 'src/scripts/data/servants.js'));
const { CE_DATA } = await import(path.join(ROOT_DIR, 'src/scripts/data/craft_essences.js'));
const { TRAIT_DATA } = await import(path.join(ROOT_DIR, 'src/scripts/data/traits.js'));

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
console.log('Validating TRAIT_DATA...');
const traitKeys = Object.keys(TRAIT_DATA);
if (traitKeys.length === 0) {
  errors.push('TRAIT_DATA is empty');
}

// 2. Validate SERVANT_DATA
console.log(`Validating SERVANT_DATA (${Object.keys(SERVANT_DATA).length} entries)...`);
for (const [id, svt] of Object.entries(SERVANT_DATA)) {
  const ctx = `Servant ${id}`;
  if (!svt || typeof svt !== 'object') {
    errors.push(`${ctx}: Invalid servant entry`);
    continue;
  }
  if (!svt.name || typeof svt.name !== 'string') {
    errors.push(`${ctx}: Missing or invalid name`);
  }

  // Validate traits
  const rawTraits = svt.traits;
  if (Array.isArray(rawTraits)) {
    checkAscending(rawTraits, `${ctx} (flat traits)`);
    rawTraits.forEach((t) => validateTraitId(t, `${ctx} (flat traits)`));
  } else if (typeof rawTraits === 'object' && rawTraits !== null) {
    if (!rawTraits.base || !Array.isArray(rawTraits.base)) {
      errors.push(`${ctx}: Multi-ascension traits missing base array`);
    } else {
      checkAscending(rawTraits.base, `${ctx} (base traits)`);
      rawTraits.base.forEach((t) => validateTraitId(t, `${ctx} (base traits)`));
    }
    for (const [stage, arr] of Object.entries(rawTraits)) {
      if (stage === 'base') continue;
      if (Array.isArray(arr)) {
        checkAscending(arr, `${ctx} (ascension ${stage})`);
        arr.forEach((t) => validateTraitId(t, `${ctx} (ascension ${stage})`));
      }
    }
  } else {
    errors.push(`${ctx}: Missing or invalid traits field`);
  }

  // Validate default face image
  const defaultImg = path.join(ROOT_DIR, 'public', 'servants', String(id), '000.webp');
  if (!fs.existsSync(defaultImg)) {
    errors.push(`${ctx}: Missing default image at public/servants/${id}/000.webp`);
  }

  // Check ascension images if multi-ascension
  const hasAscensions = typeof rawTraits === 'object' && !Array.isArray(rawTraits) && Object.keys(rawTraits).some((k) => k !== 'base');
  if (hasAscensions) {
    const standard = ['001', '002'];
    const custom = Object.keys(rawTraits).filter((k) => k !== 'base' && !standard.includes(k) && k !== '000');
    if (svt.optionLabels) {
      Object.keys(svt.optionLabels).forEach((k) => {
        if (!standard.includes(k) && k !== '000' && !custom.includes(k)) custom.push(k);
      });
    }
    for (const stage of [...standard, ...custom]) {
      const ascImg = path.join(ROOT_DIR, 'public', 'servants', String(id), `${stage}.webp`);
      if (!fs.existsSync(ascImg)) {
        errors.push(`${ctx}: Ascension stage "${stage}" image missing at public/servants/${id}/${stage}.webp`);
      }
    }
  }
}

// 3. Validate CE_DATA
console.log(`Validating CE_DATA (${Object.keys(CE_DATA).length} entries)...`);
for (const [id, ce] of Object.entries(CE_DATA)) {
  const ctx = `CE ${id}`;
  if (!ce || typeof ce !== 'object') {
    errors.push(`${ctx}: Invalid CE entry`);
    continue;
  }
  if (!ce.name) {
    errors.push(`${ctx}: Missing CE name`);
  }

  // Check CEs image
  if (ce.isGroup && ce.options) {
    for (const optId of Object.keys(ce.options)) {
      const optImg = path.join(ROOT_DIR, 'public', 'craft_essences', `${optId}.webp`);
      if (!fs.existsSync(optImg)) {
        errors.push(`${ctx}: Group option image missing at public/craft_essences/${optId}.webp`);
      }
    }
  } else {
    const ceImg = path.join(ROOT_DIR, 'public', 'craft_essences', `${id}.webp`);
    if (!fs.existsSync(ceImg)) {
      errors.push(`${ctx}: Image missing at public/craft_essences/${id}.webp`);
    }
  }
}

// Summary
console.log('--------------------------------------------------');
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
  console.log('SUCCESS: All data, traits, and images validated cleanly.');
  process.exit(0);
}
