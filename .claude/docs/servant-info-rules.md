# Servant Info Rules

Authoritative rules for Servant Info conversion (`scripts/servant_info_converter/`), UI/modal rendering (`src/scripts/servant-info-app.js`, `src/scripts/servant-info-lazy.js`), media sync (`scripts/sync_atlas_data.py`), and verification.

## 1. Architecture, Files & Branch Scope

- **Converter package (`scripts/servant_info_converter/`)**:
  - `export_servant_info.py`: batch static exporter (`export_all_servant_info`, `build_servant_info_payload`), Saint Graph & skill icon extraction, sanitization, missing inner-skill discovery.
  - `servant_formatter.py`: top-level `build_formatted_servant`, `format_profile_structured`, `formConfig`, slot index construction, markdown helpers.
  - `skill_formatter.py`: active skills (`format_skills_structured`), Mash special skills (`_fmt_mash_skills_structured`), class passives (`format_passives_structured`), append skills (`format_append_skills_structured`), `ActSet` / `ActSetWeight` grouping, tier & form dedup.
  - `np_formatter.py`: Noble Phantasms (`format_np_structured`, `fmt_np_function`, `_extract_single_np_data`), Mash NPs (`_fmt_mash_noble_phantasms_structured`), NP scope/card/variant resolution.
  - `function_formatter.py`: core function/buff formatting (`fmt_function`, `fmt_trigger_function`, `fmt_delay_fn`, `_resolve_core_context`, `_handle_*`).
  - `effect_map.py`: `FUNC_TYPE_NO_BUFF`, `BUFF_TYPE_MAP`, `TRAIT_ID_LABELS`, `TARGET_LABELS`, `HP_REDUCE_LABELS`, `JP_BUFF_NAME_MAP`, `SPIRITRON_DRESS_NAME_MAP`.
  - `utils.py`: `fmt_val_range`, `fmt_condition`, `fmt_hp_cond`, `oc_last`, `is_demerit`, `fold_chained_functions`, `append_chained_roll_tag`, ascension/costume/transform helpers.
  - `context.py` / `mapper.py`: `FetchContext` (`fetch`, `fetch_inner_skill`, `counter_name`, `functions`, `svt_data`) and helper exports.
- **UI & Styles**:
  - `src/scripts/servant-info-lazy.js` — lazy `import()` entrypoint loaded when switching to the `Servant Info` tab (leftmost tab).
  - `src/scripts/servant-info-app.js` — `ServantInfoApp` grid, search/filter/sort, pagination, `#servantInfoModal` detail & Saint Graph viewer.
  - All visual CSS lives exclusively in the single inline `<style>` in `src/layouts/BaseLayout.astro`.
- **Branch & Zero-Commit Scope**:
  - Generated `public/servant_info/*.json`, `public/saint_graphs/*.webp`, `public/servants/<id>/*.webp`, and `public/skill_icons/*.webp` are gitignored (Zero-Commit Architecture).
  - `.claude/**` (including this file), `AGENTS.md`, `GEMINI.md`, `tests/`, `scripts/verify_render.js`, and `scripts/test_*.js` are `develop`-only — never plain-merge `develop` into `main`; ship code changes with `scripts/merge_code_only.sh`.

## 2. Static Payload Schema & Sanitization (`public/servant_info/<atlasId>.json`)

- **Playable filter (`is_playable_servant`)**: Only playable Servants (excluding Mash enemy/NPC duplicates or non-playable entries) are exported.
- **Top-level JSON keys**:
  - `id`, `collectionNo`, `name`, `originalName`, `className`, `rarity`, `cost`, `hpBase`, `hpMax`, `atkBase`, `atkMax`
  - `formatted`: `{ profile, skills, noblePhantasms, passives, appendSkills, slots, formConfig }`
  - `saintGraphs`: ordered stage & costume entries (`1st Ascension`, `2nd Ascension`, `3rd Ascension`, `Final Ascension`, plus costumes).
- **Strict sanitization**:
  - Zero `https://` external URLs anywhere in the exported JSON.
  - `_sanitize_no_forbidden()` strips `_FORBIDDEN_KEYS = {"convertedText", "charaGraphs", "faceUrl", "borderedFaceUrl"}`.
