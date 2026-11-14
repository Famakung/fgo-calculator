#!/usr/bin/env node
/**
 * scripts/test_event_shop_results.js
 *
 * Browser gate for the "Best Farm Runs" results card in its owner-approved FINAL shape — Amendment
 * R7 (no total line anywhere, no section separator lines), Amendment R18 Shop Trades as per-trade
 * farm cards (from→to header icons carrying the ratio overlaid per icon — cost on the from-icon,
 * get on the to-icon, fruit-count voice — no separator bar, body carries ONLY count + label),
 * Amendment R19 (trade body count BARE — "16", no "× " prefix; receive count prefix is "×" U+00D7),
 * Amendment R21 hint REMOVED (R22 owner rejection: the trades wrap is title + grid, nothing between;
 * ZERO .farm-res-trades-hint nodes in every scene), Amendment R22 minimum-cover trades (fixture B
 * reports ONE trade card donut→pie ×196 — the cookie→donut cascade row is gone; fixture C/main scenes
 * stay tradeless), Amendment R25 single-line sliding quest names extended by R26 to all three name
 * surfaces and re-cut by R27 into a CONTINUOUS one-direction loop (one line per name — nowrap +
 * overflow hidden; an overflowing name becomes span.farm-name-track = name + 24px gap + an
 * aria-hidden duplicate, animated translateX 0 → −50% linear infinite at --slide-duration; the
 * box-dependent --slide-dist is GONE, a fitting name stays one static span; R23's 3-line min-height
 * is GONE; R24's bottom-anchored count/label keep the figures aligned across a row whatever the
 * name), Amendment R28 neutral results-card colours (Quests to Play + Shop Trades cards go back to
 * --bg/--border, data-tier kept, Drop Rates input cards + tier cards keep their tier ring),
 * Amendment R6 play cards wearing the
 * Drop Rates farm chrome, Amendment R5a one-row 320px Item Receive, Amendment R4a Bond-fruit
 * overlay at 1rem, on top of the R1 icon sizes (plan of record:
 * .claude/docs/plans/2026-11-12-event-shop-results-reorder.plan.md, Acceptance 1-8 + R1-R7 + R17-R28).
 * Tracked harness: staging, patched copies, servers and pins all live HERE.
 *
 * Checks (ids verbatim):
 *  - order.sequence    card children EXACTLY: title → Quests to Play (farm-grid of play cards,
 *                      header over the grid — R7) → Item Receive → Shop Trades; nothing after
 *                      trades; hidden trades = 3 children.
 *  - total.absent      Amendment R7 deleted the "Total: N plays" line: ZERO .farm-res-total nodes
 *                      and NO "Total:" text anywhere in the results card, in every scene — the
 *                      zero-play scene included, where the section header sits over an empty grid.
 *  - separator.absent  the three section wraps (.farm-res-quests / .farm-res-receive /
 *                      .farm-res-trades) compute border-top 0px/none with the margin-top/padding-top
 *                      8px R7 kept (R7 dropped the separator LINES; the .farm-res-total CSS rule is
 *                      deleted with them).
 *  - title.parity      "Best Farm Runs" computed {12.8px, system-ui, 600, uppercase} == a sibling
 *                      .card-title; no farm-stat class on it.
 *  - headers.parity    section headers match the sibling .quest-title computed style (no 0.72rem
 *                      farm-stat monospace on a title).
 *  - receive.figs      Item Receive overlay figures == the runs' raw drops (rounded to whole units, R3),
 *                      replayed HERE from the mode's quest drop data × the card's own play CARDS (name
 *                      .farm-quest-name, runs .farm-res-play-count — Amendment R6) with the optimizer's
 *                      integer micro arithmetic (round(dropExpected×1e4)×(num+bonus)). Never EventShop's.
 *                      Compared with the "×" overlay prefix stripped (R4 pinned the letter x; R19
 *                      moved it to U+00D7); the printed raw text is pinned by r4.counttext.
 *                      Fruits are keyed by the row's own order, which is the snapshot's currency order
 *                      (R5a: the row holds one fruit per currency, no names, so order + tier.skin carry identity).
 *  - receive.notYields no receive fruit prints the replayed POST-cascade final where it differs; the
 *                      scene must be non-degenerate (farmed != final for at least one currency).
 *                      Discriminated by the fx B scene (the R22 minimum cover: 196 donut→pie trades —
 *                      farmed donut 5,012 vs final 3,052, farmed pie 4,805 vs final 5,001); the main
 *                      scene has been tradeless since the 2026-11-12 sync re-derivation — see main.plan.
 *  - fx.exact          fixture B ("Item Receive" mockup): "×4,168" / "×5,012" / "×4,805" shown (R19 overlay
 *                      text, R3 whole units); "×3,008" / "×4,008" / "×5,007" (full-cascade finals) and
 *                      "×3,052" / "×5,001" (minimum-cover finals) absent from the receive section;
 *                      誓い 90 + 牛追い 14 runs read off the play CARDS (R6); R22: exactly ONE trade CARD
 *                      donut→pie count 196 BARE (R19) with the ratio overlaid per header icon —
 *                      from-icon "10", to-icon "1" (R18); the cookie→donut card is GONE. The 196 and the
 *                      absence pairs come from THIS gate's own requirement propagation (gateMinCover),
 *                      never from EventShop.
 *  - main.plan         shipped 80639 needs 3000/4000/5000 → 263 plays, cards 133/83/47 render order
 *                      (quests 94164102/94164104/94164103), ZERO trade cards — the oracle file's own
 *                      exhaustive
 *                      search re-derived minimum+vector on the fresh data module after the
 *                      2026-11-12 owner-ordered refetch (was 306 plays / 134-108-64 / one row × 3 on
 *                      the pre-sync drops); the 263-play optimum covers without the cascade, so this
 *                      scene pins the tradeless shape and receive.figs runs its replay with noTrades.
 *  - r1.receive96      every receive art box .farm-res-fruit computed height 96px (R1, art kept by R4).
 *  - r1.rows48         every 64px header icon box .farm-card-icon (play AND trade headers, R17/R18;
 *                      re-pinned 48→64px in 27bb180) computes height 64px. The R17 trade rows became
 *                      trade CARDS, so .farm-res-icon is dead.
 *  - r1.noOtherImages  receive art is .fg-layer inside a .farm-res-fruit (96px); play-header AND
 *                      trade-header art is .fg-layer inside a 64px .farm-card-icon; no strays. R18:
 *                      the trade-header icons gain overlay SPANS inside those boxes — spans are not
 *                      imgs, the sweep still sees one img.fg-layer per box and nothing else.
 *  - r18.tradechrome   each Shop Trade is ONE div.quest-drops-item.farm-card inside
 *                      .farm-res-trades > .farm-grid with data-tier == the DESTINATION currency
 *                      background, a .farm-card-title--icons header carrying exactly from-icon +
 *                      .farm-res-trade-arrow + to-icon (2 64px .farm-card-icon boxes, 3 header
 *                      children total) and NO separator bar (header computed border-bottom none/0px +
 *                      padding-bottom 0 — R18 dropped the bar), and a body of ONLY count
 *                      (.farm-res-play-count, the runs voice, BARE /^[\d,]+$/ — R19 dropped its "× "
 *                      prefix) + label (.farm-res-play-label) — 2 body
 *                      children. The ratio rides the icons: from-icon .farm-res-trade-icon-count ==
 *                      costAmount, to-icon == getNum, plain numbers, present exactly when the ratio
 *                      resolves (a stale pair carries no overlay). The wrap children are exactly
 *                      header + grid (R21's hint line was REMOVED with R22 — .farm-res-trades-hint is
 *                      dead markup, swept to zero with the other dead trade nodes). Zero .farm-res-icon /
 *                      .farm-res-trade-from / .farm-res-trade-to / .farm-res-trade-count /
 *                      .farm-res-trade-ratio nodes anywhere.
 *  - r18.overlay       every trade icon overlay computes the .farm-res-fruit-count skin byte-mirrored
 *                      (R15): position absolute, right 0px, bottom 0px, margin-right 3px,
 *                      margin-bottom 7px, ui-monospace 16px 700, line-height == font-size, #1a1a2e,
 *                      four white 1px/2px shadows, nowrap, pointer-events none.
 *  - r23.namealign     R25 single-line names + R24 bottom anchor (re-pinned from R23's fixed-height
 *                      min-height, which Amendment R25 removed): every play-card quest name
 *                      (.farm-res-quests .farm-quest-name) computes white-space nowrap + overflow-x
 *                      hidden and is EXACTLY one line tall (name box height == its own computed
 *                      line-height, within 0.6px — no min-height reservation returns), the one-line
 *                      height is uniform across every card of the scene, and inside one grid ROW
 *                      (equal card tops) every card's runs count and label sit at the SAME bottom
 *                      (within 1px) whatever the name length or whether a REC line is present —
 *                      that is R24's margin-top:auto anchor. Guarded vacuous: ≥ 2 cards must share
 *                      a row or the differential fails loud.
 *  - r25.slide         R27 LOOP contract, measured AT REST (the FIRST copy's rect width minus the
 *                      24px track gap vs the box clientWidth — transform- AND duplicate-independent,
 *                      so the hidden second copy can never inflate the measurement): overflow > 0 ⇔
 *                      the name wears .is-sliding over exactly ONE span.farm-name-track holding
 *                      exactly TWO .farm-quest-name-text copies (the second aria-hidden="true", the
 *                      first not hidden, both carrying the full name, 24px apart), the container
 *                      title == the full name, the TRACK's computed animation is exactly ONE
 *                      farm-name-slide at --slide-duration == round((2 + 0.05s/px × name width) ×
 *                      10)/10 s, linear, infinite, direction NORMAL, and the track layout box is
 *                      2×(name+gap) so −50% lands exactly one name+gap (the seamless seam).
 *                      --slide-dist is GONE (R27 deleted it) — it must read "" on BOTH branches, and
 *                      the inner copies must not animate themselves. A fitting name is a single
 *                      static span: no track, one copy, no class, no duration, animation none.
 *                      Runs on every scene through assertPlayCards; the fx slide scene pins the
 *                      shapes explicitly — the 82-char EN name and the 32-char MID name loop,
 *                      "QA Short" stays static.
 *  - r27.loop          the CSSOM is read, not trusted through a class name: @keyframes
 *                      farm-name-slide has EXACTLY two steps — 0% translateX(0) and 100%
 *                      translateX(-50%). A third step, or any step back to 0, IS the R25
 *                      oscillation (right-left-right) the owner rejected; this pin fails loud if it
 *                      returns even with the same rule name.
 *  - r26.surface       the same loop contract on the TWO surfaces Amendment R26 extended it to,
 *                      measured by the same function: the Drop Rates per Run quest names
 *                      (#farmGrid .farm-quest-name) and the Shop Requirements item names
 *                      (.material-name, restructured by applySlidingName). A scene-degenerate guard
 *                      insists an overflowing name exists on each surface in the fx slide scene, so
 *                      "everything fits here" can never be mistaken for "the surface works".
 *  - r28.neutral       the results play AND trade cards compute the neutral house skin: background
 *                      == the Item Receive card's --bg and border-color == its --border, NEVER their
 *                      own tier colour, with data-tier still present (R28 keeps the attribute, drops
 *                      the paint; the override must land after .quest-drops-item[data-tier]). Runs
 *                      where trade cards exist: fx B, fx slide, MAIN.
 *  - r28.keepTier      R28b extends the neutral house skin to the WHOLE Event Shop tab: the #farmGrid
 *                      input cards (.quest-drops-item[data-tier]) border in --border and the Shop
 *                      Requirements tier cards (.material-card[data-tier]) take --bg + --border — the
 *                      tier ring survives only in the art and badges, never the card skin. data-tier
 *                      stays on every card that had one.
 *  - r25.motion        the fx slide scene re-opened under emulated prefers-reduced-motion: the JS
 *                      still measured — is-sliding, the duplicated two-copy track and
 *                      --slide-duration all stay — but the TRACK computes animation-name none, and
 *                      the title attribute still carries the full name. At rest, the ONLY frame a
 *                      reduced-motion reader ever sees, the FIRST copy must start at the clip's own
 *                      left edge (±1.5px) on every surface: .material-name sits in a
 *                      text-align:center parent, so a centered overlong track would rest on the
 *                      JOIN between the two copies (a mid-name slice) instead of the name's head.
 *  - r25.resize        fx slide scene: window.addEventListener("resize") is counted through a
 *                      pre-document wrapper — exactly ONE listener after the first Calculate
 *                      (resizeWatched installs once) and STILL exactly one after a second Calculate
 *                      and two viewport moves (no accumulation across re-renders). Resizing
 *                      1120 → 360 → 1120 is the re-measure witness: the 1-column card box widens
 *                      204 → 220px, so MID (≈211px) FLIPS to fitting and its duplicated track must
 *                      be torn back down to one static span, while LONG keeps the SAME
 *                      --slide-duration at every width (R27 drives the speed from the NAME width,
 *                      not the box — the box-dependent --slide-dist is gone) and both overflowing
 *                      names come back byte-equal at 1120. A static name never picks up the class
 *                      from a resize.
 *  - r4.onecard        exactly ONE .farm-res-receive-card and ZERO legacy .farm-res-item per results card;
 *                      every fruit carries a .farm-res-fruit-count (R5a: the fruit, not a name, is the row).
 *  - r5a.onerow        the card holds exactly ONE .farm-res-row with one fruit per snapshot currency in
 *                      snapshot order, every fruit on the same row (equal top), the row centered.
 *  - r5a.nonames       ZERO currency-name nodes in Item Receive: no .farm-res-quest-name anywhere in the
 *                      card, no snapshot currency's name anywhere in its text, and the card's own text is
 *                      nothing but the "×"-counts plus an iconless art's single tier LETTER (that letter is
 *                      art, not a name). The accessible name is the alt: every iconed fruit's alt equals its
 *                      currency's name.
 *  - r4.counttext      every overlay count matches /^×[\d,]+$/ (whole units R3, "×" prefix R19).
 *  - r4.width          receive card rendered width 320px at the 1120px viewport (border-box); the narrow
 *                      scene (360px viewport) pins it ≤ the .farm-res-receive container inner width
 *                      (max-width:100% guard) AND the 3×87.94 + 2×8 = 279.8px fruit row (142/155 aspect) inside it.
 *  - r4.overlay        count style computed: ui-monospace family, 16px (1rem, R4a), 700, line-height 1
 *                      (pinned as line-height == font-size — the used value the engine reports), #1a1a2e,
 *                      position absolute, right/bottom 7px/14px (plain-art bottom of the 142/155 fruit box, clear
 *                      of the ring bands, R13), the
 *                      Bond 4-way white 1px/2px
 *                      text-shadow, white-space nowrap, pointer-events none.
 *  - r6.cardshape      each play is ONE .quest-drops-item.farm-card inside .farm-res-quests > .farm-grid:
 *                      data-tier == its main drop's background (mirroring domain.js:1436 — biggest
 *                      dropExpected×num, ties to the lower id), an all-drop play takes farm-card--combo
 *                      and NO data-tier; no dropdown (select/.farm-quest-select) and no legacy
 *                      .farm-res-row markup anywhere in the wrap.
 *  - r6.headericons    header .farm-card-title (+ --icons on an all-drop play) carries ONE icon for a
 *                      normal play (the main drop's art) and EVERY currency's icon in snapshot order for
 *                      an all-drop one, each box computed 64px, each img alt == its currency's name.
 *  - r6.bodyseq        body .farm-card-body children in order: quest name (.farm-stat.farm-quest-name,
 *                      plus the R25 STATE class is-sliding only when the name overflows — r25.slide
 *                      proves the class from measurement, bodyseq pins the identity classes),
 *                      "REC Lv. {recommendLv}" (bare .farm-stat, ONLY when recommendLv), runs number
 *                      (.farm-stat.farm-res-play-count: ui-monospace 24px 700 center in --text), label
 *                      (.farm-stat.farm-res-play-label: 0.7rem center, "run" only at exactly 1 run).
 *  - r6.order          play cards render most-ridden first (the domain's own plays order).
 *  - tier.skin         each receive fruit wears its OWN currency's art, keyed by the row's snapshot order
 *                      (the per-block data-tier skin was owner-deleted with the tier-card markup — R4; card
 *                      skin --bg/--border): an iconed currency prints img.fg-layer whose src carries the
 *                      currency icon path; an iconless one (fixture 99997 Token) prints .icon-fallback in
 *                      TIER_COLORS[background] — the tier identity survives in the art.
 *  - removals.absent   no "Required", no ✓, no +figure surplus anywhere in the card.
 *  - nullplan.shape    null plan (no farm data): exactly title + "No drop data can cover this plan",
 *                      zero receive cards, zero play cards.
 *  - zero.shape        held covers all: Quests to Play is header + empty .farm-grid (no total node,
 *                      R7), receive all zeros ("×0"), no trades.
 *  - notrades.hidden   no-trades plan: Shop Trades absent, plays + receive still render; the 1-play
 *                      plan of the same event is the singular-label scene ("1 run", not "runs").
 *  - legacy.surfaces   stub copy: "Items Needed" card, 3 #deficitGrid rows, #questGrid rows after
 *                      Calculate, zero .farm-res-* nodes (the R6 .farm-res-play-count/-label included),
 *                      no planner wording.
 *  - tt.sinks          static: zero innerHTML/insertAdjacentHTML in the four files of the change.
 *  - page.errors       zero pageerrors and console errors across every scene.
 *
 * Scenes: MAIN runs on the plain dist copy; FX runs on a patched copy whose data literal carries
 * four synthetic events (99999 = fixture B Halloween pumpkins — the plan's mockup, its 誓い card drops
 * every currency so it is also the all-drop/combo scene, 99998 = a gold "Ghost" event with no farm data
 * → null plan, 99997 = a two-currency event with NO trades list whose Token carries icon:null — the one
 * scene that exercises the R4 .icon-fallback art path, and at 30 needed it renders exactly ONE 1-run card,
 * 99996 = the R25/R26/R27 slide fixture — three one-currency quests whose names are the shipped 82-char
 * EN name, a 32-char name and "QA Short", plus a deliberately LONG currency name on the gold currency
 * so the Shop Requirements tier card (.material-name) has an overflowing name to measure on its own
 * surface; needs 36×3 give three 3-run cards in ONE row, and only the MID quest
 * carries a REC line, so the same scene exercises sliding/static names AND mixed REC bottoms together).
 * The fixture objects below are the single source of truth: injected AND replayed. Stub
 * mode empties events[] (`events:0&&[`) so the page falls back to the untouched legacy calculator.
 *
 * Mutation self-test (--mutants): each mutant is a patched FX copy; it MUST redden its target
 * checks and nothing else (house pattern). Patch anchors are CHECKED strings — a missing or
 * ambiguous target throws. Minifier names belong to the CURRENT build (chunk event-lazy.D7CovPBy:
 * st/ct/ft = the Quests-to-Play / Item-Receive / Shop-Trades wrap builders, U = the plain node
 * builder, H = the farm-stat node builder, $e/et/tt/nt = the section-title strings) —
 * re-derived after 27bb180 + CLS changes; the throws are the drift alarm:
 *   mut_farmer:   `.farmed` → `.yields`              → receive.figs, receive.notYields, fx.exact
 *   mut_order:    receive/trade append calls swapped → order.sequence
 *   mut_totalout: a Total node is RE-ADDED to the quests wrap (R7 deleted the line for good — this
 *                 mutant proves the total.absent pin actually sees it come back) → total.absent
 *   mut_h96:      receive art .farm-res-fruit 96px → 48px → r1.receive96 (the R1 .mini-icon rule is gone)
 *   mut_row48:    shared header icon 64px → 24px     → r1.rows48, r1.noOtherImages, r6.headericons
 *                 (R17: play and trade headers are the same .farm-card-icon rule, re-pinned to 64px
 *                 in 27bb180, so one patch reddens every pin that measures it — no trade-only rule exists)
 *   mut_title:    title gets farm-stat back          → title.parity
 *   mut_icons:    a NORMAL play header takes every currency icon → r6.headericons (the R6 chrome)
 *   R22 note: a minimum-cover revert mutant (reported trades back to the full cascade) was weighed
 *   and NOT added — seven mutants already consume every spare port 4173-4179 (one fresh port per
 *   mutant is what keeps Chromium's HTTP cache from answering one mutant with another's chunk), and
 *   dropping any existing mutant to make room would weaken the set. The cascade revert reddens the
 *   MAIN scene anyway: fx.exact pins donut→pie ×196 as the ONLY trade card and main.plan pins the
 *   zero-trade shape on every run, so the regression is caught without a mutant.
 *   R25/R26/R27 note: no mutant touches event-shop-farm-names.js, the @keyframes rule or the card
 *   skin, so the r23/r25/r26/r27/r28 name+loop+colour pins must stay GREEN under all seven (the
 *   mutant loop runs assertPlayCards, which carries assertQuestNameSlides; the fx B JP fixture names
 *   fit at 1120 — static branch verified there — while the sliding branch is proven by the fx slide
 *   scene and MAIN, whose 20-char CJK names overflow the 204px name box). The r26.surface /
 *   r27.loop / r28.* pins run in the SCENE functions only (main, fx B, fx slide), never in the
 *   mutant path, so a mutant reddens exactly its own target and nothing else.
 *
 * Run (build ONCE first — the gate copies dist/ and never rebuilds):
 *   npm run build
 *   node scripts/test_event_shop_results.js               # MAIN + FX + STUB scenes
 *   node scripts/test_event_shop_results.js --mutants     # 7 mutants at exactly their pins
 *   node scripts/test_event_shop_results.js --serve-only  # keep copies staged + served (dev)
 * Ports: 4173 plain / 4174 fx / 4175 stub for the scene run; in --mutants mode those three are not
 * served at all and each mutant gets its own port 4173+i (seven mutants, 4173-4179) — a reused port
 * lets Chromium's HTTP cache answer one mutant's page from another copy's identically named chunk.
 * python http.server bound 0.0.0.0, probed over
 * 127.0.0.1. NEVER 3000 (the owner's dev server). Servers die with the process (kill
 * by child PID). serve() refuses to shadow a port that still answers. stage/multi_events.json + the FX copy double as the fixture for
 * scripts/test_event_shop_race_repro.js:
 *   node scripts/test_event_shop_race_repro.js http://127.0.0.1:4174/fgo-calculator/ \
 *       --fixture /tmp/opencode/qa_results/multi_events.json
 *
 * Exit 0 green; exit 1 with one `[ERROR] <id>: <detail>` line per failed check; exit 2 when the
 * environment (missing dist, port that cannot answer HTTP, drifted snapshot) blocks the gate.
 */

