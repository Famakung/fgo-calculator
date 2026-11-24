---
title: "Atlas Academy Fetch Reference"
category: reference
sources:
  - raw/notes/2026-11-24-legacy-fetch-data-guideline.md
  - raw/notes/2026-11-24-legacy-claude-md.md
created: 2026-11-24
updated: 2026-11-24
tags: [atlas-academy, api-reference, sync-cli, asset-fetching, localization]
aliases: [Atlas Academy API, sync_atlas_data.py CLI, Asset Fetch Rules]
confidence: high
volatility: warm
summary: "Synthesized reference for Atlas Academy API endpoints, scripts/sync_atlas_data.py CLI flags, dual-region localization chains, ID-to-asset URL conventions, and event shop/icon fetching rules without raw ID table bloat."
---

# Atlas Academy Fetch Reference

> `scripts/sync_atlas_data.py` automates all game-data and image synchronization from Atlas Academy (`api.atlasacademy.io` / `static.atlasacademy.io`) using ETag caching, `PoliteRateLimiter` pacing (0.1s delay, ~8 req/s), and bordered-first WebP conversion.

## Sync CLI Commands and Flags

Invoke via `npm run data:sync -- [flags]` (or directly with `python3 -u scripts/sync_atlas_data.py`):

| Flag / Command | Effect |
|----------------|--------|
| `npm run data:sync` | Full sync: servants, bond growth, CEs, traits, event shops, `servant_info` JSON, faces, Saint Graphs, and skill icons |
| `--dry-run` | Probe Atlas Academy for updates without writing files |
| `--skip-servants` | Skip servant and `bond_growth.js` regeneration |
| `--skip-ces` | Skip Craft Essence sync |
| `--skip-traits` | Skip `traits.js` generation |
| `--skip-event-shop` | Skip `event_shop.js` and `public/event_shop/` icon sync |
| `--event-id N` | Override active-window and farmability filters to sync one specific event ID |
| `--skip-faces` / `--skip-saint-graphs` / `--skip-skill-icons` | Skip individual WebP image sync passes |
| `--force` | Bypass ETag and `_read_settled_cache()` shortcuts |
| `--clean-cache` | Wipe `.cache/atlas/` locally |
| `python3 scripts/fetch_bordered_ces.py` | Dedicated batch downloader/converter for bordered CE icons (`sync_atlas_data.py` imports it inside `try`) |
| `npm run data:validate` | Verify trait formatting/sorting, 16-step bond tables, `servant_info` schema, and local image existence |

## Atlas Academy API Endpoints

All JSON fetches route through `get_cached_json` with conditional `ETag` / `If-None-Match` headers (`304 Not Modified` avoids re-downloading payloads):

| Domain | Endpoint (`https://api.atlasacademy.io/...`) | Usage |
|--------|----------------------------------------------|-------|
| **Version gate** | `GET /info` | Returns ~230-byte JSON with `JP.hash` and `NA.hash` for CI short-circuiting |
| **Servants & Bond** | `GET /export/JP/nice_servant_lore_lang_en.json` | Bulk playable servants (`type` in `normal`, `heroine`), `bondGrowth`, `traitAdd`, `ascensionAdd`, skills/NPs, and `profile.costume` |
| **Single Servant** | `GET /nice/JP/svt/{long_id}?lore=false&lang=en` | Ad-hoc manual inspection of `traits`, `ascensionAdd`, `traitAdd`, and `costumes` |
| **Inner Skills** | `GET /nice/JP/skill/{id}?lang=en` | On-demand fetch (cached in `.cache/atlas/inner_skills.json`) for nested `Apply a state` skill triggers absent from servant payloads |
| **Traits & CEs** | `GET /export/NA/nice_trait.json`, `nice_equip_lang_en.json`, `export/NA/basic_equip.json` | Trait labels, NA CE skill brackets, full CE ingestion, and NA official CE names |
| **Event List & Shop** | `GET /export/JP/basic_event.json`, `GET /nice/JP/event/{id}?lang=en` | Active `eventQuest` selection (`startedAt <= now < finishedAt`), `shop` array, and `warIds` |
| **Items & Equips** | `GET /export/JP/nice_item.json`, `nice_item_lang_en.json`, `NA/nice_item.json`, `GET /nice/JP/equip/{id}?lang=en` | Item metadata (`item.icon`, e.g., `JP/Coins/`) and per-ID CE faces (`faces.equip` fallback `faces.ascension`) |
| **Wars & Drops** | `GET /nice/JP/war/{warId}?lang=en`, `GET /nice/JP/quest/{id}/{phase}?lang=en` | Repeatable quests (`afterClear` `repeatLast`\|`repeat`), `consume` AP, `recommendLv`, and community `drops` (`dropExpected`, `num`, `runs`) |

