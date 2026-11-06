# CLAUDE.md

Guidance for Claude Code (claude.ai/code) and AI coding assistants working in this repo.

## ⚠️ Pre-Implementation Requirement (Project Memory)

**ALWAYS read relevant docs in `.claude/docs/` before implementing anything!**
First four bullets = mandatory read (~25 KB together). `fetch-data-guideline.md` and `progress.md` are 63 KB and 172 KB — grep them for your feature, don't load either whole. `AGENTS.md` and `GEMINI.md` at repo root carry same contract for non-Claude agents (Antigravity, Codex, Copilot); all four tracked, keep in step.
- **`code-style.md`** — conventions, strict DOM safety (NEVER `innerHTML`; use `createElement()` + `textContent` + `setAttribute()`, or `DocumentFragment` + `replaceChildren()`), naming standards, state management, performance patterns.
- **`structure.md`** — architecture, 3-layer pattern (Domain, Application, Presentation), module responsibilities, Vite manual chunk splitting, script loading order.
- **`data-rules.md`** — trait ID conventions (4-digit zero-padded strings), `SERVANT_DATA` + `CE_DATA` schemas, trait match modes, public asset paths (`public/servants/`, `public/craft_essences/`).
- **`security.md`** — security rules, inline Trusted Types policy enforcement, safe DOM manipulation.
On demand only (large):
- **`fetch-data-guideline.md`** — fetch/process game data from Atlas Academy API.
- **`progress.md`** — implementation status, testing checklists, roadmap.

## ⚠️ Token Spend — Ask Before a Big Burn (owner rule, applies to every repo)

Owner decides what run costs; workflow does not. Name step in one line + **wait for approval**
before any of:

- dispatch reviewer, auditor, any subagent, or parallel agent fan-out
- run multi-agent `Workflow`
- read large file whole (on-demand docs above, generated data, lockfiles) instead of grepping
- repeat `npm run build` + `node scripts/verify_render.js` with no source change

No approval needed for what task already calls for: `npm run test`, `npm run lint`,
`node scripts/check_build_output.js`, `git` reads, targeted greps.

**Never auto-run final whole-branch code review.** Owner reviews diff + tests by hand (now
against served build at `localhost:3000`). Report gate evidence + stop; no self-review pass
replacing reviewer you were told to skip. Same in `AGENTS.md`, `GEMINI.md`, globally in
`~/.claude/CLAUDE.md`. Not permission to pause between plan tasks asking "should I continue?" —
progress prompts stay forbidden.

## Project

FGO Calculator — Astro static site on GitHub Pages. Three tools:
- **Event Shop Calculator**: Optimal quest runs for event materials
- **Bond Calculator**: Bond farming planner, servant slots wearing own CEs, quest presets
- **Bond Gain CE**: Reverse lookup — pick CEs → see matching servants

**Live:** https://famakung.github.io/fgo-calculator/
**Repo:** Famakung/fgo-calculator

### Key Features

**Event Shop Calculator:**
- Border-label input boxes: Required, Held, Bonus per material tier (Bronze, Silver, Gold)
- Base drops + primary/secondary drop multipliers config
- Optimal quest runs from material deficits
- LocalStorage persistence

