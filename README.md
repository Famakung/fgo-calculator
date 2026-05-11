# FGO Calculator

A web-based calculator for Fate/Grand Order with three tools: **Event Shop Calculator** for optimizing event item farming, **Bond Calculator** for planning bond point farming, and **Bond Gain CE Filter** for looking up eligible servants by CE traits.

**Live at:** https://famakung.github.io/fgo-calculator/

## Features

### Event Shop Calculator
- Input bronze, silver, and gold event items needed/owned
- Configure bonus drop amounts per material type
- Adjust base drops and primary/secondary multipliers
- Automatically calculates optimal quest runs
- Saves inputs to localStorage

### Bond Calculator
- Dynamic servant slots (up to 6) with portraits and drag-to-reorder
- Class icon filter in servant picker modal (multi-select, 15 classes)
- Three servant types: Normal, Support (no calculation), Max Bond (+25% to all)
- Multi-ascension support for servants with per-ascension trait differences
- Craft Essence bonus system with trait-based matching
- Frontline bonus (×1.2 multiplier + flat 20% of base) for first 3 slots
- Frontline support bonus (+4% as multiplier and flat per support) applies to all calculated servants
- Quest presets (Free Quest Lv.83/84, Grand Duel Lv.100) or custom bond per run
- Per-servant results with bond breakdown and run count

### Bond Gain CE Filter
- Reverse lookup: select CEs to find matching servants
- Match modes: All (AND), Any (OR), and Custom Match (filter by exact CE match count)
- Collapsible filter panel with search, class filter, rarity filter, and CE match count buttons
- CE match count buttons ("1 CE", "2 CE", etc.) filter by number of matching CEs
- CE picker shows grayscale indicator for CEs with no ascension-level overlap with selected CEs
- Class and rarity filter buttons hide when no servant with that trait exists in results
- Searchable results by servant ID or name
- Shows matching CE badges and trait tags per servant
- Clickable CE badges to add to selection
- Click servant portrait to see other servants sharing the same CEs (overlap modal with CE image filter, search, class/rarity filters, and count filter)
- "No Matching CE" section shows servants that don't match any trait-based CE
- Paginated results (30 servants per page) with prev/next navigation, page state persists on refresh

## Tech Stack

- **Astro** (static output) — builds single-page app with code splitting and optimized chunks
- **Vanilla JavaScript** — ES modules, no framework dependencies
- **Self-hosted fonts** — DM Sans + Space Mono (woff2, font-display: swap)
- **All images WebP** — servant portraits, CE thumbnails, UI icons
- **Lighthouse 100/100/100/100** — Performance, Accessibility, Best Practices, SEO

## Usage

### Event Shop
1. Enter shop requirements (items needed) and current holdings
2. Set bonus amounts and drop rate multipliers
3. Click "Calculate Quest Runs"

### Bond Calculator
1. Add servants and select from the portrait modal
2. Choose servant type (Normal/Support/Max Bond)
3. For Normal servants, enter bond points needed
4. Add Craft Essences for bonus traits
5. Select a quest
6. Click "Calculate Quest Runs"