- **Inner skill cache**:
  - Nested trigger/delay/rank-up skills absent from servant-embedded skill lists are fetched from `/nice/JP/skill/{id}?lang=en` and cached in `.cache/atlas/inner_skills.json`.

## 3. Profile, Forms, Ascensions & Stage-Aware Names

- **Profile (`format_profile_structured`)**: Extracts attributes, alignments, gender, and traits grouped by ascension (`get_ascension_profile_variants`, `fmt_attribute_blocks`, `fmt_alignment_blocks`, `fmt_gender_blocks`, `fmt_trait_by_asc`).
- **Mash special handling**: `is_mash(svt_id)` + `_mash_form(cid)` route Mash's story/Ortinax/Paladin forms cleanly in skills, NPs, and Saint Graph entries.
- **Costumes & transform partners**:
  - `resolve_costume_forms` and `find_transform_svt_id` build `formConfig` for multi-form Servants and costume-locked skills/NPs.
  - `_NO_SAINT_GRAPH_FORM_IDS = {600710, 1002100, 2501500}` (transform partner CharaGraphs that 404 on Atlas CDN) skip partner CharaGraphs and populate `formConfig["1"].faces` (`{"1": "<partnerId>/000.webp", ...}`) for modal hero face swapping.
- **Ascension limits & stage-aware slot names**:
  - `_ASC_LIMIT_KEYS = {"1": ("0",), "2": ("1", "2"), "3": ("3",), "4": ("4",)}` (0-indexed).
  - `saintGraphs[]` carries optional `npName` (`ascensionAdd.overWriteTDName`) and `skillNames` (`{ "skill_<num>": "<name>" }` from `ascensionAdd.overwriteSkillName`, omitting no-ops equal to base names) so the UI updates NP and skill headings dynamically per selected Saint Graph stage.
  - Costume labels resolve via `shortName` / `name` / `Costume <k>` and `SPIRITRON_DRESS_NAME_MAP`.

## 4. Effect Formatting Rules (Skills, NPs, Passives, Append Skills)

- **Sentence-case capitalization**:
  - Every formatted effect line starts with a capital letter (`0` lowercase starts across the catalog).
  - Every inner effect clause inside `Apply a state that "..."` also starts with a capital letter (`Removes`, `Apply`, `Increase`, `Decrease`, `Inflict`, `Gain`, etc.).
- **Values, conditions, Overcharge & chaining**:
  - `fmt_val_range(v0, v9, divisor, is_pct)` formats fixed values (`30%`) or scaling ranges (`30-50%`).
  - `fmt_condition(turn, count, turn_end=None)` in `utils.py` renders scaling turn durations as `(X-Y turns)` when `sv0["Turn"] != sv9["Turn"]` (e.g. `#461` Lord Logres S3 `(6-2 turns)`).
  - `oc_last(fn, svals)` resolves Overcharge scaling across `svals5`..`svals2`..`svals`.
  - `fold_chained_functions` + `append_chained_roll_tag` collapse repeated consecutive identical rolls into `(xN)` (preserving consecutive identical `funcId` passive stacking via `skill_formatter.py`).
- **Enemy-side filtering (top-level & inner skills)**:
  - Both `_resolve_core_context` and `fmt_trigger_function` in `function_formatter.py` must inspect `raw_inner_fn.get("funcTargetTeam")` **before** overwriting `inner_fn["funcTargetTeam"]` with the outer function's team.
  - Always skip `displayBuffstring` (except top-level `CheckOverChargeStageRange`) and `hastenNpturn` (Charge Up is enemy-only).
  - Always skip `delayNpturn` targeting `self`, `ptOne`, or `ptAll` (enemy-side counterpart to player `lossNp`). Keep `delayNpturn` targeting `enemy`, `enemyOne`, or `enemyAll` (legitimate enemy Charge Drain, e.g. `#418` C.I.E.L S2 `Decrease Charge for one enemy`).
  - Skip all other `funcTargetTeam == "enemy"` functions (e.g. enemy-only `upCriticalrate` paired with `gainStar`, enemy-only `downCriticalrate` paired with `downCriticalpoint`), except top-level solo enemy `downCriticalrate`, `downNpturnval`, or `commandTypeSelfTreasureDevice`.