**Bond Calculator:**
- ≤6 servant slots, drag-to-reorder, class icon multi-select filter (15 classes)
- 2 servant types: Normal (Max Bond + Bond ≥15 checkboxes), Support (no calculation)
- Visual slot badges: starting member slots show frontline bonus badges (+20% self Normal, +4% All Support); "Bond ≥15" shows "Bond All +25%" badge in any slot (stacked below +self 20% in starting member)
- Multi-ascension support — per-ascension traits merged at runtime
- Frontline bonus: ×1.2 multiplier + flat 20% of base (first 3 slots); frontline support bonus: +4% (all slots)
- Quest presets cascade from one main select (`#bondQuestSelect` → `QUEST_FAMILIES`): **Free Quest** picks quest (`#bondFreeQuestSelect` → Lv.83 845 pts, Lv.84 855 pts, `custom` → Bond/Run box), **Grand Duel** picks party class (`#bondGrandClassSelect` → 11 choices: `all`, 7 standard classes by trait id, `extra1` Shielder/Ruler/Avenger/Moon Cancer, `extra2` Alter Ego/Foreigner/Pretender/Beast, `extra` both) + difficulty (`#bondGrandDiffSelect` → Rank-Up Training Battle I–VII at 3164/3385/3622/3876/4147/4438/4748 pts). State = four keys (`questMain`/`questSub`/`questClass`/`questDiff`, all allow-listed in `loadState()`, which also lands old single `selectedQuest` into them), and `Quest.bondPerRun(state, customBond)` + `Quest.classIds(questClass)` + `Quest.matchesClass(traits, questClass)` in `domain.js` are sole readers — tested in `tests/bond-quest.test.js`, gated at end of `scripts/verify_render.js`. `BondApp.syncQuestRows()` shows only chosen family rows via `style.display`, never `hidden`: `.input-row` declares display, outranks UA rule. Grand Duel class other than `all` also limits party — `BondApp._pickerOptions()` passes `{ lockClasses }` to every `ServantSelector.open()` (both `onBack` re-opens too), modal sets `lockedClasses`, `getFilteredServants()` hands whole row set to `ServantFilters.match(traits, this)` (`domain.js`), which asks `ServantFilters.effectiveClassIds` for class set: picks kept inside group (pick saved under another quest dropped, never honoured —
and dropped pick lights no chip either: `FilterSections.renderRow` paints disabled chip
unpressed with `aria-pressed="false"`, row shows only what's in force, pick stays in
state + re-highlights once bound lifts), no pick inside group = whole group, no group + empty = no class filter at all. Renders `getFilteredServants()` from first paint, class row **always renders all fifteen** — choice naming one class greys other fourteen instead of building no row (greys Class sort option same reason), three Extra groups stay clickable, act like free-quest row: click narrows, click again clears to group. Class outside group unclickable, bound can't be escaped; `calculate()` refuses slot with servant outside group (`"${name} cannot join a Grand Duel ${group} party."`) instead of pricing illegal party. Labels + bond figures only in `constants.js`
- **Party per quest choice**: each Grand Duel class owns rack — `state.parties[key]`, `""` = shared Free Quest / no-quest party, `questClass || "all"` = Grand Duel (`BondApp._partyKey()`). `stashParty()` (copies slots after `flushInputsToState()`, files **nothing** for rack with no servant — absent key already means empty) + `applyParty()` (loads key or fresh empty rack, then `delete`s promoted key) run on every `questMain`/`questClass` change, so live party always `state.slots`, save stores each party once. `loadState()` allow-lists `parties` to 11 class keys + `""`, takes live party from `parties[liveKey]` else `data.slots`, save with no `parties` leaves **every class starting empty** (old flat `slots` = shared party only). Teapot, CE pool, results code never changed — still read `this.state.slots`
- **Servant picker modal mirrors Bond Gain CE tab**: `#servantModal` carries own search bar (`.cefilter-search-container` + `#servantPickerSearch`) + one `.cefilter-sort-row` — `#servantPickerFilterBtn` → `#servantPickerSortBy` (ID / Rarity / Class) → `#servantPickerSortOrder` (▲/▼) — class + rarity buttons left old collapsible "Filters" for nested `#servantFilterModal` (`.cefilter-modal-body`, `role="dialog" aria-modal="true"`, seven sections built by same `FilterSections` as Bond Gain CE tab — rarity, class, class group, both alignments, sub-attribute, gender; no CE Bonus, picker has no CE picks to count) opened by Filter button, closed by ✕, backdrop, Escape. Sub-modal written **after** `#servantModal` in `index.astro`: every `.servant-modal` shares `z-index: 1000`, DOM order puts it on top. Escape peels top layer only — picker keydown handler returns while `#servantFilterModal` open — `close()` takes both off, so pending-slot cancel never leaves sub-modal over tab. In modal both rows lose margins (`#servantModal .cefilter-search-container, #servantModal .cefilter-sort-row { margin: 0 }`), because `.servant-modal-content` is flex column with `gap: 8px` and flex gap doesn't collapse adjacent margins — tab 8px between search + controls would measure 24px there; `scripts/verify_render.js` measures both gaps, requires equal. `#ceModal` (essence picker), ascension prompt, overlap modal keep collapsible.
- **Servant picker row lives for page**: `ServantSelector` keeps class, rarity, search, sort across close/reopen (`open()` clears none, `syncPickerControls()` reads all four back), writes nothing to localStorage — refresh starts row blank like other filters. Search bounded where it enters state: `this._searchQuery = query.slice(0, MAX_SEARCH)` (40), so pasted wall of text can't become matcher input or reopened box. Stale pick inside one session still possible — why `getFilteredServants()` never trusts `classFilters` directly, asks `ServantFilters.effectiveClassIds(...)` instead. Modal shared, so Bond tab party picker + Bond Gain CE **Servant Select** picker remember same row for page. Grand Duel group naming exactly one class disables Class option + drops remembered `class` sort to `id` — one class nothing to sort by, same reason its fourteen siblings render greyed. Sorting = last step of `getFilteredServants()`, via `ServantSort.sorted(rows, sortBy, order, idOf, traitsOf)` (`domain.js`), which `CEFilterApp._sortEntries` also delegates to, so picker grid + tab result cards order by one comparator: `rarity` / `classIndex` read same trait list filters read, ID breaks every tie, direction applies to tie-break. Class icons now set `src`, not `data-src` — nothing promotes deferred icon once row left collapsed filter. `scripts/verify_render.js` pins lot (Saber + ★5 survives close/reopen, reload wipes it, Saber pick under Extra I ignored, Rarity desc = exact reverse of Rarity asc, that choice survives reopen not refresh, Filter button opens sub-modal over picker with Escape leaving picker open, single-class quest greys Class with sort back on ID)
- Bond level planning: per slot **Current Lv.** (`slotBondLv_${i}`, 0–15) + **Target Lv.** (`slotBondTgt_${i}`, Current+1–16) sit **above** point box, which `buildServantSlots()` labels "Next Lv. Required". Current Lv. always re-prices box from servant own table (`bondGrowth[current]`), incl. over typed figure; servant change via `setServant()` re-prices same way. Restored or freshly opened slot with empty box gets current level cost — nothing else overwrites typed number
- Current Lv. ≥ `BOND_CONSTANTS.BOND_BONUS_LEVEL` (15) ticks "Bond ≥15", lower unticks — that level pays +25% party bonus, checkbox follows select both ways
- Runs per level stretch: `BondLevelCalculator.plan({ growth, current, target, bondPerRun, typedCost })` (`domain.js`) returns `{ rows: [{from, to, runs}], total, spansLevels }`; `rows` group consecutive levels one batch of runs clears (`Bond Lv.0->2` / `1 run`), surplus carries to `BOND_CARRY_LIMIT` (10), discarded above bond cap, so Lv.11+ rounds alone. `spansLevels` sole trigger for printing rows: one-level plan keeps old single `X runs` line, `runs` still from `Math.ceil(bondNeeded / effectiveBond)`
- Slot state gained `bondLevel` / `targetLevel`, clamped in `loadState()` `sanitize()`; every slot literal now from `defaultSlot()` in `bond-app.js`, not eight hand-copied objects
- **Per-slot craft essences**: each slot owns `ces: []` + `grand: false`. Capacity = `BOND_CONSTANTS.MAX_CE_SLOTS` (1), or `GRAND_MAX_CE_SLOTS` (2) while **Grand Servant** ticked; `SlotCEs` (`domain.js`) sole home for rules — `capacity` / `trim` / `partyPool` / `sanitize` / `isValidEntry`, unit-tested in `tests/bond-slot-ces.test.js`. Block is `BondApp._buildSlotCEs()`, appended to `.servant-slot-info` after point box: bordered, labelled `Craft Essence`, chips **portrait only** at `--slot-ce-h: 64px` (`--slot-ce-w` = `142/155` of it) — name + bonus only in `title`/`alt` + results card, never under chip; `--ce-badge-h` stays 48px (also sizes results card + Bond Gain CE tab). **Grand Servant** tick built only while quest choice is Grand Duel (`questMain === "gd"`): Free Quest / no-quest card gets block, label (no `for`, nothing to point at) + chip, no tick — gated at *creation*, like Support and Max Bond; quest change already rebuilds rack via `applyParty()`, nothing else re-prices. `loadState()` sanitizes **per party, not per live quest**: `partyOf(raw, grandOn)` / `sanitize(s, grandOn)` feed `SlotCEs.sanitize(s.ces, grandOn && s.grand)`, `grandOn` = key is Grand Duel class (and `liveKey !== ""` for flat `slots`), so save written while tick sat in every card loses `grand` **and 2nd essence** in shared party instead of showing untickable extra chip — filed Grand Duel racks keep both. Id no longer resolving in `CEById` still renders removable `.ce-chip-fallback` tile carrying id. `addCE(slotIndex, position)` = house **Pending Slot** pattern: `null` in slot own list, skipped by `partyPool`, spliced out by `onPendingRemove`
- **The maths did not move**: `calculate()` walks `SlotCEs.partyPool(this.state.slots)`, so every equipped essence still boosts every servant, whichever card wears it — Support slot chips count too. Pool returns `{ entry, isSupport }`: essence worn by borrowed support servant pays that CE friend-side rate; `SlotCEs.rate(ce, isSupport)` is one rule, read by `calculate()` + chip title, so `bonus` (own servant) + `supportBonus` (0910 Chaldea Teatime: 5% vs 15%) can't disagree with results card. "Craft Essences Bonus" card, `div#ceGrid`, `buildCESlots()`, top-level `state.ces` gone. Old saves load **nothing equipped** (`loadState()` drops `data.ces`; `SlotCEs.sanitize` filters each slot list to old pool shape rule + clamps to capacity, so three chips + `grand: false` come back as one). Untick Grand drops **2nd** essence — no confirmation, no restore
- **Collapsed, not hidden**: Support slot builds no `Max Bond`/`Bond ≥15` row; Support or Max Bond slot builds no level selects + no point box — `isSupport` / `isBondHidden` gate *creation*, essence block moves up into that space (gate: 415px Normal, 317px Max Bond, 298px Support). `bond-input-box--hidden` / `bond-checkbox-row--hidden` gone from CSS + JS; uncreated fields never enter `this.elements`, which `flushInputsToState()` + `calculate()` already handle with `if (input)`. `slot.bondLevel` / `targetLevel` / `bondNeeded` stay in state — switch back to Normal restores player figures
- **Bond tab order**: `Select Quest` card first, then `Party Setup`, then results. `#bondCalculateBtn` in `.bond-card-actions` row after `div#servantGrid`, inside Party Setup `.card-inner`, bottom right; `.bond-card-actions .calculate-btn { width: auto }` override scoped there so Event Shop `#calculateBtn` keeps `width: 100%` — `scripts/verify_render.js` measures both ratios
- **Stargazer's Teapot**: `.bond-card-actions` (now `flex-wrap: wrap`, `gap: 8px`) holds teapot row immediately left of `#bondCalculateBtn` — `icons/teapot.webp`, bordered-label count box (`#teapotCountInput`, clamped by `BOND_CONSTANTS.MAX_TEAPOT_COUNT` = 9999) reusing `.bond-input-box` / `.bond-input-box-field`, slide switch (`#teapotToggle`, `.bond-teapot-switch` + `.bond-teapot-slider`, `aria-label` on checkbox because visible name belongs to count box). Both persist as `state.teapotCount` / `state.teapotOn`, sanitized in `loadState()` (whole items, `Boolean`). `change` handlers **only save** — switch flip or count edit never re-prices alone; results refresh solely on `#bondCalculateBtn` press (owner decision: calculate is sole pricing trigger). "Out of Stargazer's Teapot" chip is lone exception: itself a button press, so click clears `teapotOn` + calls `calculate()`. `calculate()` gained **step 5**: `perRun = effectiveBond * BOND_CONSTANTS.TEAPOT_MULTIPLIER` (2), so `base(+bonus)` line reads `4000(+800)` → `4000(+5600)` (teapot pays whole per-run total again, not CE percentage). `Teapot.plan({ growth, current, target, onPerRun, offPerRun, typedCost, stock })` (`domain.js`) sole home for stock rule — one teapot per run, run pays whole party, servant finishing early costs no extra. Walks `BondLevelCalculator.plan()` at boosted rate under new `runBudget`; when stock dies inside level that plan reports `stopLevel` / `stopRuns` / `stopOwed`, `Teapot.plan` runs **second** plan from that level at ordinary rate with `stopOwed` as typed figure. Returns `{ on, off, out, runs }`: `runs` counts last teapot even when it cleared no level, `on.rows` lists only levels those runs **actually** cleared — money spent inside unfinished level isn't level-up, never becomes row there, continuation below owns stretch. Stock covers plan: one grid, teapot badge **last** in `.ce-badges`. Stock runs out: boosted grid, then centred `.bond-teapot-remove` (**"Out of Stargazer's Teapot"** + 48px teapot image, `alt=""` so label names it once; click switches toggle off, saves, re-plans at ordinary rate), then second grid for continuation — stock fell short **both** grids name cleared levels even for single one — `buildCard(sr, afterTeapot)` reads `phasePlan.rows` (`sr.bondPlan.rows` above chip, `sr.offPlan.rows` below), prints on `sr.teapotOut || phasePlan.spansLevels`, so split block never left unlabeled when it raised level. Toggle off or fully covered, old `spansLevels`-only rule untouched. Tested in `tests/bond-teapot.test.js` (`runBudget` in `tests/bond-level-calculator.test.js`); `scripts/verify_render.js` drives split, Out-of, covered states + pins chip text, 48px image, place beside button on frontline Mash (servant `001`, 1,000-point quest, 2,500 typed at Lv.0, Lv.3 wanted — Lv.0→4 steps 1,000 each, so 1 teapot = bare `1 run` boosted block (no level row — cleared none) + 2-run `Bond Lv.0->2` / `Bond Lv.2->3` continuation, 99 = one covered `Bond Lv.0->3 / 2 runs`). Image committed under `public/icons/` like every other icon, never hotlinked — see provenance row in `.claude/docs/fetch-data-guideline.md`

