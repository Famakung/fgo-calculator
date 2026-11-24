---
title: "Event Shop Calculator"
category: topic
sources:
  - raw/notes/2026-11-24-legacy-claude-md.md
  - raw/notes/2026-11-24-legacy-data-rules.md
  - raw/notes/2026-11-24-legacy-fetch-data-guideline.md
  - raw/notes/plans/2026-11-11-event-shop-planner.md
  - raw/notes/plans/2026-11-12-event-shop-results-reorder.md
created: 2026-11-24
updated: 2026-11-24
tags: [event-shop, event-planner, bonus-ces, optimizer, atlas-sync]
aliases: [Event Shop Calculator, EventPlanner, Best Farm Runs, EVENT_SHOP_DATA]
confidence: high
volatility: warm
summary: "Documents the lazy-loaded Event Shop Calculator, covering Atlas Academy shop/quest/bonus-CE synchronization, farm-event selection and settled caching, per-event EventPlanner state and modal configuration, CE-aware minimum-play and minimum-cover trade optimization, and the Best Farm Runs results card overhaul (Amendments R1–R30)."
---

# Event Shop Calculator

> The **Event Shop Calculator** (`#panel-event`, lazy-loaded via `src/scripts/event-lazy.js`) combines live Atlas Academy event shop snapshots (`EVENT_SHOP_DATA`) with per-event planning (`EventPlanner`), a draft item-requirement modal (`#eventShopModal`), a Bonus CE grid (`#bonusCeGrid`), and a branch-and-bound quest/CE optimizer (`EventShop.farmPlan()`). When no farmable events exist, it falls back cleanly to a legacy tier calculator (`showLegacyCard()`).

## Modules & Zero-CLS Shell

- **Controllers & Pure Helpers**: `event-shop.js` (`UIBuilder`, `ViewManager`, `EventHandler`, `App`), `event-shop-tier.js` (event currency skins + read-only `Required` displays), `event-shop-ce.js` (`#bonusCeGrid` 3★/4★/5★ column-aligned LB/NLB counts + `#ceBonusEquipInput` `1–6`), `event-shop-modal.js` (`EventShopModal` per-currency draft modal with Default/Select All/Cancel/OK and no backdrop dismissal), `event-shop-farm.js` (`Drop Rates per Run` cards), `event-shop-farm-lines.js` (primary/secondary drop lines + `.drop-icon-count`), `event-shop-farm-controls.js` (unmapped `Held` inputs), `event-shop-farm-results.js` (`Best Farm Runs` card), `event-shop-farm-names.js` (single-line continuous marquee sliding names), and `event-planner.js` / `event-planner-state.js` / `event-planner-parts.js` (state isolation, migration, draft row builders).
- **Zero-CLS Hydration**: `index.astro` pre-renders a `.farm-card--pre` skeleton (3 currency cards + `.farm-card--pre-combo`) inside `#farmGrid`; `BaseLayout.astro` `<head>` resolves `html[data-event-combo="1"]` synchronously from saved/default `eventIds` / `comboEventIds` and hides legacy `.base-row` / `#questDropsGrid` until `showLegacyCard()` runs.
- **Per-Event Persistence (`fgo_event_shop_data`)**: Stores `{ selectedEventId, plans: { [eventId]: { requires, held, bonus, farmQuest, currencyQuest, ceOwned, ceEquipLimit } } }` (`ceEquipLimit` defaults to `6`, `1–6`). Legacy `{ eventId, requires }` blobs migrate automatically. Pruned events retain their saved plans (`retiredPlans`) across rotations and restore if re-listed. `#eventShopModal` (`EventPlanner.applyRequires`) is the sole `requires` mutation surface; dropdown changes call `ViewManager.resetResults()` rather than auto-calculating.

## `EVENT_SHOP_DATA` & Atlas Sync (`sync_event_shop`)

Step 3 of `scripts/sync_atlas_data.py` (`--skip-event-shop`, `--event-id N`) produces `src/scripts/data/event_shop.js` and `public/event_shop/{kind}_{id}.webp` (lossless WebP; item icons capped at 160px, CE/costume faces `142×155`; bordered-first, plain fallback only on `"HTTP Error 404"`):

- **Endpoints & Naming**: Queries `basic_event.json`, `nice/JP/event/{id}?lang=en` (`shop`), `nice_item` (NA → JP-EN → JP via `resolve_item_name`, always using `item.icon`), `nice/JP/equip/{id}?lang=en` (`_collect_bonus_ces()` / `_equip_event_bonuses()` scanning `eventDropUp` `AddCount`), `nice/JP/war/{warId}?lang=en` (`afterClear` `repeatLast|repeat`), and `nice/JP/quest/{id}/{phase}?lang=en` (community `drops`: `dropExpected` stacks/run × `num` stack size; event points and QP excluded because they are not shop currencies). Costume icons resolve via `servantId = target // 100` → `costumeMaterials` (or `nice_servant_lore_lang_en.json` `profile.costume` when multiple keys exist).
- **Farm-Event Pruning (Amendment J)**: Keeps **all** active `eventQuest` entries whose shop is non-empty AND ≥1 repeatable war quest reports community drops for ≥1 shop currency (pruning campaign exchanges without wars and memorial battles without drop submissions). With 0 active farm events, scans newest-first (cap 30) and ships the latest past farm event alone; total failure or empty scan falls back to `{ events: [] }` (existing file preserved on transient outage).
- **Settled Cache & CI Shop Probe**: Settled ended events (`finishedAt + 7 days < now`, `_is_settled_ended_event`) read on-disk cache via `_read_settled_cache()` with zero HTTP calls (`--force` bypasses); non-JP `basic_event.json` lists fetch concurrently. Writes `.ci-baselines/shop_probe.json` (`nextTransitionAt` + quest drop ETags) for `check_data_version.py --check-shop`.

