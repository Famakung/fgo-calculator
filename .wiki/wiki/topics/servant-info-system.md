---
title: "Servant Info System"
category: topic
sources:
  - raw/notes/2026-11-24-legacy-servant-info-rules.md
  - raw/notes/2026-11-24-legacy-data-rules.md
  - raw/notes/2026-11-24-legacy-claude-md.md
created: 2026-11-24
updated: 2026-11-24
tags: [servant-info, python-converter, saint-graph, skill-icons, enemy-filtering]
aliases: [Servant Info, Servant Info Converter, Saint Graph Viewer]
confidence: high
volatility: warm
summary: "Specifies the Servant Info tab architecture, the Python static converter package (scripts/servant_info_converter/), the sanitized public/servant_info/<atlasId>.json schema, enemy-side and hidden-hook filtering, stage-aware names, multi-choice effect formatting, lossless WebP assets, and catalog verification."
---

# Servant Info System

> **Servant Info** (`#tab-servantinfo`, leftmost tab) is a lazy-loaded Servant encyclopedia (`src/scripts/servant-info-lazy.js` + `src/scripts/servant-info-app.js`) backed by statically generated, sanitized JSON payloads (`public/servant_info/<atlasId>.json`) and lossless WebP Saint Graphs, faces, and skill icons produced by `scripts/servant_info_converter/`.

## UI, Lazy Loading & Modal Sync

