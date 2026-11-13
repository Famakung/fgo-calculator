# FGO Calculator

A web-based calculator for Fate/Grand Order with three tools: **Event Shop Calculator** for optimizing event item farming, **Bond Calculator** for planning bond point farming, and **Bond Gain CE** for looking up eligible servants by CE traits.

**Live at:** https://famakung.github.io/fgo-calculator/

## Features

### Event Shop Calculator
- **Select Event** card (same pattern as Bond's Select Quest): every active event shop is auto-fetched from Atlas Academy at data-sync time; switch between concurrent events, latest pre-selected, no blank option
- **Per-event plans**: each event keeps its own Required/Held/Bonus save (`fgo_event_shop_data`); switching swaps plans, old saves migrate automatically
- Per-currency **config modal**: click a Required display on a tier card to open that currency's shop items; steppers per item, then **Default** (clear), **Select All** (buy out every limited item), **Cancel** (discard), or **Done** (apply)
- Required fields are read-only displays showing the live per-currency total (Σ require × price); Held and Bonus stay directly editable
- **Drop Rates per Run**: each currency gets its own card with a quest dropdown (every quest dropping that currency, REC Lv order, community drop data via Atlas) — quest name, REC Lv., and two real-data drop lines `stack(+bonus)  amount / run` (amount = dropExpected × stack size): the card's own currency, then the quest's second-best shop-currency drop, `—` when it has none, event points and QP never offered. A fourth card appears when a quest drops every shop currency. Editing that currency's Bonus moves its lines live. AP stays in the data but off every card
- **Best Farm Runs** results: the trade-aware optimizer finds the minimum-play plan and only the minimum trades needed to cover each shortfall. The card shows **Quests to Play** (farm-style cards with the run count; long quest names slide on a single line), then **Item Receive** (one card with each currency's raw drops from the runs as `×`-counts overlaid on the art — held items and trade results excluded), then **Shop Trades** (per-trade cards with the exchange ratio overlaid on the from/to icons). Required totals live in the Shop Requirements boxes, not the results card
- Item names in English where available (NA server → Atlas EN translation → JP fallback); costume items show the actual costume face
- Tier cards wear event currency images and names; between events the tab falls back to the legacy generic calculator (badges, editable Required, base/primary/secondary drop config)
- Saves inputs to localStorage

### Bond Calculator
- Dynamic servant slots (up to 6) with portraits and drag-to-reorder
- Class icon filter in servant picker modal (multi-select, 15 classes)
- Two servant types: Normal (with independent "Max Bond" and "Bond ≥15" checkboxes), Support (no calculation)
- Multi-ascension support for servants with per-ascension trait differences
- Craft Essence bonus system with trait-based matching
- Frontline bonus (×1.2 multiplier + flat 20% of base) for first 3 slots
- Frontline support bonus (+4% as multiplier and flat per support) applies to all calculated servants
- Max Bond & Bond ≥15 checkboxes: "Max Bond" hides the bond required input, while "Bond ≥15" grants a +25% party bond bonus (usable even while leveling up to Bond 16)
- Visual slot badges: Starting member slots display frontline bonus badges (+20% self for Normal, +4% All for Support); checking "Bond ≥15" displays a "Bond All +25%" badge in any slot (stacked below +self 20% when in starting member)
- Quest presets (Free Quest Lv.83/84, Grand Duel Lv.100) or custom bond and AP per run
- Bond level planning: **Current Lv.** (0–15) and **Target Lv.** (up to 16) per slot, with every level's cost read from that servant's own Atlas table
- **Bond Point Required** fills itself with the cost of the level you are standing on; overwrite it with the number the game shows when you are partway through a level
- Choosing Current Lv. 15 ticks "Bond ≥15" for you (that is the level paying the +25% party bonus); a lower level unticks it
- Per-servant results with bond breakdown and run count; when the plan crosses more than one level the card lists the runs per stretch (`Bond Lv.0->2` / `1 run`), carrying surplus up to Lv.10 and rounding alone above the bond cap
- **Total AP & Golden Fruit calculation**: Shows total AP required across the party (Free Quest: 22 AP, Grand Duel: 40 AP, or custom AP/run) and Golden Fruit requirement based on configurable **Max AP** (default: 152 AP, positioned on the bottom left of Party Setup)
- **Stargazer's Teapot**: Spend teapots for 2× bond per run; displays boosted phase and unboosted continuation with a static "Out of Stargazer's Teapot" status chip when teapots run out

### Bond Gain CE
- Two sub-tabs: **Craft Essence Select** (CEs → servants, default) and **Servant Select** (servants → shared CEs)
- Servant Select: pick any number of servants, get one card per distinct shared CE list with every servant that can use it
- Servant Select splits multi-ascension servants: when a servant's ascension groups match different CEs, each group shows its own portrait, the same way Craft Essence Select cards it — badge is image only, the ascension names sit in the hover tooltip
- Servant Select defaults to the full servant roster when no servants are picked, keeps your picked servants and active sub-tab across refreshes (`fgo_ce_filter_data`), and "Clear all (N)" empties the list in one click
- Reverse lookup: select CEs to find matching servants
- Selected-CE chips are portrait only, same shape as the Servant Select chips; "Clear all (N)" next to "Add Craft Essence" empties the selection in one click
- Match modes: All (AND), Any (OR), and Custom Match (filter by exact CE match count)
- Dedicated "Filter Settings" modal (`#cefilterFilterModal` in Bond Gain CE, `#servantFilterModal` in Servant Picker, and `#ceOverlapFilterModal` in Overlap Modal) with Rarity, Class, Class Group, Alignment (L/N/C), Alignment (G/B/E/Other), Sub-Attribute, Gender, and CE Bonus filter chips
- Modal action footer with **Default** (clears selections), **Select All** (selects all valid options), **Cancel** (discards draft changes), and **OK** (applies filter changes to background and closes modal); `#servantModal` also includes a multi-select action footer (**Default**, **Select All**, **Cancel**, **OK**) when adding servants in Servant Select
- Direct servant search bar positioned statically above controls row
- Direct search bar and action footer (**Default**, **Cancel**, **OK**) in "Add Craft Essence" modal (`#ceFilterModal`), applying selected CEs to the background only upon clicking OK
- Mobile-optimized 2-per-row grid layout on narrow screens
- CE match count buttons ("1 CE", "2 CE", etc.) disable (`.ce-count-btn--disabled`) when no servant with that match count exists in results, consistent with disabled class and group chips
- CE picker shows grayscale indicator for CEs with no ascension-level overlap with selected CEs
- Class (`3×5` icon grid) and rarity filter buttons disable (`.class-btn--disabled`, `.rarity-btn--disabled`) when no servant with that trait exists in results or outside an active group/quest lock
- Searchable results by servant ID or name
- Shows matching CE badges and trait tags per servant
- Clickable CE badges to add to selection
- Click servant portrait to see other servants sharing the same CEs (overlap modal with combo cards and Filter Settings modal)
- Spiritron costume labels shown alongside ascension labels (e.g. "1st Ascension / 2nd Ascension / Serious Mode") when a spiritron CE is selected
- Paginated results (5 rows per page: 10–30 items based on viewport columns) in both Craft Essence Select and Servant Select with prev/next navigation

## Tech Stack

- **Astro** (static output) — builds single-page app with code splitting and optimized chunks
- **Vanilla JavaScript** — ES modules, no framework dependencies
- **Zero web fonts** — Native system font stacks (`system-ui`, `ui-monospace`) for instant rendering and 0 KB font payload
- **All images WebP** — servant portraits, CE thumbnails, UI icons
- **Lighthouse 100/100/100/100** — Performance, Accessibility, Best Practices, SEO

## Usage

### Event Shop
1. Open the Event Shop tab — pick an event in **Select Event** (latest is pre-selected)
2. Click a currency's Required display to open its config modal
3. Set how many of each item you want to buy (steppers clamp at the shop limit); **Select All** buys out every limited item, **Default** clears the draft
4. **Done** applies the plan — Required displays and totals update; **Cancel** discards
5. Enter current holdings (Held) and drop Bonus (plussed into each drop's base amount)
6. Click "Calculate Quest Runs" — runs and AP per currency, based on the best-drop quest

### Bond Calculator
1. Add servants and select from the portrait modal
2. Choose servant type (Normal or Support)
3. For Normal servants, toggle "Max Bond" (if already maxed) and/or "Bond ≥15" (+25% party bond bonus)
4. Set **Current Lv.** and **Target Lv.** — **Bond Point Required** fills itself from that servant's table
5. Partway through a level? Replace the box with the number the game shows you; the levels above still come from the table
6. Add Craft Essences for bonus traits
7. Select a quest
8. Click "Calculate Quest Runs" — total runs plus, when more than one level is crossed, the runs per stretch of levels

### Bond Gain CE
1. Click "Add Craft Essence" to select CEs
2. Choose match mode (Match All / Match Any OR / Custom Match)
3. Browse matching servants in the results grid
4. Search by servant ID or name to narrow results
5. Or switch to the "Servant Select" sub-tab, click "Add Servant" and pick servants to see which CE lists they share

## CE Trait Matching

Craft Essences apply bonuses based on servant traits with four modes:

| Mode | Field | Behavior |
|------|-------|----------|
| **OR** | `traits` array | Servant needs ANY matching trait |
| **AND** | `traits` + `matchAll: true` | Servant must have ALL traits |
| **AND/OR** | `traitGroups` | Each group OR-matched; ALL groups must match |
| **Override** | `alsoMatch` array | Instant match if servant has any listed trait (e.g. servant-specific overrides) |

## File Structure

```
fgo-calculator/
├── astro.config.mjs          # Astro config: static output, base path, Vite chunk splitting
├── tsconfig.json              # TypeScript config (Astro strict)
├── package.json               # Dependencies: astro; puppeteer + eslint + prettier (devDeps)
│
├── src/
│   ├── layouts/
│   │   └── BaseLayout.astro   # HTML shell, inline CSS, Trusted Types, manifest
│   ├── pages/
│   │   └── index.astro        # Main page: tab panels, UI structure, imports all JS modules
│   └── scripts/
│       ├── main.js            # Entry: DOMContentLoaded → lazy tab init (dynamic import())
│       ├── bond-lazy.js       # Lazy entry: BondApp + selectors (on Bond tab switch)
│       ├── event-lazy.js      # Lazy entry: EventShop init (on Event tab switch)
│       ├── ce-filter-app.js   # CEFilterApp (Worker; CE picks + match mode persist via CEFilterStore)
│       ├── ce-servant-select.js # Servant Select sub-tab view + CEFilterStore
│       ├── ce-match-worker.js # Worker entry (TraitMatcher inlined)
│       ├── filter-sections.js # FilterSections chip builder + FilterModalController
│       ├── constants.js       # All constants
│       ├── domain.js           # Schema, Validator, Calculator, BondLevelCalculator, TraitMatcher, ServantComboCalculator, SlotCEs, ServantFilters, ServantSort
│       ├── data.js             # ServantData (incl. getBondGrowth), TraitNames, CEList, CEById, TraitCEs
│       ├── state.js            # StateManager, Persistence
│       ├── presentation.js     # DOMFactory, CollapsibleFactory, ComboCardRenderer, debounce
│       ├── selectors.js        # ServantSelector, AscensionSelector, CESelector, etc.
│       ├── bond-app.js         # BondApp (configure() for refs, _initialized guard)
│       ├── event-shop.js       # UIBuilder, ViewManager, EventHandler, App (tier calculator)
│       ├── event-shop-tier.js  # Event-native tier skin (currency images, read-only Required)
│       ├── event-shop-farm.js  # Drop Rates per Run cards + event-mode results
│       ├── event-shop-farm-lines.js # A card's two per-run drop lines, repainted on Bonus edits
│       ├── event-shop-farm-controls.js # Farm-card Required display + the Held/Bonus pair a tier card lacks
│       ├── event-shop-modal.js # EventShopModal (per-currency draft config modal)
│       ├── event-planner.js    # EventPlanner (shop plan state + persistence)
│       ├── event-planner-parts.js # Pure builders for modal draft rows
│       ├── tab-navigator.js    # TabNavigator (lazy init callbacks)
│       └── data/
│           ├── servants.js      # SERVANT_DATA
│           ├── craft_essences.js # CE_DATA
│           ├── traits.js        # TRAIT_DATA
│           ├── bond_growth.js   # BOND_TABLES + BOND_TABLE_BY_SVT (bond points per level step)
│           └── event_shop.js    # EVENT_SHOP_DATA (current event shop, generated)
│
├── public/                     # Static assets (served as-is by Astro)
│   ├── manifest.json           # PWA manifest (start_url: ".", standalone)
│   ├── robots.txt              # Allow all
│   ├── .nojekyll               # Prevent Jekyll processing on GitHub Pages
│   ├── favicon.svg             # SVG favicon
│   ├── servants/               # Servant portraits ({atlasId}/{stage}.webp) [build-cached]
│   ├── craft_essences/         # CE images: {atlasId}.webp (unified 142×155 bordered WebP) [build-cached]
│   ├── event_shop/             # Event shop icons: {kind}_{id}.webp (bordered-first) [build-cached]
│   └── icons/                  # UI icons (classes, materials, PWA)
│
├── scripts/                    # Build-time sync and validation engine
│   ├── sync_atlas_data.py      # Incremental Atlas Academy sync (traits, face icons, multi-ascension, bond tables)
│   ├── validate_data.js        # Data integrity, schema, and image existence validator
│   └── fetch_bordered_ces.py   # Craft Essence icon fetcher & WebP converter
│
└── .github/workflows/
    └── deploy.yml              # CI/CD: cache assets, sync data, validate, build & deploy to Pages
```

## Architecture

The application follows a 3-layer architecture using ES modules bundled by Astro:

| Layer | Modules | Purpose |
|-------|---------|---------|
| **Domain** | Schema, Validator, Calculator, BondLevelCalculator, TraitMatcher, ServantComboCalculator, SlotCEs, ServantFilters, ServantSort, EventShop | Pure business logic, no DOM |
| **Application** | StateManager, Persistence, App, BondApp, CEFilterApp, ServantSelect, CEFilterStore, EventPlanner | State management and coordination |
| **Presentation** | DOMFactory, CollapsibleFactory, FilterSections, FilterModalController, ComboCardRenderer, UIBuilder, ViewManager, EventHandler, TabNavigator, ServantSelector, CESelector, AscensionSelector, CESubSelector, ServantDrag, CEFilterPicker, CEServantOverlap, EventShopModal | DOM manipulation, modals, events |

## Build & Data Commands

```bash
npm install          # Install dependencies
npm run dev          # Astro dev server (localhost:3000)
npm run build        # Build with Astro (output: dist/)
npm run preview      # Local preview server
npm run lint         # ESLint (src/scripts/)
npm run data:sync    # Sync latest servant, CE & active event shop data from Atlas Academy
npm run data:validate # Validate data schema, traits format, and image existence
```

Astro produces optimized chunks via Vite:
- Eager: `main-entry`, `data-chunk`, `ce-filter-chunk`, `tab-navigator-chunk`, `selectors-chunk`
- Lazy: `bond-lazy` (Bond tab), `event-lazy` (Event tab)
- Worker: `ce-match-worker` (TraitMatcher, offloaded from main thread)

## Technical Details

- Vanilla JavaScript with no external runtime dependencies
- Native system fonts (`system-ui`, `ui-monospace`) with zero font payload
- All images WebP format
- Trusted Types policy (`default`) enforced via inline script in `<head>`
- All DOM elements created safely with `createElement()` (no innerHTML)
- Data files use `export const` imported by `src/scripts/data.js`, bundled by Vite
- Schema-based input validation with localStorage sanitization
- Debounced input handlers (100ms)
- Multi-ascension servant support with per-ascension traits, ascension stage face icons, and spiriton dress images
- Automated build-time data sync pipeline (`scripts/sync_atlas_data.py`) with polite rate limiting (`0.1s`), automatic multi-ascension detection, full-auto Craft Essence data detection & series grouping, dynamic bordered icon synchronization, and bond point tables converted from Atlas' running totals into per-level-step costs (471 playable servants deduped into 76 shared tables)
- Zero-commit binary assets architecture: servant, CE, and event shop images are gitignored, cached ephemerally via GitHub Actions (`actions/cache@v6`), and synced at build time
- PWA manifest with standalone display mode
- Performance optimized: Web Worker for CE trait matching, double-rAF yield, lazy tab initialization, `content-visibility: auto`, critical CSS inlined, zero web-font network overhead, CLS prevention with `min-width` and `tabular-nums`

## Git

- `main` — production (GitHub Pages deploys from this branch)
- `develop` — integration
- `feat/*` — features
- Flow: feat → develop → main → push triggers GitHub Actions auto-build + deploy
- GitHub Pages source: "GitHub Actions" (not branch-based)
- `dist/` is gitignored — CI generates build output
