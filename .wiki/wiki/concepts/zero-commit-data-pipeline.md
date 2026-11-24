---
title: "Zero-Commit Data Pipeline"
category: concept
sources:
  - raw/notes/2026-11-24-legacy-data-rules.md
  - raw/notes/2026-11-24-legacy-fetch-data-guideline.md
  - raw/notes/2026-11-24-legacy-claude-md.md
  - raw/notes/archive/2026-10-20-atlas-version-gate.md
  - raw/notes/archive/2026-10-20-ci-drift-path-and-comments.md
  - raw/notes/archive/2026-10-20-jp-na-version-gate.md
  - raw/notes/archive/2026-10-21-atlas-baseline-cache-fix.md
  - raw/notes/plans/2026-11-11-atlas-cron-slots.md
created: 2026-11-24
updated: 2026-11-24
tags: [zero-commit, atlas-academy, github-actions, etag-caching, ci-pipeline, webp]
aliases: [Atlas Sync Pipeline, CI Version Gate, Zero-Commit Architecture]
confidence: high
volatility: warm
summary: "Explains FGO Calculator's zero-commit data and image architecture, where generated JS modules and WebP assets stay gitignored and are rebuilt or restored from actions/cache at build time. Covers JP+NA /info version gating, ETag revalidation, run-scoped .ci-baselines/ persistence, fixed UTC cron slots, and build/data validation gates."
---

# Zero-Commit Data Pipeline

> FGO Calculator keeps its Git repository pure source code by excluding all generated datasets and game artwork from commits, relying on `ensure_data.js` locally and a multi-stage gated Atlas Academy sync in GitHub Actions CI.

## Zero-Commit Architecture and Local Bootstrap

Seven generated paths are gitignored (with directory structure preserved via `.gitkeep`) and never committed to Git:

- **JS datasets**: `src/scripts/data/*.js` (`traits.js`, `servants.js`, `craft_essences.js`, `bond_growth.js`, `event_shop.js`)
- **Static JSON & WebP assets**: `public/servant_info/`, `public/servants/`, `public/saint_graphs/`, `public/skill_icons/`, `public/craft_essences/`, `public/event_shop/`

Locally, `npm run dev` and `npm run build` invoke `scripts/ensure_data.js` via `predev`/`prebuild` hooks, automatically running `npm run data:sync` (`scripts/sync_atlas_data.py`) if required files are absent on a fresh clone.

## Multi-Stage CI Gate (`deploy.yml`)

The workflow triggers on `push` to `main`, `workflow_dispatch` (with optional `force_sync` boolean), or fixed-slot `schedule` events (manual external watchers may also dispatch it):

1. **JP + NA `/info` & `--check-shop` gate (`scripts/check_data_version.py`)**: Before Python/Node setup or asset cache restoration, a ~230-byte `GET https://api.atlasacademy.io/info` compares both `JP.hash` and `NA.hash` against `.ci-baselines/data_version.txt` (`JP <hash>\nNA <hash>`). Checking both regions is mandatory because the app uses JP entity data alongside NA CE names and traits. When `/info` hashes match, `--check-shop` inspects `.ci-baselines/shop_probe.json` (`nextTransitionAt` window rollovers and ETag-conditional quest drop checks). Any network or parse failure fails open (`CHECK=UNKNOWN`).
2. **`DO_WORK` and `DEPLOY` gates**: Idle `schedule` or non-forced `workflow_dispatch` runs reporting `CHECK=UNCHANGED` stop green immediately. `push` and `force_sync: true` (`--force`) always proceed.
3. **ETag revalidation & settled cache (`sync_atlas_data.py`)**: Invoked with `python3 -u` for live per-phase logging, the sync script uses `PoliteRateLimiter` (0.1s delay, ~8 req/s) and ETag conditional GETs (`304 Not Modified` = ~0 bytes) over `.cache/atlas/`. Static `nice_equip_*.json` and settled JP events (`finishedAt + 7 days < now`) read from on-disk cache via `_read_settled_cache()` without HTTP requests unless `--force` is passed.
4. **Full regeneration over incremental drift (`2026-10-20` decision)**: CI wipes `src/scripts/data/*.js` before syncing rather than caching it to run `revalidate_servant_traits()` incrementally. Full regeneration takes only seconds on warm JSON/image caches and eliminates the risk of stale servant traits persisting across missed drift checks.
5. **Post-sync data-hash gate**: CI hashes all five generated `.js` files plus `public/servant_info/*.json` against `.ci-baselines/data_hash.txt`. Non-forced scheduled/dispatched runs skip Astro build and Pages deploy when `DATA_DIRTY != 'true'`.

## `.ci-baselines/` and Split `actions/cache@v6` Design