**Bond Gain CE:**
- Two sub-tabs (`#cefilterSubtabs`, `.cefilter-subtab-btn[data-subtab]`, first nested tab level in app): **Craft Essence Select** (`.cefilter-subpanel[data-subpanel="ce"]`, original CEs → servants UI, default) + **Servant Select** (`.cefilter-subpanel[data-subpanel="servant"]`, servants → shared-CE groups) — panels carry no `id`; `#cefilterSubCE`/`#cefilterSubServant` never existed, two cards swap on `data-subpanel`. Both sub-tabs persist picks under `CEFILTER_STORAGE_KEY` (`fgo_ce_filter_data`) as `{ servantPicks: [...], cePicks: [...], ceMode: "all", subTab: "ce" | "servant" }`, always written through `CEFilterStore` (exported by `ce-servant-select.js`, read-modify-write — blind single-field `setItem` would erase other sub-tab field). Servant side: `ServantSelect._savePicks()`/`_loadPicks()`. CE side: `CEFilterApp._saveState()`, called from `render()` because that's sole point every pick mutation reaches (picker `onApply` in `main.js` + card-badge clicks mutate `selectedCEs` directly), + `CEFilterApp._loadPicks()` at top of `init()`, sanitized by `Validator.validatePicks` then `CEById.has`. Match mode survives with picks — `renderResults` forces back to `all` below 2 selected CEs. `matchCustomCounts`, class/rarity filters, search, page still reset on refresh. Nothing else on sub-tab axis: `_switchSubTab()` is sole point every sub-tab change reaches (`#cefilterSubtabs` click handler + `selectCEFromCombo`), writes `subTab` there, `_loadPicks()` restores it (anything but `"servant"` → `"ce"`), last line of `init()` is `_switchSubTab(this.state.subTab)`, not bare `render()` — markup ships `ce` panels visible, restore un-hides `servant`, `ce` still renders through it.
  - No swap visible on refresh, and **Chrome paints while it parses**, so body script can't win: `is:inline` script placed after sub-tab buttons still ran at t=920 ms against first-paint 780 / FCP 848 under 20× CPU throttling with chunks delayed 1500 ms. Pre-paint mechanism = CSS + one head attribute. Existing `is:inline` LCP/`data-tab` script (`src/layouts/BaseLayout.astro`) also parses `fgo_ce_filter_data` + sets `data-subtab="servant"` on `<html>` (nothing in repo uses partial-match `[data-tab*=]` selectors, two attributes can't collide), two rules — kept in site only stylesheet, `<style is:inline>` in `BaseLayout.astro`, right after `.cefilter-subpanel[hidden]` — hide `ce` panel + un-hide `servant` under `html[data-subtab="servant"]`. Specificity 0-3-0 beats `.cefilter-subpanel[hidden]` (0-2-0), wins from first paint; measured proof = `ce` panel computed `display` is `none` instant it enters DOM. `hidden` does work here (shipped CSS declares no other `.cefilter-subpanel` rule) — just can't act before any script runs
  - `_switchSubTab()` sets `document.documentElement.dataset.subtab = sub` alongside panels `hidden`, so CSS + JS can't disagree: `"ce"` leaves override rules unmatched, `hidden` governs; `"servant"` matches them, they say same. Markup default stays `<div class="cefilter-subpanel" data-subpanel="servant" hidden>` (no-JS users get Craft Essence Select, documented default), must stay in sync with `_loadPicks()` `"ce"` fallback. **Buttons** sole part still JS-only — `.active` is class carrying pill styling, reproducing from `html[data-subtab]` would duplicate `.tab-btn` rule set under second selector — so small `is:inline` script immediately after `#cefilterSubtabs` (`src/pages/index.astro`) reads head attribute + flips `.active`/`aria-pressed`, earliest point buttons exist — sampled every `requestAnimationFrame` (rAF runs before that frame paints) at 20× CPU throttling with chunks delayed 1500 ms: 517 frames, none showed wrong highlight, row appears already correct