- **Lazy Entry, Filters & Grid**: Switching to `#tab-servantinfo` dynamically imports `servant-info-lazy` (`ServantInfoApp.init`), prefetched on navbar `pointerover`/`focusin`. `src/pages/index.astro` pre-renders disabled placeholder pagination and 30 blank `.servant-info-card-placeholder` skeleton shells (no `<img>` tags) with responsive `nth-child` CSS in `BaseLayout.astro` matching `_getCols()` (10/15/20/25/30 across breakpoints) plus `.servant-info-card { content-visibility: visible; }` so top/bottom pagination and 5 card rows paint at exact height on frame 1 with zero CLS. `ServantInfoApp.render()` / `_buildCard()` replace them with real card names + `.servant-info-portrait-slot` boxes (hiding only `:not([src])` until queued, then painting natively), then `_startProgressivePortraitLoad()` loads portraits in index order (#1 onward) via a 6-concurrent sliding window (cancelled cleanly on page/filter change). `<head>` portrait preloading in `BaseLayout.astro` is skipped for `servantinfo` so JS chunks load uncontended and progressive loading starts from servant #1; `ServantFilters`/`ServantSort` live in `src/scripts/servant-filters.js` (re-exported by `domain.js`) inside `shared-ui-chunk`, keeping `selectors-chunk` off `servantinfo`, while `astro.config.mjs` injects `modulepreload` hints to flatten the JS waterfall. The grid shares search/filter/sort conventions and adds **NP Type** (`NP_TYPE_FILTERS`: `quick`, `arts`, `buster`) and **NP Effect** (`NP_EFFECT_FILTERS`: `aoe`, `st`, `support`) modal rows (`#servantInfoNpTypeFilter`, `#servantInfoNpEffectFilter`) backed by `ServantData.getNpTagSet(id)` and `ServantFilters.match(traits, filters, npTags)` (checked before sub-alignment `Other` early return). Renders via Trusted-Types-safe `DOMFactory.el()`, `document.createTextNode()`, `setAttribute()`, and `DocumentFragment` + `replaceChildren()`.
- **Detail & Saint Graph Modal (`#servantInfoModal`)**: Locked to `calc(var(--screen-h) - 32px)`. `_openDetailModal()` awaits only `servant_info/{id}.json` (instant on `_infoCache` hit), renders immediately with zero-CLS placeholder boxes (`.servant-info-portrait`, `.f-skill-icon`, and `.f-sg-slot` with `aspect-ratio: 512 / 724` and `max-width: 366px` wrapping `.f-sg-img` with `fetchpriority="high"`) using native incremental (top-to-bottom) paint—remounting `.f-sg-img` inside `.f-sg-slot` on stage switches so ascension/costume changes also clear to the placeholder box and paint top-down—and loads all modal images strictly on-demand (off-screen Saint Graphs, alternate faces, and non-active rank-up skill icons are not predownloaded until switched to), falling back to `_renderFallbackModal()` if fetch fails.
- **Converter ↔ UI Parser Contracts**:
  - `appendHighlightedEffect`: maps `[Demerit]` → `<span class="f-demerit-tag">Demerit</span>`, scaling notes matching `SCALING_NOTE_REGEX` → `<em class="f-overcharge-note">`, and balanced `<...>` annotations → `<span class="f-effect-note">` (recursively highlighting nested tags; unbalanced brackets break parsing).
  - `parseSkillOptions`: extracts `[Nth Time]` usage-cycle headers (final button labeled `Nth Time -> 1st Time`), `[XX% Chance]` random-weight headers (`.f-effects-container` supports 2-layer choice selection), `Select N Options (...)`, and `OPTION_TRANSLATIONS`.
  - `EMPTY_EFFECTS_FALLBACK`: `"No class passives."`, `"No append skills."`, `"No skill effects."`, `"No Noble Phantasm effects."`.
- **Stage & Form Synchronization**: `_syncAllCardsToForm`, `_setServantAscensionStage`, `_applyStageSlotNames`, and `_applyStageIdentity` synchronize the Saint Graph stage, `.f-form-selector-bar` (for non-Mash multi-form Servants; clicks on already-active `.f-option-btn` are ignored), hero face icon, skill/NP tier buttons, and stage-overwritten NP/skill names (`modalState.activeSgEntry`). Selecting a Spiritron Dress Saint Graph resolves `targetStage = entry.ascensionStage || (entry.kind === "costume" ? "1" : null)` so ascension buttons stay synced.
- **Tier-Colored Rank Up Markers**: `annotateRankUpEffects()`, `diffInlineTokens()`, `advancePastEffectNote()`, `formatAnnotatedEffectLine()`, and `getCooldownRankUpTiers()` in `src/scripts/servant-info-app.js` render `.f-rankup-marks` / `.f-rankup-mark` (`--rankup-1`, `--rankup-2` in `BaseLayout.astro`) on upgraded effect values (including both Special Attack and NP damage multipliers) and skill cooldown reductions.

## Python Converter Package & Static JSON Schema

`scripts/servant_info_converter/` runs in-memory during `sync_atlas_data.py` (`export_servant_info.py`: `export_all_servant_info`, `build_servant_info_payload`):

- **Module Roles**: `servant_formatter.py` (`build_formatted_servant`, `format_profile_structured`, `formConfig`, slot indices); `skill_formatter.py` (active skills, Mash special skills, passives, 5 append skill slots, `ActSet`/`ActSetWeight` grouping, tier/form dedup); `np_formatter.py` (NPs, Mash NPs, empty-placeholder drop, `_pick_preferred_np` dedup); `function_formatter.py` (`fmt_function`, `fmt_trigger_function`, `fmt_delay_fn`, `_resolve_core_context`); `effect_map.py` (lookup maps incl. `JP_BUFF_NAME_MAP`, `SPIRITRON_DRESS_NAME_MAP`); `utils.py` (`fmt_val_range`, `fmt_condition`, `oc_last`, `is_demerit`, `fold_chained_functions`, `append_chained_roll_tag`); `context.py` / `mapper.py` (`FetchContext`).
- **Playable Filter & Payload Keys**: `is_playable_servant` excludes Mash enemy/NPC duplicates (`800151`/`800200`) and non-playable entries. Exported JSON contains `id`, `collectionNo`, `name`, `originalName`, `className`, `rarity`, `cost`, `hpBase`, `hpMax`, `atkBase`, `atkMax`, `formatted` (`{ profile, slots, formConfig }` — `export_servant_info.py` strips the duplicate `skills`, `noblePhantasms`, `passives`, and `appendSkills` arrays produced by `build_formatted_servant()`), and `saintGraphs`.
- **Strict Sanitization**: Zero `https://` URLs anywhere in output; `_sanitize_no_forbidden()` strips `_FORBIDDEN_KEYS = {"convertedText", "charaGraphs", "faceUrl", "borderedFaceUrl"}`.
- **Inner Skill Cache**: Nested trigger/delay/rank-up skills absent from servant-embedded skill lists are fetched per ID from `/nice/JP/skill/{id}?lang=en` via `collect_missing_inner_skill_ids()` and persisted in `.cache/atlas/inner_skills.json`.

## Stage-Aware Names, Forms & Transform Partners

- **Ascension Limit Keys**: 0-indexed `_ASC_LIMIT_KEYS = {"1": ("0",), "2": ("1", "2"), "3": ("3",), "4": ("4",)}`.
- **Enriched `saintGraphs[]`**: Ordered `1st Ascension`–`Final Ascension` plus costumes (`shortName` / `name` / `Costume <k>` and `SPIRITRON_DRESS_NAME_MAP`), carrying `form`, `ascensionStage` (from skill/NP `releaseConditions` or costume keywords), `name`/`originalName`, site-relative `face` (`<id>/000.webp`–`003.webp`, `<id>/c_<key>.webp`), and optional `npName` (`ascensionAdd.overWriteTDName`) and `skillNames` (`ascensionAdd.overwriteSkillName`, omitting no-ops equal to base names).
- **Mash & Transform Partners**: `is_mash(svt_id)` + `_mash_form(cid)` route Mash's story/Ortinax/Paladin forms. `_NO_SAINT_GRAPH_FORM_IDS = {600710, 1002100, 2501500}` (Jekyll/Hyde, Flora, Aoko — partner CharaGraphs 404 on Atlas CDN) skip partner CharaGraphs and populate `formConfig["1"].faces` (`{"1": "<partnerId>/000.webp", ...}`) for modal hero face swapping.

## Effect Formatting & Enemy-Side Filtering Rules

- **Capitalization, Pluralization & Chaining**: Every top-level effect line and every inner clause inside `Apply a state that "..."` starts with a capital letter. `fmt_sub_state_label()` in `utils.py` pluralizes `Buff`/`Debuff`/`Mental Debuff` vs singular `Buffs`/`Debuffs` (`TRAIT_ID_LABELS[3009]` = `"DEF Debuffs"`). `fmt_condition(turn, count, turn_end)` emits `(X-Y turns)` when `sv0["Turn"] != sv9["Turn"]`. `oc_last()` resolves Overcharge across `svals5`..`svals2`..`svals`. `fold_chained_functions` + `append_chained_roll_tag` collapse repeated consecutive identical rolls into `(xN)` while preserving passive stacking.
- **Enemy-Side Filtering (Top-Level & Inner Skills)**: Both `_resolve_core_context` and `fmt_trigger_function` inspect `raw_inner_fn.get("funcTargetTeam")` **before** overwriting `inner_fn["funcTargetTeam"]` with the outer team:
  - Always skip `displayBuffstring` (except top-level `CheckOverChargeStageRange`) and `hastenNpturn` (Charge Up is enemy-only).
  - Skip `delayNpturn` targeting `self`/`ptOne`/`ptAll` (keep `enemy`/`enemyOne`/`enemyAll` Charge Drain, e.g., `#418` C.I.E.L S2).
  - Skip `lossNp` targeting `enemy`/`enemyOne`/`enemyAll` (enemies lack NP gauges; keep player-side `lossNp` demerit).
  - Skip all other `funcTargetTeam == "enemy"` functions except top-level solo enemy `downCriticalrate`, `downNpturnval`, or `commandTypeSelfTreasureDevice`.
- **Hidden Engine Hooks**: `_is_internal_hide_miss()` suppresses `HideMiss == 1` + `ShowState == -1` internal buffs (`addIndividuality`, `skillRankUp`, `delayFunction`, `donotReplace`, negative-rate `avoidState`, zero-value `upDamage`, `attackAfterFunctionMainOnly` with `UnSubStateWhileLinkedToOthers == 1`). Top-level `subState` with `HideNoEffect == 1` is suppressed, while inner `subState` inside `fmt_trigger_function` is preserved (`#310` Barghest S2, `#96` Edmond Dantès S2).
- **Special Sleep, Trigger, Delay & Choice Blocks**: `donotAct` buffs with traits `3066` (`buffSleep`) + `3076` (`cantBeSacrificed`) emit `<Rate>% Chance to Apply [<Name>] <nullify Resistance, unable to remove, unable to select Sacrifice, unable to Order Change><cond> <target>` using `JP_BUFF_NAME_MAP` (e.g., `"湖水の夢": "Lake Water Dream"`), suppressing hidden `donotReplace` companions (`funcId=7485`). `fmt_trigger_function` formats named `selfturnendFunction` / `selfturnstartFunction` buffs; `fmt_delay_fn` follows `additionalSkillId`. Both skills and NPs group `ActSet` / `ActSetWeight` under `[XX% Chance]` (`[Set N]` fallback) after shared base effects, collapse duplicate-effect variants (preferring non-`???` names), and append `[Demerit]` via `is_demerit(fn)`.

## Lossless Assets & Verification Checklist

- **Lossless WebP (`lossless=True, quality=90, method=6`)**: `sync_saint_graphs()` (`public/saint_graphs/*.webp`, native `512×724`, modal `max-height: 512px`), `sync_servant_faces()` (`public/servants/<id>/`, `142×155` bordered-first), and `sync_skill_icons()` (`public/skill_icons/skill_XXXXX.webp`, rendered at `32×32px`) use `_nonempty_file()` to repair 0-byte/missing files. All are gitignored and cached in CI (`fgo-atlas-cache-*`, `fgo-static-images-v2-*`, `fgo-saint-graphs-v1-*`).
- **Verification Gates**:
  1. Run converter tests standalone: `python3 -m unittest scripts/test_servant_info_converter.py` (never `unittest discover -s scripts`, as sibling tests mock `PIL.Image`).
  2. Offline re-export via `export_all_servant_info(servants, output_dir="public/servant_info", nice_skills=list(inner.values()))`.
  3. Full-catalog sanity scan across `public/servant_info/*.json`: assert 0 `"https://"` URLs, 0 `"[unknown"` tokens, 0 lowercase effect starts, and 0 `"Increase Charge"` / `"Decrease Charge for yourself"` leaks.
  4. UI/JS/CSS validation: `npm run lint`, `npm run test`, `npm run build`, `npm run check:build`, `npm run data:validate`.
- **Offline Effect Lookup (`tools/query_effect.py`)**: Inspect raw Atlas skill/NP functions (`--svt`, `--name`, `--skill`, `--func`, `--buff`, `--kind`, `--fmt`) and formatted display text (`--text`) locally via `tools/query_effect.py`, which auto-caches `.cache/atlas/effects.db` (SQLite, ~9 MB, auto-rebuilt on source mtime change) with compact deduplicated `svals` (`--full-svals` for all 10 levels). Never fetch Atlas API or read `.cache/atlas/nice_servant_lore_lang_en.json` (100 MB) directly, and never run plain `rg` content mode on minified `public/servant_info/*.json` (use `--text` or `rg -l`).

## Key Files, Symbols & Tests

| Role | Target |
|---|---|
| UI controller & Rank Up markers | `src/scripts/servant-info-app.js` (`ServantInfoApp`, `annotateRankUpEffects`, `diffInlineTokens`, `parseSkillOptions`, `appendHighlightedEffect`) |
| Lazy entry & modal HTML | `src/scripts/servant-info-lazy.js`, `src/pages/index.astro` (`#servantInfoFilterModal`, `#servantInfoModal`) |
| Filter constants & matcher | `src/scripts/constants.js` (`NP_TYPE_FILTERS`, `NP_EFFECT_FILTERS`), `src/scripts/domain.js` (`ServantFilters.compile`/`match`), `src/scripts/data.js` (`ServantData.getNpTagSet`) |
| Python static converter | `scripts/servant_info_converter/` (`export_servant_info.py`, `servant_formatter.py`, `skill_formatter.py`, `np_formatter.py`, `function_formatter.py`, `effect_map.py`, `utils.py`) |
| Tests | `tests/servant-filters.test.js`, `tests/servant-info-stage-names.test.js`, `tests/servant-info-rankup-marks.test.js`, `scripts/test_servant_info_converter.py` |

## See Also

- [[zero-commit-data-pipeline|Zero-Commit Data Pipeline]] ([Zero-Commit Data Pipeline](../concepts/zero-commit-data-pipeline.md)) — CI caches, `ensure_data.js`, and lossless WebP sync steps
- [[data-schemas-and-traits|Data Schemas and Traits]] ([Data Schemas and Traits](../references/data-schemas-and-traits.md)) — trait IDs, ascension diffs, and asset paths
- [[security-and-dom-safety|Security and DOM Safety]] ([Security and DOM Safety](../concepts/security-and-dom-safety.md)) — Trusted Types compliance in `#servantInfoModal`

## Sources

- [Servant Info Converter and Rendering Rules](../../raw/notes/2026-11-24-legacy-servant-info-rules.md) — converter modules, sanitization, formatting contracts, UI parser, and checklist
- [Data Schemas and Trait Rules](../../raw/notes/2026-11-24-legacy-data-rules.md) — `saintGraphs[]`, `_ASC_LIMIT_KEYS`, `_NO_SAINT_GRAPH_FORM_IDS`, and asset sync rules
- [CLAUDE.md Project Guide](../../raw/notes/2026-11-24-legacy-claude-md.md) — CI cache isolation and zero-commit asset directories
