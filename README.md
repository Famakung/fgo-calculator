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
- Frontline bonus (+20%) for first 3 slots
- Frontline support bonus (+4%) when support is in frontline
- Quest presets (Free Quest Lv.83/84, Grand Duel Lv.100) or custom bond per run
- Per-servant results with bond breakdown and run count

### Bond Gain CE Filter
- Reverse lookup: select CEs to find matching servants
- Match modes: All (AND), Any (OR), and Custom Match (filter by exact CE match count)
- CE match count buttons ("1 CE", "2 CE", etc.) filter by number of matching CEs
- CE picker shows grayscale indicator for CEs with no ascension-level overlap with selected CEs
- Class and rarity filter buttons hide when no servant with that trait exists in results
- Searchable results by servant ID or name
- Shows matching CE badges and trait tags per servant
- Clickable CE badges to add to selection
- Click servant portrait to see other servants sharing the same CEs (overlap modal with multi-select filter)
- "No Matching CE" section shows servants that don't match any trait-based CE

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
├── index.html              # Main HTML with static grid elements, tab panels and modals
├── styles.css              # CSS source (~1930 lines)
├── styles.min.css          # Minified CSS (served to browser)
├── app.js                  # All logic in single IIFE (~3250 lines, source)
├── app.min.js              # Minified JS (served to browser)
├── tab-init.js             # (Removed; logic inlined in index.html <head> to eliminate render-blocking request)
├── sw.js                   # Service Worker (cache-first for assets, stale-while-revalidate for code)
├── register-sw.js          # SW registration (separate file for CSP compliance)
├── manifest.json           # PWA manifest
├── fonts/                  # Self-hosted web fonts (DM Sans, Space Mono — woff2)
├── data/
│   ├── traits.js           # Trait ID to display name mapping
│   ├── servants.js         # Servant data with trait arrays
│   └── craft_essences.js   # CE data with traits/matchAll/traitGroups/alsoMatch
├── servants/               # Servant portraits ({ID}.webp, with ascension subdirs)
├── craft_essences/         # CE images ({ID}.webp)
└── icons/                  # UI icons
    ├── bond_icon.webp
    ├── fp_icon.webp
    ├── materials/           # Material background/foreground icons
    └── classes/             # Class icons (.webp)
```

## Architecture

The application follows a clean 3-layer architecture within a single IIFE:

| Layer | Modules | Purpose |
|-------|---------|---------|
| **Domain** | Schema, Validator, Calculator, TraitMatcher | Pure business logic, no DOM |
| **Application** | StateManager, Persistence, App, BondApp, CEFilterApp | State management and coordination |
| **Presentation** | DOMFactory, UIBuilder, ViewManager, EventHandler, TabNavigator, ServantSelector, CESelector, AscensionSelector, CESubSelector, ServantDrag, CEFilterPicker, CEServantOverlap | DOM manipulation, modals, events. UIBuilder hydrates static HTML grids |

## Technical Details

- Vanilla JavaScript with no external dependencies
- Self-hosted fonts (DM Sans, Space Mono) via `@font-face` with woff2
- All images in WebP format
- Content Security Policy (CSP) restricting all resources to `'self'`
- All DOM elements created safely with `createElement()` (no innerHTML)
- Data files use `var` globals via `<script defer>` tags in `<head>` for `file://` compatibility
- Schema-based input validation with localStorage sanitization
- Debounced input handlers (100ms)
- Multi-ascension servant support with per-ascension traits and spiriton dress images
- **PWA support** with Service Worker (cache-first for assets with Cache-Control override, stale-while-revalidate for code) for offline access and instant repeat visits
- **Performance optimized**: Static HTML grids (zero CLS on load), CSS/JS minification, tab flash prevention via inline `<head>` script, DocumentFragment batching, lazy image loading, lazy tab initialization, computation caching, debounced filter renders, CSS layout containment, right-sized material icons (2x render dimensions), font preloading with `fetchpriority="high"` on LCP-critical font, CSS preload, inline critical CSS for LCP optimization, CLS prevention with `min-width` and `tabular-nums` on dynamic numeric elements