- `_switchSubTab()` writes `subTab` to `CEFilterStore` **only when value changed**, because `init()` calls it with saved value + plain write would touch localStorage on every page load. First-ever visit leaves key with no `subTab` field — `_loadPicks()` treats as `"ce"`
- Two guards stop silent rot: `.astro` linted by nothing, mechanism spread over four files. `scripts/check_build_output.js` pins exact set of `.cefilter-subpanel` display rules in both stylesheet texts (`dist/index.html`, `BaseLayout.astro`) as *assertion* — `--write` refuses to absorb it; `scripts/verify_render.js` reloads with `subTab: "servant"` stored + fails if any panel computed `display` wrong at instant first parsed, if `<html data-subtab>` missing afterwards, if `.cefilter-subtab-btn` has `.active`/`aria-pressed` disagreeing
- **Servant Select**: unlimited picked servants (chips, not slots). Every match-cache entry of picked servant is own member, so multi-ascension servant whose ascension groups match different CE sets splits into one badge per group, portraited like that group Craft Essence Select card but **image only** — no blue `.cefilter-ascension-label` text under badge, ascension + spiritron names stay in `title`/`alt`; pick still needs no ascension choice (`ServantSelector.open(..., { skipAscension: true })`). Output = one row per distinct CE list, each carrying maximal member group sharing it (servant split across forms can appear twice in one row), rows needing ≥2 servants, sorted CE count desc then servants desc; sections with no rows never print; below two picks `#cefilterComboEmpty` gives instructions instead of result (`ServantSelect._paintNotes`, same element as no-rows message) — "Add two or more servants…" at zero, "Add one more servant…" at one, card never sits blank under own title — `#cefilterComboUnshared` stays hidden there, naming loner as sharing nothing needs two to compare; servant in no row named in `#cefilterComboUnshared`; enumeration stops at `ServantComboCalculator.MAX_COMBO_NODES`, shows `#cefilterComboTruncated`. Click CE hands over to Craft Essence Select with it selected (`CEFilterApp.selectCEFromCombo`). `Clear all (N)` (`#cefilterServantClearBtn`, `.cefilter-add-btn--clear`) beside Add Servant, hides at zero picks; `ServantSelect.render()` resets `visibleCards` on every pick change + sub-tab entry (`_paintResults`, which "Show N more" calls, does not); restored ids filtered by `Validator.validatePicks` (`/^\d{3,}$/`, deduped) then `ServantData.getServant()`
- **Craft Essence Select** chips (`#cefilterChips`) portrait only like Servant Select ones — no name `span`, CE name stays in `img alt` + remove button `aria-label`; `Clear all (N)` (`#cefilterClearBtn`, `CEFilterApp.clearAllCEs()`) beside Add Craft Essence, hides at zero picks, resets `currentPage`. CE picks + match mode survive refresh (`cePicks`/`ceMode`); class/rarity filters, match-count selection, search, paging still reset
- `src/scripts/domain.js` exports `ServantComboCalculator.buildSharedCEGroups(entries, pickedIds)` → `{ groups, unshared, truncated }`; `src/scripts/ce-servant-select.js` (in `ce-filter-chunk`) is only view
- Match modes: All (AND), Any (OR), Custom Match (exact CE match count)
- Dedicated "Filter Settings" popup modal (`#cefilterFilterModal`): **eight labelled sections in one column, 2px `var(--border)` separator (card own border recipe) between them, body scrolls** — Rarity (`04xx`) / Class / Class (Group) / Alignment (Lawful·Neutral·Chaotic) / Alignment (Good·Balanced·Evil·Other) / Sub-Attribute / Gender / CE Bonus. Every chip built by `FilterSections` (`src/scripts/filter-sections.js`) from `constants.js` lists (`CLASS_GROUPS`, `ALIGNMENT_LNC_FILTERS`, `ALIGNMENT_GBE_FILTERS`, `SUB_ATTR_FILTERS`, `GENDER_FILTERS`) — 48×48 `.class-btn`, 48×36 `.rarity-btn` (★N chips, labelled `★0`…`★5` in that order, CE-count `.ce-count-btn` keep that 48px box), **word chips size to their text** — `.ce-group-btn` + `.rarity-btn` inside group / both alignment / sub-attribute / gender rows are `width: auto; padding: 0 10px`, scoped by `#cefilterFilterModal`/`#servantFilterModal` + row id because word chip + rarity chip are same element — chip is `<button aria-pressed>` because class row must say *present but untouchable*. Group chips (`state.groupClassFilters`) bound class row via `ServantFilters.rowScope`: classes outside group render greyed, never absent; class pick greys nothing — only group or Grand Duel lock does. Matching = `ServantFilters.match` (`domain.js`): union inside row, AND across rows, empty row = no filter, `Other` one chip of its row own union (servant with none of Good/Balanced/Evil — Madness + Summer live there), never veto on chips beside it. Rows read `this._traitsOf(entry)` — **ascension that card matched on**, not `entry.servant.traits`: alignment (23 servants) + sub-attribute (4: `b13919d`) change per ascension, class never. So 415 1st/2nd form answers to Good + Human, 3rd to Evil + **Earth** — attribute comes from Atlas `ascensionAdd.attribute.ascension`, read by `sync_atlas_data.py`; individuality lists never carry it, `2011 skyOrEarthServant` / `2903 kuonjiAliceStage3` are AI gate conditions, not traits (dropped by `normalize_trait_id` on purpose). `base` = intersection of stages, so those four hold no `02xx` on `base`: anything naming no single form — Bond tab party picker, result card with no `primaryAscension` — reads `ServantData.getAllTraits(id)`, union of every form (cached on servant), instead of `servant.traits`. Card naming a form still reads `getTraitsForAscension`, answers to that form attribute only. CE Bonus row still builds one chip per CE count results actually reach
- Direct servant search bar static above controls row (`#cefilterSearchInput`)
- Direct search bar in "Add Craft Essence" modal (`#ceFilterPickerSearch`)
- Mobile 2-per-row grid <580px (`.grid-sm`: `repeat(2, minmax(0, 140px))`)
- Grayscale indicator for CEs with no ascension-level overlap
- Class/rarity filters auto-hide when no matching servant
- Clickable CE badges, overlap modal (click servant portrait → other servants sharing same CEs)
- Paginated results, page state persists on refresh
- Spiritron costume labels: stage costumes with trait diff (e.g. 444 "Earth President") label own stage group via `getAscensionLabel`; label-only costumes (e.g. 388 "Serious Mode", no `300` in `traits`) appended by `ServantData.getSpiritronLabel()` when spiritron CE (trait `2780`) matches base group — combined as "1st Ascension / 2nd Ascension / Serious Mode"