- **Hidden engine hooks**:
  - `_is_internal_hide_miss()` suppresses `HideMiss == 1` + `ShowState == -1` internal buffs: `addIndividuality`, `skillRankUp`, `delayFunction`, `donotReplace`, negative-rate `avoidState`, zero-value `upDamage`, and `attackAfterFunctionMainOnly` with `UnSubStateWhileLinkedToOthers == 1`.
  - Suppress top-level `subState` with `HideNoEffect == 1`; do **not** blindly hide inner `subState` with `HideNoEffect == 1` inside `fmt_trigger_function` (`#310` Barghest S2 and `#96` Edmond Dantès S2 rely on inner `subState` `HideNoEffect == 1`).
- **Trigger, delay & named turn-end/turn-start patterns**:
  - `fmt_trigger_function` formats `Apply a state that "..." <trigger_phrase><cond> <target>` and `Inflict <Name> <Apply a state that "..." at turn end> (<outer_cond>) <outer_target>` for named `selfturnendFunction` / `selfturnstartFunction` buffs (e.g. `#316` Oberon S2 & S3).
  - `fmt_delay_fn` formats `After N turn(s) "..." <cond> <target>` and follows `inner_skill.script.additionalSkillId`.
- **Special unremovable sacrifice-blocked sleep**:
  - `donotAct` buffs carrying both traits `3066` (`buffSleep`) and `3076` (`cantBeSacrificed`) format as `<Rate>% Chance to Apply [<Name>] <nullify Resistance, unable to remove, unable to select Sacrifice, unable to Order Change><cond> <target>`, with JP names mapped in `JP_BUFF_NAME_MAP` (e.g. `"湖水の夢": "Lake Water Dream"`), while hidden `donotReplace` companions (`funcId=7485`) are suppressed.
- **Multi-choice, random weights, usage-cycles & dedup**:
  - `skill_formatter.py` (`_fmt_single_skill_functions`) and `np_formatter.py` (`_extract_single_np_data`) group `ActSet` / `ActSetWeight` functions under `[XX% Chance]` headers (`[Set N]` fallback) after shared base effects (e.g. `#320` Leonardo da Vinci Ruler NP).
  - Usage-cycle skills emit `[1st Time]`, `[2nd Time]`, etc. block headers.
  - Drop empty-function NP placeholders and collapse duplicate-effect variants (preferring non-`???` names) so name-only differences never emit false-positive choice selectors.
- **Demerits & angle-bracket hygiene**:
  - `is_demerit(fn)` appends `[Demerit]` (always bracketed).
  - `<...>` annotations must remain strictly balanced because the UI parser pairs `<` and `>`.
- **Passives & Append Skills**:
  - Class passives live in `formatted.passives` (supports form variants); `appendPassive` exports to `formatted.appendSkills` (5 slots).

## 5. UI & Modal Rules (`servant-info-app.js`, `servant-info-lazy.js`, `BaseLayout.astro`)

- **DOM safety (Trusted Types)**: Never use `innerHTML` or `insertAdjacentHTML`. Build nodes via `DOMFactory.el(...)`, `document.createTextNode(...)`, `setAttribute(...)`, and batch with `DocumentFragment` + `replaceChildren()`.
- **Converter ↔ UI parser contracts**:
  - `appendHighlightedEffect`: renders `[Demerit]` as `<span class="f-demerit-tag">Demerit</span>`, notes matching `SCALING_NOTE_REGEX` as `<em class="f-overcharge-note">...</em>`, and any other balanced `<...>` as `<span class="f-effect-note">...</span>` (recursively highlighting nested `[Demerit]` / `<...>`).
  - `parseSkillOptions`: detects `[Nth Time]` usage-cycle headers (appending ` -> 1st Time` on the final button label), `[XX% Chance]` random-weight headers, `Select N Options (...)` headers, and `OPTION_TRANSLATIONS` tags.
  - `EMPTY_EFFECTS_FALLBACK`: `"No class passives."`, `"No append skills."`, `"No skill effects."`, `"No Noble Phantasm effects."`.