## Farm & Bonus CE Optimization (`EventShop`)

`EventShop.farmPlan()` and `bestCeFarmPlan()` in `src/scripts/domain.js` jointly optimize quest run counts, per-quest owned LB/NLB CE combos (`buildQuestParetoCombos`, `solveCeBranchAndBound`, bounded by `ceEquipLimit`), and minimum shop trades:

- **Per-Run Formula**: `perRun = dropExpected * (num + flatBonus + ceBonus)`. On Drop Rates cards, `buildSecondaryDropLine()` renders the selected quest's next-best shop-currency drop (`dropExpected * num`, tie → lower `currencyId`).
- **Minimum-Cover Trades (Amendment R22)**: The minimum-play search ranks full-cascade surplus (`cascadeSurplus`) to preserve optimal play vectors, while `finishFarmPlan()` computes `minCoverTrades(rawYields, deficits, chain)` (integer micro-units) so **Shop Trades** prints only the minimum trades needed to cover downstream deficits rather than converting all low-tier surplus.
- **Over-Farm Fix (Amendment R30)**: Fixed an exact/greedy search-space split where a dominated per-currency quest pick locked out the best-rate fallback quest inside `exactPool` (`selectedFarmers` → `usableFarmer(poolSet)`, `exactPool` → `keyCandidates`/`hasSelection`), restoring optimal minimums (e.g., 270 → 240 runs).

## Results Card Design & Amendments (R1–R30)

`src/scripts/event-shop-farm-results.js` renders `#results .results-card` in the owner-approved order (replacing legacy Required/Get/✓/+surplus displays and dropping the `Total: N plays` footer and section border lines per R7):

1. **Title**: `"Best Farm Runs"` with `.card-title` only (no `.farm-stat` class, matching sibling `.card-title` typography `0.8rem` `system-ui`).
2. **Quests to Play** (`.farm-res-quests`, R6): Neutral `.farm-card` tiles (`data-tier`, neutral `--bg`/`--border` across the entire Event Shop tab per R28/R28b) with `64px` `.farm-card-icon` headers, single-line quest names, optional `REC Lv.`, `.farm-res-ce-list` (`LB ×N`/`NLB ×N` chips), and aligned run counts (`.farm-res-quests:has(.farm-res-ce-list) .farm-res-play-count { margin-top: 0; }` overrides `margin-top: auto` when CE chips vary in height).
3. **Item Receive** (`.farm-res-receive`, R3/R4a/R5a/R14/R19): One `320px` `.farm-res-receive-card` holding one centered row of `96px` currency art (`aspect-ratio: 142 / 155` matched to avoid letterboxing) with whole-unit raw quest drop counts (`×4,168`, `1rem` mono with 4-way white shadow, pinned `right: 7px; bottom: 14px` inside the bordered ring). Prints `result.farmed` (pre-trade drops), never `result.yields`.
4. **Shop Trades** (`.farm-res-trades`, R17/R18/R19): Per-trade neutral `.farm-card` tiles with `64px` from→to icons carrying inset ratio overlays (`10`, `1`; `margin-right: 3px; margin-bottom: 7px`), no header separator bar, and plain numeric trade count + `trades` label.
5. **Sliding Names (R25–R29)**: `event-shop-farm-names.js` converts overflowing quest names and `.material-name` labels into a continuous one-direction marquee (`translateX(0)` → `translateX(-50%)`, duplicated `aria-hidden` track + 24px gap, `2s + 0.05s/px`, disabled under `prefers-reduced-motion`). A `ResizeObserver` on `#panel-event` plus a single debounced window `resize` listener triggers re-measurement on first tab reveal.

## See Also

- [[zero-commit-data-pipeline|Zero-Commit Data Pipeline]] ([Zero-Commit Data Pipeline](../concepts/zero-commit-data-pipeline.md)) — CI shop probe, asset caching, and `validate_data.js`
- [[atlas-academy-fetch-reference|Atlas Academy Fetch Reference]] ([Atlas Academy Fetch Reference](../references/atlas-academy-fetch-reference.md)) — Atlas API endpoints and `sync_atlas_data.py` CLI flags
- [[project-history-and-decisions|Project History and Decisions]] ([Project History and Decisions](../topics/project-history-and-decisions.md)) — chronological record of Amendments A–K and R1–R30

## Sources

- [CLAUDE.md Project Guide](../../raw/notes/2026-11-24-legacy-claude-md.md) — Event Shop modules, Bonus CE grid, and zero-CLS pre-render summary
- [Data Schemas and Trait Rules](../../raw/notes/2026-11-24-legacy-data-rules.md) — `EVENT_SHOP_DATA` schema, Amendment J selection, and plan state
- [Atlas Academy Data Fetch and Sync Guideline](../../raw/notes/2026-11-24-legacy-fetch-data-guideline.md) — `sync_event_shop()` endpoints, costume resolution, and icon rules
- [Event Shop Planner — Frozen Implementation Plan](../../raw/notes/plans/2026-11-11-event-shop-planner.md) — frozen planner implementation plan, Atlas JP shop sync, `EVENT_SHOP_DATA` contract, UI parts, and QA gates
- [Plan: Event Shop Results Card Reorder and Item Receive](../../raw/notes/plans/2026-11-12-event-shop-results-reorder.md) — frozen domain/UI contracts, acceptance criteria, and Amendments R1–R30