**Shell / Layout:**
- Wide-screen magnification: `BaseLayout.astro` head inline script sets `zoom` on `<html>` to `max(1, min(window.innerWidth / 1400, 2))`, re-applies on `resize`. Window up to 1400 CSS px untouched — 1366 laptop gets nothing; past that layout viewport pinned to 1400 + scaled, so 1120px content rail (80% of width), 160px cards, all type grow together at ratios real 1400 window shows — 1920 at 1.371x, 2560 at 1.829x, 2800+ at 2x cap (ultrawide keeps 2240px-wide column, gains only margin). Cap so text stops doubling on 4K/8K panels; raise `MAX` to fill. `W` was 1280 first, magnified harder (1920 at 1.5x, cap at 2560); owner moved to 1400.
  - Reads `window.innerWidth`, never `documentElement.clientWidth` — `clientWidth` already divided by `zoom` once factor applied, recomputing from it on next `resize` yields wrong factor (`clientWidth` only fallback when `innerWidth` missing).
  - Chrome multiplies viewport units by `zoom`, so `vh`-sized box overshoots real screen: `--screen-h` (`innerHeight / zoom`, declared `100vh` in `:root`) replaces `100vh` on `body{min-height}`, `80vh` on `.servant-modal-content{max-height}`, `calc(80vh - 80px)` on `.cefilter-modal-body{max-height}` in shipped `<style>`. Future viewport-unit length must go through `--screen-h`. At zoom 1 variable equals `100vh`.
  - Nothing else keys off width above 1120: no media query tier past `@media (width >= 1120px)`, two JS `window.innerWidth` staircases (`CEFilterApp._getPageSize()` in `src/scripts/ce-filter-app.js`, LCP preload `matchMedia("(min-width:1120px)")` in `BaseLayout.astro`) top out at 1120 too, so every magnified window resolves same 6-across tier + same 30-card page. Measured at 1400 base: card 160 → 219 → 293 → 320 device px, servant name 11.2 → 15.4 → 20.5 → 22.4 device px at 1280 / 1920 / 2560 / 3840, no horizontal overflow at any size.
  - `scripts/verify_render.js` runs CSS-px assertions at Puppeteer default 800x600, where this script does nothing; only last block (bond slot label) changes viewport, to 320 / 800 / 1120 px, puts 800x600 back after itself.
  - This is magnification approach `.claude/docs/archive/2026-11-04-fluid-desktop-layout-design.md` + `-plan.md` argued against and left unbuilt; see status note at top of each.
- Stale-tab new-version prompt: `BaseLayout.astro` inline script conditional-GETs own URL (30s interval + `focus`), caches ETag in sessionStorage (`fgo_build_etag`), shows fixed-bottom "A new version is available" banner with Reload on new build deploy. Skips localhost. (Client-side — distinct from CI-side ETag build gate below.)

## Build & Dev

```bash
npm run dev        # Astro dev server (localhost:3000)
npm run build      # Production build → dist/
npm run preview    # Serve dist/ locally (localhost:3000)
npm run test       # node --test tests/**/*.test.js — pure-domain unit tests, no browser
npm run lint       # ESLint (src/scripts/) — no CSS linter: the site ships no .css file
npm run format     # Prettier (src/scripts, tests, *.mjs)
npm run format:check # Check formatting without writing
npm run data:sync  # Sync latest servant & CE data from Atlas Academy
npm run data:validate # Validate data schema, traits format, and image existence
npm run check:build # Assert dist/ against scripts/build_baseline.json (exit 1 on drift)
```