## Localization, Selection, and Outage Rules

- **Dual-region naming**: Unreleased JP CEs keep custom/EN-translated names until NA releases them in `export/NA/basic_equip.json`. Event shop items resolve names across **NA -> Atlas JP-EN -> JP original** (`resolve_item_name`).
- **Event selection (Amendment J)**: A **farmable event** must have a non-empty `shop` and at least one repeatable quest in its wars reporting community drops for a shop currency (event points and QP are excluded). Open passes retain **all** active farmable events (`startedAt` desc); if none are active, a fallback scans up to the 30 newest `eventQuest` entries and ships the first farmable historical event. War/quest reads are memoized once per sync run.
- **Event outage policy**: Individual event failures skip only that event; total failure preserves any existing `event_shop.js` file; on a fresh clone with total failure, a `{ events: [] }` stub is written so builds never break.

## ID Derivation and Static Asset Conventions

- **Servant IDs & stages**: Each servant has a 3-digit in-game `collectionNo` (`Short ID`, e.g., `388`) and an Atlas `id` (`Long ID`, e.g., `1101600`). Stripping the trailing `00` yields `{base}` (`11016`) for face URLs `https://static.atlasacademy.io/JP/Faces/f_{base}{asc}_bordered.png` (`000`–`003` for ascensions; `300`/costume key for Spiritron Dresses). Flat-file portraits are removed when upgraded to multi-ascension directories (`servants/{atlasId}/{stage}.webp`).
- **Costume shop icons**: Because Atlas returns 404 on direct costume endpoints, `costumeRelease` resolves `servantId = target // 100`, inspects `costumeMaterials` keys (disambiguating multiple keys via lore `profile.costume` where `id == target % 100`), and downloads `JP/Faces/f_{detailId}0.png` (falling back to base face with a warning).
- **Bordered-first & lossless WebP**: Face and CE fetchers request `_bordered.png` first and fall back to plain `.png` only on `"HTTP Error 404"` (phrase-gated so IDs containing `404` like `f_9404xxx` never false-trigger). Non-404 errors abort cleanly. Faces/CEs save as `142×155` WebP; Saint Graphs (`512×724`), skill icons, and event icons (`≤160px`) use `lossless=True, method=6`.
- **Committed UI icons (`public/icons/`)**:
  - Bond icon: `icons/bond_icon.webp` (`JP/SkillIcons/skill_00205.png`, rendered at `16px`/`24px`)
  - Stargazer's Teapot: `icons/teapot.webp` (`JP/Items/94065901_bordered.png`, `142×155` rendered at `48px`)
  - Golden Fruit: `icons/100_bordered.webp` (`JP/Items/100_bordered.png`, rendered at `48px`)
  - Class icons (`15` classes): `icons/classes/{class}.webp` (`JP/ClassIcons/class3_{1..11,23,25,28,33}.png`, resized to `64×64` for 2× Retina `32×32` display)

## See Also

- [[zero-commit-data-pipeline|Zero-Commit Data Pipeline]] ([Zero-Commit Data Pipeline](../concepts/zero-commit-data-pipeline.md)) — CI gates, `.ci-baselines/`, cron schedule, and cache splitting
- [[data-schemas-and-traits|Data Schemas and Traits]] ([Data Schemas and Traits](../references/data-schemas-and-traits.md)) — output schemas for `SERVANT_DATA`, `CE_DATA`, `bond_growth.js`, and `EVENT_SHOP_DATA`
- [[servant-info-system|Servant Info System]] ([Servant Info System](../topics/servant-info-system.md)) — static `servant_info` converter (`export_servant_info.py`) rules

## Sources

- [Atlas Academy Data Fetch and Sync Guideline](../../raw/notes/2026-11-24-legacy-fetch-data-guideline.md) — endpoints, CLI flags, `traitAdd`, icon URLs, and event shop sync contract
- [CLAUDE.md Project Guide](../../raw/notes/2026-11-24-legacy-claude-md.md) — CI workflow integration, settled cache behavior, and validation scripts