In October 2026 (CI runs #58–#61), storing `data_version.txt` inside the `.cache/atlas/` asset cache caused an infinite `CHECK=CHANGED` loop because `actions/cache` **never re-saves an exact-key hit**, freezing the old baseline hash. The fix moved `data_version.txt`, `data_hash.txt`, and `shop_probe.json` into `.ci-baselines/`:

- **Run-scoped baseline round-trip**: `actions/cache/restore@v6` and `actions/cache/save@v6` use `key: fgo-version-baseline-${{ github.run_id }}-${{ github.run_attempt }}` with `restore-keys: fgo-version-baseline-`. Every run misses the primary key (allowing `save` after `Upload Pages artifact` when `push`, `CHECK == 'CHANGED'`, or `DATA_DIRTY == 'true'`), preventing failed builds from swallowing upstream updates.
- **Separated asset caches**: Because `actions/cache` hashes its `path:` list into its internal version, caches are isolated so script edits do not invalidate large image blobs:
  - `fgo-atlas-cache-*` (`public/servant_info/`, `src/scripts/data/`, keyed on sync/converter scripts + `data_version.txt`)
  - `fgo-atlas-raw-v1-*` (`.cache/atlas/`)
  - `fgo-static-images-v2-*` (`public/servants/`, `public/craft_essences/`, `public/skill_icons/`, `public/event_shop/`)
  - `fgo-saint-graphs-v1-*` (`public/saint_graphs/`, keyed on `data_version.txt` alone so Python edits never re-download portraits)

When `CHECK=UNCHANGED` and `atlas_cache`, `static_img_cache`, and `saint_graph_cache` all hit, `sync_atlas_data.py` is skipped entirely.

## Fixed Cron Schedule (`2026-11-11`)

Originally configured as `*/10 * * * *`, GitHub throttled the 10-minute cron to 3–5 random fires/day (avg gap 5.8h). It was replaced by four fixed UTC slots (`10 9,11,15,19 * * *`) aligned to JP/NA maintenance ends (`16:10`/`18:10`/`22:10`/`02:10` ICT), dodging top-of-hour load at `:10`.

## Lossless WebP Asset Fetching and Verification

- **Bordered-first rule**: Asset fetchers request `{base}_bordered.png` first and fall back to plain `.png` only when the error contains the exact phrase `"HTTP Error 404"` (preventing collisions with numeric IDs containing `404` such as `f_9404xxx`). Non-404 errors abort without writing partial files.
- **Incremental repair**: `_nonempty_file()` skips valid existing images while repairing missing or 0-byte files. Saint Graphs (`512×724`), skill icons, bordered faces/CEs (`142×155`), and event shop icons (`≤160px`) encode as WebP with `method=6` (`lossless=True` for lossless assets).
- **CI & local verification**:
  - `npm run data:validate` (`scripts/validate_data.js`) checks trait sorting, 16-int `bond_growth.js` tables, `servant_info` schema/no-external-URL invariants, and image existence.
  - `npm run check:build` (`scripts/check_build_output.js` against `scripts/build_baseline.json`) asserts chunk names, 25% byte floors, 3× byte ceilings, `<head>` marker order, raw vs normalised visible-text SHAs, and `.cefilter-subpanel` CSS rules.
  - `self-test` job runs 7 public Python suites (`test_check_data_version.py`, `test_deploy_workflow.py`, `test_drift.py`, `test_sync_event_shop.py`, `test_sync_event_shop_adversarial.py`, `test_image_webp_lossless.py`, `test_repro_action_versions.py`).

## See Also

- [[atlas-academy-fetch-reference|Atlas Academy Fetch Reference]] ([Atlas Academy Fetch Reference](../references/atlas-academy-fetch-reference.md)) — endpoints, `sync_atlas_data.py` CLI flags, and asset naming rules
- [[data-schemas-and-traits|Data Schemas and Traits]] ([Data Schemas and Traits](../references/data-schemas-and-traits.md)) — generated JS/JSON shapes validated by `validate_data.js`
- [[architecture-and-bundling|Architecture and Bundling]] ([Architecture and Bundling](../concepts/architecture-and-bundling.md)) — Astro build chunks and `check_build_output.js` context

## Sources

- [Data Schemas and Trait Rules](../../raw/notes/2026-11-24-legacy-data-rules.md) — zero-commit directories, settled cache, and image encoding rules
- [Atlas Academy Data Fetch and Sync Guideline](../../raw/notes/2026-11-24-legacy-fetch-data-guideline.md) — rate limiter, ETag sync, and event shop sync pipeline
- [CLAUDE.md Project Guide](../../raw/notes/2026-11-24-legacy-claude-md.md) — CI workflow gates, cache IDs, and Python self-test suite list
- [Archive Plan: Atlas Data Version Gate](../../raw/notes/archive/2026-10-20-atlas-version-gate.md) — original `/info` gate design and fail-open contract
- [Archive Plan: CI Comments Fix and Data-File Drift Path](../../raw/notes/archive/2026-10-20-ci-drift-path-and-comments.md) — decision to keep full regeneration over incremental CI drift caching
- [Archive Plan: JP+NA Version Gate](../../raw/notes/archive/2026-10-20-jp-na-version-gate.md) — extension of `/info` check to both JP and NA hashes
- [Archive Plan: Atlas Baseline Cache Fix](../../raw/notes/archive/2026-10-21-atlas-baseline-cache-fix.md) — root cause of exact-key cache freeze and `.ci-baselines/` fix
- [Plan: Fixed-Slot Atlas Data-Poll Schedule](../../raw/notes/plans/2026-11-11-atlas-cron-slots.md) — rationale and UTC/ICT/JST mapping for `10 9,11,15,19 * * *`