`predev`/`prebuild` run `scripts/ensure_data.js` — fresh clone auto-runs `npm run data:sync` if generated data files missing.

`tests/` tracked on `develop` alone, like docs + browser gate (owner decision 2026-11-06): CI never runs `npm run test` — `deploy.yml` only test steps are `npm run check:build` + Python self-checks in `scripts/test_*.py`, which stay public — fresh `main` clone has no `tests/` directory, `npm run test` finds nothing there. Run unit tests from `develop` clone.

**Build-output gate** (`scripts/check_build_output.js` + `scripts/build_baseline.json`, run in CI between Build + Pages upload): asserts chunk names lazy tabs + worker resolve to, byte floors + 3x ceilings per chunk, `<head>` marker order (critical CSS → font preloads → inline poller scripts), two page-text signatures — raw keeps whitespace between adjacent inline elements, normalised collapses it, raw-only difference = whitespace change. `--write` re-captures measurements after intentional change, refuses to run when chunk missing or head marker moved.

**Browser gate** (`scripts/verify_render.js`, local only — out of CI because it needs Chromium download on 10-minute schedule, tracked on `develop` alone, `main` clone can't run it): drives production build with Puppeteer, asserts lazy tabs actually fetch, CE worker returns results, critical CSS paints, `fgo_build_etag` poller present. Last block fills one bond slot, asserts point box label text (`Next Lv. Required`), no label clips, no sideways scroll at 320 / 800 / 1120 px; restores 800x600 default afterwards so assertions above keep CSS-px numbers. Serve first: `npx astro preview`, then `node scripts/verify_render.js`.

### Lighthouse Audit

No npm script, no project dependency — run ad hoc against served build: `npx lighthouse <url>`. Old `npm run lighthouse` invoked `lighthouse-runner.js`, which `.gitignore` lists as temp/test file and doesn't exist in either clone, so script was broken + `lighthouse` devDependency (1,616 lockfile lines) bought nothing; both removed. `node_modules/lighthouse` may still be on disk until `npm prune`.

## Tech Stack

- **Astro 7** (static output, no SSR, base path `/fgo-calculator/`) — needs **Node >= 22.23.4** (`.nvmrc`, `package.json` `engines`, CI `node-version-file: .nvmrc`)
- **Vite 8** bundler → **Rolldown**, not Rollup — chunk layout is `vite.build.rolldownOptions.output.codeSplitting.groups`
- **Vanilla JS ES modules** (no frameworks, no TypeScript at runtime)
- **Self-hosted fonts**: DM Sans + Space Mono (woff2 in `public/fonts/`)
- **PWA**: manifest.json (standalone mode, start_url: ".")

## Architecture

3-layer architecture via ES modules:

| Layer | Modules | Role |
|-------|---------|------|
| **Domain** | Schema, Validator, Calculator, TraitMatcher, ServantComboCalculator, SlotCEs | Pure business logic, no DOM |
| **Application** | StateManager, Persistence, BondApp, CEFilterApp, EventShop App | State coordination |
| **Presentation** | DOMFactory, selectors, modals, UIBuilder | DOM manipulation, events |

### Key Files

- `astro.config.mjs` — Vite chunk splitting config (`data-chunk`, `selectors-chunk`, `ce-filter-chunk`, etc.)
- `src/layouts/BaseLayout.astro` — HTML shell, critical CSS, font preloads, Trusted Types policy
- `src/pages/index.astro` — main page structure, imports all JS modules
- `src/scripts/main.js` — entry: `DOMContentLoaded` → lazy tab init via `import()`
- `src/scripts/domain.js` — trait matching logic, calculator, `SlotCEs` (per-slot essence capacity, pool, sanitising)
- `src/scripts/data.js` — re-exports from `data/` directory
- `src/scripts/bond-app.js` — Bond Calculator controller
- `src/scripts/ce-filter-app.js` — Bond Gain CE controller (Web Worker for matching)
- `src/scripts/ce-servant-select.js` — Servant Select sub-tab view (`ServantSelect`), only consumer of `ServantComboCalculator`, home of `CEFilterStore` (`read()`/`write(patch)`) — keeps it only Bond Gain CE module touching localStorage; `CEFilterApp` imports store instead of using `localStorage` itself
- `src/scripts/event-shop.js` — Event Shop controller

### Lazy Loading

Bond + Event tabs load on-demand via dynamic `import()`:
- `bond-lazy.js` — first Bond tab visit
- `event-lazy.js` — first Event tab visit

Bond Gain CE uses Web Worker (`ce-match-worker.js`) for trait matching off main thread.

### Worker Config

- Worker format: ES modules (`vite.worker.format: "es"` in `astro.config.mjs`)
- Worker inlines `TraitMatcher` from domain.js for off-main-thread computation

### Performance Patterns

- **content-visibility: auto** — skip rendering off-screen servant/CE grids
- **Double rAF yield** — `requestAnimationFrame(() => requestAnimationFrame(() => {...}))` before heavy DOM ops
- **Font loading**: `font-display: swap` body text, `font-display: optional` monospace (prevents FOIT)
- **CLS prevention**: `min-width` + `tabular-nums` on numeric inputs, explicit image dimensions
- **Critical CSS**: no separate stylesheet at all — `src/layouts/BaseLayout.astro` holds entire site CSS as one `<style is:inline>` line, `dist/` ships exactly one `<style>` block + zero `.css` assets. `src/styles/` deleted 2026-11-04, so that block is only place CSS exists. See Known Issues
- **Font preloads**: `fetchpriority="high"` on woff2 files
- **Lazy tab init**: Bond/Event tabs load JS only on first visit
- **CE match cache**: `CEFilterApp._allCEMatchesCache` — populated on first filter, computed in Worker

## Code Style

- **JS**: ES modules, 2-space indent, semicolons required, **double quotes** (Prettier enforces)
- **CSS**: BEM-ish class names (`servant-slot--frontline`), CSS custom properties for theming
- **File naming**: kebab-case (`ce-filter-app.js`, `bond-lazy.js`)

### Lint & Format Config

**ESLint** (`eslint.config.js`):
- `semi: ["error", "always"]` — semicolons required
- `no-unused-vars: ["warn", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }]` — prefix unused with `_`
- `prefer-const: "warn"`, `no-var: "error"`

**Prettier** (`.prettierrc`):
- `singleQuote: false` (double quotes), `trailingComma: "all"`, `printWidth: 120`, `endOfLine: "lf"`

**TypeScript** (`tsconfig.json`):
- Extends `astro/tsconfigs/strict` — strict mode enabled

### DOM Safety
- **Never use `innerHTML`** — use `createElement()`, `textContent`, `setAttribute()`
- Heavy renders: `DocumentFragment` → `replaceChildren()` once
- Below-fold images: `DOMFactory.createLazyImg()` with `loading="lazy"`
- Above-fold small icons: plain `<img>` without lazy

### State Management
- Plain objects, immutable spread updates
- Persist to localStorage on meaningful changes
- Sanitize on load via key allowlists (see `Validator.validateStorageData()`)

### Debounce
- Inputs: 100ms (`DEBOUNCE_MS`)
- Filter renders: 50ms

## Data Layer

- `src/scripts/data/*.js` export `const` — bundled by Vite, not runtime fetch
- Bond point tables: `src/scripts/data/bond_growth.js` exports `BOND_TABLES` (`{ "tN": [16 ints] }`) + `BOND_TABLE_BY_SVT` (`{ "002": "t1" }`) — 471 playable servants share only 76 distinct tables, so map deduped instead of 16 numbers per servant (~18 KB vs ~56 KB in eagerly loaded `data-chunk`). **Atlas `bondGrowth` is running total from Lv.0** (Altria `3000, 9125, 15250, …`); `sync_bond_growth()` differences it, so shipped array is per level step — `table[1]` = 6,125 = Lv.1→Lv.2. Read only via `ServantData.getBondGrowth(id)` (resolves `"467-1"` to `"467"`); `SERVANT_DATA` entries carry no bond field — also why bond changes never rewrite `servants.js` or trip trait-drift full-replacement path
- Trait IDs: 4-digit zero-padded strings (`"0100"` = Saber, `"0002"` = Female)
- Servant multi-ascension: `traits: {"base": [...], "000": [...], "001": [...]}` — diff arrays merged at runtime
- Extra individualities: Atlas keeps some always-on traits out of `traits` — `sync_atlas_data.py` merges permanent `traitAdd` entries (`condType: "none"`, `eventId: 0`, id > 1000) into base + every stage set. Event/quest-gated entries stay out; id > 1000 filter keeps Mash class-form entries (`idx` = classId, carrying another form rarity) out. `"2821"` reaches 22 servants only this way (314/334 Koyanskaya among them); old `cno == 238` hardcode gone
- CE match modes: OR (default), AND (`matchAll: true`), AND-of-ORs (`traitGroups`), override (`alsoMatch`)
- New CE fields: whitelist in `CEList` IIFE (`src/scripts/data.js`)
- New servant fields: handle in `ServantData.load()` (`src/scripts/data.js`)

### Adding Data

1. Trait IDs: sort ascending in arrays
2. New trait: add to `TRAIT_DATA` (`src/scripts/data/traits.js`) with display name
3. Servant images: `public/servants/{ID}/{ascension}.webp`
4. CE images: `public/craft_essences/{ID}.webp` (bordered 142×155, unified for all display sizes)

## Deployment & CI/CD Pipeline

- **Branch flow**: `feat/*` → `develop` → `main`, **`develop` local-only** (unpublished 2026-11-03: `origin` carries `main` alone). CI never needed it — workflow triggers are push to `main`, 10-minute schedule, `workflow_dispatch`. Bare `git push` on `develop` now errors "no upstream branch" — that's guard; re-publish with `git push -u origin develop` if ever wanted on GitHub.
- **Docs + local-only browser gate never reach `main` (owner decision 2026-11-04; gate joined 2026-11-05).** `.claude/CLAUDE.md`, `.claude/docs/**`, `AGENTS.md`, `GEMINI.md`, `scripts/verify_render.js`, `tests/` tracked on `develop` only — `main` is public repo GitHub Pages deploys from, those files name local paths + two-clone workflow, CI never runs gate or unit tests. `scripts/fetch_bordered_ces.py` stays public: `sync_atlas_data.py` imports it inside `try`, CI sync step runs that. Ship code with **`scripts/merge_code_only.sh [source]`** (default `develop`): `git merge --no-ff --no-commit`, then `git rm -r -f --cached .claude AGENTS.md GEMINI.md scripts/merge_code_only.sh scripts/verify_render.js tests` (script hides itself too) before commit, then assert `main` tree holds none. `--cached` leaves files on disk as ignored untracked — works only while `main` `.gitignore` carries rule for each (bare `.claude` line + `scripts/merge_code_only.sh`, `scripts/verify_render.js`, `/tests/`); script restores `main` file instead of taking `develop`'s, checks each path with `git check-ignore --no-index`, prints note when branches disagree on `.gitignore` (code-relevant ignore line then needs hand-porting); `-f` also settles `modify/delete` conflicts every merge after first raises for doc file `main` deleted + `develop` edited. Refuses dirty tree, stale local `main`, unresolved **code** conflict (exit 1, merge left in progress — fix + `git commit`, or `git merge --abort`); never pushes. Bare `git merge develop` into `main` still forbidden: drags whole doc tree (happened, undone with `git reset --hard origin/main` before push), same for `git pull origin develop` (same merge) and `--no-ff`/`-X ours` (flags change commit shape + conflicting hunks only, never one-sided doc additions). Can't commit by pathspec mid-merge — `git commit -- src tests` dies with `fatal: cannot do a partial commit during a merge.` — so drop-the-docs denylist is only merge route. Cherry-picking code commits onto `main` stays fine.
- **Pages source**: GitHub Actions (not branch-based)
- **Zero Committed Images**: `public/servants/` + `public/craft_essences/` gitignored. Assets synced at build time, cached with `actions/cache@v4`.
- **Triggers**:
  - Push to `main` (always builds + deploys to Pages)
  - Every-10-min schedule (version-gated; syncs + revalidates via ETag; build skipped when no data changed)
  - `workflow_dispatch` (manual run, optional `force_sync` input)
- **ETag revalidation + build gate**: `sync_atlas_data.py` revalidates cached JSON with conditional GETs (304 = ~0 bytes idle). CI hashes three generated data JS files vs previous run (`.ci-baselines/data_hash.txt`, see version-baseline cache below); build/validate/deploy skipped on `schedule` run when hash unchanged. Push/dispatch always build. `force_sync` passes `--force` to bypass cache.
- **`/info` version gate**: before env setup or sync, one ~230-byte `GET /info` compares JP **and** NA `hash` with `.ci-baselines/data_version.txt`. Idle `schedule` runs stop green on `UNCHANGED` (~15s); push/dispatch/`force_sync` always continue. Network/parse failures report `UNKNOWN`, fall through to full sync.
- **Version baseline cache**: two gate baselines (`data_version.txt`, `data_hash.txt`) in `.ci-baselines/`, round-tripped by `actions/cache/restore@v4` + `actions/cache/save@v4` keyed `fgo-version-baseline-${{ github.run_id }}-${{ github.run_attempt }}` (save step after `Upload Pages artifact`; save `if` gated on push/`CHECK==CHANGED`/`DATA_DIRTY==true`). Lesson: `actions/cache` never re-saves blob on exact-key hit — mutable CI state inside script-keyed asset cache freezes, so every run after real data change re-detected `CHANGED` forever (dispatch runs #60/#61, 2026-10-20). Run-unique key always misses, so save persists; `restore-keys` picks newest entry. `run_attempt` in key required: `run_id` stable across `gh run rerun`, `cache/save` hard-fails on existing key.
- `dist/` gitignored — CI generates it

## Known Issues

- **CSS has single home: `<style is:inline>` in `BaseLayout.astro`.** `src/styles/global.css` + `src/styles/critical.css` deleted 2026-11-04, directory gone — no second copy to keep in step, no `npm run lint:css`. Never loaded (no Astro CSS entry, `dist/` ships zero `.css` files), hand-maintained drift already cost live site: `.cefilter-sort-order-btn:active { background: var(--bg) }` existed **only** in `global.css`, so sort-direction button had no press state — rule now ported to `BaseLayout.astro`. Two other measured differences left as shipped copy has them, shipped copy is correct one: `#panel-cefilter > .card:first-child .card-inner { position: relative }` stays unconditional (dead file wrapped it in `@media (width >= 760px)`), font `src` URLs stay `fonts/…` relative (dead file had `/fonts/…`, breaks under `/fgo-calculator/` base path). Stylelint, `.stylelintrc.json`, both stylelint devDependencies went too — linted CSS that never reached browser. `scripts/check_build_output.js` now pins `.cefilter-subpanel` display rules across two texts (`dist/index.html`, `BaseLayout.astro`) instead of three. Last known difference unmeasured: nothing checks rule added to `BaseLayout.astro` is rule site wanted, only that sub-tab display set survives
- `.claude/` only half ignored — `.gitignore` says `.claude/*` + negates `.claude/CLAUDE.md` and `.claude/docs/`, so handoff docs + root `AGENTS.md` / `GEMINI.md` tracked, reach CI or fresh clone; `settings.local.json` + anything else new under `.claude/` stays local. Do **not** collapse back to bare `.claude` line: git can't re-include path under excluded directory, negations would stop matching, docs silently un-track (`git check-ignore -v .claude/CLAUDE.md` says nothing when right)
- **`astro build` fails on Astro >= 6 anywhere under `/mnt/storage` (this repo mount, `ntfs3`)**, working copy + fresh clone alike: Vite client-environment dependency optimizer runs at build time, bundles Astro `astro/runtime/client/dev-toolbar/entrypoint.js`, dies with `[MISSING_EXPORT] "loadDevToolbarApps" is not exported by "node_modules/astro:toolbar:internal/dist/index.js"`. Identical tracked files, identical `node_modules` (424 packages, byte-identical Astro), cold caches: builds fine on tmpfs, fails here. `devToolbar: { enabled: false }` no help — include list naming entrypoint unconditional in Astro environment config. GitHub runners **don't** hit it: CI run 41594463380 built Astro 7.4.5 green 2026-11-03 (`build` + `Check build output` step, `self-test`, `deploy`) — local-mount defect only, live site passed `node scripts/verify_render.js`.
- **`__vite__injectQuery has already been declared` in browser console on localhost:3000 is same mount, not Astro version** — reproduces on cold `node_modules/.vite` with Astro 5.18.2 + Vite 6.4.2 and Astro 7 + Vite 8, from optimized-dep chunk (`node_modules/.vite/deps/`). Page still works: cards, slots, pagination render.
- **Working arrangement (chosen 2026-11-03): build + run dev from `/home/famakung/dev/fgo-calculator`** (`cd` there first — `astro` is project-local bin, use `npm run dev` for server (`package.json` passes `--port 3000`, `astro.config.mjs` sets `server.port`/`preview.port` to 3000, bare `npx astro dev` lands on 3000 too; explicit `--port` still wins, which browser gate 4173 relies on), `npx astro dev status|logs|stop` for daemon controls), clone of `develop` on btrfs, `origin` = GitHub. Everything works there on Astro 7 — `npm run build`, `npm run check:build`, `npm run lint`, browser gate (`npx astro preview`, then `node scripts/verify_render.js`), `npm run dev` with zero page errors. This `/mnt/storage` checkout stays editor-side copy: `package.json` + lock declare `^7.4.5`, `node_modules` here holds Astro 5.18.2 installed `--no-save` so dev server still runs, copy that shows `__vite__injectQuery` console error. Two clones = two git dirs: commit + push from native one, then `git -C /mnt/storage/Dev/Projects/fgo-calculator pull` to catch editor copy up.
- Astro 7 makes `astro dev` + `astro preview` **detached daemons**: command returns immediately, server keeps running. Controls `astro dev stop|status|logs`, `astro preview stop|status|logs`. Second `astro preview --port N` prints `already running at <first port>` + exits 0 instead of serving N, so `npm run preview` no longer binds server to terminal.
- Generated data gitignored — fresh clone needs `src/scripts/data/*.js`, `public/servants/`, `public/craft_essences/` copied in (or `npm run data:sync`) before `prebuild` `ensure_data.js` stops trying to sync.
- Node: default runtime now **v22.23.4** — upgraded in place inside `~/.local/node` (`~/.local/bin/node` symlink puts it on `PATH`), no `PATH=` prefix needed anywhere. Old 22.14.0 files in `~/.local/node-22.14.0-backup/` (`bin/node`, `lib/node_modules/{npm,corepack}`), tarball copy at `~/.local/node-v22.23.4/`. Roll back by moving those three paths back into `~/.local/node`. `npm` only *warns* on `EBADENGINE`, so always check `node --version` before trusting build.

## Common Patterns

### Pending Slot
Add servant/CE → push `null` to state → open modal → cancel removes null entry

### CE Match Cache
`CEFilterApp._allCEMatchesCache` — populated on first filter, computed in Worker

### Tab Init
Head inline `<script>` sets `data-tab` on `<html>` + preloads LCP images before DOMContentLoaded

### Trusted Types
`BaseLayout.astro` defines inline Trusted Types policy (`default`) in `<head>` before any scripts load. All DOM sinks (`innerHTML`, `insertAdjacentHTML`, etc.) need policy-wrapped values.