### CE Filter
1. Click "Add Craft Essence" to select CEs
2. Choose match mode (Match All / Match Any OR / Custom Match)
3. Browse matching servants in the results grid
4. Search by servant ID or name to narrow results

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
├── package.json               # Dependencies: astro (dev), lighthouse + puppeteer (devDeps)
│
├── src/
│   ├── layouts/
│   │   └── BaseLayout.astro   # HTML shell, inline CSS, font preloads, Trusted Types, manifest
│   ├── pages/
│   │   └── index.astro        # Main page: tab panels, UI structure, imports all JS modules
│   ├── scripts/
│   │   ├── main.js            # Entry: DOMContentLoaded → lazy tab init (dynamic import())
│   │   ├── bond-lazy.js       # Lazy entry: BondApp + selectors (on Bond tab switch)
│   │   ├── event-lazy.js      # Lazy entry: EventShop init (on Event tab switch)
│   │   ├── ce-filter-app.js   # CEFilterApp (Worker, no localStorage)
│   │   ├── ce-match-worker.js # Worker entry (TraitMatcher inlined)
│   │   ├── constants.js       # All constants
│   │   ├── domain.js           # Schema, Validator, Calculator, TraitMatcher
│   │   ├── data.js             # ServantData, TraitNames, CEList, CEById, TraitCEs
│   │   ├── state.js            # StateManager, Persistence
│   │   ├── presentation.js     # DOMFactory, CollapsibleFactory, debounce
│   │   ├── selectors.js        # ServantSelector, AscensionSelector, CESelector, etc.
│   │   ├── bond-app.js         # BondApp (configure() for refs, _initialized guard)
│   │   ├── event-shop.js       # UIBuilder, ViewManager, EventHandler, App
│   │   ├── tab-navigator.js    # TabNavigator (lazy init callbacks)
│   │   └── data/
│   │       ├── servants.js      # SERVANT_DATA
│   │       ├── craft_essences.js # CE_DATA
│   │       └── traits.js        # TRAIT_DATA
│   └── styles/
│       ├── critical.css        # Above-fold CSS (inlined by Astro)
│       └── global.css          # Full styles (loaded by Astro)
│
├── public/                     # Static assets (served as-is by Astro)
│   ├── manifest.json           # PWA manifest (start_url: ".", standalone)
│   ├── robots.txt              # Allow all
│   ├── .nojekyll               # Prevent Jekyll processing on GitHub Pages
│   ├── favicon.svg             # SVG favicon
│   ├── fonts/                  # Self-hosted web fonts (DM Sans, Space Mono — woff2)
│   ├── servants/               # Servant portraits ({ID}/{ascension}.webp)
│   ├── craft_essences/         # CE images: 128/{ID}.webp (full) + 64/{ID}.webp (thumb)
│   └── icons/                  # UI icons (classes, materials, PWA)
│
└── .github/workflows/
    └── deploy.yml              # GitHub Actions: Astro build + deploy to Pages on push to main
```

## Architecture

The application follows a 3-layer architecture using ES modules bundled by Astro:

| Layer | Modules | Purpose |
|-------|---------|---------|
| **Domain** | Schema, Validator, Calculator, TraitMatcher | Pure business logic, no DOM |
| **Application** | StateManager, Persistence, App, BondApp, CEFilterApp | State management and coordination |
| **Presentation** | DOMFactory, CollapsibleFactory, UIBuilder, ViewManager, EventHandler, TabNavigator, ServantSelector, CESelector, AscensionSelector, CESubSelector, ServantDrag, CEFilterPicker, CEServantOverlap | DOM manipulation, modals, events |

## Build

```bash
npm install          # Install dependencies
npm run build       # Build with Astro (output: dist/)
npm run preview      # Local preview server
```

Astro produces optimized chunks via Vite:
- Eager: `main-entry`, `data-chunk`, `ce-filter-chunk`, `tab-navigator-chunk`, `selectors-chunk`
- Lazy: `bond-lazy` (Bond tab), `event-lazy` (Event tab)
- Worker: `ce-match-worker` (TraitMatcher, offloaded from main thread)

## Technical Details

- Vanilla JavaScript with no external runtime dependencies
- Self-hosted fonts (DM Sans, Space Mono) via `@font-face` with woff2 and font-display: swap
- All images in WebP format
- Trusted Types policy (`default`) enforced via inline script in `<head>`
- All DOM elements created safely with `createElement()` (no innerHTML)
- Data files use `export const` imported by `src/scripts/data.js`, bundled by Vite
- Schema-based input validation with localStorage sanitization
- Debounced input handlers (100ms)
- Multi-ascension servant support with per-ascension traits and spiriton dress images
- PWA manifest with standalone display mode
- Performance optimized: Web Worker for CE trait matching, double-rAF yield, lazy tab initialization, `content-visibility: auto`, `font-display: optional`, critical CSS inlined, font preloads with `fetchpriority="high"`, CLS prevention with `min-width` and `tabular-nums`

## Git

- `main` — production (GitHub Pages deploys from this branch)
- `develop` — integration
- `feat/*` — features
- Flow: feat → develop → main → push triggers GitHub Actions auto-build + deploy
- GitHub Pages source: "GitHub Actions" (not branch-based)
- `dist/` is gitignored — CI generates build output