- **Modal lifecycle & stage/form sync**:
  - `_openDetailModal` fetches `servant_info/{id}.json` and calls `_preloadModalImages` before rendering so Saint Graphs and icons appear without layout jump; falls back to `_renderFallbackModal` on fetch failure.
  - `_syncAllCardsToForm`, `_setServantAscensionStage`, `_applyStageSlotNames`, and `_applyStageIdentity` keep Saint Graph stage, hero portrait/icon, skill/NP tier & form buttons, and overwritten skill/NP titles synchronized.

## 6. Media Assets, Sync & CI Cache Rules

- **Lossless WebP (`lossless=True, quality=90, method=6`)**:
  - Saint Graphs: `public/saint_graphs/*.webp` (native `512×724`, no resize; modal max-height `512px`).
  - Servant faces: `public/servants/<id>/000.webp`–`003.webp`, `c_<costume_key>.webp`, and transform partner faces (`142×155`, `_bordered.png` first with plain `.png` fallback).
  - Skill icons: `public/skill_icons/skill_XXXXX.webp`, referenced as `"skill_icons/skill_XXXXX.webp"` on skill tier variants & forms (rendered at `32×32px` in headers).
- **Cache-busting & incremental repair**:
  - Image URLs use `IMAGE_VERSION` query params; `sync_saint_graphs()`, `sync_servant_faces()`, and `sync_skill_icons()` use `_nonempty_file()` to repair missing/0-byte files (`--skip-saint-graphs`, `--skip-faces`, `--skip-skill-icons` skip).
- **CI caches & build guards**:
  - `.github/workflows/deploy.yml` caches `fgo-atlas-cache-*`, `fgo-static-images-v2-*`, and `fgo-saint-graphs-v1-*` (keyed on `data_version.txt`).
  - `scripts/ensure_data.js` (`predev` / `prebuild`) and `scripts/validate_data.js` (`npm run data:validate`) require `public/servant_info/` and `public/skill_icons/`.

## 7. Verification & Regression Testing Checklist

1. **Converter unit tests (run standalone)**:
   ```bash
   python3 -m unittest scripts/test_servant_info_converter.py
   ```
   Do **not** run `python3 -m unittest discover -s scripts` in one process (other test files mock `PIL.Image`). Add a regression test in `scripts/test_servant_info_converter.py` for every converter fix.
2. **Offline re-export from `.cache/atlas/`** (pass `target_ids=[...]` while iterating, omit for full catalog):
   ```bash
   python3 -c '
   import json
   from scripts.servant_info_converter.export_servant_info import export_all_servant_info
   servants = json.load(open(".cache/atlas/nice_servant_lore_lang_en.json"))
   inner = json.load(open(".cache/atlas/inner_skills.json"))
   res = export_all_servant_info(servants, output_dir="public/servant_info", nice_skills=list(inner.values()))
   print("Exported:", res["exported"], "errors:", res["errors"])
   '
   ```
3. **Full-catalog sanity scan** after re-export:
   ```bash
   python3 - <<'EOF'
   import json, glob
   for p in sorted(glob.glob("public/servant_info/*.json")):
       txt = open(p, encoding="utf-8").read()
       assert "https://" not in txt, f"External URL in {p}"
       assert "[unknown" not in txt, f"Unmapped token in {p}"
       d = json.loads(txt)
       for grp in ("skills", "noblePhantasms", "passives", "appendSkills"):
           for slot in d["formatted"].get(grp, []):
               for v in slot["variantsByTier"].values():
                   lines = list(v.get("effects", [])) + [e for fm in v.get("forms", []) for e in fm.get("effects", [])]
                   for e in lines:
                       assert e and not e[0].islower(), f"Lowercase start in {p}: {e}"
                       assert "Increase Charge" not in e and "Decrease Charge for yourself" not in e, f"Charge leak in {p}: {e}"
   print("All servant_info payloads passed sanity scan.")
   EOF
   ```
4. **UI / JS / CSS changes**: Run `npm run lint`, `npm run test`, `npm run build`, `npm run check:build`, and `npm run data:validate`.