import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { EVENT_SHOP_DATA } from "../src/scripts/data/event_shop.js";
import { EVENT_SHOP_STORAGE_KEY, TIER_COLORS } from "../src/scripts/constants.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(REPO, "dist");
const STAGE = process.env.QA_RESULTS_STAGE || "/tmp/opencode/qa_results";
const argv = process.argv.slice(2);
const MUTANTS = argv.includes("--mutants");
const SERVE_ONLY = argv.includes("--serve-only");
const PORTS = { plain: 4173, fx: 4174, stub: 4175 }; // --mutants uses plain+i, one port per mutant

const errors = [];
const pageErrors = [];
const consoleErrors = [];
const fail = (id, detail) => errors.push(`${id}: ${detail}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- fixture events: injected verbatim, and the oracle of every FX figure --------------- */
const FX_ICON = (n) => `event_shop/item_9416${n}.webp`; // existing shipped files — zero 404s
const FX_B_QUESTS = [
  {
    questId: 94161100,
    questName: "パンプキン収穫 ちからファーム",
    recommendLv: "70",
    ap: 40,
    sampleRuns: 435,
    drops: { 94160901: { dropExpected: 10.9149, num: 3 }, 94160902: { dropExpected: 2.1379, num: 3 } },
  },
  {
    questId: 94161101,
    questName: "パンプキン収穫 ぷちぷちファーム",
    recommendLv: "70",
    ap: 40,
    sampleRuns: 317,
    drops: { 94160902: { dropExpected: 11.0189, num: 3 }, 94160903: { dropExpected: 2.205, num: 3 } },
  },
  {
    questId: 94161102,
    questName: "パンプキン収穫 分け合いファーム",
    recommendLv: "70",
    ap: 40,
    sampleRuns: 591,
    drops: { 94160901: { dropExpected: 2.2081, num: 3 }, 94160903: { dropExpected: 11.1421, num: 3 } },
  },
  {
    questId: 94161103,
    questName: "パンプキン収穫 ここ掘れファーム",
    recommendLv: "75",
    ap: 40,
    sampleRuns: 742,
    drops: { 94160901: { dropExpected: 14.4205, num: 3 }, 94160902: { dropExpected: 2.9394, num: 3 } },
  },
  {
    questId: 94161104,
    questName: "パンプキン収穫 妙案奇案ファーム",
    recommendLv: "80",
    ap: 40,
    sampleRuns: 973,
    drops: { 94160902: { dropExpected: 14.555, num: 3 }, 94160903: { dropExpected: 2.8828, num: 3 } },
  },
  {
    questId: 94161105,
    questName: "パンプキン収穫 牛追いファーム",
    recommendLv: "85",
    ap: 40,
    sampleRuns: 981,
    drops: { 94160901: { dropExpected: 2.8685, num: 3 }, 94160903: { dropExpected: 14.4954, num: 3 } },
  },
  {
    questId: 94161107,
    questName: "パンプキン収穫 父と子のファーム",
    recommendLv: "90+",
    ap: 40,
    sampleRuns: 1736,
    drops: {
      94160901: { dropExpected: 9.254, num: 3 },
      94160902: { dropExpected: 9.3001, num: 3 },
      94160903: { dropExpected: 9.2068, num: 3 },
    },
  },
  {
    questId: 94161108,
    questName: "パンプキン収穫 誓いのファーム",
    recommendLv: "90++",
    ap: 40,
    sampleRuns: 13472,
    drops: {
      94160901: { dropExpected: 11.1328, num: 3 },
      94160902: { dropExpected: 11.1377, num: 3 },
      94160903: { dropExpected: 11.0917, num: 3 },
    },
  },
];
const FX_TRADES = [
  { fromId: 94160901, toId: 94160902, costAmount: 10, getNum: 1 },
  { fromId: 94160902, toId: 94160903, costAmount: 10, getNum: 1 },
];
const FX_B = {
  event: {
    id: 99999,
    name: "QA Fixture B Halloween Pumpkins",
    shortName: "QA Fixture B",
    startedAt: 1900000000,
    endedAt: 1900999999,
  },
  currencies: [
    { id: 94160901, name: "Cookie", background: "bronze", icon: FX_ICON("4000") },
    { id: 94160902, name: "Donut", background: "gold", icon: FX_ICON("4002") },
    { id: 94160903, name: "Pie", background: "silver", icon: FX_ICON("4001") },
  ],
  items: [
    {
      id: 99999001,
      name: "QA Cookie Item",
      purchaseType: "item",
      cost: { itemId: 94160901, amount: 1 },
      limitNum: 0,
      setNum: 1,
      priority: 1,
      icon: FX_ICON("4000"),
    },
    {
      id: 99999002,
      name: "QA Donut Item",
      purchaseType: "item",
      cost: { itemId: 94160902, amount: 1 },
      limitNum: 0,
      setNum: 1,
      priority: 2,
      icon: FX_ICON("4002"),
    },
    {
      id: 99999003,
      name: "QA Pie Item",
      purchaseType: "item",
      cost: { itemId: 94160903, amount: 1 },
      limitNum: 0,
      setNum: 1,
      priority: 3,
      icon: FX_ICON("4001"),
    },
  ],
  farm: { quests: FX_B_QUESTS, best: { 94160901: 94161103, 94160902: 94161104, 94160903: 94161105 } },
  trades: FX_TRADES,
};
const FX_NULL = {
  event: { id: 99998, name: "QA Null Farm Ghost", shortName: "QA Null", startedAt: 1700000000, endedAt: 1700999999 },
  currencies: [{ id: 94160909, name: "Ghost", background: "gold", icon: FX_ICON("4002") }],
  items: [
    {
      id: 99998001,
      name: "QA Ghost Item",
      purchaseType: "item",
      cost: { itemId: 94160909, amount: 1 },
      limitNum: 0,
      setNum: 1,
      priority: 1,
      icon: FX_ICON("4002"),
    },
  ],
  farm: { quests: [], best: {} },
  trades: [],
};
const FX_NOTRADE = {
  event: { id: 99997, name: "QA No Trades Coin", shortName: "QA NoTrades", startedAt: 1750000000, endedAt: 1750999999 },
  currencies: [
    { id: 94160920, name: "Coin", background: "bronze", icon: FX_ICON("4000") },
    { id: 94160921, name: "Token", background: "gold", icon: null }, // iconless on purpose: the R4 .icon-fallback art path
  ],
  items: [
    {
      id: 99997001,
      name: "QA Coin Item",
      purchaseType: "item",
      cost: { itemId: 94160920, amount: 1 },
      limitNum: 0,
      setNum: 1,
      priority: 1,
      icon: FX_ICON("4000"),
    },
    {
      id: 99997002,
      name: "QA Token Item",
      purchaseType: "item",
      cost: { itemId: 94160921, amount: 1 },
      limitNum: 0,
      setNum: 1,
      priority: 2,
      icon: FX_ICON("4002"),
    },
  ],
  farm: {
    quests: [
      {
        questId: 94161199,
        questName: "QA Coin Quest",
        recommendLv: "70",
        ap: 40,
        sampleRuns: 100,
        drops: { 94160920: { dropExpected: 10, num: 3 } },
      },
    ],
    best: { 94160920: 94161199 },
  },
  trades: [],
};
/* R25/R26/R27 slide fixture: three single-currency quests, one row of three 3-run cards at 1120.
   The names are the WHOLE point, on ALL THREE sliding surfaces: LONG is the shipped 82-char EN name
   verbatim (≈538px over the 204px name box → must slide), MID is 32 chars (≈211px → still overflows
   by ~7px → slides, and its overflow FLIPS to fitting at 360, where the 1-column card box widens to
   220px — that is the resize re-measure witness), SHORT is "QA Short" (≈57px → fits → static).
   The "Badge" currency carries a deliberately long name (≈300px over the 132px tier-card name box):
   that is the R26 Shop Requirements (.material-name) surface, the only tier-card name in the whole
   fixture set wide enough to overflow, so the third surface is measured, not assumed. Only MID carries
   a REC line: the row then differential-proves R24's bottom anchor across mixed name lengths AND
   mixed REC presence in one scene. Each currency drops from exactly one quest at 4×3 = 12/run, so
   needs 36/36/36 force 3 runs of EACH quest — every name renders, none is an optimizer casualty. */
const R25_LONG_NAME = "Monster Extermination: Torikoe Shrine, Pilgrimage to the Path where Spirits Wander";
const R25_MID_NAME = "QA Ridge Racers Shrine Rally Run";
const R25_SHORT_NAME = "QA Short";
/* R26 Shop Requirements witness: a CURRENCY name long enough to overflow the 132px tier-card name box
   at 1120 (its own text ≈ 300px). Shares no substring with the quest names above. */
const R26_LONG_CURRENCY_NAME = "Monster Feast Pumpkin Commemorative Grand Badge Edition";
const FX_SLIDE = {
  event: { id: 99996, name: "QA Slide Names", shortName: "QA Slide", startedAt: 1750000000, endedAt: 1750999999 },
  currencies: [
    { id: 94160930, name: "Medal", background: "bronze", icon: FX_ICON("4000") },
    { id: 94160931, name: R26_LONG_CURRENCY_NAME, background: "gold", icon: FX_ICON("4002") },
    { id: 94160932, name: "Chalk", background: "silver", icon: FX_ICON("4001") },
  ],
  items: [
    {
      id: 99996001,
      name: "QA Medal Item",
      purchaseType: "item",
      cost: { itemId: 94160930, amount: 1 },
      limitNum: 0,
      setNum: 1,
      priority: 1,
      icon: FX_ICON("4000"),
    },
    {
      id: 99996002,
      name: "QA Badge Item",
      purchaseType: "item",
      cost: { itemId: 94160931, amount: 1 },
      limitNum: 0,
      setNum: 1,
      priority: 2,
      icon: FX_ICON("4002"),
    },
    {
      id: 99996003,
      name: "QA Chalk Item",
      purchaseType: "item",
      cost: { itemId: 94160932, amount: 1 },
      limitNum: 0,
      setNum: 1,
      priority: 3,
      icon: FX_ICON("4001"),
    },
  ],
  farm: {
    quests: [
      {
        questId: 94161300,
        questName: R25_LONG_NAME,
        recommendLv: "",
        ap: 40,
        sampleRuns: 500,
        drops: { 94160930: { dropExpected: 4, num: 3 } },
      },
      {
        questId: 94161301,
        questName: R25_MID_NAME,
        recommendLv: "80",
        ap: 40,
        sampleRuns: 500,
        drops: { 94160931: { dropExpected: 4, num: 3 } },
      },
      {
        questId: 94161302,
        questName: R25_SHORT_NAME,
        recommendLv: "",
        ap: 40,
        sampleRuns: 500,
        drops: { 94160932: { dropExpected: 4, num: 3 } },
      },
    ],
    best: { 94160930: 94161300, 94160931: 94161301, 94160932: 94161302 },
  },
  trades: [],
};
const FX_SLIDE_PLAN = {
  requires: { 99996001: 36, 99996002: 36, 99996003: 36 },
  held: {},
  bonus: {},
  farmQuest: null,
  currencyQuest: {},
};
const NAMES = {
  fx: {
    94160901: "Cookie",
    94160902: "Donut",
    94160903: "Pie",
    94160909: "Ghost",
    94160920: "Coin",
    94160921: "Token",
  },
  "fx slide": { 94160930: "Medal", 94160931: R26_LONG_CURRENCY_NAME, 94160932: "Chalk" },
};
const FX_KEYS = ["94160901", "94160902", "94160903"];

/* ---------- MAIN scene: shipped 80639, needs 3000/4000/5000 (the oracle's pinned scenario) ---- */
const LIVE = EVENT_SHOP_DATA.events.find((e) => e.event.id === 80639);
if (!LIVE) {
  console.error("[ERROR] harness: shipped snapshot no longer carries 80639 — re-derive the gate");
  process.exit(2);
}
NAMES.main = Object.fromEntries(LIVE.currencies.map((c) => [String(c.id), c.name]));
/* The fixture events share one currency-name table; the scenes that replay against them carry their
   own labels, so assertFigs looks NAMES[label] up for each of them. */
for (const alias of ["fx zero", "fx notrade", "fx single", "fx narrow"]) NAMES[alias] = NAMES.fx;
const MAIN_REQUIRES = { 80639054: 300, 80639053: 400, 80639055: 2500 };
/* MAIN scene constants — re-derived 2026-11-12 from the FRESH data module, independently of the app:
   the oracle file's own exhaustive integer kernel (same arithmetic this gate replays) brute-forced
   minimum 263 plays at needs 3000/4000/5000 with tie-break witness 94164102×133 + 94164104×83 +
   94164103×47 and ZERO cascade trades (farmed 3,008.09 / 4,001.69 / 5,011.03 covers directly); 262
   plays proved infeasible. The previous 306 / 134-108-64 / one row × 3 was the pre-sync answer —
   the owner-ordered Atlas refetch moved 80639's community drops (sanctioned data drift). MAIN_TRUTH
   below is the verbatim drop transcription of the three winning quests — the drift alarm. */
const MAIN_ORACLE = {
  totalPlays: 263,
  rows: { 94164102: 133, 94164103: 47, 94164104: 83 },
  trades: { count: 0 },
};
const MAIN_TRUTH = {
  94164102: { 94164000: [2.2844, 3], 94164002: [10.8199, 3] },
  94164103: { 94164000: [14.8696, 3], 94164001: [2.7391, 3] },
  94164104: { 94164001: [14.52, 3], 94164002: [2.7867, 3] },
};
for (const [qid, drops] of Object.entries(MAIN_TRUTH)) {
  const quest = LIVE.farm.quests.find((q) => String(q.questId) === qid);
  for (const [cid, [de, num]] of Object.entries(drops)) {
    const d = quest && quest.drops[cid];
    if (!d || d.dropExpected !== de || d.num !== num) {
      console.error(
        `[ERROR] harness: snapshot drift — quest ${qid} currency ${cid} is ${JSON.stringify(d)}, pinned [${de}, ${num}]`,
      );
      process.exit(2);
    }
  }
}
for (const [iid, qty] of Object.entries(MAIN_REQUIRES)) {
  const item = LIVE.items.find((i) => String(i.id) === iid);
  if (!item || item.limitNum !== 0) {
    console.error(`[ERROR] harness: MAIN requires row ${iid} is no longer an unlimited item — re-derive`);
    process.exit(2);
  }
}

/* ---------- independent replay (the oracle's integer reading of the same data) ---------------- */
const MICRO = 10000;
const rateMicro = (drop, bonus) => Math.round(drop.dropExpected * MICRO) * (drop.num + (Number(bonus) || 0));
function replayFarmed(quests, plays, bonusMap, nameTable) {
  const byName = new Map(quests.map((q) => [q.questName, q]));
  const farmed = {};
  for (const play of plays) {
    const quest = byName.get(play.name);
    if (!quest) throw new Error(`card names quest "${play.name}" the data module does not have`);
    for (const [cid, drop] of Object.entries(quest.drops))
      farmed[cid] = (farmed[cid] || 0) + play.runs * rateMicro(drop, bonusMap[cid]);
  }
  void nameTable;
  return farmed;
}
function replayFinal(farmedMicro, tradePairs, tradeList) {
  const final = { ...farmedMicro };
  for (const t of tradePairs) {
    const ratio = tradeList.find((c) => String(c.fromId) === t.fromId && String(c.toId) === t.toId);
    if (!ratio) throw new Error(`trade ${t.fromId}→${t.toId} sold by nobody`);
    final[t.fromId] = (final[t.fromId] || 0) - MICRO * t.count * ratio.costAmount;
    final[t.toId] = (final[t.toId] || 0) + MICRO * t.count * ratio.getNum;
  }
  return final;
}
const fmtFigure = (microValue) => Math.round((microValue || 0) / MICRO).toLocaleString("en-US");
/* R22 currency needs, derived from the shop data the scene actually loaded: Σ requires[item] ×
   cost.amount per currency (unlimited items, setNum buys goods not currency). */
function currencyNeeds(items, requires) {
  const needs = {};
  for (const [iid, qty] of Object.entries(requires)) {
    const item = (items || []).find((i) => String(i.id) === String(iid));
    if (!item) throw new Error(`requires names item ${iid} the snapshot does not sell`);
    needs[item.cost.itemId] = (needs[item.cost.itemId] || 0) + qty * item.cost.amount;
  }
  return needs;
}
/* R22 INDEPENDENT minimum-cover trades: requirement propagation down a LINEAR chain — the top
   demands exactly ceil(shortfall/get) from below, a source owes its own need plus the cost of every
   sale. This is NOT the app's seed-then-trim: it never builds a cascade. Non-linear shapes (branch,
   cycle, duplicate pair) return null and only the structural pins run there; both FX scenarios and
   the shipped event are linear 10:1 chains. Whole micro-units, the same grid the replay uses. */
function gateMinCover(farmedMicro, needsUnits, tradeList) {
  const edges = (tradeList || [])
    .filter(
      (t) =>
        Number.isFinite(Number(t.fromId)) &&
        Number.isFinite(Number(t.toId)) &&
        Number(t.fromId) !== Number(t.toId) &&
        Number(t.costAmount) > 0 &&
        Number(t.getNum) > 0,
    )
    .map((t) => ({
      from: Number(t.fromId),
      to: Number(t.toId),
      cost: Math.round(Number(t.costAmount) * MICRO),
      get: Math.round(Number(t.getNum) * MICRO),
    }));
  const hold = {};
  const needOf = {};
  for (const [k, v] of Object.entries(farmedMicro)) hold[Number(k)] = v;
  for (const [k, v] of Object.entries(needsUnits || {})) needOf[Number(k)] = Math.round(Number(v) * MICRO);
  const outEdge = {};
  const inCount = {};
  const outCount = {};
  for (const e of edges) {
    outCount[e.from] = (outCount[e.from] || 0) + 1;
    inCount[e.to] = (inCount[e.to] || 0) + 1;
    outEdge[e.from] = e;
  }
  for (const c of [...Object.values(outCount), ...Object.values(inCount)]) if (c > 1) return null;
  const sold = {};
  const settled = {};
  let progress = true;
  while (progress) {
    progress = false;
    for (const e of edges) {
      const id = `${e.from}>${e.to}`;
      if (settled[id]) continue;
      const downstream = outEdge[e.to];
      const dId = downstream ? `${downstream.from}>${downstream.to}` : null;
      if (downstream && !settled[dId]) continue;
      const obligation = downstream ? sold[dId] * downstream.cost : 0;
      const short = (needOf[e.to] || 0) + obligation - (hold[e.to] || 0);
      sold[id] = Math.max(0, Math.ceil(short / e.get));
      settled[id] = true;
      progress = true;
    }
  }
  if (Object.keys(settled).length !== edges.length) return null; // a cycle among otherwise-linear edges
  const trades = [];
  for (const e of edges) {
    const n = sold[`${e.from}>${e.to}`];
    if (n > 0) trades.push({ fromId: e.from, toId: e.to, count: n });
  }
  return trades;
}
/* R4/R19: the receive figure is the overlay text "×{whole units}"; replay comparisons strip the
   prefix, the raw printed text stays pinned by r4.counttext + fx.exact. */
const stripX = (text) => String(text || "").replace(/^×/, "");
const hexToRgb = (hex) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : hex;
};

/* ---------- staging ---------------------------------------------------------------------------- */
function findDataChunk(dir) {
  const marker = "events:[{event:{id:";
  const hits = fs
    .readdirSync(path.join(dir, "_astro"))
    .filter((f) => f.endsWith(".js"))
    .filter((f) => fs.readFileSync(path.join(dir, "_astro", f), "utf8").includes(marker));
  if (hits.length !== 1) throw new Error(`patch target: ${hits.length} chunks carry "${marker}", want exactly 1`);
  return hits[0];
}
function patchFile(file, find, replace, label) {
  const text = fs.readFileSync(file, "utf8");
  const first = text.indexOf(find);
  if (first === -1) throw new Error(`patch target missing (${label}): ${JSON.stringify(find.slice(0, 90))}`);
  if (text.indexOf(find, first + 1) !== -1)
    throw new Error(`patch target ambiguous (${label}): ${JSON.stringify(find.slice(0, 90))}`);
  fs.writeFileSync(file, text.replace(find, replace));
}
function makeCopy(name, fromDir = DIST) {
  const to = path.join(STAGE, name, "fgo-calculator");
  fs.rmSync(path.join(STAGE, name), { recursive: true, force: true });
  fs.mkdirSync(path.join(STAGE, name), { recursive: true });
  fs.cpSync(fromDir, to, { recursive: true });
  return to;
}
/* Returns the patched chunk's filename (resolved dynamically, never a pinned hash). The fixture
   events go AFTER the live first element: pickSelectedEventId's fresh-load fallback is events[0],
   and scripts/test_event_shop_race_repro.js types against the force-selected event — 80639 must
   stay head (house MULTI recipe line: "80639 stays the list head"). */
function firstEventsElement(text, markerIdx) {
  const open = text.indexOf("[", markerIdx);
  if (open === -1) throw new Error("fx events inject: no array bracket after marker");
  let depth = 0;
  let quote = null;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth < 0) throw new Error("fx events inject: events[] head is not an object");
      if (depth === 0) return i; // closing brace of the first events[] element
    }
  }
  throw new Error("fx events inject: unbalanced events[] literal");
}
function stageFx(name) {
  const dir = makeCopy(name);
  const file = findDataChunk(dir);
  const pathFile = path.join(dir, "_astro", file);
  const text = fs.readFileSync(pathFile, "utf8");
  const marker = "events:[{event:{id:";
  const mIdx = text.indexOf(marker);
  if (mIdx === -1 || text.indexOf(marker, mIdx + 1) !== -1)
    throw new Error(`fx events inject: marker count is not exactly 1 in ${file}`);
  const endIdx = firstEventsElement(text, mIdx);
  const inject =
    "," +
    JSON.stringify(FX_B) +
    "," +
    JSON.stringify(FX_NULL) +
    "," +
    JSON.stringify(FX_NOTRADE) +
    "," +
    JSON.stringify(FX_SLIDE);
  fs.writeFileSync(pathFile, text.slice(0, endIdx + 1) + inject + text.slice(endIdx + 1));
  return file;
}
const MUTANT_TARGETS = {
  mut_farmer: ["receive.figs", "receive.notYields", "fx.exact"],
  mut_order: ["order.sequence"],
  mut_totalout: ["total.absent"],
  mut_h96: ["r1.receive96"],
  mut_row48: ["r1.rows48", "r1.noOtherImages", "r6.headericons"],
  mut_title: ["title.parity"],
  mut_icons: ["r6.headericons"],
};
function resolveChunkMatch(text, re, tag) {
  const match = text.match(re);
  if (!match) throw new Error(`${tag}: structural chunk pattern missing`);
  return match;
}

function stageMutant(name, fxDirName, fxChunk) {
  const dir = makeCopy(name, path.join(STAGE, fxDirName, "fgo-calculator"));
  const chunk = path.join(dir, "_astro", fxChunk);
  const html = path.join(dir, "index.html");
  const chunkText = fs.readFileSync(chunk, "utf8");
  const statNodeFn = () =>
    resolveChunkMatch(
      chunkText,
      /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{let ([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\.el\([`"']div[`"'],\[[`"']farm-stat[`"'],\3\]\.filter\(Boolean\)\);return \4\.textContent=\2,\4\}/,
      "statNodeFn",
    )[1];
  const plainNodeFn = () =>
    resolveChunkMatch(
      chunkText,
      /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{let ([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\.el\([`"']div[`"'],\3\);return \4\.textContent=\2,\4\}/,
      "plainNodeFn",
    )[1];
  /* R17: the trade rows became trade CARDS and .farm-res-icon is dead — the 64px header icon rule
     (re-pinned 48→64px in 27bb180) is now the single shared .farm-card-icon (play AND trade headers),
     so this patch reddens every pin that measures header art: r1.rows48, the sweep, and r6.headericons. */
  const iconRule = ".farm-card-icon { width: auto; height: 64px;";
  switch (name) {
    case "mut_farmer":
      patchFile(chunk, "t.farmed", "t.yields", "m-farmed");
      break;
    case "mut_order": {
      const m = resolveChunkMatch(
        chunkText,
        /([A-Za-z_$][\w$]*\.appendChild\([A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*\.result\)\)),([A-Za-z_$][\w$]*\.appendChild\([A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*\.result\)\)),([A-Za-z_$][\w$]*\.appendChild\([A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*\.result\)\))/,
        "m-order",
      );
      patchFile(chunk, m[0], `${m[1]},${m[3]},${m[2]}`, "m-order");
      break;
    }
    case "mut_totalout": {
      const hFn = statNodeFn();
      const m = resolveChunkMatch(
        chunkText,
        /function [A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{let ([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\.el\([`"']div[`"'],[`"']farm-res-quests[`"']\),([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\.el\([`"']div[`"'],[`"']farm-grid[`"']\);for\(let [A-Za-z_$][\w$]* of \2\.plays\)[^}]*?return (\3\.replaceChildren\(([A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*,[`"']quest-title[`"']\),\4)\)),\3\}/,
        "m-total-back",
      );
      patchFile(
        chunk,
        m[5],
        `${m[3]}.replaceChildren(${m[6]},${hFn}(\`Total: \${${m[2]}.totalPlays} plays\`,\`farm-res-total\`))`,
        "m-total-back",
      );
      break;
    }
    case "mut_h96":
      patchFile(
        html,
        ".farm-res-fruit { position: relative; width: fit-content; height: 96px;",
        ".farm-res-fruit { position: relative; width: fit-content; height: 48px;",
        "m-height96",
      );
      break;
    case "mut_row48":
      patchFile(html, iconRule, iconRule.replace("height: 64px;", "height: 24px;"), "m-row48");
      break;
    case "mut_title": {
      const hFn = statNodeFn();
      const uFn = plainNodeFn();
      const escapedU = uFn.replace(/\$/g, "\\$");
      const m = resolveChunkMatch(
        chunkText,
        new RegExp(`${escapedU}\\(([A-Za-z_$][\\w$]*),[\`"']card-title[\`"']\\)`),
        "m-title",
      );
      patchFile(chunk, m[0], `${hFn}(${m[1]},\`card-title\`)`, "m-title");
      break;
    }
    case "mut_icons":
      // R6 chrome: a play that does NOT drop every currency still takes every currency's icon.
      patchFile(chunk, "r=t.isAllDrop?e:e.filter(e=>String(e.id)===String(t.mainDropId))", "r=e", "m-icons");
      break;
    default:
      throw new Error(`unknown mutant ${name}`);
  }
}

const servers = [];
function portAnswering(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/fgo-calculator/index.html`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}
async function waitPortFree(port, name) {
  const t0 = Date.now();
  while (await portAnswering(port)) {
    if (Date.now() - t0 > 10000)
      throw new Error(`ENVIRONMENT: port ${port} is still serving (not this run's ${name}) — refusing to shadow it`);
    await wait(250);
  }
}
async function serve(name, port) {
  const root = path.join(STAGE, name);
  await waitPortFree(port, name);
  const child = spawn("python3", ["-m", "http.server", String(port), "--bind", "0.0.0.0", "--directory", root], {
    stdio: "ignore",
  });
  servers.push({ child, name, port });
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const attempt = () => {
      const req = http.get(`http://127.0.0.1:${port}/fgo-calculator/index.html`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on("error", retry);
      function retry() {
        if (Date.now() - t0 > 15000)
          reject(new Error(`ENVIRONMENT: server ${name} on port ${port} never answered 200`));
        else setTimeout(attempt, 250);
      }
    };
    attempt();
  });
}
function killServer(port) {
  const s = servers.find((x) => x.port === port);
  if (s && s.child) {
    try {
      s.child.kill("SIGKILL");
    } catch {
      /* gone */
    }
    s.child = null;
  }
}
function killServers() {
  for (const s of servers) {
    try {
      if (s.child) s.child.kill("SIGKILL");
    } catch {
      /* gone */
    }
  }
}
process.on("exit", killServers);

/* ---------- page scenes ------------------------------------------------------------------------ */
const KEY = EVENT_SHOP_STORAGE_KEY;
function watch(page) {
  page.on("pageerror", (e) => pageErrors.push(String(e.message)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
}
async function openEventPage(browser, url, eventId, plan) {
  const page = await browser.newPage();
  watch(page);
  await page.setViewport({ width: 1120, height: 900 });
  /* selectedEventId is stored NUMERIC: pickSelectedEventId matches it against event.id with ===,
     and a string there silently falls back to the list head — which would run the wrong scene. */
  await page.evaluateOnNewDocument(
    (key, eid, pl) => {
      localStorage.setItem(key, JSON.stringify({ selectedEventId: eid, plans: { [String(eid)]: pl } }));
    },
    KEY,
    Number(eventId),
    plan,
  );
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.click('.tab-btn[data-tab="event"]');
  await page.waitForSelector("#farmGrid", { timeout: 8000 });
  await wait(250);
  await page.click("#calculateBtn");
  await wait(400);
  return page;
}
async function readCard(page) {
  return page.evaluate(() => {
    const inner = document.querySelector("#results .results-card .card-inner");
    if (!inner) return null;
    const styleOf = (el) => {
      const s = getComputedStyle(el);
      return {
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
        fontWeight: s.fontWeight,
        textTransform: s.textTransform,
      };
    };
    const kids = [...inner.children].map((el) => ({ classes: [...el.classList], text: el.textContent.trim() }));
    const titleEl = [...inner.children].find((el) => el.classList.contains("card-title"));
    /* R17: .farm-res-icon is dead — the 64px row/header art box is the single .farm-card-icon shared
       by play AND trade card headers; this scrape measures every one of them in the card. */
    const rowIcons = [...inner.querySelectorAll(".farm-card-icon")].map((el) => getComputedStyle(el).height);
    /* R7 absence scrapes: the total line must be GONE (node and text); the three section wraps must
       show no separator border-top and keep the 8px/8px margin/padding R7 kept. */
    const totalEls = inner.querySelectorAll(".farm-res-total");
    const totalEl = totalEls[0] || null;
    const wrapBorders = [...inner.querySelectorAll(".farm-res-quests, .farm-res-receive, .farm-res-trades")].map(
      (el) => {
        const s = getComputedStyle(el);
        return {
          cls: [...el.classList].find((c) => c.startsWith("farm-res-")),
          marginTop: s.marginTop,
          paddingTop: s.paddingTop,
          borderTopWidth: s.borderTopWidth,
          borderTopStyle: s.borderTopStyle,
        };
      },
    );
    const questsWrap = inner.querySelector(".farm-res-quests");
    const questsWrapKids = questsWrap ? [...questsWrap.children].map((el) => [...el.classList].join(" ")) : null;
    const receiveCardEls = [...inner.querySelectorAll(".farm-res-receive-card")];
    const receiveEl = inner.querySelector(".farm-res-receive");
    const receiveCard = receiveCardEls[0] || null;
    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10, top: r.top, width: r.width };
    };
    /* R5a: the card is ONE centered row whose fruits are the rows — keyed by the row's own order, which
       is the snapshot's currency order. No name nodes: the art's alt is the only thing naming a currency. */
    const receiveRows = receiveCard ? [...receiveCard.querySelectorAll(":scope > .farm-res-row")] : [];
    const receive = [...(receiveCard ? receiveCard.querySelectorAll(".farm-res-fruit") : [])].map((fruit) => {
      const countEl = fruit.querySelector(".farm-res-fruit-count");
      const s = countEl ? getComputedStyle(countEl) : null;
      const art = fruit.querySelector("img, .icon-fallback");
      const row = fruit.parentElement;
      return {
        figure: countEl ? countEl.textContent : null,
        fruitH: getComputedStyle(fruit).height,
        hasFruit: true,
        hasCount: !!countEl,
        inRow: !!row && row.classList.contains("farm-res-row"),
        rowSiblings: row ? row.children.length : 0,
        rowJustify: row ? getComputedStyle(row).justifyContent : null,
        rect: rectOf(fruit),
        countStyle: s
          ? {
              fontFamily: s.fontFamily,
              fontSize: s.fontSize,
              fontWeight: s.fontWeight,
              lineHeight: s.lineHeight,
              color: s.color,
              position: s.position,
              right: s.right,
              bottom: s.bottom,
              textShadow: s.textShadow,
              whiteSpace: s.whiteSpace,
              pointerEvents: s.pointerEvents,
            }
          : null,
        artCls: art ? [...art.classList].join(" ") : null,
        artSrc: art && art.tagName === "IMG" ? art.getAttribute("src") || "" : null,
        artAlt: art && art.tagName === "IMG" ? art.getAttribute("alt") : null,
        artLetter: art && art.classList.contains("icon-fallback") ? art.textContent.trim() : null,
        artBg: art && art.classList.contains("icon-fallback") ? getComputedStyle(art).backgroundColor : null,
      };
    });
    /* R6: each play is a Drop Rates farm card inside .farm-res-quests > .farm-grid — header art, body
       lines, no dropdown. The whole card is scraped so the pins can check chrome, icons and order. */
    /* R27 loop-mechanism reader, shared by ALL THREE sliding surfaces (results play cards, the Drop
       Rates grid, the Shop Requirements tier cards). The at-rest text width is duplication- and
       transform-independent: the FIRST name-text copy's rect minus the track gap it carries (the
       animation only ever translateX()es the track, so rects stay true mid-cycle). nTexts/hasTrack/
       dupHidden are the structural half of the contract (name + gap + duplicate, duplicate hidden);
       anim* is the animation the TRACK runs — not the inner span, which never animates. */
    const nameState = (el) => {
      if (!el) return null;
      const track = el.querySelector(":scope > .farm-name-track");
      const texts = [...el.querySelectorAll(".farm-quest-name-text")];
      const first = texts[0] || null;
      const ts = track ? getComputedStyle(track) : null;
      const gap = track && first ? parseFloat(getComputedStyle(first).paddingInlineEnd) || 0 : 0;
      const fr = first ? first.getBoundingClientRect() : null;
      return {
        nameText: first ? first.textContent : el.textContent,
        titleAttr: el.getAttribute("title"),
        sliding: el.classList.contains("is-sliding"),
        dur: getComputedStyle(el).getPropertyValue("--slide-duration").trim(),
        slideDistProp: getComputedStyle(el).getPropertyValue("--slide-dist").trim(),
        boxW: el.clientWidth,
        boxSW: el.scrollWidth,
        gapPx: gap,
        textW: fr ? Math.round((fr.width - gap) * 10) / 10 : null,
        trackW: track ? Math.round(track.getBoundingClientRect().width * 10) / 10 : null,
        hasTrack: !!track,
        nTexts: texts.length,
        dupHidden: texts[1] ? texts[1].getAttribute("aria-hidden") : null,
        text2: texts[1] ? texts[1].textContent : null,
        firstHidden: first ? first.getAttribute("aria-hidden") : null,
        animName: ts ? ts.animationName : null,
        animDur: ts ? ts.animationDuration : null,
        animDir: ts ? ts.animationDirection : null,
        animIter: ts ? ts.animationIterationCount : null,
        animTf: ts ? ts.animationTimingFunction : null,
        spanAnim: first ? getComputedStyle(first).animationName : null,
      };
    };
    /* The name line's VISIBLE text: the loop's second copy is aria-hidden, so it must not count as
       text the card prints. The copy sits INSIDE span.farm-name-track, so the walk has to skip
       aria-hidden subtrees at any depth, not just direct children. Used by the body-sequence pin,
       which compares the line against the snapshot's quest name. */
    const visibleText = (node) => {
      if (node.nodeType === 3) return node.nodeValue || "";
      if (node.nodeType === 1 && node.getAttribute("aria-hidden") === "true") return "";
      let out = "";
      for (const child of node.childNodes) out += visibleText(child);
      return out;
    };
    const playCards = [...inner.querySelectorAll(".farm-res-quests .farm-grid > .farm-card")].map((el) => {
      const title = el.querySelector(":scope > .farm-card-title");
      const body = el.querySelector(":scope > .farm-card-body");
      const icons = title ? [...title.querySelectorAll(".farm-card-icon")] : [];
      const nameEl = body ? body.querySelector(".farm-quest-name") : null;
      const nameSpan = nameEl ? nameEl.querySelector(".farm-quest-name-text") : null;
      const countEl = body ? body.querySelector(".farm-res-play-count") : null;
      const cs = countEl ? getComputedStyle(countEl) : null;
      const labelEl = body ? body.querySelector(".farm-res-play-label") : null;
      const ls = labelEl ? getComputedStyle(labelEl) : null;
      const rect = el.getBoundingClientRect();
      return {
        cls: [...el.classList],
        tier: el.getAttribute("data-tier"),
        titleCls: title ? [...title.classList].join(" ") : null,
        /* R25/R27 (re-pinned from R23's min-height, which the amendment removed, and from R25's
           --slide-dist oscillation, which R27 replaced): the single-line name contract — computed
           nowrap/overflow + one-line geometry — plus the full loop state from nameState (track,
           duplicate, title, duration, the track's animation) and the R28 computed card skin.
           Card/figure rects: R24 bottom-anchor compares BOTTOMS across cards sharing a grid row. */
        ...nameState(nameEl),
        nameWS: nameEl ? getComputedStyle(nameEl).whiteSpace : null,
        nameOvX: nameEl ? getComputedStyle(nameEl).overflowX : null,
        nameLH: nameEl ? getComputedStyle(nameEl).lineHeight : null,
        nameH: nameEl ? Math.round(nameEl.getBoundingClientRect().height * 10) / 10 : null,
        nameCW: nameEl ? nameEl.clientWidth : null,
        nameSW: nameEl ? nameEl.scrollWidth : null,
        spanW: nameSpan ? Math.round(nameSpan.getBoundingClientRect().width * 10) / 10 : null,
        cardTop: Math.round(rect.top * 10) / 10,
        countTop: countEl ? Math.round(countEl.getBoundingClientRect().top * 10) / 10 : null,
        labelTop: labelEl ? Math.round(labelEl.getBoundingClientRect().top * 10) / 10 : null,
        nameBottom: nameEl ? Math.round(nameEl.getBoundingClientRect().bottom * 10) / 10 : null,
        countBottom: countEl ? Math.round(countEl.getBoundingClientRect().bottom * 10) / 10 : null,
        labelBottom: labelEl ? Math.round(labelEl.getBoundingClientRect().bottom * 10) / 10 : null,
        iconH: icons.map((i) => getComputedStyle(i).height),
        iconAlts: icons.map((i) => (i.querySelector("img") ? i.querySelector("img").getAttribute("alt") : null)),
        iconSrcs: icons.map((i) => (i.querySelector("img") ? i.querySelector("img").getAttribute("src") || "" : null)),
        iconFallbacks: icons.map((i) => {
          const fb = i.querySelector(".icon-fallback");
          return fb ? getComputedStyle(fb).backgroundColor : null;
        }),
        name: nameSpan ? nameSpan.textContent.trim() : null,
        runsText: countEl ? countEl.textContent.trim() : null,
        runs: countEl ? Number(countEl.textContent.replace(/[^\d]/g, "")) : NaN,
        label: labelEl ? labelEl.textContent.trim() : null,
        bodySeq: body ? [...body.children].map((k) => ({ cls: [...k.classList], text: visibleText(k).trim() })) : [],
        countStyle: cs
          ? {
              fontFamily: cs.fontFamily,
              fontSize: cs.fontSize,
              fontWeight: cs.fontWeight,
              textAlign: cs.textAlign,
              color: cs.color,
            }
          : null,
        labelStyle: ls ? { fontSize: ls.fontSize, textAlign: ls.textAlign, color: ls.color } : null,
        dropdowns: el.querySelectorAll("select, .farm-quest-select, .material-input-box").length,
        legacyRows: el.querySelectorAll(".farm-res-row, .farm-res-quest-name, .farm-res-quest-runs").length,
        cardX: Math.round(rect.x),
        cardW: Math.round(rect.width * 10) / 10,
      };
    });
    /* R18: each Shop Trade is ONE farm card in .farm-res-trades > .farm-grid — from→to header (two
       64px .farm-card-icon boxes plus the arrow, NO separator bar under it), the exchange ratio
       OVERLAID on the header icons (cost on the from-icon, get on the to-icon) only when it
       resolves, the trade count in the runs voice (.farm-res-play-count) and the "trade(s)" label;
       the body carries ONLY those two lines (the R17 ratio body line is gone). No names in the body:
       the header alts name the currencies. */
    const tradeCards = [...inner.querySelectorAll(".farm-res-trades .farm-grid > .farm-card")].map((el) => {
      const title = el.querySelector(":scope > .farm-card-title");
      const body = el.querySelector(":scope > .farm-card-body");
      const kids = title ? [...title.children] : [];
      const icons = kids.filter((k) => k.classList.contains("farm-card-icon"));
      const arrow = kids.find((k) => k.classList.contains("farm-res-trade-arrow")) || null;
      const overlays = icons.map((i) => i.querySelector(":scope > .farm-res-trade-icon-count"));
      const bodyKids = body ? [...body.children] : [];
      const countEl = bodyKids.find((k) => k.classList.contains("farm-res-play-count")) || null;
      const cs = countEl ? getComputedStyle(countEl) : null;
      const labelEl = bodyKids.find((k) => k.classList.contains("farm-res-play-label")) || null;
      const m = countEl ? /\s*(\d[\d,]*)\s*$/.exec(countEl.textContent.trim()) : null;
      const ts = title ? getComputedStyle(title) : null;
      return {
        cls: [...el.classList],
        tier: el.getAttribute("data-tier"),
        titleCls: title ? [...title.classList].join(" ") : null,
        titleKids: kids.map((k) => [...k.classList].join(" ")),
        iconH: icons.map((i) => getComputedStyle(i).height),
        iconAlts: icons.map((i) => {
          const img = i.querySelector("img");
          return img ? img.getAttribute("alt") : null;
        }),
        iconSrcs: icons.map((i) => {
          const img = i.querySelector("img");
          return img ? img.getAttribute("src") || "" : null;
        }),
        arrow: arrow ? arrow.textContent.trim() : null,
        /* R18: the per-icon overlay text (plain number, no prefix at all) plus the icon-count skin. */
        iconOverlays: overlays.map((el) => (el ? el.textContent.trim() : null)),
        overlayStyles: overlays.map((el) => {
          if (!el) return null;
          const s = getComputedStyle(el);
          return {
            position: s.position,
            right: s.right,
            bottom: s.bottom,
            marginRight: s.marginRight,
            marginBottom: s.marginBottom,
            fontFamily: s.fontFamily,
            fontSize: s.fontSize,
            fontWeight: s.fontWeight,
            lineHeight: s.lineHeight,
            color: s.color,
            textShadow: s.textShadow,
            whiteSpace: s.whiteSpace,
            pointerEvents: s.pointerEvents,
          };
        }),
        headerBar: ts
          ? {
              borderBottomWidth: ts.borderBottomWidth,
              borderBottomStyle: ts.borderBottomStyle,
              paddingBottom: ts.paddingBottom,
            }
          : null,
        countText: countEl ? countEl.textContent.trim() : null,
        count: m ? Number(m[1].replace(/,/g, "")) : null,
        countStyle: cs
          ? {
              fontFamily: cs.fontFamily,
              fontSize: cs.fontSize,
              fontWeight: cs.fontWeight,
              textAlign: cs.textAlign,
              color: cs.color,
            }
          : null,
        label: labelEl ? labelEl.textContent.trim() : null,
        bodySeq: bodyKids.map((k) => ({ cls: [...k.classList], text: k.textContent.trim() })),
        bodyRatioNodes: body ? body.querySelectorAll(".farm-res-trade-ratio").length : 0,
      };
    });
    /* R17/R18 deletions: the trade-ROW classes the old shape used — and the R17 ratio body line R18
       deleted — are dead markup; every one of them counts ZERO nodes here, in every scene, and the
       grid is the only trades child structure. R22: the R21 .farm-res-trades-hint line joined the
       dead list — the owner rejected the explanation line, zero hint nodes in EVERY scene. */
    const deadTradeNodes = inner.querySelectorAll(
      ".farm-res-icon, .farm-res-trade-from, .farm-res-trade-to, .farm-res-trade-count, .farm-res-trade-ratio, .farm-res-trades-hint",
    ).length;
    const tradesWrap = inner.querySelector(".farm-res-trades");
    const tradesWrapKids = tradesWrap ? [...tradesWrap.children].map((el) => [...el.classList].join(" ")) : null;
    const tradesGridNodes = inner.querySelectorAll(".farm-res-trades > .farm-grid").length;
    const tradesOtherNodes = tradesWrap ? tradesWrap.querySelectorAll(".farm-res-row, select").length : 0;
    const headerSel =
      ".farm-res-quests > .quest-title, .farm-res-receive > .quest-title, .farm-res-trades > .quest-title";
    const headers = [...inner.querySelectorAll(headerSel)].map((el) => ({
      text: el.textContent.trim(),
      style: styleOf(el),
      farmStat: el.classList.contains("farm-stat"),
    }));
    const siblings = [...document.querySelectorAll("#panel-event .card-title")].filter((el) => !inner.contains(el));
    const siblingQuest = [...document.querySelectorAll("#panel-event .quest-title")].find((el) => !inner.contains(el));
    /* R17 sweep: an image in this card lives either in a receive .farm-res-fruit or in a 64px
       .farm-card-icon header box (play OR trade header — the trade-row .farm-res-icon box is dead).
       Anything else is a stray. */
    const images = [...inner.querySelectorAll("img")].map((img) => {
      const box = img.closest(".farm-res-fruit") || img.closest(".farm-card-icon");
      return {
        inReceive: !!img.closest(".farm-res-receive"),
        inPlay: !!img.closest(".farm-card"),
        cls: box ? [...box.classList].join(" ") : null,
        h: box ? getComputedStyle(box).height : null,
        imgCls: [...img.classList].join(" "),
      };
    });
    return {
      kids,
      receive,
      receiveCardCount: receiveCardEls.length,
      receiveRowCount: receiveRows.length,
      receiveNameNodes: receiveEl ? receiveEl.querySelectorAll(".farm-res-quest-name").length : 0,
      receiveCardText: receiveCard ? receiveCard.textContent.replace(/\s+/g, "") : null,
      receiveCardStyle: receiveCard
        ? (function (s) {
            return {
              background: s.backgroundColor,
              borderTopWidth: s.borderTopWidth,
              borderTopColor: s.borderTopColor,
              borderRadius: s.borderTopLeftRadius,
              paddingLeft: s.paddingLeft,
              paddingRight: s.paddingRight,
            };
          })(getComputedStyle(receiveCard))
        : null,
      receiveCardRect: receiveCard ? rectOf(receiveCard) : null,
      receiveRect: receiveEl ? rectOf(receiveEl) : null,
      itemNodes: inner.querySelectorAll(".farm-res-item").length,
      cardW: receiveCardEls.length ? Math.round(receiveCardEls[0].getBoundingClientRect().width) : null,
      wrapW: receiveEl ? receiveEl.clientWidth : null,
      rowIcons,
      plays: playCards.map((c) => ({ name: c.name, runs: c.runs })),
      playCards,
      /* R26 surfaces outside the results card: the Drop Rates grid quest names and the Shop
         Requirements tier-card item names, read through the SAME nameState contract as the play
         cards. R28/R28b skins: results play/trade cards, the Drop Rates input cards and the tier
         cards are ALL neutral house cards (data-tier kept, tier paint dropped). loopCss is the @keyframes rule
         the pins read instead of trusting a class name. */
      dropRateNames: [...document.querySelectorAll("#farmGrid .farm-quest-name")].map((el) => ({
        ...nameState(el),
        align: getComputedStyle(el).textAlign,
      })),
      materialNames: [...document.querySelectorAll(".material-name")].map((el) => ({
        ...nameState(el),
        align: getComputedStyle(el).textAlign,
      })),
      resultsCardSkins: [...inner.querySelectorAll(".farm-res-quests .farm-card, .farm-res-trades .farm-card")].map(
        (el) => {
          const s = getComputedStyle(el);
          return {
            tier: el.getAttribute("data-tier"),
            // an all-drop play card is combo by contract and carries NO data-tier (r6.cardshape pins that)
            combo: el.classList.contains("farm-card--combo"),
            bg: s.backgroundColor,
            bc: s.borderColor,
            inTrades: !!el.closest(".farm-res-trades"),
          };
        },
      ),
      inputCardSkins: [...document.querySelectorAll("#farmGrid .quest-drops-item")].map((el) => {
        const s = getComputedStyle(el);
        return { tier: el.getAttribute("data-tier"), bg: s.backgroundColor, bc: s.borderColor };
      }),
      tierCardSkins: [...document.querySelectorAll(".material-card[data-tier]")].map((el) => {
        const s = getComputedStyle(el);
        return { tier: el.getAttribute("data-tier"), bg: s.backgroundColor, bc: s.borderColor };
      }),
      loopCss: (function () {
        const steps = [];
        for (const sh of document.styleSheets) {
          let rules;
          try {
            rules = sh.cssRules;
          } catch {
            continue;
          }
          for (const r of rules)
            if (r.type === CSSRule.KEYFRAMES_RULE && r.name === "farm-name-slide")
              for (const k of r.cssRules) steps.push({ key: k.keyText, transform: k.style.transform });
        }
        return steps;
      })(),
      gridNodes: inner.querySelectorAll(".farm-res-quests > .farm-grid").length,
      gridKids: (function (g) {
        return g ? g.children.length : null;
      })(inner.querySelector(".farm-res-quests > .farm-grid")),
      gridW: (function (g) {
        return g ? g.clientWidth : null;
      })(inner.querySelector(".farm-res-quests > .farm-grid")),
      questsRows: inner.querySelectorAll(".farm-res-quests .farm-res-row").length,
      questsSelects: inner.querySelectorAll(".farm-res-quests select").length,
      // R17: trade CARDS wear .farm-res-play-count too, so the play-count node tally is scoped to Quests to Play.
      playCountNodes: questsWrap ? questsWrap.querySelectorAll(".farm-res-play-count").length : 0,
      tradeCards,
      deadTradeNodes,
      tradesWrapKids,
      tradesHintNodes: inner.querySelectorAll(".farm-res-trades-hint").length,
      tradesGridNodes,
      tradesOtherNodes,
      headers,
      totalNodes: totalEls.length,
      totalText: totalEl ? totalEl.textContent.trim() : null,
      totalTextInCard: /Total:/.test(inner.textContent),
      wrapBorders,
      questsWrapKids,
      title: titleEl
        ? {
            text: titleEl.textContent.trim(),
            style: styleOf(titleEl),
            farmStat: titleEl.classList.contains("farm-stat"),
          }
        : null,
      siblingTitles: siblings.map((el) => ({ text: el.textContent.trim(), style: styleOf(el) })),
      siblingQuestStyle: siblingQuest ? styleOf(siblingQuest) : null,
      siblingQuestText: siblingQuest ? siblingQuest.textContent.trim() : null,
      images,
      cardText: inner.textContent,
      receiveText: receiveEl ? receiveEl.textContent : "",
    };
  });
}

const classHas = (kid, c) => kid.classes.includes(c);
/* The Bond golden-fruit overlay shadow (R4a): four white shadows, one unit offset each way, 2px blur —
   "0 1px 2px #fff, 0 -1px 2px #fff, 1px 0 2px #fff, -1px 0 2px #fff" whatever order the engine prints. */
function bondShadow(value) {
  if (!value || value === "none") return false;
  const offs = [];
  /* split BETWEEN the four shadows, never inside one: rgb(255, 255, 255) carries commas of its own. */
  for (const part of value.split(/,(?=\s*rgb\()/)) {
    const m = /^rgb\(255, 255, 255\) (-?\d+)px (-?\d+)px (\d+)px$/.exec(part.trim());
    if (!m || m[3] !== "2" || Math.abs(Number(m[1])) + Math.abs(Number(m[2])) !== 1) return false;
    offs.push(`${m[1]}px ${m[2]}px`);
  }
  return offs.sort().join("|") === "-1px 0px|0px -1px|0px 1px|1px 0px";
}

/* R6: which quest is an all-drop play (every shop currency drops from it) and which currency is its
   main drop — mirrored from the domain (domain.js:1436 mainDropCurrencyId: biggest dropExpected×num on
   the plain figure, ties to the lower key; playsFromRuns isAllDrop). The unit tests pin these two values
   on the plan itself; what this gate pins is what the DOM WEARS because of them. */
const dropAmount = (drop) => Number(drop.dropExpected || 0) * Number(drop.num || 0);
function expectMainDrop(quest, currencies) {
  const keys = Object.keys(quest.drops || {});
  if (!keys.length) return null;
  const top = keys.reduce((a, b) => (dropAmount(quest.drops[a]) >= dropAmount(quest.drops[b]) ? a : b));
  return currencies.find((c) => String(c.id) === String(top)) || null;
}
const isAllDropQuest = (quest, currencies) => currencies.every((c) => Object.hasOwn(quest.drops, String(c.id)));
const sameClassSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/* R25 (re-pinned from R23's fixed-height contract, which the owner pivot deleted): every play-card
   quest name is EXACTLY ONE line — nowrap + overflow hidden, its box height equal to its own line
   height (no reserved min-height returning), uniform across the scene — and R24's bottom anchor
   keeps the runs count and label at the SAME BOTTOM across cards sharing a grid row, whatever the
   name length and whether a REC line pushes the body taller. */
function assertNameAreaAlignment(cards, label) {
  if (!cards.length) return;
  const heights = [];
  for (const c of cards) {
    if (c.nameWS !== "nowrap")
      fail(
        "r23.namealign",
        `${label}: "${c.name}" name white-space ${JSON.stringify(c.nameWS)}, want nowrap (R25: one line)`,
      );
    if (c.nameOvX !== "hidden")
      fail(
        "r23.namealign",
        `${label}: "${c.name}" name overflow-x ${JSON.stringify(c.nameOvX)}, want hidden (R25: single-line clip)`,
      );
    const lh = parseFloat(c.nameLH);
    if (!(lh > 0) || Math.abs(c.nameH - lh) > 0.6)
      fail(
        "r23.namealign",
        `${label}: "${c.name}" name box ${c.nameH}px is not ONE line of its ${c.nameLH} line-height (R23 min-height must not return)`,
      );
    heights.push(c.nameH);
  }
  if (heights.length && Math.max(...heights) - Math.min(...heights) > 0.6)
    fail("r23.namealign", `${label}: one-line name heights drift ${heights.join(" / ")}px across cards`);
  const rows = [];
  for (const c of cards) {
    const row = rows.find((r) => Math.abs(r[0].cardTop - c.cardTop) <= 1);
    if (row) row.push(c);
    else rows.push([c]);
  }
  if (cards.length >= 2 && rows.length === cards.length)
    fail("r23.namealign", `${label}: no two play cards share a grid row — the alignment differential did not run`);
  for (const row of rows) {
    if (row.length < 2) continue;
    const counts = row.map((c) => c.countBottom);
    if (Math.max(...counts) - Math.min(...counts) > 1)
      fail(
        "r23.namealign",
        `${label}: ${row.length} cards in one grid row put the runs count BOTTOM at ${counts.join(" / ")}px — R24's bottom anchor broke, the name length (or a REC line) drags the figures`,
      );
    const labels = row.map((c) => c.labelBottom);
    if (Math.max(...labels) - Math.min(...labels) > 1)
      fail("r23.namealign", `${label}: label bottoms ${labels.join(" / ")}px across one grid row (R24 bottom anchor)`);
  }
}

/* R25/R26/R27 sliding names, measured independently AT REST and shared by ALL THREE surfaces (the
   results play cards, the Drop Rates grid, the Shop Requirements tier cards). Overflow is derived
   from the FIRST copy's rect width minus the 24px track gap: transform-invariant (the animation only
   translateX()es) and duplication-invariant, so it never counts the copy the loop needs. Contract
   both ways: overflow > 0 ⇔ .is-sliding over ONE span.farm-name-track holding exactly TWO
   .farm-quest-name-text copies (the second aria-hidden="true", the first not hidden, both the full
   name, separated by the 24px gap) + the container title carrying the full name + the track running
   EXACTLY ONE farm-name-slide animation, linear, infinite, direction normal (never alternate — an
   alternating loop is the oscillation the owner rejected) at --slide-duration ==
   round((2 + 0.05s/px × name width) × 10)/10 s; and the track layout box is exactly TWO name+gap
   units wide, so the −50% step is one name+gap and the loop is seamless. --slide-dist is GONE (R27
   deleted it): neither branch may carry it. A fitting name is a single static span — no track, no
   class, no duration, no animation. */
function assertSlidingNames(cards, label, id = "r25.slide") {
  for (const c of cards) {
    if (!c || c.nameText == null) continue;
    const shown = JSON.stringify(String(c.nameText).slice(0, 28));
    if (c.titleAttr !== c.nameText)
      fail(id, `${label}: ${shown} title ${JSON.stringify(c.titleAttr)}, want the full name (R25 accessibility)`);
    const overflow = Math.round((c.textW - c.boxW) * 10) / 10;
    if (c.slideDistProp !== "")
      fail(id, `${label}: ${shown} still carries --slide-dist ${JSON.stringify(c.slideDistProp)} — R27 deleted it`);
    if (overflow > 0.5) {
      // One root line when the loop was never built at all: the rest of the contract is unreachable
      // without a track, and reporting ten consequences hides the single cause.
      if (!c.sliding || !c.hasTrack || c.nTexts !== 2)
        fail(
          id,
          `${label}: ${shown} overflows its box by ${overflow}px but is NOT a loop: is-sliding ${c.sliding}, span.farm-name-track ${c.hasTrack}, ${c.nTexts} name-text copy(ren) — an overflowing name must wrap into the track (name + 24px gap + aria-hidden duplicate)`,
        );
      else {
        if (c.dupHidden !== "true")
          fail(
            id,
            `${label}: ${shown} duplicate copy aria-hidden ${JSON.stringify(c.dupHidden)}, want "true" (a screen reader must read the name once)`,
          );
        if (c.firstHidden !== null)
          fail(
            id,
            `${label}: ${shown} first copy carries aria-hidden ${JSON.stringify(c.firstHidden)}, want none — the readable copy is the first`,
          );
        if (c.text2 !== c.nameText)
          fail(
            id,
            `${label}: ${shown} duplicate text ${JSON.stringify(c.text2)} != the name — the loop seam would print two different strings`,
          );
        if (c.gapPx !== 24)
          fail(id, `${label}: ${shown} name/gap padding-inline-end ${c.gapPx}px, want the 24px loop gap`);
        const seam = 2 * (c.textW + c.gapPx);
        if (Math.abs(c.trackW - seam) > 2)
          fail(
            id,
            `${label}: ${shown} track ${c.trackW}px, want 2×(name ${c.textW} + gap ${c.gapPx}) = ${seam.toFixed(1)}px so −50% lands exactly one name+gap (±2)`,
          );
        const wantDur = Math.round((2 + c.textW * 0.05) * 10) / 10;
        const dur = parseFloat(c.dur);
        if (!Number.isFinite(dur))
          fail(id, `${label}: ${shown} --slide-duration ${JSON.stringify(c.dur)}, want ${wantDur}s`);
        else if (Math.abs(dur - (2 + c.textW * 0.05)) > 0.1)
          fail(
            id,
            `${label}: ${shown} --slide-duration ${dur}s vs 2s + 0.05s/px × ${c.textW}px = ${(2 + c.textW * 0.05).toFixed(2)}s (±0.1)`,
          );
        if (c.animName !== "farm-name-slide")
          fail(
            id,
            `${label}: ${shown} track animation-name ${JSON.stringify(c.animName)}, want exactly farm-name-slide (a doubled list means stacked animations)`,
          );
        if (c.animDur !== c.dur)
          fail(
            id,
            `${label}: ${shown} track animation-duration ${JSON.stringify(c.animDur)} != --slide-duration ${JSON.stringify(c.dur)}`,
          );
        if (c.animTf !== "linear")
          fail(
            id,
            `${label}: ${shown} track animation-timing-function ${JSON.stringify(c.animTf)}, want linear (constant speed)`,
          );
        if (c.animIter !== "infinite")
          fail(
            id,
            `${label}: ${shown} track animation-iteration-count ${JSON.stringify(c.animIter)}, want infinite (R27: the slide LOOPS)`,
          );
        if (c.animDir !== "normal")
          fail(
            id,
            `${label}: ${shown} track animation-direction ${JSON.stringify(c.animDir)}, want normal — alternate/reverse is the back-and-forth swap the owner rejected`,
          );
      }
      if (c.spanAnim !== "none")
        fail(
          id,
          `${label}: ${shown} name-text span animates (${JSON.stringify(c.spanAnim)}) — the loop moves the TRACK, not the copy`,
        );
    } else {
      if (c.sliding) fail(id, `${label}: fitting name ${shown} (overflow ${overflow}px) wears .is-sliding`);
      if (c.hasTrack || c.nTexts !== 1)
        fail(
          id,
          `${label}: fitting name ${shown} (overflow ${overflow}px) is not a single static span: track ${c.hasTrack}, ${c.nTexts} text child(ren)`,
        );
      if (c.dur !== "")
        fail(id, `${label}: fitting name ${shown} still carries --slide-duration ${JSON.stringify(c.dur)}`);
      if (c.spanAnim !== "none") fail(id, `${label}: fitting name ${shown} animates: ${JSON.stringify(c.spanAnim)}`);
    }
  }
}

/* R25 (kept, re-pinned): the loop contract for the results play cards is one call away. */
function assertQuestNameSlides(cards, label) {
  assertSlidingNames(cards, label, "r25.slide");
}

/* R27: the owner's complaint was an OSCILLATION (0 → −dist → 0). The proof it is gone is the
   keyframe rule itself, read from the CSSOM — exactly two steps, 0% at translateX(0) and 100% at
   translateX(−50%). Three or more steps, or a step returning to 0, is the back-and-forth swap
   coming back, whatever the class names say. */
function assertLoopKeyframes(card, label) {
  const steps = card.loopCss || [];
  const keys = steps.map((s) => s.key).join(",");
  if (steps.length !== 2)
    fail(
      "r27.loop",
      `${label}: @keyframes farm-name-slide has ${steps.length} step(s) [${keys}], want exactly 2 (0% and 100%) — a mid step back to 0 is the oscillation R27 removed`,
    );
  const from = steps.find((s) => /(^|,)\s*0%\s*(,|$)/.test(s.key));
  const to = steps.find((s) => /(^|,)\s*100%\s*(,|$)/.test(s.key));
  if (!from || !to) return void fail("r27.loop", `${label}: no 0%/100% step in ${JSON.stringify(steps)}`);
  if (!/^translateX\(0(px)?\)$/.test(from.transform))
    fail(
      "r27.loop",
      `${label}: 0% step ${JSON.stringify(from.transform)}, want translateX(0) — the loop starts on the name's own head`,
    );
  if (!/^translateX\(-50%\)$/.test(to.transform))
    fail(
      "r27.loop",
      `${label}: 100% step ${JSON.stringify(to.transform)}, want translateX(-50%) — one name+gap per cycle, the seam of the seamless loop`,
    );
}

/* R28: the results play/trade cards go back to the neutral house card skin — the same background and
   border the Item Receive card already pins as --bg/--border. The discriminator is the tier colour:
   with data-tier KEPT (the Drop Rates pick-a-currency cue), a border that still equals that tier's
   colour means the override never landed. R28b brings the Drop Rates input cards
   (.quest-drops-item[data-tier]) and the Shop Requirements tier cards into the same neutral contract. */
function assertNeutralResultsSkin(card, label) {
  const ref = card.receiveCardStyle;
  if (!ref)
    return void fail("r28.neutral", `${label}: no Item Receive card to read the neutral --bg/--border reference from`);
  if (!card.resultsCardSkins.length)
    return void fail("r28.neutral", `${label}: zero results play/trade cards scraped — the R28 pin did not run`);
  for (const c of card.resultsCardSkins) {
    const at = `${label}: ${c.inTrades ? "trade" : "play"} card data-tier ${JSON.stringify(c.tier)}`;
    if (c.bg !== ref.background)
      fail(
        "r28.neutral",
        `${at} background ${c.bg}, want the neutral --bg ${ref.background} (the Item Receive card's own skin)`,
      );
    if (c.bc !== ref.borderTopColor)
      fail("r28.neutral", `${at} border-color ${c.bc}, want the neutral --border ${ref.borderTopColor}`);
    const tier = c.tier && TIER_COLORS[c.tier] ? hexToRgb(TIER_COLORS[c.tier]) : null;
    if (tier && c.bc === tier)
      fail(
        "r28.neutral",
        `${at} border is STILL the ${c.tier} tier colour ${c.bc} — the results-card override must land after .quest-drops-item[data-tier]`,
      );
    // data-tier is KEPT by R28 on every card that ever had one; the all-drop combo card has none by contract
    if (!c.tier && !c.combo)
      fail(
        "r28.neutral",
        `${at} lost its data-tier attribute — R28 keeps it (this pin and the Drop Rates cue both read it)`,
      );
    if (!c.tier && c.combo && c.bc !== ref.borderTopColor)
      fail("r28.neutral", `${at} the combo card must take the same neutral border, got ${c.bc}`);
  }
}

function assertTierSkinKept(card, label) {
  const ref = card.receiveCardStyle;
  if (!ref)
    return void fail("r28.keepTier", `${label}: no Item Receive card to read the neutral --bg/--border reference from`);
  for (const [what, list, checkBg] of [
    // R28b reskins the input card's BORDER only — its grey inset background is not in the contract;
    // the tier card takes the full neutral house skin, background included.
    ["Drop Rates input card", card.inputCardSkins, false],
    ["Shop Requirements tier card", card.tierCardSkins, true],
  ]) {
    if (!list.length)
      return void fail("r28.keepTier", `${label}: zero ${what} skin samples — the R28b scope pin did not run`);
    for (const c of list) {
      if (!c.tier) continue; // the all-drop combo card carries no tier by contract
      const stale = TIER_COLORS[c.tier] ? hexToRgb(TIER_COLORS[c.tier]) : null;
      if (!stale)
        return void fail("r28.keepTier", `${label}: ${what} data-tier "${c.tier}" is no tier colour — re-derive`);
      if (c.bc !== ref.borderTopColor)
        fail(
          "r28.keepTier",
          `${label}: ${what} data-tier ${c.tier} border ${c.bc}, want the neutral --border ${ref.borderTopColor} — R28b neutralises the whole Event Shop tab`,
        );
      if (c.bc === stale)
        fail(
          "r28.keepTier",
          `${label}: ${what} data-tier ${c.tier} border is STILL the tier colour ${stale} — the R28b neutral rule did not land`,
        );
      if (checkBg && c.bg !== ref.background)
        fail(
          "r28.keepTier",
          `${label}: ${what} data-tier ${c.tier} background ${c.bg}, want the neutral --bg ${ref.background}`,
        );
    }
  }
}

function assertPlayCards(card, label, { currencies, quests }) {
  assertNameAreaAlignment(card.playCards, label);
  assertQuestNameSlides(card.playCards, label);
  if (card.gridNodes !== 1)
    fail("r6.cardshape", `${label}: ${card.gridNodes} .farm-grid wraps inside Quests to Play, want exactly 1`);
  if (card.gridKids !== card.playCards.length)
    fail(
      "r6.cardshape",
      `${label}: the grid holds ${card.gridKids} children but ${card.playCards.length} play cards were scraped`,
    );
  if (card.questsRows !== 0)
    fail("r6.cardshape", `${label}: ${card.questsRows} legacy .farm-res-row node(s) left in Quests to Play`);
  if (card.questsSelects !== 0)
    fail("r6.cardshape", `${label}: ${card.questsSelects} dropdown(s) in Quests to Play — R6 is chrome, not controls`);
  if (card.playCountNodes !== card.playCards.length)
    fail(
      "r6.bodyseq",
      `${label}: ${card.playCountNodes} .farm-res-play-count nodes, want one per play card (${card.playCards.length})`,
    );
  card.playCards.forEach((c, idx) => {
    const at = `card #${idx} "${c.name}"`;
    const quest = quests.find((q) => q.questName === c.name);
    if (!quest) return void fail("r6.cardshape", `${label}: play card ${at} names no quest of the snapshot`);
    const allDrop = isAllDropQuest(quest, currencies);
    const main = expectMainDrop(quest, currencies);
    const wrong = [];
    if (!c.cls.includes("quest-drops-item") || !c.cls.includes("farm-card")) wrong.push(`classes "${c.cls.join(" ")}"`);
    if (c.cls.includes("farm-card--combo") !== allDrop)
      wrong.push(`farm-card--combo ${c.cls.includes("farm-card--combo")}, want ${allDrop}`);
    const wantTier = allDrop || !main ? null : main.background;
    if (c.tier !== wantTier) wrong.push(`data-tier ${JSON.stringify(c.tier)}, want ${JSON.stringify(wantTier)}`);
    if (c.dropdowns || c.legacyRows)
      wrong.push(`${c.dropdowns} dropdown + ${c.legacyRows} legacy row node(s) inside the card`);
    if (wrong.length) fail("r6.cardshape", `${label}: play card ${at} off the Drop Rates chrome: ${wrong.join("; ")}`);

    const wantIcons = allDrop ? currencies : main ? [main] : [];
    const header = [];
    if (c.titleCls !== (allDrop ? "farm-card-title farm-card-title--icons" : "farm-card-title"))
      header.push(`title class "${c.titleCls}"`);
    if (c.iconH.length !== wantIcons.length)
      header.push(`${c.iconH.length} header icon(s), want ${wantIcons.length} (${wantIcons.map((w) => w.name)})`);
    wantIcons.forEach((cur, i) => {
      if (i >= c.iconH.length) return;
      if (c.iconH[i] !== "64px") header.push(`icon ${i} height ${c.iconH[i]}, want 64px`);
      if (cur.icon) {
        if (!c.iconSrcs[i] || !c.iconSrcs[i].includes(String(cur.icon).split("/").pop()))
          header.push(`icon ${i} src ${JSON.stringify(c.iconSrcs[i])}, want ${cur.icon}`);
        if (c.iconAlts[i] !== cur.name)
          header.push(`icon ${i} alt ${JSON.stringify(c.iconAlts[i])}, want the currency name "${cur.name}"`);
      } else if (c.iconFallbacks[i] !== hexToRgb(TIER_COLORS[cur.background] || TIER_COLORS.silver))
        header.push(`icon ${i} fallback ${JSON.stringify(c.iconFallbacks[i])}, want the ${cur.background} colour`);
    });
    for (let i = wantIcons.length; i < c.iconH.length; i++)
      header.push(`unexpected header icon ${i} (alt ${JSON.stringify(c.iconAlts[i])})`);
    if (header.length) fail("r6.headericons", `${label}: play card ${at} header: ${header.join("; ")}`);

    const wantSeq = [["farm-stat", "farm-quest-name"]];
    if (quest.recommendLv) wantSeq.push(["farm-stat"]);
    wantSeq.push(["farm-stat", "farm-res-play-count"], ["farm-stat", "farm-res-play-label"]);
    const body = [];
    if (c.bodySeq.length !== wantSeq.length)
      body.push(`${c.bodySeq.length} body lines ${JSON.stringify(c.bodySeq.map((k) => k.text))}`);
    wantSeq.forEach((cls, i) => {
      const line = c.bodySeq[i];
      if (!line) return;
      // R25: the name line may carry the measured STATE class is-sliding — identity classes stay
      // exact and r25.slide alone decides whether is-sliding is legitimate (proven from geometry).
      const gotCls = i === 0 ? line.cls.filter((x) => x !== "is-sliding") : line.cls;
      if (!sameClassSet(gotCls, cls)) body.push(`line ${i} classes "${line.cls.join(" ")}", want "${cls.join(" ")}"`);
    });
    const nameLine = c.bodySeq[0];
    if (nameLine && nameLine.text !== quest.questName) body.push(`line 0 text "${nameLine.text}"`);
    const recLine = quest.recommendLv ? c.bodySeq[1] : null;
    if (quest.recommendLv && recLine && recLine.text !== `REC Lv. ${quest.recommendLv}`)
      body.push(`REC line "${recLine.text}", want "REC Lv. ${quest.recommendLv}"`);
    const countLine = c.bodySeq[wantSeq.length - 2];
    if (countLine && countLine.text !== c.runs.toLocaleString("en-US"))
      body.push(`runs line "${countLine.text}", want ${c.runs.toLocaleString("en-US")}`);
    const labelLine = c.bodySeq[wantSeq.length - 1];
    if (labelLine && labelLine.text !== (c.runs === 1 ? "run" : "runs"))
      body.push(`label "${labelLine.text}", want "${c.runs === 1 ? "run" : "runs"}"`);
    if (body.length) fail("r6.bodyseq", `${label}: play card ${at} body: ${body.join("; ")}`);
    const cs = c.countStyle;
    if (cs) {
      const off = [];
      if (!/ui-monospace/.test(cs.fontFamily)) off.push(`family ${cs.fontFamily}`);
      if (cs.fontSize !== "24px") off.push(`size ${cs.fontSize}`);
      if (cs.fontWeight !== "700") off.push(`weight ${cs.fontWeight}`);
      if (cs.textAlign !== "center") off.push(`align ${cs.textAlign}`);
      if (cs.color !== "rgb(26, 26, 46)") off.push(`colour ${cs.color}`);
      if (off.length)
        fail(
          "r6.bodyseq",
          `${label}: play card ${at} runs number off 1.5rem/24px 700 centered --text: ${off.join(", ")}`,
        );
    } else fail("r6.bodyseq", `${label}: play card ${at} has no .farm-res-play-count to style`);
    const ls = c.labelStyle;
    if (ls) {
      const off = [];
      if (ls.fontSize !== "11.2px") off.push(`size ${ls.fontSize}`);
      if (ls.textAlign !== "center") off.push(`align ${ls.textAlign}`);
      if (ls.color !== "rgb(75, 85, 99)") off.push(`colour ${ls.color}`);
      if (off.length)
        fail(
          "r6.bodyseq",
          `${label}: play card ${at} runs label off 0.7rem/11.2px centered --text-secondary: ${off.join(", ")}`,
        );
    }
  });
  for (let i = 1; i < card.playCards.length; i++) {
    const prev = card.playCards[i - 1];
    const cur = card.playCards[i];
    if (prev.runs < cur.runs)
      fail(
        "r6.order",
        `${label}: card #${i} (${cur.runs} runs) outrides its predecessor #${i - 1} (${prev.runs}) — most-ridden first broken`,
      );
  }
}
/* Amendment R18: Shop Trades wear the play-card chrome — one farm card per trade, data-tier on the
   DESTINATION currency, a from→to icon header with the ratio OVERLAID per icon (cost on the
   from-icon, get on the to-icon, plain numbers, only when the ratio resolves) and NO separator bar,
   and a body of ONLY the count in the runs voice + the trades label.
   Full strength: every field of every card is re-derived from the snapshot (currencies + trade list),
   never hardcoded, plus fx.exact's pinned counts/overlays/tier identity for the mockup scene. */
function assertTradeCards(card, label, { currencies, trades, wantCounts }) {
  const byId = Object.fromEntries(currencies.map((c) => [String(c.id), c]));
  if (card.tradeCards.length !== trades.length)
    return void fail(
      "r18.tradechrome",
      `${label}: ${card.tradeCards.length} trade cards, want ${trades.length} (one per planned trade)`,
    );
  card.tradeCards.forEach((t, idx) => {
    const at = `trade card #${idx}`;
    const wrong = [];
    if (!t.cls.includes("quest-drops-item") || !t.cls.includes("farm-card"))
      wrong.push(`classes "${t.cls.join(" ")}", want quest-drops-item farm-card`);
    // identity by the header alts: from = icon 0, to = icon 1 — resolved through the currency table
    const from = currencies.find((c) => c.name === t.iconAlts[0]);
    const to = currencies.find((c) => c.name === t.iconAlts[1]);
    const planned =
      from && to ? trades.find((x) => Number(x.fromId) === Number(from.id) && Number(x.toId) === Number(to.id)) : null;
    if (!from || !to) wrong.push(`header alts ${JSON.stringify(t.iconAlts)} name no currency pair`);
    else if (!planned) wrong.push(`${from.name}→${to.name} is no trade of the snapshot`);
    if (from && to && from.name === to.name) wrong.push("from and to icons name the same currency");
    if (t.titleCls !== "farm-card-title farm-card-title--icons") wrong.push(`header classes "${t.titleCls}"`);
    if (t.titleKids.length !== 3)
      wrong.push(
        `${t.titleKids.length} header children ${JSON.stringify(t.titleKids)}, want icon + arrow + icon (R18)`,
      );
    if (t.iconH.length !== 2) wrong.push(`${t.iconH.length} header icons, want exactly 2 (from + to)`);
    if (t.arrow !== "\u2192") wrong.push(`arrow ${JSON.stringify(t.arrow)}, want "\u2192"`);
    t.iconH.forEach((h, i) => {
      if (h !== "64px") wrong.push(`icon ${i} height ${h}, want 64px`);
    });
    if (from && from.icon && t.iconSrcs[0] && !t.iconSrcs[0].includes(String(from.icon).split("/").pop()))
      wrong.push(`from icon src ${JSON.stringify(t.iconSrcs[0])}, want ${from.icon}`);
    if (to && to.icon && t.iconSrcs[1] && !t.iconSrcs[1].includes(String(to.icon).split("/").pop()))
      wrong.push(`to icon src ${JSON.stringify(t.iconSrcs[1])}, want ${to.icon}`);
    if (to && t.tier !== to.background)
      wrong.push(`data-tier ${JSON.stringify(t.tier)}, want the destination "${to.background}"`);
    /* R18 NO separator bar: the shared .farm-card-title border-bottom/padding are switched off
       inside Shop Trades — a returning bar reddens here. */
    const hb = t.headerBar;
    if (!hb) wrong.push("no header to measure the separator bar on");
    else if (hb.borderBottomStyle !== "none" || hb.borderBottomWidth !== "0px" || hb.paddingBottom !== "0px")
      wrong.push(
        `header separator bar ${JSON.stringify(hb)}, want border-bottom none/0px + padding-bottom 0px (R18 removed the bar)`,
      );
    /* R18: the ratio rides the HEADER ICONS, never the body. A resolved pair shows costAmount on
       the from-icon and getNum on the to-icon (plain numbers — an exchange rate is not a count, so
       no prefix — R19 made even the trade count bare); a stale, unresolvable pair carries NO
       overlay at all (graceful, never a 0). */
    if (planned) {
      const wantCost = planned.costAmount.toLocaleString("en-US", { maximumFractionDigits: 1 });
      const wantGet = planned.getNum.toLocaleString("en-US", { maximumFractionDigits: 1 });
      if (t.iconOverlays[0] !== wantCost)
        wrong.push(`from-icon overlay ${JSON.stringify(t.iconOverlays[0])}, want the costAmount "${wantCost}"`);
      if (t.iconOverlays[1] !== wantGet)
        wrong.push(`to-icon overlay ${JSON.stringify(t.iconOverlays[1])}, want the getNum "${wantGet}"`);
      if (t.count !== Number(wantCounts[idx]))
        wrong.push(`count ${JSON.stringify(t.countText)}, want the bare ${wantCounts[idx].toLocaleString("en-US")}`);
      if (t.label !== (t.count === 1 ? "trade" : "trades")) wrong.push(`label "${t.label}"`);
    } else if (t.iconOverlays.some((o) => o !== null))
      wrong.push(
        `an unresolved (stale) pair carries icon overlays ${JSON.stringify(t.iconOverlays)} — R18 renders them only when the ratio resolves`,
      );
    /* R18: the .farm-res-fruit-count skin byte-mirrored onto the trade overlays (R15 parity):
       absolute, pinned to the icon box's right/bottom corner with the 3px/7px margin inset. */
    t.overlayStyles.forEach((s, i) => {
      if (!s) return;
      const off = [];
      if (s.position !== "absolute") off.push(`position ${s.position}`);
      if (s.right !== "0px") off.push(`right ${s.right}`);
      if (s.bottom !== "0px") off.push(`bottom ${s.bottom}`);
      if (s.marginRight !== "3px") off.push(`margin-right ${s.marginRight}`);
      if (s.marginBottom !== "7px") off.push(`margin-bottom ${s.marginBottom}`);
      if (!/ui-monospace/.test(s.fontFamily)) off.push(`family ${s.fontFamily}`);
      if (s.fontSize !== "16px") off.push(`size ${s.fontSize}`);
      if (s.fontWeight !== "700") off.push(`weight ${s.fontWeight}`);
      if (parseFloat(s.lineHeight) !== parseFloat(s.fontSize)) off.push(`line-height ${s.lineHeight}`);
      if (s.color !== "rgb(26, 26, 46)") off.push(`colour ${s.color}`);
      if (!bondShadow(s.textShadow)) off.push(`shadow ${JSON.stringify(s.textShadow)}`);
      if (s.whiteSpace !== "nowrap") off.push(`white-space ${s.whiteSpace}`);
      if (s.pointerEvents !== "none") off.push(`pointer-events ${s.pointerEvents}`);
      if (off.length)
        fail("r18.overlay", `${label}: ${at} icon ${i} overlay off the fruit-count skin: ${off.join(", ")}`);
    });
    /* R19: the trade count prints BARE whole units — /^[\d,]+$/, no "×" prefix (the header overlays
       carry the ratio; a multiplying "×" beside a count would read as "10 × 16 trades"). */
    if (!/^[\d,]+$/.test(t.countText || ""))
      wrong.push(`count text ${JSON.stringify(t.countText)} off /^[\\d,]+$/ (R19 bare number)`);
    /* the count rides the play-card runs voice: ui-monospace 24px 700 centered --text (.farm-res-play-count). */
    const cs = t.countStyle;
    if (!cs) wrong.push("no .farm-res-play-count count line to style");
    else {
      const off = [];
      if (!/ui-monospace/.test(cs.fontFamily)) off.push(`family ${cs.fontFamily}`);
      if (cs.fontSize !== "24px") off.push(`size ${cs.fontSize}`);
      if (cs.fontWeight !== "700") off.push(`weight ${cs.fontWeight}`);
      if (cs.textAlign !== "center") off.push(`align ${cs.textAlign}`);
      if (cs.color !== "rgb(26, 26, 46)") off.push(`colour ${cs.color}`);
      if (off.length) off.forEach((o) => wrong.push(`count ${o}`));
    }
    /* R18 body: count + label ONLY — the R17 ratio line is deleted markup (also globally pinned
       ZERO through deadTradeNodes). Exactly 2 children, classes in order. */
    if (t.bodyRatioNodes)
      wrong.push(`${t.bodyRatioNodes} .farm-res-trade-ratio node(s) in the body — R18 deleted the ratio line`);
    const wantSeq = [
      ["farm-stat", "farm-res-play-count"],
      ["farm-stat", "farm-res-play-label"],
    ];
    if (t.bodySeq.length !== wantSeq.length)
      wrong.push(
        `body ${JSON.stringify(t.bodySeq.map((k) => k.text))}, want count + label ONLY (${wantSeq.length} lines)`,
      );
    wantSeq.forEach((cls, i) => {
      const line = t.bodySeq[i];
      if (line && !sameClassSet(line.cls, cls))
        wrong.push(`body line ${i} classes "${line.cls.join(" ")}", want "${cls.join(" ")}"`);
    });
    if (wrong.length) fail("r18.tradechrome", `${label}: ${at}: ${wrong.join("; ")}`);
  });
}
/* fx.exact value pins for the mockup (the counts, per-icon ratio overlays, tiers and identity the
   plan of record names): the cards themselves are structurally pinned above, these are the FIGURES.
   R22: the minimum cover is ONE trade — donut→pie ×196. The card list the DOM must show is ALSO
   derived independently per run by gateMinCover (runFx), this literal is the frozen contract value. */
function assertTradeFxExact(card, label) {
  const got = card.tradeCards.map((t) => [t.countText, ...t.iconOverlays, t.tier, t.iconAlts.join("\u2192")]);
  const want = [["196", "10", "1", "silver", "Donut\u2192Pie"]];
  if (JSON.stringify(got) !== JSON.stringify(want))
    fail(
      "fx.exact",
      `${label}: trade cards ${JSON.stringify(got)}, want ${JSON.stringify(want)} (R22 minimum cover — the cookie→donut cascade row must be GONE)`,
    );
}
function assertStructure(card, label, { expectTrades }) {
  if (!card) return void fail("order.sequence", `${label}: #results card inner missing after Calculate`);
  const wanted = ["card-title", "farm-res-quests", "farm-res-receive"];
  if (expectTrades) wanted.push("farm-res-trades");
  const got = card.kids
    .filter((k) => ["card-title", "farm-res-quests", "farm-res-receive", "farm-res-trades"].some((c) => classHas(k, c)))
    .map((k) => (classHas(k, "card-title") ? "card-title" : k.classes.find((c) => c.startsWith("farm-res-"))));
  if (JSON.stringify(got) !== JSON.stringify(wanted))
    fail("order.sequence", `${label}: section order ${JSON.stringify(got)}, want ${JSON.stringify(wanted)}`);
  const structural = card.kids.filter((k) =>
    ["card-title", "farm-res-quests", "farm-res-receive", "farm-res-trades", "farm-res-empty"].some((c) =>
      classHas(k, c),
    ),
  );
  if (structural.length !== wanted.length)
    fail(
      "order.sequence",
      `${label}: ${structural.length} section nodes, want exactly ${wanted.length} (nothing extra after trades) — ${JSON.stringify(card.kids.map((k) => k.classes))}`,
    );

  /* R7: the total line is gone — no .farm-res-total node, no "Total:" text anywhere in the card,
     in EVERY scene (zero-play included). And the separator LINES left the three wraps while the
     margin/padding spacing stayed (the .farm-res-total CSS rule itself is deleted with them). */
  if (card.totalNodes || card.totalText || card.totalTextInCard)
    fail(
      "total.absent",
      `${label}: a total line is back — ${card.totalNodes} .farm-res-total node(s), totalText ${JSON.stringify(card.totalText)}, "Total:" in card text ${card.totalTextInCard}`,
    );
  for (const w of card.wrapBorders) {
    const off = [];
    if (w.borderTopWidth !== "0px" || w.borderTopStyle !== "none")
      off.push(`border-top ${w.borderTopStyle} ${w.borderTopWidth}`);
    if (w.marginTop !== "8px" || w.paddingTop !== "8px")
      off.push(`margin-top ${w.marginTop}, padding-top ${w.paddingTop} (R7 keeps 8px/8px)`);
    if (off.length) fail("separator.absent", `${label}: .${w.cls}: ${off.join("; ")}`);
  }

  const keys = ["fontSize", "fontFamily", "fontWeight", "textTransform"];
  if (!card.title) fail("title.parity", `${label}: no card-title in the results card`);
  else {
    const t = card.title.style;
    if (card.title.farmStat)
      fail("title.parity", `${label}: the card title carries farm-stat (0.72rem monospace bug is back)`);
    if (t.fontSize !== "12.8px") fail("title.parity", `${label}: title font-size ${t.fontSize}, want 12.8px (0.8rem)`);
    if (!/system-ui/.test(t.fontFamily))
      fail("title.parity", `${label}: title font-family ${t.fontFamily}, want the system-ui stack`);
    if (t.fontWeight !== "600") fail("title.parity", `${label}: title font-weight ${t.fontWeight}, want 600`);
    if (t.textTransform !== "uppercase")
      fail("title.parity", `${label}: title text-transform ${t.textTransform}, want uppercase`);
    const sib = card.siblingTitles[0];
    if (!sib) fail("title.parity", `${label}: no sibling .card-title to compare against`);
    else {
      const diff = keys.filter((k) => t[k] !== sib.style[k]);
      if (diff.length) fail("title.parity", `${label}: differs from sibling "${sib.text}" in ${diff.join(",")}`);
    }
    if (card.title.text !== "Best Farm Runs") fail("title.parity", `${label}: title text "${card.title.text}"`);
  }
  /* The legacy "Recommended Quest Runs" .quest-title sibling is replaced with the planner fragment
     in event mode, so the header parity pins the .quest-title RULE VALUES (sheet: 0.8rem, 600,
     uppercase, inherited system-ui) directly: a farm-stat header would land at 11.52px monospace. */
  for (const h of card.headers) {
    const wrong = [];
    if (h.style.fontSize !== "12.8px") wrong.push(`size ${h.style.fontSize}`);
    if (h.style.fontWeight !== "600") wrong.push(`weight ${h.style.fontWeight}`);
    if (h.style.textTransform !== "uppercase") wrong.push(`transform ${h.style.textTransform}`);
    if (!/system-ui/.test(h.style.fontFamily)) wrong.push(`family ${h.style.fontFamily}`);
    if (h.farmStat) wrong.push("carries farm-stat");
    if (wrong.length)
      fail("headers.parity", `${label}: header "${h.text}" off quest-title parity: ${wrong.join(", ")}`);
  }
  if (card.headers.length !== (expectTrades ? 3 : 2))
    fail("headers.parity", `${label}: ${card.headers.length} section headers, want ${expectTrades ? 3 : 2}`);
  const badR = card.receive.filter((r) => r.fruitH !== "96px");
  if (badR.length) fail("r1.receive96", `${label}: ${badR.length} receive art box(es) at ${badR[0].fruitH}, want 96px`);
  if (!card.receive.length) fail("r1.receive96", `${label}: no Item Receive fruit rendered`);
  const badRow = card.rowIcons.filter((h) => h !== "64px");
  if (badRow.length) fail("r1.rows48", `${label}: ${badRow.length} .farm-card-icon at ${badRow[0]}, want 64px`);
  /* R17: the 64px box is the shared .farm-card-icon (play AND trade headers) — a plan with trades
     renders at least two of them (two per trade card, pinned on the cards themselves). */
  if (card.rowIcons.length < (expectTrades ? 2 : 0))
    fail("r1.rows48", `${label}: ${card.rowIcons.length} .farm-card-icon boxes, want ≥ 2 with trades rendered`);
  /* R17/R18 deletions: the old trade-ROW classes and R18's dead ratio body line are dead markup —
     zero nodes, every scene (the list is pinned in the deadTradeNodes scrape). */
  if (card.deadTradeNodes)
    fail(
      "r18.tradechrome",
      `${label}: ${card.deadTradeNodes} dead trade node(s) (.farm-res-icon/.farm-res-trade-from/-to/-count/-ratio) are back`,
    );
  if (expectTrades) {
    if (card.tradesGridNodes !== 1)
      fail("r18.tradechrome", `${label}: ${card.tradesGridNodes} .farm-grid in Shop Trades, want exactly 1`);
    if (JSON.stringify(card.tradesWrapKids) !== JSON.stringify(["quest-title", "farm-grid"]))
      fail(
        "r18.tradechrome",
        `${label}: Shop Trades wrap children ${JSON.stringify(card.tradesWrapKids)}, want exactly header + grid (R22 removed the R21 hint)`,
      );
    if (card.tradesOtherNodes)
      fail(
        "r18.tradechrome",
        `${label}: ${card.tradesOtherNodes} legacy .farm-res-row/select node(s) in Shop Trades — R17/R18 is cards, not rows or controls`,
      );
  }
  /* R22 (owner rejected the R21 explanation line): ZERO .farm-res-trades-hint nodes in EVERY scene,
     with or without trades — the sweep above counts them among the dead trade markup. */
  if (card.tradesHintNodes)
    fail(
      "r18.tradechrome",
      `${label}: ${card.tradesHintNodes} .farm-res-trades-hint node(s) — R21's hint was removed, none may render`,
    );
  const stray = card.images.filter(
    (i) =>
      !i.cls ||
      i.imgCls !== "fg-layer" ||
      (i.inReceive ? i.cls !== "farm-res-fruit" : i.cls !== "farm-card-icon" || i.h !== "64px"),
  );
  if (stray.length)
    fail(
      "r1.noOtherImages",
      `${label}: ${JSON.stringify(stray.slice(0, 3))} — image outside the .farm-res-fruit / 64px .farm-card-icon boxes (R17: .farm-res-icon is dead)`,
    );

  /* R4/R5a: exactly one 320px receive card wearing the .bond-result-servant-card skin, holding ONE
     centered row of fruits (no names, R5a); the overlay is the Bond golden fruit at 1rem (R4a); the
     count prints whole units behind the "×" (R19). */
  if (card.receiveCardCount !== 1)
    fail("r4.onecard", `${label}: ${card.receiveCardCount} .farm-res-receive-card nodes, want exactly 1`);
  if (card.itemNodes !== 0) fail("r4.onecard", `${label}: ${card.itemNodes} legacy .farm-res-item nodes, want 0`);
  const badR4Row = card.receive.filter((r) => !r.hasFruit || !r.hasCount || !r.countStyle);
  if (badR4Row.length) fail("r4.onecard", `${label}: ${badR4Row.length} receive fruit(s) miss .farm-res-fruit-count`);
  const skin = card.receiveCardStyle;
  if (!skin) fail("r4.onecard", `${label}: no receive card to read the skin from`);
  else {
    const off = [];
    if (skin.background !== "rgb(248, 249, 252)") off.push(`background ${skin.background}`);
    if (skin.borderTopWidth !== "2px" || skin.borderTopColor !== "rgb(229, 231, 235)")
      off.push(`border ${skin.borderTopWidth} ${skin.borderTopColor}`);
    if (skin.borderRadius !== "10px") off.push(`radius ${skin.borderRadius}`);
    if (off.length)
      fail("r4.onecard", `${label}: receive card off the --bg/--border/radius-sm skin: ${off.join(", ")}`);
  }
  if (card.receiveRowCount !== 1)
    fail(
      "r5a.onerow",
      `${label}: ${card.receiveRowCount} .farm-res-row child(ren) in the receive card, want exactly ONE centered row (R5a)`,
    );
  const offRow = card.receive.filter((r) => !r.inRow || r.rowSiblings !== card.receive.length);
  if (offRow.length)
    fail(
      "r5a.onerow",
      `${label}: ${offRow.length} fruit(s) not sitting in the single row of ${card.receive.length} siblings`,
    );
  const tops = [...new Set(card.receive.map((r) => Math.round(r.rect.top)))];
  if (tops.length !== 1)
    fail("r5a.onerow", `${label}: fruits sit on ${tops.length} lines (${tops.join(", ")}), want one shared row`);
  const badJustify = card.receive.filter((r) => r.rowJustify !== "center");
  if (badJustify.length)
    fail("r5a.onerow", `${label}: fruit row justify-content ${badJustify[0].rowJustify}, want center`);
  if (card.receiveNameNodes !== 0)
    fail(
      "r5a.nonames",
      `${label}: ${card.receiveNameNodes} .farm-res-quest-name node(s) inside Item Receive, want none (R5a)`,
    );
  /* R5a: the card's own text is nothing but the counts — plus, for an iconless currency, the single
     tier LETTER of its .icon-fallback art (that letter is art, not a name: buildFallbackIcon prints
     "G" for gold, so it belongs to the art the contract keeps, and the art sits BEFORE the count).
     A name node returning reddens here. */
  const onlyCounts = card.receive.map((r) => `${r.artLetter || ""}${r.figure || ""}`).join("");
  if (card.receiveCardText !== onlyCounts)
    fail(
      "r5a.nonames",
      `${label}: receive card text ${JSON.stringify(card.receiveCardText)} is more than the counts+tier-letters ${JSON.stringify(onlyCounts)} — a name node is back`,
    );
  const badText = card.receive.filter((r) => !/^×[\d,]+$/.test(r.figure || ""));
  if (badText.length)
    fail(
      "r4.counttext",
      `${label}: count text ${JSON.stringify(badText.map((r) => r.figure))} off /^×[\\d,]+$/ (× + whole units, R3/R19)`,
    );
  const badOverlay = card.receive.filter((r) => {
    const s = r.countStyle;
    if (!s) return false;
    return (
      !/ui-monospace/.test(s.fontFamily) ||
      s.fontSize !== "16px" ||
      s.fontWeight !== "700" ||
      /* line-height: 1 — getComputedStyle reports the USED value, so it must equal the 16px font. */
      parseFloat(s.lineHeight) !== parseFloat(s.fontSize) ||
      s.color !== "rgb(26, 26, 46)" ||
      s.position !== "absolute" ||
      s.right !== "7px" ||
      s.bottom !== "14px" ||
      !bondShadow(s.textShadow) ||
      s.whiteSpace !== "nowrap" ||
      s.pointerEvents !== "none"
    );
  });
  if (badOverlay.length)
    fail(
      "r4.overlay",
      `${label}: ${badOverlay.length} count overlay(s) off the Bond golden-fruit skin at 1rem (ui-monospace 16px 700 lh1 #1a1a2e absolute right:7px bottom:14px on the 142/155 fruit box (87.94×96), four white 1px/2px shadows, nowrap, pointer-events none) — first ${JSON.stringify(badOverlay[0].countStyle)}`,
    );
  if (card.cardW !== 320)
    fail("r4.width", `${label}: receive card renders ${card.cardW}px at the 1120px viewport, want 320px`);
  if (card.receiveCardRect && card.receiveRect) {
    const off = Math.abs(
      card.receiveCardRect.left - card.receiveRect.left - (card.receiveRect.right - card.receiveCardRect.right),
    );
    if (off > 1)
      fail(
        "r4.width",
        `${label}: receive card is not centered in its wrap (margin boxes differ by ${off.toFixed(1)}px)`,
      );
  }

  const joined = card.receive.map((r) => r.figure).join(" ");
  if (/Required/.test(card.receiveText)) fail("removals.absent", `${label}: "Required" still visible in Item Receive`);
  if (card.cardText.includes("✓")) fail("removals.absent", `${label}: ✓ covered mark still visible`);
  if (/^[-+＋]\d/.test(joined) || /[-+＋]\d[\d,.]*$/.test(joined))
    fail("removals.absent", `${label}: +/- surplus figure style residue in receive`);
}
function assertFigs(card, label, { quests, bonusMap, tradeList, keys, exactWant, exactAbsent, noTrades }) {
  let farmed;
  let final;
  try {
    farmed = replayFarmed(quests, card.plays, bonusMap);
    /* R17: trade cards name their pair in the HEADER ALTS (the body prints figures only) — key the
       replay's trade pairs by the from/to alt identity, the same table the fx names come from. */
    const pairs = card.tradeCards.map((t) => {
      const hit = tradeList.find(
        (c) => NAMES[label][String(c.fromId)] === t.iconAlts[0] && NAMES[label][String(c.toId)] === t.iconAlts[1],
      );
      if (!hit) throw new Error(`trade card "${t.countText}" (${JSON.stringify(t.iconAlts)}) matches no snapshot pair`);
      return { fromId: String(hit.fromId), toId: String(hit.toId), count: t.count };
    });
    final = replayFinal(farmed, pairs, tradeList);
  } catch (e) {
    return void fail(`receive.figs(${label})`, `replay aborted: ${e.message}`);
  }
  /* R5a: the row has no names, so a fruit IS its snapshot currency by position (assertArt reddens the
     same positions on the art, so a swapped or dropped fruit cannot pass both pins). */
  if (card.receive.length !== keys.length)
    return void fail(
      "receive.figs",
      `${label}: ${card.receive.length} receive fruits, want one per currency (${keys.length})`,
    );
  for (const [ri, r] of card.receive.entries()) {
    const cid = keys[ri];
    const who = (NAMES[label] || Object.fromEntries(keys.map((k) => [k, k])))[cid] || cid;
    const wantFar = fmtFigure(farmed[cid]);
    if (stripX(r.figure) !== wantFar)
      fail("receive.figs", `${label}/${who}: shows "${r.figure}", the runs replay says ${wantFar}`);
    if (noTrades) continue;
    const wantFinal = fmtFigure(final[cid]);
    if (wantFinal !== wantFar && stripX(r.figure) === wantFinal)
      fail("receive.notYields", `${label}/${who}: shows the POST-cascade ${wantFinal}, must show raw drops ${wantFar}`);
  }
  if (noTrades) {
    for (const w of exactWant || [])
      if (!card.receive.some((r) => r.figure === w))
        fail(
          "fx.exact",
          `${label}: no receive figure "${w}" — got ${JSON.stringify(card.receive.map((r) => r.figure))}`,
        );
    return { farmed, final };
  }
  const degenerate = keys.every((k) => fmtFigure(farmed[k]) === fmtFigure(final[k]));
  if (degenerate)
    fail(
      "receive.notYields",
      `${label}: scene degenerate — farmed == final for every currency, no pin can discriminate`,
    );
  for (const w of exactWant || [])
    if (!card.receive.some((r) => r.figure === w))
      fail("fx.exact", `${label}: no receive figure "${w}" — got ${JSON.stringify(card.receive.map((r) => r.figure))}`);
  for (const a of exactAbsent || [])
    if (card.receiveText.includes(a))
      fail("fx.exact", `${label}: "${a}" (post-trade figure) appears in the receive section`);
  return { farmed, final };
}
/* tier.skin (R5a re-key): the row wears its currencies in snapshot order and nothing else names them,
   so position + art are the identity (the owner-deleted per-block data-tier skin left with the old
   .farm-res-item markup — Amendment R4, card skin --bg/--border): an iconed currency must print
   img.fg-layer whose src carries its icon path and whose ALT carries its name (house Q1: the art is the
   only thing naming it), an iconless one (fixture 99997 Token) must print .icon-fallback in
   TIER_COLORS[background]. A fruit wearing another currency's art, or the wrong tier letter, reddens here. */
function assertArt(card, label, currencies) {
  if (card.receive.length !== currencies.length)
    return void fail(
      "tier.skin",
      `${label}: ${card.receive.length} receive fruits, want one per currency (${currencies.length})`,
    );
  for (const [i, r] of card.receive.entries()) {
    const cur = currencies[i];
    /* R5a: nothing in the section may NAME a currency in text — the alt is the only label. A name
       node returning (or a name printed beside the art) reddens here, on every currency. */
    if (card.receiveText.includes(cur.name))
      fail("r5a.nonames", `${label}/${cur.name}: Item Receive text still names the currency in visible text`);
    if (cur.icon) {
      if (r.artCls !== "fg-layer" || !r.artSrc.includes(String(cur.icon).split("/").pop()))
        fail(
          "tier.skin",
          `${label}/${cur.name}: art ${JSON.stringify([r.artCls, r.artSrc])}, want img.fg-layer of ${cur.icon}`,
        );
      if (r.artAlt !== cur.name)
        fail(
          "r5a.nonames",
          `${label}/${cur.name}: fruit alt ${JSON.stringify(r.artAlt)}, want the currency name as the accessible name`,
        );
    } else if (r.artCls !== "icon-fallback" || r.artBg !== hexToRgb(TIER_COLORS[cur.background] || TIER_COLORS.silver))
      fail(
        "tier.skin",
        `${label}/${cur.name}: fallback ${JSON.stringify([r.artCls, r.artBg])}, want .icon-fallback in the ${cur.background} colour`,
      );
  }
}

/* ---------- scene runners --------------------------------------------------------------------- */
async function runMain(browser, url) {
  const plan = { requires: MAIN_REQUIRES, held: {}, bonus: {}, farmQuest: null, currencyQuest: {} };
  const page = await openEventPage(browser, url, 80639, plan);
  const card = await readCard(page);
  await page.close();
  if (!card) return void fail("order.sequence", "main: card missing");
  const total = card.plays.reduce((s, p) => s + (p.runs || 0), 0);
  if (total !== MAIN_ORACLE.totalPlays)
    fail("main.plan", `${total} plays across cards, want ${MAIN_ORACLE.totalPlays}`);
  /* R7 deleted the total line: its absence is pinned by total.absent inside assertStructure. */
  for (const [qid, runs] of Object.entries(MAIN_ORACLE.rows)) {
    const name = LIVE.farm.quests.find((q) => String(q.questId) === qid).questName;
    const play = card.plays.find((p) => p.name === name);
    if (!play || play.runs !== runs) fail("main.plan", `card ${name}: ${JSON.stringify(play)}, want ${runs} runs`);
  }
  if (card.tradeCards.length !== MAIN_ORACLE.trades.count)
    fail(
      "main.plan",
      `trade cards ${JSON.stringify(card.tradeCards.map((r) => [r.countText, r.label]))}, want ${MAIN_ORACLE.trades.count} — the 263-play optimum re-derived on the fresh 2026-11-12 drops covers without the cascade`,
    );
  assertStructure(card, "main", { expectTrades: MAIN_ORACLE.trades.count > 0 });
  assertPlayCards(card, "main", { currencies: LIVE.currencies, quests: LIVE.farm.quests });
  /* R26/R27/R28 on shipped data: the loop keyframe, the Drop Rates surface this amendment extended
     (MAIN's 20-char JP quest names overflow the 204px grid name box, so the pin is discriminating
     here, not only in the slide fixture), the tier-card item names (they fit on shipped currency
     names, so this leg pins the static branch), and the neutral results-card skin against the tier
     rings that must survive. */
  assertLoopKeyframes(card, "main");
  assertSlidingNames(card.dropRateNames, "main #farmGrid", "r26.surface");
  assertSlidingNames(card.materialNames, "main tier cards", "r26.surface");
  assertNeutralResultsSkin(card, "main");
  assertTierSkinKept(card, "main");
  /* 2026-11-12 sync drift: the re-derived 263-play optimum executes ZERO trades, so farmed === final
     on this shipped-data scene and receive.notYields cannot discriminate here — the fx B scene (R22
     minimum cover 196 donut→pie, ×3,052/×5,001/×3,008/×4,008/×5,007 absence) carries that pin at full
     strength. The replay here still re-computes every shown figure independently (receive.figs). */
  const figsMain = assertFigs(card, "main", {
    quests: LIVE.farm.quests,
    bonusMap: {},
    tradeList: LIVE.trades,
    keys: LIVE.currencies.map((c) => String(c.id)),
    noTrades: MAIN_ORACLE.trades.count === 0,
  });
  if (figsMain) {
    const expectedMain = gateMinCover(figsMain.farmed, currencyNeeds(LIVE.items, MAIN_REQUIRES), LIVE.trades);
    if (expectedMain && expectedMain.length)
      fail(
        "main.plan",
        `gate-propagated minimum cover ${JSON.stringify(expectedMain)} on the 263-play drops — the scenario must be tradeless`,
      );
  }
  assertArt(card, "main", LIVE.currencies);
}

const FX_PLAN_B = {
  requires: { 99999001: 4000, 99999002: 3000, 99999003: 5000 },
  held: {},
  bonus: { 94160901: 1, 94160902: 2, 94160903: 1 },
  farmQuest: null,
  currencyQuest: {},
};
async function runFx(browser, url) {
  const page = await openEventPage(browser, url, 99999, FX_PLAN_B);
  const card = await readCard(page);
  await page.close();
  if (!card) return void fail("order.sequence", "fx B: card missing");
  assertStructure(card, "fx", { expectTrades: true });
  assertPlayCards(card, "fx", { currencies: FX_B.currencies, quests: FX_B.farm.quests });
  /* R27/R28 with TRADES present: the trade cards are the other half of the neutral-skin contract, and
     the loop keyframe is read once more off the shipped page. */
  assertLoopKeyframes(card, "fx");
  assertNeutralResultsSkin(card, "fx");
  assertTierSkinKept(card, "fx");
  /* R22: the gate's OWN minimum-cover trades — requirement propagation over the replayed farmed
     micro (from the card play lists, not from EventShop). Contract fixture: pie 4,804.7544 short
     of 5,000 → 196 donut→pie; donut then holds 3,051.965 ≥ 3,000 → the cookie→donut row is gone. */
  const needsFx = currencyNeeds(FX_B.items, FX_PLAN_B.requires);
  const figs = assertFigs(card, "fx", {
    quests: FX_B.farm.quests,
    bonusMap: { 94160901: 1, 94160902: 2, 94160903: 1 },
    tradeList: FX_TRADES,
    keys: FX_KEYS,
    exactWant: ["×4,168", "×5,012", "×4,805"],
    exactAbsent: ["×3,008", "×4,008", "×5,007", "×3,052", "×5,001"],
  });
  if (!figs) return;
  const expected = gateMinCover(figs.farmed, needsFx, FX_TRADES);
  if (!expected)
    return void fail("fx.exact", "fx B: gateMinCover found a non-linear chain — the fixture shape changed");
  if (JSON.stringify(expected) !== JSON.stringify([{ fromId: 94160902, toId: 94160903, count: 196 }]))
    fail("fx.exact", `fx B: gate-propagated minimum cover ${JSON.stringify(expected)}, want the pinned donut→pie ×196`);
  const actual = card.tradeCards.map((t) => ({
    fromId: Number(Object.keys(NAMES.fx).find((k) => NAMES.fx[k] === t.iconAlts[0])),
    toId: Number(Object.keys(NAMES.fx).find((k) => NAMES.fx[k] === t.iconAlts[1])),
    count: t.count,
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    fail(
      "fx.exact",
      `fx B: trade cards ${JSON.stringify(actual)} != gate-propagated minimum cover ${JSON.stringify(expected)}`,
    );
  /* R7: no total line — "104 plays" lives on only in the play CARDS (誓い 90 + 牛追い 14 below) and
     the total.absent pin inside assertStructure. */
  const oath = card.playCards.find((p) => p.name.includes("誓い"));
  const herd = card.playCards.find((p) => p.name.includes("牛追い"));
  if (!oath || oath.runs !== 90 || !herd || herd.runs !== 14)
    fail("fx.exact", `cards ${JSON.stringify(card.plays.map((p) => [p.name, p.runs]))}, want 誓い 90 + 牛追い 14`);
  /* The mockup's two cards are the two R6 shapes: 誓い drops every currency (combo chrome, every icon,
     no data-tier), 牛追い rides its silver main drop (one icon, data-tier silver, REC Lv. 85 line). */
  if (oath) {
    const off = [];
    if (!oath.cls.includes("farm-card--combo")) off.push(`classes "${oath.cls.join(" ")}"`);
    if (oath.tier !== null) off.push(`data-tier ${JSON.stringify(oath.tier)} on an all-drop play`);
    if (oath.titleCls !== "farm-card-title farm-card-title--icons") off.push(`title "${oath.titleCls}"`);
    if (oath.iconH.length !== 3) off.push(`${oath.iconH.length} header icons, want every currency`);
    if (oath.label !== "runs") off.push(`label "${oath.label}"`);
    if (off.length) fail("fx.exact", `fx B: 誓い play card ${off.join("; ")}`);
  }
  if (herd) {
    const off = [];
    if (herd.tier !== "silver") off.push(`data-tier ${JSON.stringify(herd.tier)}, want the Pie (silver) main drop`);
    if (herd.cls.includes("farm-card--combo")) off.push("combo class on a one-currency play");
    if (herd.iconAlts.join() !== "Pie") off.push(`header icons ${JSON.stringify(herd.iconAlts)}, want only Pie`);
    if (herd.bodySeq.map((k) => k.text).join(" | ") !== "パンプキン収穫 牛追いファーム | REC Lv. 85 | 14 | runs")
      off.push(`body ${JSON.stringify(herd.bodySeq.map((k) => k.text))}`);
    if (off.length) fail("fx.exact", `fx B: 牛追い play card ${off.join("; ")}`);
  }
  assertTradeCards(card, "fx", {
    currencies: FX_B.currencies,
    // the PLANNED (minimum-cover) trades with their snapshot ratios joined in — what the cards must wear
    trades: expected.map((t) => ({
      ...t,
      ...FX_TRADES.find((r) => Number(r.fromId) === t.fromId && Number(r.toId) === t.toId),
    })),
    wantCounts: expected.map((t) => t.count),
  });
  assertTradeFxExact(card, "fx");
  assertArt(card, "fx", FX_B.currencies);
}
async function runFxZero(browser, url) {
  const plan = {
    requires: FX_PLAN_B.requires,
    held: { 94160901: 9999, 94160902: 9999, 94160903: 9999 },
    bonus: {},
    farmQuest: null,
    currencyQuest: {},
  };
  const page = await openEventPage(browser, url, 99999, plan);
  const card = await readCard(page);
  await page.close();
  if (!card) return void fail("zero.shape", "fx zero: card missing");
  /* R7 zero-play shape: Quests to Play is EXACTLY header + empty .farm-grid, no total node — the
     total.absent + separator.absent pins run inside assertStructure below. */
  if (card.plays.length !== 0) fail("zero.shape", `${card.plays.length} play cards on a zero plan, want none`);
  if (card.gridKids !== 0)
    fail("zero.shape", `${card.gridKids} children in the empty grid, want the grid kept but empty`);
  if (JSON.stringify(card.questsWrapKids) !== JSON.stringify(["quest-title", "farm-grid"]))
    fail(
      "zero.shape",
      `Quests to Play wrap children ${JSON.stringify(card.questsWrapKids)}, want exactly header + empty grid (R7)`,
    );
  if (card.receive.length !== 3 || !card.receive.every((r) => stripX(r.figure) === "0"))
    fail("zero.shape", `receive ${JSON.stringify(card.receive.map((r) => r.figure))}, want three zeros`);
  if (card.receiveCardCount !== 1)
    fail("zero.shape", `${card.receiveCardCount} receive cards on the zero plan, want exactly 1`);
  if (card.kids.some((k) => classHas(k, "farm-res-trades"))) fail("zero.shape", "Shop Trades shown on a zero plan");
  assertStructure(card, "fx zero", { expectTrades: false });
  assertPlayCards(card, "fx zero", { currencies: FX_B.currencies, quests: FX_B.farm.quests });
  assertArt(card, "fx zero", FX_B.currencies);
}
async function runFxNoTrades(browser, url) {
  const plan = { requires: { 99997001: 300 }, held: {}, bonus: {}, farmQuest: null, currencyQuest: {} };
  const page = await openEventPage(browser, url, 99997, plan);
  const card = await readCard(page);
  await page.close();
  if (!card) return void fail("notrades.hidden", "fx notrade: card missing");
  if (card.kids.some((k) => classHas(k, "farm-res-trades")))
    fail("notrades.hidden", "Shop Trades rendered though the plan has no trades");
  if (!card.kids.some((k) => classHas(k, "farm-res-receive")))
    fail("notrades.hidden", "Item Receive missing on a no-trades plan");
  if (card.plays.length !== 1 || card.plays[0].runs !== 10)
    fail("notrades.hidden", `cards ${JSON.stringify(card.plays)}, want QA Coin Quest 10 runs`);
  if (card.receive.map((r) => stripX(r.figure)).join() !== "300,0")
    fail("notrades.hidden", `receive ${JSON.stringify(card.receive.map((r) => r.figure))}, want ×300 then ×0`);
  assertStructure(card, "fx notrade", { expectTrades: false });
  assertPlayCards(card, "fx notrade", { currencies: FX_NOTRADE.currencies, quests: FX_NOTRADE.farm.quests });
  /* no cascade to discriminate here (the event has no trades), so the replay pins the farmed side only. */
  assertFigs(card, "fx notrade", {
    quests: FX_NOTRADE.farm.quests,
    bonusMap: {},
    tradeList: [],
    keys: FX_NOTRADE.currencies.map((c) => String(c.id)),
    noTrades: true,
  });
  assertArt(card, "fx notrade", FX_NOTRADE.currencies);
}
/* R6's singular-label scene: 30 Coin is exactly ONE run of the one quest, so the card must read
   "1 / run" — the only place in the battery where the runs===1 branch of buildPlayCard renders. */
async function runFxSingle(browser, url) {
  const plan = { requires: { 99997001: 30 }, held: {}, bonus: {}, farmQuest: null, currencyQuest: {} };
  const page = await openEventPage(browser, url, 99997, plan);
  const card = await readCard(page);
  await page.close();
  if (!card) return void fail("r6.bodyseq", "fx single: card missing");
  if (card.plays.length !== 1)
    return void fail(
      "r6.bodyseq",
      `fx single: ${card.plays.length} play cards, want exactly one (${JSON.stringify(card.plays)})`,
    );
  const one = card.playCards[0];
  if (one.runs !== 1 || one.runsText !== "1" || one.label !== "run")
    fail("r6.bodyseq", `fx single: card reads "${one.runsText}" / "${one.label}", want "1" / "run"`);
  /* R7: no "Total: 1 play" line — the singular shape is pinned on the card itself above, and the
     absence of any total line runs through assertStructure below. */
  if (card.receive.map((r) => r.figure).join() !== "×30,×0")
    fail("receive.figs", `fx single: receive ${JSON.stringify(card.receive.map((r) => r.figure))}, want ×30 then ×0`);
  if (card.kids.some((k) => classHas(k, "farm-res-trades")))
    fail("notrades.hidden", "fx single: Shop Trades rendered though the plan has no trades");
  assertStructure(card, "fx single", { expectTrades: false });
  assertPlayCards(card, "fx single", { currencies: FX_NOTRADE.currencies, quests: FX_NOTRADE.farm.quests });
  assertFigs(card, "fx single", {
    quests: FX_NOTRADE.farm.quests,
    bonusMap: {},
    tradeList: [],
    keys: FX_NOTRADE.currencies.map((c) => String(c.id)),
    noTrades: true,
  });
  assertArt(card, "fx single", FX_NOTRADE.currencies);
}
async function runFxNullPlan(browser, url) {
  const plan = { requires: { 99998001: 100 }, held: {}, bonus: {}, farmQuest: null, currencyQuest: {} };
  const page = await openEventPage(browser, url, 99998, plan);
  const card = await readCard(page);
  await page.close();
  if (!card) return void fail("nullplan.shape", "fx null: card missing");
  const cls = card.kids.map((k) =>
    classHas(k, "card-title") ? "card-title" : k.classes.filter((c) => c.startsWith("farm-res")).join(),
  );
  if (card.kids.length !== 2 || cls[0] !== "card-title" || !cls[1].includes("farm-res-empty"))
    fail(
      "nullplan.shape",
      `children ${JSON.stringify(card.kids.map((k) => k.classes))}, want exactly [card-title, farm-res-empty]`,
    );
  const msg = card.kids.find((k) => k.classes.includes("farm-res-empty"));
  if (msg && msg.text !== "No drop data can cover this plan") fail("nullplan.shape", `message "${msg.text}"`);
  if (card.totalNodes || card.totalText || card.totalTextInCard)
    fail(
      "nullplan.shape",
      `a Total line rendered on the null plan: ${card.totalNodes} node(s), text ${JSON.stringify(card.totalText)}, card text has "Total:" ${card.totalTextInCard}`,
    );
  if (card.receive.length || card.receiveCardCount) fail("nullplan.shape", "Item Receive rendered on the null plan");
  if (card.playCards.length || card.gridNodes)
    fail("nullplan.shape", `${card.playCards.length} play cards / ${card.gridNodes} grids rendered on the null plan`);
}
/* R4/R5a max-width guard: shrink the FX B viewport to 360px — the card must fit the container, the
   single fruit row (3×87.94 + 2×8 = 279.8px) must fit INSIDE the card, and the play grid must collapse
   to one column with every card inside the wrap. */
async function runFxNarrow(browser, url) {
  const page = await openEventPage(browser, url, 99999, FX_PLAN_B);
  await page.setViewport({ width: 360, height: 900 });
  await wait(250);
  const card = await readCard(page);
  await page.close();
  if (!card) return void fail("r4.width", "fx narrow: card missing after resize");
  if (card.cardW === null || card.wrapW === null)
    fail("r4.width", `fx narrow: card or container gone after resize (cardW=${card.cardW}, wrapW=${card.wrapW})`);
  else if (card.cardW > card.wrapW)
    fail(
      "r4.width",
      `fx narrow: receive card ${card.cardW}px overflows the ${card.wrapW}px container inner width — max-width:100% guard broken`,
    );
  if (card.receiveCardCount !== 1 || card.itemNodes !== 0)
    fail(
      "r4.onecard",
      `fx narrow: ${card.receiveCardCount} cards + ${card.itemNodes} .farm-res-item nodes, want 1 card + 0 legacy items`,
    );
  if (card.receive.length !== 3 || card.receive.some((r) => !/^×[\d,]+$/.test(r.figure || "")))
    fail(
      "r4.counttext",
      `fx narrow: counts ${JSON.stringify(card.receive.map((r) => r.figure))}, want three /^×[\\d,]+$/ overlays`,
    );
  const style = card.receiveCardStyle || {};
  const pad = ["paddingLeft", "paddingRight"].map((p) => parseFloat(style[p] || "0")).reduce((a, b) => a + b, 0);
  const inner = card.receiveCardRect ? card.receiveCardRect.width - pad - 4 : null;
  const rowWidth = card.receive.reduce((s, r) => s + r.rect.width, 0) + 8 * Math.max(0, card.receive.length - 1);
  if (inner !== null && rowWidth > inner + 0.5)
    fail(
      "r5a.onerow",
      `fx narrow: the fruit row measures ${rowWidth.toFixed(1)}px (3×87.94 + 2×8) but the card inner width is ${inner.toFixed(1)}px`,
    );
  const spill = card.receive.filter(
    (r) =>
      Math.abs(r.rect.width - 87.94) > 0.5 ||
      (card.receiveCardRect &&
        (r.rect.left < card.receiveCardRect.left + 2 - 0.5 || r.rect.right > card.receiveCardRect.right - 2 + 0.5)),
  );
  if (spill.length)
    fail(
      "r5a.onerow",
      `fx narrow: fruit(s) ${JSON.stringify(spill.map((r) => [r.rect.width, r.rect.left, r.rect.right]))} off 87.94px wide or outside the card box`,
    );
  if (card.playCards.some((c) => c.cardW > card.gridW))
    fail(
      "r6.cardshape",
      `fx narrow: play card ${JSON.stringify(card.playCards.map((c) => c.cardW))} wider than the ${card.gridW}px grid`,
    );
  if (new Set(card.playCards.map((c) => c.cardX)).size !== 1)
    fail(
      "r6.cardshape",
      `fx narrow: play cards sit on ${new Set(card.playCards.map((c) => c.cardX)).size} columns, want one column at 360px`,
    );
}
/* R25 slide scenes on fixture 99996 (one row of three: LONG 82-char EN / MID 32-char / SHORT 8-char).
   A dedicated page opener: a pre-document wrapper COUNTS window.addEventListener("resize") — the
   contract is exactly one listener (resizeWatched installs on first refresh, every re-render reuses
   it) — and the reduced-motion scene emulates the media feature BEFORE load so the animation is off
   from the first paint. */
async function openSlidePage(browser, url, { reduced = false } = {}) {
  const page = await browser.newPage();
  watch(page);
  await page.setViewport({ width: 1120, height: 900 });
  if (reduced) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.evaluateOnNewDocument(
    (key, eid, pl) => {
      localStorage.setItem(key, JSON.stringify({ selectedEventId: eid, plans: { [String(eid)]: pl } }));
      window.__qaResizeAdds = 0;
      const orig = window.addEventListener.bind(window);
      window.addEventListener = function (type, ...rest) {
        if (type === "resize") window.__qaResizeAdds++;
        return orig(type, ...rest);
      };
    },
    KEY,
    99996,
    FX_SLIDE_PLAN,
  );
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.click('.tab-btn[data-tab="event"]');
  await page.waitForSelector("#farmGrid", { timeout: 8000 });
  await wait(250);
  await page.click("#calculateBtn");
  await wait(400);
  return page;
}
/* R27 view of one name for the scene-to-scene comparisons: the state the JS measured (class, track,
   copies, duration) plus the duplication-independent overflow. No distance exists any more — the loop
   travels −50% of the track, so the only per-name quantity left is the duration. */
const slideOf = (card, name) => {
  const c = card.playCards.find((p) => p.name === name);
  return (
    c && {
      sliding: c.sliding,
      overflow: c.textW - c.boxW,
      textW: c.textW,
      dur: c.dur,
      nTexts: c.nTexts,
      hasTrack: c.hasTrack,
      animName: c.animName,
      animDir: c.animDir,
    }
  );
};
async function runFxSlide(browser, url) {
  const page = await openSlidePage(browser, url);
  try {
    const card = await readCard(page);
    if (!card) return void fail("r25.slide", "fx slide: card missing");
    const scene = (at) => {
      const LONG = slideOf(card, R25_LONG_NAME);
      const MID = slideOf(card, R25_MID_NAME);
      const SHORT = slideOf(card, R25_SHORT_NAME);
      for (const [who, s] of [
        ["LONG", LONG],
        ["MID", MID],
        ["SHORT", SHORT],
      ])
        if (!s) fail("r25.slide", `${at}: fixture quest ${who} rendered no card`);
      return { LONG, MID, SHORT };
    };
    /* --- A: shapes at 1120 — LONG + MID overflow → slide; SHORT fits → static --- */
    assertStructure(card, "fx slide", { expectTrades: false });
    assertPlayCards(card, "fx slide", { currencies: FX_SLIDE.currencies, quests: FX_SLIDE.farm.quests });
    /* R27/R28/R26 on top of the play-card pass: the loop's CSSOM shape, the two EXTRA sliding
       surfaces this fixture reaches (Drop Rates quest names, tier-card item names), and the neutral
       results-card skin against the surfaces that must keep their tier ring. */
    assertLoopKeyframes(card, "fx slide");
    assertSlidingNames(card.dropRateNames, "fx slide #farmGrid", "r26.surface");
    assertSlidingNames(card.materialNames, "fx slide tier cards", "r26.surface");
    assertNeutralResultsSkin(card, "fx slide");
    assertTierSkinKept(card, "fx slide");
    const gridOver = (card.dropRateNames || []).filter((n) => n.textW - n.boxW > 0.5).length;
    const matOver = (card.materialNames || []).filter((n) => n.textW - n.boxW > 0.5).length;
    if (!gridOver)
      fail(
        "r26.surface",
        `fx slide: no Drop Rates quest name overflows its box — the ${JSON.stringify((card.dropRateNames || []).map((n) => [Math.round(n.textW), n.boxW]))} scene is degenerate, the pin proves nothing`,
      );
    if (!matOver)
      fail(
        "r26.surface",
        `fx slide: no tier-card item name overflows its box — ${JSON.stringify((card.materialNames || []).map((n) => [Math.round(n.textW), n.boxW]))} is degenerate`,
      );
    const a = scene("fx slide");
    if (a.LONG && a.LONG.overflow <= 0)
      fail("r25.slide", `fx slide: scene degenerate — the 82-char name does not overflow (${a.LONG.overflow}px)`);
    if (a.MID && a.MID.overflow <= 0)
      fail("r25.slide", `fx slide: scene degenerate — the 32-char name does not overflow (${a.MID.overflow}px)`);
    if (a.SHORT && a.SHORT.overflow > 0)
      fail("r25.slide", `fx slide: scene degenerate — the short name overflows (${a.SHORT.overflow}px)`);
    const addsA = await page.evaluate(() => window.__qaResizeAdds);
    if (addsA !== 1) fail("r25.resize", `fx slide: ${addsA} window resize listeners after Calculate, want exactly 1`);
    /* --- B: second Calculate — re-render must NOT accumulate listeners and the loop re-measures to
       the SAME state: same duration, same two-copy track, still exactly one farm-name-slide --- */
    await page.click("#calculateBtn");
    await wait(400);
    const cardB = await readCard(page);
    assertQuestNameSlides(cardB.playCards, "fx slide (recalc)");
    const b = slideOf(cardB, R25_LONG_NAME);
    if (!a.LONG || !b || b.dur !== a.LONG.dur || b.nTexts !== a.LONG.nTexts)
      fail(
        "r25.resize",
        `fx slide: recalc changed the LONG loop (${JSON.stringify([a.LONG, b])}) — measurement not deterministic`,
      );
    const addsB = await page.evaluate(() => window.__qaResizeAdds);
    if (addsB !== addsA)
      fail(
        "r25.resize",
        `fx slide: re-render added resize listeners (${addsA} → ${addsB}) — the resizeWatched guard broke`,
      );
    /* --- C: resize 1120 → 360 — the ONE debounced watcher re-measures the live DOM. The 3-column row
       becomes a 1-column stack and the card box widens 204 → 220px, so MID (≈211px of text) FLIPS to
       FITTING: its track must be torn back down to a single static span. That flip is the witness that
       the re-measure ran — R27 removed the box-dependent --slide-dist, and the loop's duration is a
       function of the NAME width only, so LONG keeps the same duration at every width (pinned). --- */
    await page.setViewport({ width: 360, height: 900 });
    await wait(600);
    const cardC = await readCard(page);
    assertQuestNameSlides(cardC.playCards, "fx slide @360");
    const c = slideOf(cardC, R25_LONG_NAME);
    const cm = slideOf(cardC, R25_MID_NAME);
    const cs = slideOf(cardC, R25_SHORT_NAME);
    if (!c || c.nTexts !== 2) fail("r25.resize", `fx slide @360: LONG lost its loop track (${JSON.stringify(c)})`);
    else if (a.LONG && c.dur !== a.LONG.dur)
      fail(
        "r25.resize",
        `fx slide @360: LONG duration moved ${a.LONG.dur} → ${c.dur} — the loop's speed is the name width, which a resize does not change`,
      );
    if (!cm || cm.overflow > 0.5)
      fail("r25.resize", `fx slide @360: scene degenerate — MID does not fit the widened box (${JSON.stringify(cm)})`);
    else if (cm.sliding || cm.nTexts !== 1)
      fail(
        "r25.resize",
        `fx slide @360: MID fits by ${(-cm.overflow).toFixed(1)}px but still slides ${JSON.stringify(cm)} — the watcher never tore the duplicated track back down`,
      );
    if (cs && (cs.sliding || cs.nTexts !== 1))
      fail("r25.resize", `fx slide @360: the static SHORT name started sliding ${JSON.stringify(cs)}`);
    /* --- D: back to 1120 — the loop comes back byte-equal (re-measured, not sticky): both overflowing
       names carry their original duration and a two-copy track again --- */
    await page.setViewport({ width: 1120, height: 900 });
    await wait(600);
    const cardD = await readCard(page);
    assertQuestNameSlides(cardD.playCards, "fx slide @1120 restored");
    const d = slideOf(cardD, R25_LONG_NAME);
    const dm = slideOf(cardD, R25_MID_NAME);
    if (!d || !a.LONG || d.dur !== a.LONG.dur || d.nTexts !== 2)
      fail(
        "r25.resize",
        `fx slide @1120 restored: LONG loop ${JSON.stringify(d)}, want duration ${a.LONG && a.LONG.dur} and 2 copies`,
      );
    if (!dm || !a.MID || dm.dur !== a.MID.dur || dm.nTexts !== 2)
      fail(
        "r25.resize",
        `fx slide @1120 restored: MID loop ${JSON.stringify(dm)}, want duration ${a.MID && a.MID.dur} and 2 copies`,
      );
    const addsD = await page.evaluate(() => window.__qaResizeAdds);
    if (addsD !== 1)
      fail("r25.resize", `fx slide: ${addsD} resize listeners after two resizes + re-render, want still 1`);
  } finally {
    await page.close();
  }
  /* --- E: prefers-reduced-motion — the JS still measures (class + the duplicated track), the CSS must
       not animate, and the AT-REST frame is then the only thing a user ever sees. R27's track is two
       copies wide inside a box that clips it, and .material-name sits in a text-align:center parent:
       if centering pushed the line box off both edges, the resting view would be the JOIN between the
       copies (a mid-name slice), unreadable from its start. Pinned directly: every sliding name's
       FIRST copy must start at its own clip's left edge (±1.5px), on every surface. --- */
  const rpage = await openSlidePage(browser, url, { reduced: true });
  try {
    const card = await readCard(rpage);
    const long = card && slideOf(card, R25_LONG_NAME);
    if (!long) return void fail("r25.motion", "fx slide reduced: LONG card missing");
    if (long.overflow <= 0)
      fail("r25.motion", `fx slide reduced: degenerate, LONG does not overflow (${long.overflow}px)`);
    if (!long.sliding)
      fail(
        "r25.motion",
        "fx slide reduced: is-sliding vanished — the measurement is motion-independent, the CSS alone drops the animation",
      );
    if (!long.hasTrack || long.nTexts !== 2)
      fail(
        "r25.motion",
        `fx slide reduced: the duplicated track vanished (${JSON.stringify(long)}) — reduced-motion drops the ANIMATION, not the loop markup`,
      );
    if (long.animName !== "none")
      fail(
        "r25.motion",
        `fx slide reduced: the track still animates (${JSON.stringify(long.animName)}) — prefers-reduced-motion must set animation none`,
      );
    if (long.dur === "")
      fail(
        "r25.motion",
        "fx slide reduced: --slide-duration vanished with the animation — the class stays measured, the duration is its record",
      );
    const title = card.playCards.find((p) => p.name === R25_LONG_NAME).titleAttr;
    if (title !== R25_LONG_NAME)
      fail(
        "r25.motion",
        `fx slide reduced: title ${JSON.stringify(title)} must carry the FULL name — with motion off it is the only complete reading`,
      );
    const rest = await rpage.evaluate(() =>
      [...document.querySelectorAll(".farm-quest-name.is-sliding, .material-name.is-sliding")].map((el) => {
        const copy = el.querySelector(".farm-name-track > .farm-quest-name-text");
        const track = el.querySelector(":scope > .farm-name-track");
        const er = el.getBoundingClientRect();
        const cr = copy ? copy.getBoundingClientRect() : null;
        return {
          surface: el.classList.contains("material-name")
            ? "tier-card"
            : el.closest("#farmGrid")
              ? "farmGrid"
              : "results",
          align: getComputedStyle(el).textAlign,
          anim: track ? getComputedStyle(track).animationName : "no-track",
          headOffset: cr ? Math.round((cr.left - er.left) * 10) / 10 : null,
        };
      }),
    );
    if (!rest.length)
      fail("r25.motion", "fx slide reduced: no .is-sliding name to measure at rest — the scene went degenerate");
    for (const r of rest) {
      if (r.anim !== "none")
        fail("r25.motion", `fx slide reduced: ${r.surface} track animation-name ${JSON.stringify(r.anim)}, want none`);
      if (r.headOffset === null || r.headOffset < -1.5 || r.headOffset > 1.5)
        fail(
          "r25.motion",
          `fx slide reduced: ${r.surface} (text-align:${r.align}) rests with its first copy ${r.headOffset}px from the clip edge — the at-rest view must start on the name's own head, not a mid-name slice of the duplicated track`,
        );
    }
  } finally {
    await rpage.close();
  }
}
async function runStub(browser, url) {
  const page = await browser.newPage();
  watch(page);
  await page.setViewport({ width: 1120, height: 900 });
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.click('.tab-btn[data-tab="event"]');
  await page.waitForSelector("#deficitGrid", { timeout: 8000 });
  await page.click("#goldNeed", { clickCount: 3 });
  await page.type("#goldNeed", "100");
  await wait(250);
  await page.click("#calculateBtn");
  await wait(300);
  const out = await page.evaluate(() => ({
    resultsTitle:
      (document.querySelector("#results .results-card > .card-inner > .card-title") || {}).textContent?.trim() || null,
    deficitRows: document.querySelectorAll("#deficitGrid .deficit-item").length,
    questRows: document.querySelectorAll("#questGrid > *").length,
    farmResNodes: document.querySelectorAll(
      ".farm-res-receive, .farm-res-quests, .farm-res-trades, .farm-res-total, .farm-res-item, .farm-res-receive-card, .farm-res-fruit, .farm-res-fruit-count, .farm-res-play-count, .farm-res-play-label, .farm-res-trade-icon-count, .farm-res-trade-ratio, .farm-res-trades-hint",
    ).length,
    plannerWording:
      document.body.textContent.includes("Best Farm Runs") || document.body.textContent.includes("Item Receive"),
    goldDeficit: (document.getElementById("goldDeficit") || {}).textContent,
    goldPlay: (document.getElementById("goldPlay") || {}).textContent,
  }));
  await page.close();
  if (out.resultsTitle !== "Items Needed")
    fail("legacy.surfaces", `#results card title "${out.resultsTitle}", want "Items Needed"`);
  if (out.deficitRows !== 3) fail("legacy.surfaces", `#deficitGrid rows ${out.deficitRows}, want 3`);
  if (out.questRows < 3) fail("legacy.surfaces", `#questGrid rows ${out.questRows} after Calculate, want ≥ 3`);
  if (out.farmResNodes !== 0) fail("legacy.surfaces", `${out.farmResNodes} .farm-res-* nodes on the legacy page`);
  if (out.plannerWording)
    fail("legacy.surfaces", "planner wording (Best Farm Runs / Item Receive) appeared in legacy mode");
  if (out.goldDeficit !== "100")
    fail("legacy.surfaces", `goldDeficit "${out.goldDeficit}" after typing 100, want "100"`);
  if (!out.goldPlay || out.goldPlay === "")
    fail("legacy.surfaces", "Recommended Quest Runs produced no play figure after Calculate");
}

function checkSinks() {
  for (const f of [
    "src/scripts/domain.js",
    "src/scripts/event-shop-farm-results.js",
    "src/layouts/BaseLayout.astro",
    "tests/event-shop.test.js",
  ]) {
    const text = fs.readFileSync(path.join(REPO, f), "utf8");
    if (/\.innerHTML\s*=|insertAdjacentHTML/.test(text)) fail("tt.sinks", `${f} uses an unsanitized HTML sink`);
  }
}

/* ---------- main ------------------------------------------------------------------------------- */
if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("[ERROR] harness: dist/ missing — run npm run build first (the gate builds nothing)");
  process.exit(2);
}
fs.mkdirSync(STAGE, { recursive: true });
fs.writeFileSync(
  path.join(STAGE, "multi_events.json"),
  JSON.stringify({ events: [...EVENT_SHOP_DATA.events, FX_B, FX_NULL, FX_NOTRADE, FX_SLIDE] }),
);

try {
  makeCopy("plain");
  const fxChunk = stageFx("fx");
  const stubDir = makeCopy("stub");
  patchFile(
    path.join(stubDir, "_astro", findDataChunk(stubDir)),
    "events:[{event:{id:",
    "events:0&&[{event:{id:",
    "stub events",
  );
  if (MUTANTS) for (const m of Object.keys(MUTANT_TARGETS)) stageMutant(m, "fx", fxChunk);

  if (MUTANTS) {
    /* In --mutants mode the plain/fx/stub servers are not needed (the copies are staging sources
       only), so every spare port belongs to a mutant. */
  } else {
    await serve("plain", PORTS.plain);
    await serve("fx", PORTS.fx);
    await serve("stub", PORTS.stub);
  }

  if (SERVE_ONLY) {
    console.log(`staged + served: plain :${PORTS.plain} fx :${PORTS.fx} stub :${PORTS.stub} — Ctrl-C to stop`);
    await new Promise((r) => process.on("SIGINT", r));
    killServers();
    process.exit(0);
  }

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    checkSinks();
    if (MUTANTS) {
      const proofErrors = [];
      const names = Object.entries(MUTANT_TARGETS);
      if (names.length > 7) throw new Error(`mutant ports: ${names.length} mutants, only 4173-4179 are spare`);
      for (const [i, [name, expected]] of names.entries()) {
        /* One port per mutant, 4173-4179 (plain/fx/stub are not served here): a reused port lets
           Chromium's HTTP cache answer one mutant's page with another's identical chunk filename,
           which measured as mut_farmer's patched chunk replaying under mut_row48. serve() also
           refuses to bind a port that still answers, so no scene is read from a stale copy. */
        const port = PORTS.plain + i;
        errors.length = 0;
        pageErrors.length = 0;
        consoleErrors.length = 0;
        await serve(name, port);
        const url = `http://127.0.0.1:${port}/fgo-calculator/`;
        try {
          const page = await openEventPage(browser, url, 99999, FX_PLAN_B);
          const card = await readCard(page);
          await page.close();
          assertStructure(card, "fx", { expectTrades: true });
          assertPlayCards(card, "fx", { currencies: FX_B.currencies, quests: FX_B.farm.quests });
          assertFigs(card, "fx", {
            quests: FX_B.farm.quests,
            bonusMap: { 94160901: 1, 94160902: 2, 94160903: 1 },
            tradeList: FX_TRADES,
            keys: FX_KEYS,
            exactWant: ["×4,168", "×5,012", "×4,805"],
            exactAbsent: ["×3,008", "×4,008", "×5,007", "×3,052", "×5,001"],
          });
        } catch (e) {
          fail(`${name}.harness`, e.message.split("\n")[0]);
        }
        for (const e of pageErrors) errors.push(`page.errors: ${e}`);
        for (const e of consoleErrors) errors.push(`page.errors: ${e}`);
        const fired = [...new Set(errors.map((err) => err.split(":")[0].replace(/\(.*$/, "").trim()))].filter(
          (id) => id !== "page.errors",
        );
        const unexpected = fired.filter((id) => !expected.includes(id));
        if (pageErrors.length || consoleErrors.length)
          proofErrors.push(
            `${name}.proof: mutation raised page/console errors — ${JSON.stringify([...pageErrors, ...consoleErrors].slice(0, 3))}`,
          );
        else if (!fired.length)
          proofErrors.push(`${name}.proof: mutant ran GREEN — the harness cannot detect this bug`);
        else if (unexpected.length)
          proofErrors.push(
            `${name}.proof: reddened non-target ${JSON.stringify(unexpected)}, targets ${JSON.stringify(expected)}; errors: ${JSON.stringify(errors.slice(0, 6))}`,
          );
        else console.log(`mutant ${name}: red at ${JSON.stringify(fired)} — exactly its targets`);
        errors.length = 0;
        pageErrors.length = 0;
        consoleErrors.length = 0;
        killServer(port);
      }
      errors.push(...proofErrors);
      /* the per-mutant error buffer is the proof record; it feeds the final exit, not the pins. */
    } else {
      await runMain(browser, `http://127.0.0.1:${PORTS.plain}/fgo-calculator/`);
      await runFx(browser, `http://127.0.0.1:${PORTS.fx}/fgo-calculator/`);
      await runFxZero(browser, `http://127.0.0.1:${PORTS.fx}/fgo-calculator/`);
      await runFxNoTrades(browser, `http://127.0.0.1:${PORTS.fx}/fgo-calculator/`);
      await runFxSingle(browser, `http://127.0.0.1:${PORTS.fx}/fgo-calculator/`);
      await runFxNarrow(browser, `http://127.0.0.1:${PORTS.fx}/fgo-calculator/`);
      await runFxSlide(browser, `http://127.0.0.1:${PORTS.fx}/fgo-calculator/`);
      await runFxNullPlan(browser, `http://127.0.0.1:${PORTS.fx}/fgo-calculator/`);
      await runStub(browser, `http://127.0.0.1:${PORTS.stub}/fgo-calculator/`);
      for (const e of pageErrors) errors.push(`page.errors: ${e}`);
      for (const e of consoleErrors) errors.push(`page.errors: console: ${e}`);
    }
  } finally {
    await browser.close();
  }
} catch (e) {
  console.error(`[ERROR] harness: ${e.message}`);
  killServers();
  process.exit(String(e.message).includes("ENVIRONMENT") ? 2 : 1);
}
killServers();
const uniq = [...new Set(errors)];
if (uniq.length) {
  for (const err of uniq) console.error(`[ERROR] ${err}`);
  console.error(`FAIL: ${uniq.length} failing check(s)`);
  process.exit(1);
}
console.log(
  `PASS: ${MUTANTS ? "7 mutants reddened exactly their target pins" : "main + fx(B/zero/notrade/single/narrow/slide/null) + stub scenes green"}`,
);
