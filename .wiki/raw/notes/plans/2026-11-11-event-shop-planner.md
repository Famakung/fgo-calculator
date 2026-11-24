---
title: "Event Shop Planner — Frozen Implementation Plan"
source: "migrated from .plans/event-shop-planner.plan.md"
type: notes
ingested: 2026-11-24
tags: [event-shop, planner, atlas-academy, plan]
summary: "Frozen implementation plan for the Event Shop Planner covering Atlas Academy JP shop sync, 3-layer architecture, generated EVENT_SHOP_DATA contract, UI components, and QA gates."
---

# Event Shop Planner — frozen plan (lead: contracts here are law)

Repo: /home/famakung/dev/fgo-calculator (MAIN checkout; never /mnt/storage). Branch: feat/event-shop-planner (from develop).
Style: ultracave + ponytail ultra for prose only. Code/docs/comments normal English. House rules in AGENTS.md + .claude/docs/* bind every agent.

## Goal

Auto-fetch the current JP event shop from Atlas Academy at data-sync time, save item icons (WebP) + a generated data module, and add an "Event Shop" planner card to the Event tab: every shop item gets a configurable **Require** (purchases wanted), live per-currency totals. Existing tier/run calculator stays untouched.

## Verified API facts (probed live 2026-11-11)

- `GET https://api.atlasacademy.io/export/JP/basic_event.json` — 335 KB, all events. Auto-pick: type=="eventQuest" with max startedAt → today id 80639 (ぐだぐだぷにぷにウォーズ！, active).
- `GET https://api.atlasacademy.io/nice/JP/event/80639?lang=en` — `shop` array, 55 entries, all slot 1 (DB "shop-1" = slot 1 = whole shop). 3 currencies: 94164002 YAKIまんじゅう (gold, 19 items), 94164001 SHIMONITAネギ (silver, 17), 94164000 MISOおでん (bronze, 19). `?lang=en` falls back to JP names when untranslated (this event: JP).
- Entry fields: id, name, purchaseType ("item" | "servant" | "costumeRelease" | ...), cost.item (embedded full item: id/name/icon/background), cost.amount, limitNum (0 = unlimited), setNum (units per purchase, e.g. coins ×10), targetIds, priority, slot.
- purchaseType "item": targetIds[0] = item id. `GET /export/JP/nice_item.json` (1.24 MB) → id→{name, icon}. Icons NOT always Items/{id}.png (coins: JP/Coins/705500.png) — always use item.icon.
- purchaseType "servant" with equip target (event CE): `GET /nice/JP/equip/9409690?lang=en` → name, rarity, face = extraAssets.faces.equip first value (f_94096900.png). Fetch PER ID (cached), NOT the 22 MB equip export.
- purchaseType "costumeRelease": target 20470011 → servantId = floor(target/100) = 204700 (高杉晋作). Costume endpoints 404/{} — use servant face `https://static.atlasacademy.io/JP/Faces/f_2047000.png` (verified 200). Display name = shop entry name.
- Currency icons: cost.item.icon (Items/{id}.png).
- DB planner semantics (atlasacademy/apps Shop.tsx): total = Σ count×cost.amount per cost.item.id; "clear" count = limitNum (unlimited items contribute 0).

## Architecture (3-layer house pattern)

Sync (Python, build-time) → generated data module → domain (pure) → app (state/persist) → view (DOM). No runtime network. Zero external resources at runtime (security.md). All images local WebP. No innerHTML ever. No vh units. CSS only in BaseLayout.astro inline `<style>`.

## File plan + ownership

Builder (clean-code-builder):
1. scripts/sync_atlas_data.py — add sync_event_shop() + helpers; flags --skip-event-shop, --event-id; wire into main() after CE step.
2. scripts/ensure_data.js — requiredFiles += src/scripts/data/event_shop.js.
3. scripts/validate_data.js — EVENT_SHOP_DATA validation block.
4. .github/workflows/deploy.yml — cache path += public/event_shop/; data-hash cat += src/scripts/data/event_shop.js; self-test run += python3 scripts/test_sync_event_shop.py.
5. .gitignore — public/event_shop/ + !public/event_shop/.gitkeep (data/*.js already ignored).
6. public/event_shop/.gitkeep — new tracked empty file.
7. src/scripts/constants.js — EVENT_SHOP_STORAGE_KEY = "fgo_event_shop_data".
8. src/scripts/domain.js — Schema.shopRequire + EventShop object (below).
9. src/scripts/event-planner.js — app: state, persistence, handlers (below).
10. src/scripts/event-lazy.js — initEvent() also calls EventPlanner.init().
11. tests/event-shop.test.js — node --test domain tests.
12. scripts/test_sync_event_shop.py — offline unittest-style sync tests (run: python3 scripts/test_sync_event_shop.py).
13. Run sync → generate src/scripts/data/event_shop.js + public/event_shop/*.webp (gitignored outputs).

Designer (frontend-ux-designer):
14. src/scripts/event-planner-view.js — EventPlannerView (contract below). AMENDED round 1: pure DOM builders (buildInfo/stepButton/buildStepper/createFilterChip/buildFilters/buildActions/buildRow/buildGroup) live in src/scripts/event-planner-parts.js; event-planner-view.js keeps the 4 public functions + setText + imports from parts. Both files ≤200 lines. Public import path unchanged (event-planner.js imports ./event-planner-view.js).
15. src/pages/index.astro — planner card shell, FIRST card inside #panel-event (markup below).
16. src/layouts/BaseLayout.astro — .eshop-* rules appended to the single inline <style> block.

QA (software-qa):
17. scripts/test_event_shop.js — puppeteer browser gate, URL arg default http://localhost:4173/fgo-calculator/ (spare port; NEVER 3000 — owner may watch it). Pin in repo.

Lead (Step 6 docs): README.md, .claude/docs/structure.md, data-rules.md, code-style.md, progress.md (append), fetch-data-guideline.md. Delegated to builder with exact text: AGENTS.md layout-map row, .claude/CLAUDE.md module list lines.

Baseline: scripts/build_baseline.json re-captured via `node scripts/check_build_output.js --write` AFTER build, only when assertions pass and only drift differs (new card text + event-lazy growth are expected drift). Never hand-edit assertions.

## Contract: generated data (src/scripts/data/event_shop.js)

```js
export const EVENT_SHOP_DATA = {
  event: { id: 80639, name: "…", shortName: "…", startedAt: 1794394800, endedAt: 1796183999 },
  currencies: [{ id: 94164002, name: "YAKIまんじゅう", background: "gold", icon: "event_shop/item_94164002.webp" }],
  items: [{ id: 80639001, name: "霊衣「夏の奇兵隊」開放権", purchaseType: "costumeRelease",
            cost: { itemId: 94164002, amount: 150 }, limitNum: 1, setNum: 1, priority: 1,
            icon: "event_shop/costume_20470011.webp" }],
};
```
- currencies sorted id asc; items sorted (priority, id). icon = site-relative path, no leading slash; null when unresolved. background ∈ gold|silver|bronze (default "silver" when absent).
- Slim: NO detail/infoMessage/warningMessage/timestamps per item. Event window only.
- Outage/empty stub: `{ event: null, currencies: [], items: [] }` — sync catches fetch failure: keep existing file if present, else write stub. Build must never die on event-API outage.
- Icon files: public/event_shop/{kind}_{id}.webp — kind: item (items + currencies), equip (CE faces), costume (servant face for costumeRelease). PIL RGBA → WebP lossless method=6. Faces (equip/costume) resized 142×155 LANCZOS; item icons native size, capped 160×160 if larger. Skip existing unless --force. Unique URLs downloaded once.
- USER DIRECTIVE 2026-11-11: every icon fetch uses the bordered variant first — resolve URL, then try `{base}_bordered.png` before `{base}.png` (house download_face_icon candidate pattern). Probed: Items/94164002_bordered.png 200, Items/6503_bordered.png 200, Faces/f_94096900_bordered.png 200, Faces/f_2047000_bordered.png 200; Coins/705500_bordered.png 404 (coins have NO bordered asset) → plain-URL fallback on 404 only. Never silently skip an icon; fallback is the plain variant of the SAME url, not a different asset.
- Sync resolution: item → nice_item map icon; servant|equip → per-id cached nice equip face, fallback icon null; costumeRelease → servant face URL pattern; other types → icon null, name kept.
- pick_event(basic_events, override_id): override wins; else eventQuest max startedAt; none → stub + WARN.
- get_cached_json filenames: "basic_event.json", f"nice_event_{id}.json", "nice_item.json", f"nice_equip_{tid}.json". Reuse fetch_url/get_cached_json/rate_limiter/STATIC_BASE. main(): step 3 unless --skip-event-shop.

## Contract: domain (domain.js additions)

```js
Schema.shopRequire = { min: 0, max: 999999, default: 0 };
export const EventShop = {
  maxRequire(item),                  // item.limitNum > 0 ? item.limitNum : Schema.shopRequire.max
  clampRequire(item, value),         // Math.floor(Validator.clamp(value, 0, maxRequire(item)))
  rowCost(item, require),            // require * item.cost.amount
  totals(items, requires),           // { [currencyId]: Σ rowCost } for every currency present in items (0 included)
  clearRequires(items),              // { [item.id]: item.limitNum }  (unlimited → 0)
  sanitizeRequires(saved, items, currentEventId),
  // saved = { eventId, requires } from storage; eventId !== currentEventId → {};
  // unknown item ids dropped; values clampRequire'd; returns plain { [itemId]: count }
};
```
Pure, no DOM. requires keys = String(item.id).

## Contract: app (event-planner.js)

```js
export const EventPlanner = {
  state: { eventId, requires: {}, filter: "all" },
  init(),   // load EVENT_SHOP_DATA + sanitize storage → render → bind; idempotent (_initialized guard, house BondApp pattern)
};
```
- Storage: localStorage EVENT_SHOP_STORAGE_KEY, value { eventId: number, requires: { [itemId]: count } }. Write on every mutation. Load: JSON.parse in try/catch → EventShop.sanitizeRequires; event null → requires {}.
- handlers passed to view: onRequire(itemId, rawValue) → clamp → state → updateTotals → persist; onStep(itemId, ±1) → clamp(current±1) → syncInputs + updateTotals → persist; onBuyAll() → requires = clearRequires → syncInputs + updateTotals → persist; onClear() → all 0 → same; onFilter(key) → state.filter → renderList (summary/controls untouched).
- Input events debounced DEBOUNCE_MS (100) for totals+persist; clamp applied to state immediately. Never rebuild rows while typing (focus loss). Filter change rebuilds list only.
- filter: "all" | String(currencyId). Not persisted (house: filters reset).

## Contract: view (event-planner-view.js)

```js
export const EventPlannerView = {
  render(card, data, state, handlers),      // full: name/window, summary chips, controls, list
  renderList(card, data, state, handlers),  // groups + rows only
  updateTotals(card, data, state),          // patch: row subtotals, active classes, group totals, summary chips; NO input.value writes
  syncInputs(card, state),                  // input.value = state.requires per row
};
```
- card = #eventPlannerCard element. Query by data attributes, cache nothing across renders.
- Empty data (event null or items []): .eshop-empty message "No event shop data yet — run npm run data:sync."; hide controls/summary; name "Event Shop".
- Groups: filter "all" → one .eshop-group per currency (data-currency), header = currency icon + name + .eshop-group-total; single filter → that group only, no header redundancy (header kept, shows total).
- Row: icon (DOMFactory.createLazyImg, src = icon + "?v=" + IMAGE_VERSION, fallback via DOMFactory.addSimpleFallback, alt = name), .eshop-item-name (textContent), .eshop-item-meta = "{currencyName} ×{amount}" + " · Limit {limitNum}" or " · Unlimited" + (setNum > 1 ? " · ×{setNum} per buy" : ""), stepper (− input +), .eshop-item-total = rowCost formatted with toLocaleString("en-US").
- Summary chip per currency: data-tier = background (reuses existing tier color tokens), icon + name + ×total (tabular-nums). role="status" on #eventPlannerSummary.
- Filter chips: All + one per currency; aria-pressed; active class eshop-filter-chip--active.
- Buttons #eventPlannerBuyAll ("Buy all"), #eventPlannerClear ("Clear"), type="button".
- Input: type="number", min 0, max maxRequire(item), class eshop-require-input, data-item-id, aria-label = item.name + " require". Stepper buttons aria-label "Decrease/Increase {name}", data-step.
- Row active class eshop-item--active when require > 0.
- createElement/textContent/setAttribute only. DocumentFragment → replaceChildren per render.

## Contract: markup (index.astro, first card in #panel-event)

```html
<div class="card" id="eventPlannerCard">
  <div class="card-inner">
    <div class="card-title">Event Shop</div>
    <div class="eshop-event-name" id="eventPlannerEventName"></div>
    <div class="eshop-window" id="eventPlannerWindow"></div>
    <div class="eshop-summary" id="eventPlannerSummary" role="status"></div>
    <div class="eshop-controls" id="eventPlannerControls"></div>
    <div class="eshop-list" id="eventPlannerList"></div>
  </div>
</div>
```
Window text: Intl.DateTimeFormat("en", { dateStyle: "medium" }) range from event.startedAt/endedAt (UTC+9 display: format with timeZone "Asia/Tokyo"). Event name: event.shortName || event.name, newlines → spaces.

## Design direction (designer)

House language: light cards, indigo --accent, tier colors via data-tier tokens (gold/silver/bronze already defined). Planner reads like the in-game exchange shop: currency chips up top with live totals, grouped item rows, 48px icons, steppers with ≥44px tap targets (::before extension, house pattern), tabular-nums everywhere a number moves. Active rows tinted --accent-light + 2px accent left border. Hover only inside @media (hover: hover); :active after. Breakpoints 580/760/940/1120: mobile row = icon + info stacked over full-width stepper; ≥760px single-line row (icon | info | stepper | subtotal). No new fonts, no vh, no gradients outside existing tokens. Scrollbar: list is page-flow (no inner scroll) — nothing to style. Subtle transition on totals/active tint (0.15s ease, house). prefers-reduced-motion respected.

## Acceptance criteria (Given/When/Then)

1. Given main checkout, when `python3 scripts/sync_atlas_data.py --skip-servants --skip-ces --skip-traits`, then event_shop.js has event.id 80639, 3 currencies, 55 items; ≥45 WebP icons in public/event_shop/; CE entry icon = equip_9409690.webp; costume entry icon = costume_20470011.webp; coin entries resolve via nice_item map.
2. Given a limited item (limitNum N), when Require typed > N or via +, then clamped to N; unlimited item accepts up to 999999.
3. Given requires {80639005: 14} (coin, cost 10 YAKI), then YAKI total includes 140; multi-currency totals exact Σ require×amount.
4. Given Buy all, then every limited item require = limitNum, unlimited = 0; totals = Σ limitNum×amount. Clear → all 0, totals 0.
5. Given saved requires, when reload, then restored; when data event.id differs from saved eventId, then requires reset {}.
6. Given NaN/negative/fraction/unknown-id storage input, then sanitize drops/clamps; no crash.
7. Given stub data (event null), then empty-state message, no console errors.
8. Existing behavior unchanged: npm run test (all existing suites), lint, build, check:build (after baseline re-capture), data:validate green. Tier calculator inputs/calculate untouched.
9. Browser gate (scripts/test_event_shop.js) green against preview on port 4173: rows render, icons naturalWidth > 0 (sample), stepper clamp, totals math, buy-all/clear, filter chips, persistence across reload, mobile 360px + desktop 1120px no overflow, zero pageerrors.
10. deploy.yml: test_deploy_workflow.py + test_check_data_version.py + test_drift.py + test_sync_event_shop.py all exit 0.

## Test plan

- tests/event-shop.test.js: ≥15 asserts covering clamp (limit/unlimited/NaN/negative/fraction), rowCost, totals (multi-currency, zero, missing keys), clearRequires, sanitizeRequires (event mismatch, unknown ids, garbage values, non-object).
- scripts/test_sync_event_shop.py: offline fixtures — pick_event (override, latest eventQuest, no quest → None), entry mapping (item/servant-equip/costume/unknown), icon URL resolution, stub on outage, JS output shape (parse via json after stripping export prefix). No network.
- scripts/test_event_shop.js (QA writes): acceptance 2–7, 9 in real browser.

## Doc impact list (Step 6)

- README.md — Event Shop feature bullets + Usage + File Structure + data:sync line. (lead)
- .claude/docs/structure.md — file layout, lazy chunk contents. (lead)
- .claude/docs/data-rules.md — EVENT_SHOP_DATA schema, zero-commit paths, image paths. (lead)
- .claude/docs/code-style.md — planner persistence pattern entry. (lead)
- .claude/docs/progress.md — append dated entry. (lead)
- .claude/docs/fetch-data-guideline.md — event shop endpoints section. (lead)
- AGENTS.md — layout-map application-controllers row += event-planner.js. (delegate builder, exact text at Step 6)
- .claude/CLAUDE.md — lines ~20/29/139/145 Event Shop module mentions. (delegate builder, exact text at Step 6)
- GEMINI.md — no Event Shop content, not stale.

## Amendment A (2026-11-12, user directive) — event-native tier cards + config modal

User: "Shop Requirements" + "Drop Rates per Run" use current event images; Required becomes read-only display; configuration moves to a per-currency modal popup with footer Default / Select All / Cancel / Done (house modal consistency).

Contracts (frozen):
1. domain.js: `EventShop.currencyForTier(currencies, tier)` → currency with background === tier, else null. Pure.
2. Tier cards (event-shop.js): when mapped currency exists — material-icon shows single event image (currency.icon + "?v=" + IMAGE_VERSION, replace bg/fg layers, keep wrapper + data-tier), material-name = currency.name, Required input → READ-ONLY display (class eshop-require-display, aria-haspopup="dialog", click opens modal), value = EventShop.totals(requires)[currency.id]. Held/Bonus inputs unchanged. No mapping (stub/legacy) → today's behavior exactly (generic icons, editable Required).
3. Drop Rates card: quest drop icon spans swap to mapped currency images at runtime (QUEST_DROPS tier mapping unchanged); quest-drops-title = "{currency.name} Quest" when mapped, else legacy. Math/labels/values untouched.
4. Modal #eventShopModal — house .servant-modal pattern, STATIC markup in index.astro (main.js scroll lock binds .servant-modal at DOMContentLoaded): .servant-modal-content > .servant-modal-header (#eventShopModalTitle "{currency.name} — Shop Items" + #eventShopModalClose ✕) > #eventShopModalList (scrolling draft rows: icon, name, meta, Required stepper — reuse parts builders) > .cefilter-modal-footer: left #eventShopModalDefaultBtn "Default" + #eventShopModalSelectAllBtn "Select All"; right #eventShopModalCancelBtn "Cancel" + #eventShopModalDoneBtn "Done" (cefilter-footer-btn--primary). z-index 1000, backdrop/✕/Escape = Cancel.
5. New module src/scripts/event-shop-modal.js — EventShopModal: configure({ itemsOf, requiresOf, onCommit }) callback injection (house BondApp.configure pattern, no circular imports); open(currencyId) builds DRAFT = clone of that currency's requires; Default → draft zeros; Select All → draft = EventShop.clearRequires(items) (unlimited 0); Cancel → discard; Done → onCommit(draft). Draft steppers clamp exactly like planner (EventShop.clampRequire), focus preserved.
6. Planner card conversion: row steppers → read-only .eshop-require-display (click opens same modal); Buy all / Clear buttons REMOVED from card (modal footer is sole mutation surface); filter chips + summary + group totals stay. EventPlanner gains applyRequires(partial) (merge → sanitize → persist → updateTotals + displays); card handlers onRequire/onStep removed, onFilter stays. View keeps 4 function names; syncInputs now writes display text.
7. State: fgo_event_shop_data requires = single source of truth. Event active → tier need recomputed from totals on load AND on Done commit; Persistence legacy shape unchanged; Calculator math unchanged. event-lazy.js wires EventShopModal.configure to EventPlanner; event-shop.js opens modal via EventShopModal.open.
8. Ownership: builder → domain.js, event-shop.js, event-shop-modal.js, event-planner.js, event-lazy.js, tests/event-shop.test.js (+currencyForTier tests). Designer (AFTER view-split lands) → index.astro (Required display markup + modal markup), BaseLayout.astro (display + modal list CSS), event-planner-view.js + event-planner-parts.js (display conversion). QA rewrites scripts/test_event_shop.js pins to new contract (clamp asserts move INTO modal, not weakened; legacy fallback pinned; tier Required = total pinned; event images on both cards pinned). Reviewer round 2 audits round-1 fixes + Amendment A together.
9. Files ≤200 lines each; event-shop-modal.js new; no innerHTML; no vh; hover media house rules.

## Amendment B (2026-11-12, user directive) — card removal + box parity + standalone icons

User: remove the "Event Shop" planner card (modal is the surface); Required box height consistent with Held/Bonus boxes; remove grey background from item icons — display alone with bordered art like other slot displays.

Contracts (frozen):
1. index.astro: #eventPlannerCard block REMOVED entirely. #eventShopModal stays.
2. event-planner.js: EventPlanner keeps state/load/persist/applyRequires/itemsFor ONLY — no view import, no _card, no filter, no render handlers. init() loads storage + data, renders nothing.
3. event-planner-view.js: DELETED. event-planner-parts.js: card-only builders removed (display buildRow, buildGroup, buildFilters, createFilterChip, summary/chip builders); keep the modal draft chain: buildDraftRow, rowShell, buildInfo, buildStepper, icon helpers, fmt, metaText, requireAriaLabel (whatever buildDraftRow actually uses — trace it).
4. Required parity: tier input carries BOTH .material-input-box-field and .eshop-require-display. Redefine .eshop-require-display to NOT override box geometry (drop width/min-height/display/font-size/padding overrides) — keep only dashed border + cursor pointer + hover/focus accent cues. Height then equals Held/Bonus by construction.
5. Standalone icons: .material-icon grey #e5e7eb must not sit behind event art — event-shop-tier.js adds class material-icon--event on hydration; CSS .material-icon--event { background: transparent }. Same audit for .mini-icon (quest drops) if it carries a background. Modal .eshop-item-icon-fallback: drop grey fill (transparent + dashed border badge). Legacy mode (no event) byte-identical: grey stays for generic bg/fg icons.
6. BaseLayout: delete dead card classes (eshop-controls/empty/event-name/filter-chip*/filters/group*/icon-fallback/list/summary*/window, eshop-item--editable, card-row eshop-item variants no longer used); keep modal classes (eshop-modal-list, eshop-item modal row, --active, icon/info/meta/name/stepper/total, require-input, step-btn, require-display redefined).
7. QA gate re-target: card ABSENCE pins (#eventPlannerCard, .eshop-summary, .eshop-filter-chip, .eshop-group must not exist); Required offsetHeight === Held/Bonus offsetHeight per tier; event icon boxes computed background transparent; modal contract unchanged (draft/clamp/footer/commit/persistence/legacy/viewports); mutants; full suite; anchor.
8. Baseline: text sha drift (card text gone) + event-lazy shrink — sanctioned --write after assertions pass. Floor check: event-lazy baseline 28263, floor 7065 — data module stays, expect ~23KB.
9. Docs: README planner-card mentions (lead); structure.md view module line, code-style.md planner bullet, CLAUDE.md planner bullet, progress.md append (delegated).
10. Ownership: builder → index.astro removal, event-planner.js, view deletion, parts prune, event-shop-tier.js class, unit gates. Designer (after builder) → BaseLayout CSS (parity + transparent + dead-rule purge) + dev visual verify. QA → gate re-target. Reviewer → new cycle round 1.

## Amendment C (2026-11-12, user directive) — remove old item mockup

User: "remove old item mockup" = the generic bronze/silver/gold material placeholder art still shipped in static markup. Real event images are the only item art.

Contracts (frozen):
1. index.astro: remove ALL 18 icons/materials imgs (materialsGrid 3×bg+fg, questDropsGrid 6×bg+fg). Containers (.material-icon, .mini-icon spans) stay EMPTY in markup; ids stay (load-bearing). Tier name labels ("Bronze" etc.) + quest titles stay as stub labels — event JS overwrites them.
2. event-shop.js: legacy/stub icon path builds tier-color fallback tiles directly (existing icon-fallback pattern: background TIER_COLORS[tier], capitalize(tier) letter) into the empty containers; REMOVE the bg/fg static-img error-handler code (no static imgs left). Event mode path unchanged. Input ref caching unchanged.
3. event-shop-tier.js: hydration must work against EMPTY containers (verify replaceChildren semantics; adjust only if needed).
4. BaseLayout: purge .bg-layer rules (dead after removal — grep-verify zero live refs); KEEP .fg-layer (event imgs use it) + .icon-fallback.
5. DELETE public/icons/materials/{bronze,silver,gold}_{bg,fg}.webp (6 files) — zero references after the change (grep src/ scripts/ tests/ first; QA gate legacy pins reference them — QA re-targets, that's expected).
6. QA gate re-target: legacy pins → fallback tiles present, ZERO icons/materials requests in either mode (absence pin); event contract unchanged; mutants; full suite; anchor.
7. Baseline: img removal ≠ visible text change → text sha likely stable; event-lazy bytes shift within floor/ceiling; --write only on drift with assertions passing.
8. Docs: README + CLAUDE.md legacy wording "generic icons" → "tier-color fallback badges"; progress.md append (delegated).
9. Ownership: builder → event-shop.js, event-shop-tier.js (if needed), asset deletion, unit gates. Designer (after builder) → index.astro + BaseLayout + dev visual verify. QA → gate re-target. Reviewer → new cycle round 1.

## Amendment D (2026-11-12, user directive) — best-quest farm model

User: "replace bronze silver gold quest with most that item drop quest remove base primary secondary confiable" = per currency, show the quest that drops it MOST (real Atlas community drop data); remove the Base / Primary % / Secondary % configurable inputs (event mode).

Verified farm truth (live API 2026-11-12, /nice/JP/quest/{id}/{phase}.drops): MISO → 94164100 【GUNMA巡り】だるまを買いにいこう 32.14/run, 40 AP, 111 runs; SHIMONITA → 94164101 こんにゃくとネギ 33.61/run, 54 runs; YAKI → 94164102 槍をスキーに連れていけ 32.49/run, 89 runs. drops = community submissions: {type, objectId, num (stack size), dropCount, runs, dropExpected (stacks/run), dropVariance}; amount/run = dropExpected × num.

Contracts (frozen):
1. Sync (sync_event_shop): event.warIds → get_cached_json nice_war_{id}.json (/nice/JP/war/{id}?lang=en) → spots[].quests[] filter afterClear ∈ {repeatLast, repeat} → per quest /nice/JP/quest/{id}/{maxPhase}?lang=en cached nice_quest_{id}_{phase}.json → drops[]. Per shop currency: pick quest maximizing dropExpected×num for that currency id (tie → lower questId); EVENT_SHOP_DATA.farm = { [currencyId]: { questId, questName, recommendLv, ap, dropExpected (stacks/run, 4dp), num (base stack amount), sampleRuns } | null }. No drop submissions → null. Only shop currencies. Outage: keep previous file / stub as today.
2. Domain: EventShop.farmPlan({ totals, held, bonus, farm }) → per currency { deficit: max(0, total−held), perRun: farm ? farm.dropExpected × (farm.num + bonus) : 0, runs: farm && perRun > 0 ? Math.ceil(deficit / perRun) : null, ap: runs != null ? runs × farm.ap : null }. USER CORRECTION 2026-11-12: bonus plusses INTO the base drop amount (per drop stack, in-game drop-CE mechanic) — NOT flat items/run. Example: YAKI dropExpected 10.83, num 3, bonus +3 → 10.83×6 = 64.99/run. Pure, guarded (bonus ≥0 via Schema.tier.Bonus).
3. UI event mode: base-row (#baseDrop/#primaryMultiplier/#secondaryMultiplier) HIDDEN; #questDropsGrid hidden; NEW #farmGrid visible: one card per currency (data-tier) — currency icon+name, quest name, NEXT LINE "REC Lv. {recommendLv}" (user directive 2026-11-12, e.g. "REC Lv. 70"), "{perRun} / run" (base = dropExpected×num), "{ap} AP", "{sampleRuns} runs reported"; farm null → "No drop data yet" card. Bonus inputs STAY (plussed into base stack amount per contract 2); Held stays; Required display stays. Results: deficit grid + runs via farmPlan; AP per currency shown; old calcOptimalRuns not called in event mode.
4. Stub mode (event null): legacy calculator BYTE-IDENTICAL — base-row + questDropsGrid visible, farmGrid hidden, old math. Markup keeps legacy nodes (hidden toggled at hydration), adds farmGrid container.
5. State: legacy keys unchanged; event mode ignores baseDrop/multipliers. Persistence shape unchanged.
6. validate_data.js: farm keys ⊆ currencies; entries null or {questId int, questName string, recommendLv string|number, ap ≥0 int, dropExpected >0 number, num >0 int, sampleRuns ≥0 int}.
7. Tests: farmPlan unit (deficit, bonus add, zero/negative guard, null farm, ceil); sync farm mapping offline fixtures (best pick, tie-break, no-drops null, repeatable filter); QA gate re-target: event mode base inputs hidden + farm cards real data + runs math vs independent reference (MISO 32.14 / SHIMONITA 33.61 / YAKI 32.49 at sync time — recompute from data module, never hardcode), stub legacy intact, absence pins kept.
8. Docs: README, data-rules (farm schema + quest drops endpoint), fetch-data-guideline (drops field discovery — corrects "no drop data in API"), structure, code-style, CLAUDE.md, progress append.
9. Ownership: builder → sync + validate + domain + event-shop.js + farm hydration module (event-shop-farm.js if >200L pressure) + unit tests + data regen. Designer → index.astro farmGrid markup + base-row toggle wiring support + BaseLayout farm card CSS (reuse quest-drops language). QA → gate re-target. Reviewer → new cycle. SEQUENCING: dispatch AFTER Amendment C QA + review close and C commits (clean diffs per cycle).

## Amendment E (2026-11-12, user directive) — EN item names, NA-first fallback

User: "make item in item shop display english na server then have fallback step like servant name display."

Probed facts: export/NA/nice_item.json (941 KB) — permanent materials EN ("Crown of Silvery Light"), event currencies ABSENT (NA behind JP). export/JP/nice_item_lang_en.json (1.2 MB) — Atlas EN translations ("Servant Coin"), event currencies untranslated (name == originalName). House precedent: CE sync uses NA names first (na_names from NA basic_equip), JP fallback; servants use JP lore lang_en.

Contracts (frozen):
1. Sync adds cached exports: na_nice_item.json (export/NA/nice_item.json), nice_item_lang_en.json (export/JP/nice_item_lang_en.json); reuse na_basic_equip.json (NA basic_equip, same file CE sync caches) for CE names.
2. Name chain helper resolve_item_name(id, na_map, jp_en_map, jp_map): NA name → JP-EN name → JP name (jpEn.name is EN when translated, JP otherwise — chain falls back naturally). Pure helper, offline-testable.
3. Apply: items[].name for purchaseType "item" → chain on targetIds[0]; currencies[].name → chain; "servant"/"equip" targets → NA equip name → per-id nice equip lang=en name → entry.name; "costumeRelease"/unknown → entry.name (no item target). entry.name stays the last-resort fallback everywhere.
4. Data stays slim: single resolved `name` field, no dual-name storage. UI unchanged (renders name). Current event effect: currencies JP (untranslated everywhere), coin → "Servant Coin", permanent-material shop items → EN, event CE/costume → JP.
5. Tests: chain fixtures (NA hit / EN hit / JP fallback / missing id), currency + coin + CE cases, offline. validate_data unchanged (name string already required).
6. Folds into Amendment D builder dispatch (same sync_event_shop function) — one build, one gate cycle.

## Amendment F (2026-11-12, user directive) — costume shop item shows the COSTUME face

User: "make costume sell in shop display that costume face instead 1st ascension." Current code uses servant base face f_{servantId}0.png (1st ascension) as stand-in.

Probed facts: costumeRelease target 20470011 → servantId = target//100 = 204700, costumeLimit = target%100 = 11. No costume API endpoint (404). Lore export profile.costume is keyed by costume DETAIL id: {"100130": {id: 11 (costumeLimit), battleCharaId, name, shortName, ...}}. Nice servant costumeMaterials keys = detail ids directly (204700 → "204730"). Costume face = JP/Faces/f_{detailId}0.png — VERIFIED f_2047300.png 200 + f_2047300_bordered.png 200. Cached lore (Nov 8) predates this event's costume — live export has it; CI full sync always caches lore.

Contracts (frozen):
1. _resolve_entry_icon costumeRelease branch: servantId = target//100 → per-id nice servant cached (nice_servant_{id}.json) → costumeMaterials keys. Exactly 1 key → detailId. Multiple keys → lore lookup: cached nice_servant_lore_lang_en.json (fetch ONLY if absent and needed — 195 MB, CI full sync already caches it) → servant.profile.costume entry with id == target%100 → detailId = entry key. Zero keys / unresolved → current base-face fallback + WARN.
2. Asset path: JP/Faces/f_{detailId}0.png — bordered-first rule applies (f_{detailId}0_bordered.png verified). kind stays "costume", filename costume_{releaseTarget}.webp unchanged.
3. Tests: single-costume mapping, multi-costume lore disambiguation (offline fixture), zero-costume fallback, bordered candidate order.
4. Current event effect: costume_20470011.webp = 高杉晋作「夏の奇兵隊」costume face (detail 204730), not 1st ascension. Lead re-syncs --force after build.
5. Folds into D+E builder dispatch (same _resolve_entry_icon function).

## Amendment G (2026-11-12, user directive) — Event Select card, multi-event, per-event saves

User: "make it have 'Event Select' at above use same card consistancy with 'Select Quest' in 'Bond Calculator' to support more 1 shop in same time and if only have 1 event i want it still display and each event has own data save." Supersedes the one-event-at-a-time limit.

Bond pattern (verified markup): card > card-inner > card-title + .input-row > label.input-label + select.select-field.

Contracts (frozen):
1. DATA SCHEMA (breaking, replaces single-event shape): EVENT_SHOP_DATA = { events: [ { event: {id,name,shortName,startedAt,endedAt}, currencies: [...], items: [...], farm: {...} } ] }. Sync collects ALL active event shops: type eventQuest, startedAt <= now < finishedAt, shop non-empty; sorted startedAt desc. --event-id → only that event. Stub: { events: [] }. D/E/F (farm, EN names, costume face) apply PER event snapshot.
2. Event Select card FIRST in #panel-event: <div class="card" id="eventSelectCard"><div class="card-inner"><div class="card-title">Select Event</div><div class="input-row"><label class="input-label" for="eventSelect">Event</label><select class="select-field" id="eventSelect"></select></div></div></div>. Options built by JS: shortName (newlines→spaces). ALWAYS visible even with exactly 1 event. USER REFINEMENT 2026-11-12: NO blank/placeholder option (unlike Bond's "-- Select a Quest --"); if nothing selected yet, FORCE-select the latest event (first of sorted list) — the select always shows a real event. Zero events (stub) → single disabled option "No active event", legacy calculator below. Card title is "Select Event" (Bond "Select Quest" naming consistency).
3. Selection state: EventPlanner.state.selectedEventId, persisted; on load: saved selection if valid, ELSE latest event (never blank). On change: re-hydrate tier cards + farm cards + modal context + results, load that event's plan.
4. STORAGE (breaking, with migration): fgo_event_shop_data = { selectedEventId, plans: { [eventId]: { requires: { [itemId]: n }, held: { bronze/silver/gold: n }, bonus: { bronze/silver/gold: n } } } }. Old {eventId, requires} blob migrates to plans[eventId] (+ default held/bonus), selectedEventId = eventId. Sanitize: unknown event ids dropped; requires clamped per that event's items; held/bonus via Schema.tier bounds. Each event's plan isolated — editing B never touches A.
5. Event mode: Held/Bonus inputs read/write the ACTIVE event's plan (App delegates through EventPlanner); calculate() reads active plan + farmPlan. Stub mode: legacy Persistence flow byte-identical.
6. Modal: opens for selected event's currency; Done commits to selected event's plan only.
7. validate_data.js: events array; per-entry rules as before (currencies/items/farm/name/icon).
8. Tests: multi-event sync fixtures, active-window filter, selection fallback, per-event isolation, storage migration, farmPlan, name chain, costume mapping. QA re-target: select visible with 1 event, switch re-hydrates + swaps saves, per-event persistence across reload, stub legacy, all prior pins adapted to events[].
9. Ownership: ONE builder dispatch for D+E+F+G logic (sync, validate, domain, event-planner, event-shop, event-shop-farm, event-shop-tier, index.astro containers, unit+sync tests, data regen). Designer after: BaseLayout CSS (event select inherits house .input-row/.select-field — likely zero new rules; farm cards) + visual verify. QA → gate re-target. Reviewer → new cycle.

## Amendment H (2026-11-12, lead design call on reviewer 🟡) — N-currency collision fix

Data-real: event 80379 has two gold currencies, 80292 two silver + zero/QP. currencyForTier first-match made currency #2 unreachable (no modal entry, no Held/Bonus). Fix contract:
1. Plan held/bonus keyed by CURRENCY ID (string) in plans[eid]; migration maps old tier keys via the event's currencyForTier at load; unknown keys dropped. requires unchanged.
2. EVERY farm card gets a Required display (that currency's total spend; click/Enter opens the modal for THAT currency) — all currencies reachable regardless of tier mapping.
3. Held/Bonus input pair exists exactly once per currency: on the tier card for the first-mapped currency per background (unchanged behavior), on the farm card for every other currency (compact house input style). Farm-card boxes write the same plan via EventPlanner.setHeld/setBonus(currencyId, …).
4. farmPlan reads per-currency held/bonus. Tier cards' Required/Held/Bonus resolve through currencyForTier → currency-keyed plan. Single-currency events: behavior byte-identical to today.
5. Tests: collision fixture (two golds) — second currency modal-reachable + own held/bonus + farmPlan uses them; migration tier→currency keys; single-currency regression.

## Amendment I (2026-11-12, user directive, FINAL after two refinements) — "Drop Rates per Run" real-data card

User: (1) "i want 'Drop Rates per Run' back but it display real fetch data instead configable" (2) "display both primary and second drop like before" (3) "remove run report and ap use". Example mockup shown + accepted shape:

1. Event-mode card title = "Drop Rates per Run" (was "Best Farm Quests"); content real-data, zero config (base-row + questDropsGrid stay hidden).
2. Farm card gains the SECONDARY drop line: per quest, two lines like the old card — [currency icon] {num}(+{bonus}) {amount/run} — primary = the card's currency, secondary = that quest's second-best SHOP-CURRENCY drop (points/QP excluded); null → "—" line. Amount = dropExpected × (num + bonusOf(lineCurrency)), bonus live from plan. Sync: farm entry += secondary: { currencyId, dropExpected, num } | null (second max dropExpected×num among shop currencies on that quest).
3. REMOVE from farm card display: AP and "N runs reported" (sampleRuns). Data fields kept (ap still feeds results "runs · X AP"; sampleRuns stays in schema, display-only removal).
4. Results math UNCHANGED (per-currency independent farmPlan; secondary drops do NOT credit other currencies' deficits — display only; old cross-drop optimizer stays stub-mode-only). If the owner wants cross-credit, that is a separate directive.
5. Card keeps: currency header, quest name, REC Lv line (skipped when falsy), Required display (modal opener), Held/Bonus on non-tier-mapped currencies.
6. Gate re-pins: title, secondary line vs data module, AP/runs absence, REC presence. Docs: "Best Farm Quests" mentions updated.
7. USER FINAL REFINEMENT: NO Required box on farm cards — Required displays live ONLY in "Shop Requirements" tier cards. Modal access for every currency preserved via the farm card's CURRENCY HEADER (icon+name) as the click/Enter opener (role=button, tabindex, aria-haspopup; pointer cue; inputs inside the card never trigger it). Tier-mapped currencies keep their tier-card Required opener as today.

## Amendment J (2026-11-12, owner-approved "go") — prune non-farm events + latest-farm fallback

Evidence (live probe): 80639 = 3 repeatable quests WITH drop submissions (farm event); 80630/80638 = no war/quests (campaign exchange shops); 80379/80292 = memorial battles, zero drop submissions.

Contracts (frozen):
1. Farm-event test: event has ≥1 repeatable quest (afterClear repeatLast|repeat) in its wars with non-empty community drops for ≥1 of its shop currencies.
2. Selection: active farm events = eventQuest, startedAt ≤ now < finishedAt, shop non-empty, farm-event test passes → ALL kept (multi-event unchanged).
3. Fallback: zero active farm events → scan eventQuest entries newest-startedAt-first (cap 30), first passing the farm-event test wins (ended events qualify; Atlas keeps historical drop data). Single option, auto-selected.
4. Nothing passes → stub {events:[]} (legacy calculator), as today.
5. --event-id N bypasses all filters. Pruned events' saved plans untouched. Sync-side only; NO UI additions.
6. Tests: farm-event test fixtures (campaign no-war → out, memorial no-drops → out, farm event → in), fallback picks latest farm not latest any, cap honored, override bypass. validate unchanged.
7. Sequencing: dispatch AFTER Amendment I builder completes (same sync file — rule 26); bundle with the I final-refinement delta (no farm Required box, header opener) in one pass.

## Amendment L (2026-11-12, owner-approved via refine loop, FINAL) — 4-card farm display + quest selection + 1-event history

Owner refinements (verbatim intent): Select Event can go back to past events (test high-level farm quests) but ONLY latest 1 past; Drop Rates per Run = 4 cards: first three per-currency with header showing ONLY that currency's icon 96px; fourth = 3-in-1 card with all 3 icons 96px + quest dropdown; challenge quests that drop no farm item excluded; 4th card wraps to next row when screen can't fit 4.

Contracts (frozen):
1. SELECT EVENTS: events[] = active farm events (J test) + the LATEST 1 past farm event (scan eventQuest newest-startedAt-first, cap 30, first ended one passing the farm test). Options: shortName + start month/year, newest first. Default = latest active; no active → first listed (the past one). --event-id bypass unchanged. Outage policy unchanged.
2. FARM DATA (replaces per-currency best-only shape): farm = { quests: [ { questId, questName, recommendLv, ap, sampleRuns, drops: { [currencyId]: { dropExpected (4dp), num } } } ], best: { [currencyId]: questId } }. quests = ALL repeatable quests (afterClear repeatLast|repeat) that drop ≥1 shop currency on REPEAT runs. CHALLENGE RULE (owner refinement 2026-11-12): a repeatable quest is excluded when its farm-item rewards are FIRST-TIME ONLY — shop currencies present in first-clear gifts but absent from repeat-run drops. drops = every shop currency that quest drops on repeat. best = max dropExpected×num per currency, tie lower questId. sampleRuns = max runs across the quest's drop rows.
3. FOUR CARDS in #farmGrid: cards 1-3 one per currency (id asc): header = OWN currency icon ONLY, 96px height + name; body = effective quest name, REC Lv (skip falsy), ONE drop line for own currency [24px icon] num(+bonus) amount/run live. Effective quest = plan.farmQuest if it drops this currency else best[currency]. Card 4 (3-in-1) CONDITIONAL (owner refinement 2026-11-12): rendered ONLY when ≥1 quest drops ALL of the event's shop currencies; otherwise absent (80639 today: no all-drop quest → 3 cards). Card 4: header = ALL event currency icons 96px, NO item names (owner refinement); body = house .select-field dropdown: "Auto (best per item)" + every ALL-COVERING quest ("{name} · Lv.{lv}"), then quest name line (Auto → "Auto — best quest per item", REC hidden), one drop line per currency = [24px icon] num(+bonus) amount/run, NO currency name text (Auto → each currency's best amount).
4. SELECTION: dropdown options = ALL-COVERING quests ONLY (owner refinement: NO "Auto" option, no other mode). Default = the all-covering quest with the highest total dropExpected×num. plans[eid].farmQuest = questId (always set when an all-covering quest exists); sanitize: must exist in event farm.quests else re-default; persist per event; cards 1-3 + results recompute on change; bonus repaint live. Switching events swaps choice. No all-covering quest → no 4th card, farmQuest null, per-currency exact ceil (same math, nothing to share — NOT a separate mode).
5. MATH — EXACT-MATCH, MINIMUM-PLAY OPTIMIZER with FULL SECONDARY CROSS-CREDIT (owner refinements 2026-11-12): deficit per currency = Required − Held (exact shop-plan totals). WITH priority quest (farmQuest set): SCAN its run count X from 0 .. ceil(max deficit / its min rate); at each X apply its FULL drop vector, then top-up greedy (largest remaining deficit → that currency's best quest → ceil runs → credit ENTIRE drop vector → repeat until covered); total = X + top-up plays; pick MINIMUM total plays (tie-break: least total surplus, then least AP). Reference fixture (80627 data, needs 3000/4000/5000, 90++ priority): no-bonus no-trade optimum 142 plays = 113×誓い + 29×牛追い. TRADE-AWARE bonus +2/+1/+1 fixture: 104 plays = 90×誓い + 14×牛追い, FULL CASCADE trades 16 cookie→donut + 202 donut→pie; final donut 3007.9 / cookie 4008.5 / pie 5006.8, surplus +7.9/+8.5/+6.8 (~23). 103 runs INFEASIBLE (best 103-mix leaves pie short 19.66 even with full cascade) — 104 is the floor. Trades MUST be integer (10:1) and cascade the full chain (bronze→silver→gold); optimizer searches farming mix + cascading trade conversions jointly (a greedy that fully covers deficits by farming alone is WRONG — misses trade substitution; lead's earlier 0-saved claim corrected). Theoretical floor ~120 (no-bonus). No all-covering quest (farmQuest null): top-up greedy over all quests with cross-credit (largest deficit first), same minimum-play objective — no mode label. perRun = dropExpected×(num+bonus). Surplus per currency displayed, never hidden. Results show PLAYS PER QUEST + final yield vs requirement per currency + total plays. Labels: "runs" wording per K6, no AP display in results (AP stays in data). Optimizer is deterministic + bounded; unit-test the 142 fixture.
6. GRID: house 320px auto-fill centered (K7) — 4 cards wrap 3+1 / 2+2 / 1col as width demands (owner-confirmed wrap).
6b. RESULTS CARD "Best Farm Runs" (owner refinements): (a) requirement-block currency icons 48px height; labels "Required" (shop need) + "Get" (final count user obtains) + ✓ covered + surplus, surplus shown as trade-up value. (b) "Quests to Play" rows prefixed with drop icon(s) BEFORE the quest name: normal quest = 1 icon of its MAIN drop (highest dropExpected×num currency); all-drop quest = ALL currency icons (e.g. 3). Prefix icons inline 24px. Each row: icon(s) + quest name + REC Lv + runs. (c) total plays footer, no AP.
7. Stub legacy byte-identical. Modal/Shop Requirements/saves/order untouched. NO extra controls beyond the dropdown.
8. TRADE-AWARE SURPLUS (owner refinement 2026-11-12): shop upgrade trades (low-rarity currency → high-rarity, e.g. 10 bronze→1 silver, 10 silver→1 gold, unlimited) are read from synced shop entries (purchaseType item, target = another shop currency; ratio = cost.amount / setNum). Optimizer treats trades as an extra coverage source: surplus low-rarity converts up the chain to cover high-rarity deficits; total runs minimized including trade conversions (trades are free/unlimited, only farming runs counted). Surplus display reports trade-up value (e.g. "+1636.8 donut → 163 pie"). Events without upgrade trades skip this. Verified: 80639 + 80627 both have 2 unlimited 10:1 trades; in the balanced 90++ bonus example trades save 0 runs (plan already covered, steep ratio) — benefit appears for lopsided needs / slow high-rarity drops.
9. Ownership: builder → sync, validate, domain (trade-aware optimizer), planner state, farm cards/lines/controls JS (split modules under 200L cap as needed), event-shop wiring, unit+py tests (142-run fixture + trade fixture), data regen. Designer → BaseLayout farm styles (96px headers, card-4 dropdown, wrap) + Best Farm Runs results layout + visual verify. QA → gate re-pin (4 cards, selection math, trades, history). Reviewer → new cycle.

## Amendment M (2026-11-12, owner "fix instantly" + "self check before commit") — farm card refinements

Owner refinements (approved via "fix instantly"): M1 secondary drops back; M2 header icons 48px; M3 own-best quest per card; M4 every card own dropdown; M5 card width 240px. COMMIT HELD until owner self-checks on port 3000.

Contracts (frozen):
1. M1: cards 1-3 show PRIMARY + SECONDARY drop lines of the selected quest (own currency = primary; the quest's other dropped shop currency = secondary; omit secondary if quest drops only 1).
2. M2: farm card header icon (.farm-card-icon) 48px HEIGHT (was 96px). Cards 1-3 own icon + card 4 all icons → 48px. Shop Requirements tier icons stay 96px; Best Farm Runs requirement icons stay 48px.
3. M3: cards 1-3 default to own per-currency best quest (1=bronze, 2=silver, 3=gold); card 4 = all-covering quest. Each card displays its own drop rate independently.
4. M4: EVERY card has its own quest dropdown. Cards 1-3: quests dropping that currency (sorted rate desc), default = best. Card 4: all-covering quests, default = best. State: plans[eid].currencyQuest = {[cid]: questId} (cards 1-3) + farmQuest (card 4 priority). Selecting re-prices that card's lines + the optimizer. Sanitize: quest must drop that currency (cards 1-3) / be all-covering (card 4), else re-default.
5. M5: farm card width 240px — .farm-grid repeat(auto-fill, minmax(min(100%,220px),240px)) centered, 8px gap; 4 cards fit one row at desktop (~984px), wrap on tablet/mobile.
6. OPTIMIZER: priority = farmQuest (card 4, null when no all-covering quest); top-up quest per currency = currencyQuest[cid] (user selection, default best). Scan priority X + top-up with the SELECTED per-currency quests + integer cascade trades + cross-credit, minimize total plays (tiebreak surplus→AP). No all-covering → cards 1-3 selections drive the plan. Fixtures must still hold when selections = defaults (142/104/335).
7. Best Farm Runs results: same structure (Required/Get/✓/+X, Quests to Play w/ main-drop icon 1 or all-drop 3, Shop Trades real ratios, total plays, no AP) using the new optimizer.
8. Stub legacy byte-identical. No extra controls beyond the per-card dropdowns.
9. Ownership: builder → domain optimizer (selected-quest top-up), planner state (currencyQuest), farm cards/lines/controls JS (per-card dropdown + secondary line), event-shop wiring, tests. Designer → BaseLayout (.farm-card-icon 48px, .farm-grid 240px, dropdown styling) + visual. QA → re-pin. Reviewer → cycle. COMMIT HELD for owner self-check on 3000.

## Amendment N (2026-11-12, owner self-check feedback) — dropdown sort + exclusion

1. N1: ALL farm card dropdowns (cards 1-3 + card 4) sort options by REC Lv. DESCENDING — high above, low down (owner refinement "sort high above low down"): 100★ > 90++ > 90+ > 90 > 85 > ... > 70; numeric-aware (numeric part then +/++/★ suffix). Missing recommendLv sorts LAST (bottom).
2. N2: cards 1-3 dropdowns EXCLUDE all-covering quests (all-covering quests appear ONLY in card 4). Card 1-3 default selection = best-rate NON-all-covering quest for that currency; if a currency has no non-all-covering quest, fall back gracefully (card still shows its best quest). Card 4 unchanged (all-covering only).
3. Optimizer top-up uses the cards 1-3 selected (non-all-covering) quests; priority = card 4 farmQuest. Default-selection fixtures must still hold (142/104/335).
4. Ownership: fast builder → event-shop-farm-controls.js (questsDroppingCurrency sort + exclusion, buildFarmQuestSelect sort), farm.js if needed, tests. Rebuild for owner self-check; commit held.

## Amendment O (2026-11-12, owner self-check) — cards 1-3 dropdown = main-drop quests only

Owner: "why first three card have dropdown choice quest that not main drop of that item" → cards 1-3 dropdowns must list ONLY quests whose MAIN drop is that currency (the currency with the highest dropExpected×num among the quest's shop-currency drops). A quest where the currency is only a SECONDARY drop is excluded. All-covering quests still excluded (card 4 only). Sort REC Lv. descending (N) kept. Default = best main-drop quest (= farm.best, unchanged). Card 4 unchanged. Optimizer top-up uses selected main-drop quest; default fixtures hold (142/104/335). Ownership: fast builder → event-shop-farm-controls.js (questsDroppingCurrency main-drop filter) + tests. Rebuild for self-check; commit held.

## Amendment P (2026-11-12, owner self-check) — farm card header/border/centering

1. P1: cards 1-3 header = currency IMAGE ONLY, centered — REMOVE the currency name span (buildCardHeader). Header centers the icon (justify-content center). Card 4 header already icons-only.
2. P2: 4th combo card border CONSISTENT with cards 1-3 (2px solid border, same radius/width; neutral var(--border) or house-consistent color since it spans all tiers).
3. P3: when only 3 cards (no all-covering quest), CENTER them, not left-align — grid auto-fit (collapse empty tracks) + justify-content center so 3 cards center; 4 cards still fill the row.
4. Ownership: fast designer → event-shop-farm.js (buildCardHeader name removal) + BaseLayout.astro (header centering, combo border, grid auto-fit/center). Rebuild for self-check; commit held.

## Amendment Q (2026-11-12, owner self-check) — duplicate name + exact no-all-drop optimizer

Owner reported: results show currency name twice (ネギ/YAKI) + big YAKI surplus (+1093) on 80639 (no all-drop quest).
1. Q1: results requirement-block icon is DECORATIVE (name shown adjacent) → alt="" so copying/screen-reading doesn't duplicate the name. buildCurrencyImg/buildIcon need an alt override; results requirement icons alt="". Play-row icons keep alt=name (currency identified there); trade-row icons alt="" (name already in trade text). Farm-card header icons keep alt=name (P1 removed the visible name there).
2. Q2: no-all-drop optimizer must find the EXACT minimum (greedyFarmPlan overproduces — oracle found 306 vs greedy 334/335 on 80639). Replace the no-priority greedy with a bounded exact search over farming mixes + integer cascade trades, minimize total plays (tiebreak surplus→AP). Must be ≤ greedy; update the 80639 fixture to the exact min (verify vs scripts/test_event_shop_optimizer_oracle.js). Priority-quest fixtures 142/104 unchanged. Deterministic, bounded (cap nodes), never under-covers.
3. Ownership: builder → event-shop-farm-results.js + event-shop-tier.js (alt override) + domain.js (exact no-priority optimizer) + tests. Rebuild for self-check; commit held.

## Round tracker

- DELIVERED: commit bc80866 (30 files, +5209/−635), worktree clean. Full chain: f2ec3f8 (A) → 1299e8e (B) → ea650a8 (C) → bc80866 (D-J). Not merged to develop / not shipped to main — owner's call via scripts/merge_code_only.sh.
- Team-lead rule 24 amended: quota failure → retry with alibaba-token-plan/qwen3.6-flash (owner order; fallback proven live on the final docs dispatch). Rules 22-26 binding.
- Format failures ledger: clean-code-builder fix-pass (verdict token missing, transport blocked re-ask, substance lead-verified); final docs fallback dispatch (reworded verdict, substance lead-grepped). QA harness stale-hash defect closed (dynamic chunk resolution).
- Servers at delivery: owner preview 3000 (dual-stack); QA static 4173/4174/4175 (pids 65188/65192/65196) — kill by PID when done.
- D-G cycle: builder PASS (5 shops/160 items) → designer PASS → review R1 REJECT (🟡 N-currency collision + 5 🔵) → Amendment H + fixes PASS (256 tests) → flush fix + H visual PASS → QA D-G FAIL: 🔴 debounce switch race → flush-before-switch + isConnected guard → QA re-verify interim green (final verdict superseded by I/J re-pin).
- QA D-G gate otherwise green: events[] contract, select/isolation/migration/farm math (105 runs case)/names/costume/zero-bg/stub all pinned; 4 mutants red at target pins; verify_render reds pre-existing bond/CE zone.

- Amendment B cycle: builder PASS (+27/−301, card gone, state-only planner 70L, parts 99L); designer PASS (parity 34×132px all tiers, transparent icon boxes, 23 dead rules purged); build + baseline re-capture green (text drift only), both served pages card-free.
- Amendment B DELIVERED: commit 1299e8e (13 files, +803/−1065, net deletion), worktree clean. Review round 2 PASS zero findings; QA PASS + lead anchor re-run exit 0; progress.md entry appended. Team-lead rules 13-21 update dispatched (config file outside repo).
- Amendment B review round 1: REJECT, 8 🔵 (1 dead reduced-motion selector + 7 stale doc refs; code audit clean) → 8/8 fixed (grep empty, lint 0). Round 2 re-audit: PASS.
- Amendment B QA: PASS, gate re-targeted (absence + parity 34px + transparency pins; modal contract whole; legacy live-pinned), 3 mutants red at target pins only. Lead anchor re-run post-rebuild: node scripts/test_event_shop.js http://127.0.0.1:4173/fgo-calculator/ → exit 0 SUCCESS, matches QA. Lead fresh: build + check:build green (no re-capture — CSS-only), 227/227, lint/validate/format 0.
- Deferred 🔵 (lead-accepted): hover background tint instant vs border 0.2s (transition stripped with geometry overrides).
- Prior cycle (Amendment A): 2 fix rounds + round 3 PASS; QA 3× PASS; delivered f2ec3f8.
- PLAN OF RECORD: /tmp/opencode copy VANISHED (tmp cleanup, session rule 5 vindicated) — repo copy .plans/event-shop-planner.plan.md is authoritative; all dispatches cite it.
- format failures: none. Lead tooling: subagent sessionID continuation truncated in transport ("ses") — fallback = fresh dispatch with full context. One reviewer dispatch died on transport ("delta missing id or name") — retried once, running.
- Docs sync DONE: README.md (lead, 6 edits); structure/data-rules/code-style/fetch-data-guideline/progress + AGENTS.md + CLAUDE.md + main.js comment (builder delegation, anchors verified, lint 0). .claude/docs edit permission denied for lead — delegation is the sanctioned path.
- Accepted: event-shop.js 293 lines (pre-existing 260 shape, legacy debt); 44 unique icons; stub AC7 code-read gap; tier Required raw number vs formatted chip.
- Verified buy-all totals (data truth, id asc): 94164000 MISOおでん 5740, 94164001 SHIMONITAネギ 5390, 94164002 YAKIまんじゅう 6610. (QA dispatch prompt had YAKI/MISO labels swapped — plan annotation corrected here; code was always right.)
- AC7 stub state: bundled data cannot exercise empty branch in prod browser; code-read clean per QA. Accepted documented gap, not a defect.
- Preview daemon lesson: two simultaneous `astro preview` launches race the daemon lock — second times out (3000 died, 4173 survived). Launch sequentially; probe HTTP before claiming live.

## Step 6 doc delegation — exact text (builder applies, lead reviews)

AGENTS.md, layout map row — replace:
`| src/scripts/bond-app.js, ce-filter-app.js, ce-servant-select.js, event-shop.js | Application controllers per tab |`
with:
`| src/scripts/bond-app.js, ce-filter-app.js, ce-servant-select.js, event-shop.js, event-planner.js | Application controllers per tab |`

AGENTS.md, generated-data bullet — replace:
`**Generated data is gitignored**: \`src/scripts/data/*.js\`, \`public/servants/\`, \`public/craft_essences/\`.`
with:
`**Generated data is gitignored**: \`src/scripts/data/*.js\`, \`public/servants/\`, \`public/craft_essences/\`, \`public/event_shop/\`.`

.claude/CLAUDE.md line 20 — replace:
`- **Event Shop Calculator**: Optimal quest runs for event materials`
with:
`- **Event Shop Calculator**: Live event shop planner (per-item Require, per-currency totals, Atlas-synced) + optimal quest runs for event materials`

.claude/CLAUDE.md Key Features block — after line 33 (`- LocalStorage persistence`, the Event Shop Calculator block's last bullet) insert:
`- **Event Shop planner** (first card, #eventPlannerCard): current JP event auto-picked at sync time (latest eventQuest by startedAt, --event-id override), every shop item with icon + Require stepper (0..limitNum, unlimited cap 999999), live per-currency totals (Σ require×cost.amount), Buy all / Clear, currency filter chips; requires persist under EVENT_SHOP_STORAGE_KEY keyed by event id (new event resets); EventShop (domain.js) sole math home, EventPlanner (event-planner.js) state, EventPlannerView (event-planner-view.js) DOM`

.claude/CLAUDE.md line 139 — after `- src/scripts/event-shop.js — Event Shop controller` insert:
`- src/scripts/event-planner.js — Event Shop planner controller (EventPlanner: requires state + persistence)
- src/scripts/event-planner-view.js — Event Shop planner DOM (EventPlannerView: render/renderList/updateTotals/syncInputs)`

## Dispatch rules (every prompt)

USER STANDING ORDER 2026-11-12: ALL subagent dispatches run background=true, no exceptions. Lead ends turn after dispatching, resumes on completion notification. Parallel background agents must have disjoint file sets.
Scope, contracts, file plan frozen from lead — implement, do not re-litigate/shrink/defer. Pushback → review ledger. End reply with role verdict line verbatim, uncompressed, own line (trailer after if style demands). Builder fix dispatches: one line naming behavior changed + assertion that should now pass.