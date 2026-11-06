#!/usr/bin/env node
/**
 * scripts/check_build_output.js
 *
 * Build-output gate for the Astro 5 -> 7 migration and every upgrade after it.
 * Asserts that `dist/` still contains the chunk layout the lazy tabs and the CE
 * Filter worker depend on, that the critical CSS and the stale-version poller are
 * still emitted into <head> in the same order, that the sub-tab restore's display
 * rules still match across the shipped page and both hand-maintained stylesheet
 * copies, and that the page's visible text — including the whitespace between
 * adjacent inline elements — has not changed.
 *
 * Baseline: scripts/build_baseline.json, captured on astro 7.4.5.
 *   node scripts/check_build_output.js          compare (exit 1 on any [ERROR])
 *   node scripts/check_build_output.js --write  re-capture the measurements
 *
 * `--write` refreshes measurements only (byte floors/ceilings, chunk list, text
 * signatures). It refuses to run when an assertion fails — a missing chunk or a
 * <head> marker out of order — because those are what a refresh must never absorb.
 * The assertions themselves are constants in this file, so they cannot be rewritten.
 *
 * shortcut: the text signature uses a crude tag/script regex rather than an HTML
 * parser — upgrade to one if the signature ever reports a change the browser does
 * not show.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const baselinePath = path.join(root, "scripts", "build_baseline.json");

// Chunk layout. The six names come from the codeSplitting groups in
// astro.config.mjs; the rest are split automatically and are what the first-visit
// tab imports and the Bond Gain CE worker resolve to.
const REQUIRED_CHUNKS = [
  "constants-chunk",
  "data-chunk",
  "selectors-chunk",
  "tab-navigator-chunk",
  "ce-filter-chunk",
  "main-entry",
  "bond-lazy",
  "event-lazy",
  "ce-match-worker",
  "index.astro_astro_type_script_index_0_lang",
];

// Must appear inside <head>, in this order. Critical CSS first, then the inline
// scripts (the last one polls the build ETag and drives the "A new version is available"
// banner).
const REQUIRED_HEAD_MARKERS = ["<style>", "--bg:", "<script>", "fgo_build_etag"];

// The sub-tab restore hides Craft Essence Select from the first paint using CSS keyed on
// <html data-subtab>, so those rules must be present in the page that ships AND in the one
// hand-maintained copy of the stylesheet: BaseLayout's `<style is:inline>` (the copy the build
// actually inlines). `src/styles/global.css` used to be a third copy kept in step by hand and was
// deleted — it was loaded by nothing, and stylelint there was linting CSS that never shipped. The un-hide
// names `display: block` outright, which is why the whole set of panel-level display rules is
// pinned: a later rule giving .cefilter-subpanel a display of its own would silently fight it.
const SUBTAB_PANEL_DISPLAY_RULES = [
  [".cefilter-subpanel[hidden]", "none"],
  ['html[data-subtab="servant"] .cefilter-subpanel[data-subpanel="ce"]', "none"],
  ['html[data-subtab="servant"] .cefilter-subpanel[data-subpanel="servant"]', "block"],
];

// A chunk may fall to a quarter of its measured size before this fails, and may
// not exceed three times it. The ceiling is what catches content being swept into
// the wrong chunk: generated game data grows a few percent per event, so 3x is far
// outside honest growth but a tripled main-entry is exactly the predicted failure.
const MIN_BYTES_RATIO = 0.25;
const MAX_BYTES_RATIO = 3;

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

// "data-chunk.0JmB4njH.js" -> "data-chunk"; leaves an unhashed filename alone.
function chunkBase(file) {
  return file.replace(/[-.][A-Za-z0-9_-]{8}\.js$/, "");
}

// Visible text of the page: script/style/comment bodies removed, each tag replaced
// by a newline, so every surviving line is one text node with its original
// whitespace. A whitespace-only line IS the space between two adjacent inline
// elements, so the raw signature must keep it — trimming here is what made the
// gate blind to the ~390 spaces Astro 7 removed on the 5 -> 7 jump.
function visibleTextLines(html) {
  const withoutCode = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  return withoutCode.replace(/<[^>]*>/g, "\n").split("\n");
}

// Selectors and values compared quote-free and space-collapsed: the copies differ in formatting
// (the inlined one is a single line) and a minifier would drop the quotes.
const flat = (s) => s.replace(/\s+/g, " ").replace(/["']/g, "").trim();
const panelEntry = (sel, display) => `${flat(sel)}=${flat(display)}`;

function styleBodies(html) {
  return (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [])
    .map((s) => s.replace(/^<style[^>]*>/i, "").replace(/<\/style>$/i, ""))
    .join("\n");
}

// Every rule that sets `display` on a sub-panel itself (not on something inside it). A crude split
// on `}` is enough for these flat rules; the `@media … {` that survives the split is stripped.
function panelDisplayRules(css) {
  const found = [];
  for (const block of css.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
    const brace = block.indexOf("{");
    if (brace < 0) continue;
    const display = (block.slice(brace + 1).match(/(?:^|[;{])\s*display\s*:\s*([^;]+)/i) || [])[1];
    if (!display) continue;
    for (const raw of block.slice(0, brace).split(",")) {
      const sel = flat(raw.replace(/^@[^{]*\{\s*/, ""));
      if (/(^|\s)\.cefilter-subpanel(\[[^\]]*\])?$/.test(sel)) found.push(`${sel}=${flat(display)}`);
    }
  }
  return found.sort();
}

function measure() {
  const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
  const chunkFiles = fs.readdirSync(path.join(distDir, "_astro")).filter((f) => f.endsWith(".js"));
  const chunks = {};
  for (const file of chunkFiles) {
    const base = chunkBase(file);
    chunks[base] = (chunks[base] || 0) + fs.statSync(path.join(distDir, "_astro", file)).size;
  }
  const headEnd = html.indexOf("</head>");
  const lines = visibleTextLines(html);
  return {
    astroVersion: JSON.parse(fs.readFileSync(path.join(root, "node_modules", "astro", "package.json"), "utf8")).version,
    chunks: Object.keys(chunks).sort(),
    chunkBytes: chunks,
    head: headEnd < 0 ? html : html.slice(0, headEnd),
    rawTextSha: sha256(lines.join("\n")),
    normalisedTextSha: sha256(
      lines
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(" ")
        .replace(/\s+/g, " "),
    ),
  };
}

// `assertions` are layout facts a refresh must never absorb; `drift` is the
// measurements having moved. Only drift may be re-captured by --write.
const assertions = [];
const drift = [];
const notes = [];
const write = process.argv.includes("--write");

if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, "index.html"))) {
  console.error("[ERROR] dist/ not built — run npm run build");
  process.exit(1);
}

const m = measure();

for (const name of REQUIRED_CHUNKS) {
  if (!m.chunks.includes(name)) assertions.push(`missing chunk: ${name}`);
}

for (let i = 1; i < REQUIRED_HEAD_MARKERS.length; i++) {
  const prev = m.head.indexOf(REQUIRED_HEAD_MARKERS[i - 1]);
  const cur = m.head.indexOf(REQUIRED_HEAD_MARKERS[i]);
  if (prev < 0 || cur < 0) {
    assertions.push(`head marker missing: ${REQUIRED_HEAD_MARKERS[prev < 0 ? i - 1 : i]}`);
  } else if (cur < prev) {
    assertions.push(`head marker out of order: ${REQUIRED_HEAD_MARKERS[i]} before ${REQUIRED_HEAD_MARKERS[i - 1]}`);
  }
}

const expectedPanel = SUBTAB_PANEL_DISPLAY_RULES.map(([sel, display]) => panelEntry(sel, display)).sort();
for (const [label, file, extract] of [
  ["dist/index.html", path.join(distDir, "index.html"), styleBodies],
  ["src/layouts/BaseLayout.astro", path.join(root, "src", "layouts", "BaseLayout.astro"), styleBodies],
]) {
  let css;
  try {
    css = extract(fs.readFileSync(file, "utf8"));
  } catch {
    assertions.push(`sub-tab restore: cannot read ${file}`);
    continue;
  }
  const saw = panelDisplayRules(css);
  if (saw.join("|") !== expectedPanel.join("|")) {
    assertions.push(
      `sub-tab restore display rules changed in ${label} — saw [${saw.join(" ")}], want [${expectedPanel.join(
        " ",
      )}]. Keep the shipped page and BaseLayout's inline <style> in step, and give the un-hide rule the panel's real display value if its layout moved`,
    );
  }
}

if (write) {
  if (assertions.length) {
    console.error("[ERROR] refusing --write: an assertion is failing, so this dist must not become the baseline");
    for (const a of assertions) console.error(`  [ERROR] ${a}`);
    process.exit(1);
  }
  const baseline = {
    astroVersion: m.astroVersion,
    chunks: m.chunks,
    chunkBytes: m.chunkBytes,
    chunkMinBytes: Object.fromEntries(
      Object.entries(m.chunkBytes).map(([name, bytes]) => [name, Math.floor(bytes * MIN_BYTES_RATIO)]),
    ),
    rawTextSha: m.rawTextSha,
    normalisedTextSha: m.normalisedTextSha,
  };
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
  for (const [name, bytes] of Object.entries(m.chunkBytes)) {
    console.log(`  wrote ${name} ${bytes} B (floor ${baseline.chunkMinBytes[name]}, ceiling ${Math.floor(bytes * MAX_BYTES_RATIO)})`);
  }
  console.log(`SUCCESS: baseline written to ${path.relative(root, baselinePath)} on astro ${m.astroVersion}`);
  process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
  assertions.push("no baseline — run: node scripts/check_build_output.js --write");
} else {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  if (baseline.astroVersion !== m.astroVersion) {
    notes.push(`baseline captured on astro ${baseline.astroVersion}, running ${m.astroVersion}`);
  }
  for (const name of REQUIRED_CHUNKS) {
    const bytes = m.chunkBytes[name];
    if (bytes === undefined) continue;
    const floor = baseline.chunkMinBytes[name];
    const base = baseline.chunkBytes ? baseline.chunkBytes[name] : undefined;
    if (floor !== undefined && bytes < floor) drift.push(`chunk shrank below floor: ${name} ${bytes} B < ${floor} B`);
    if (base !== undefined && bytes > base * MAX_BYTES_RATIO) {
      drift.push(`chunk grew past ceiling: ${name} ${bytes} B > ${Math.floor(base * MAX_BYTES_RATIO)} B (baseline ${base} B)`);
    }
    notes.push(`${name} ${bytes} B (baseline ${base ?? "n/a"}, floor ${floor ?? "n/a"})`);
  }
  for (const key of ["rawTextSha", "normalisedTextSha"]) {
    if (baseline[key] !== m[key]) drift.push(`${key} differs from baseline`);
  }
  const extra = m.chunks.filter((name) => !baseline.chunks.includes(name));
  const gone = baseline.chunks.filter((name) => !m.chunks.includes(name));
  if (extra.length) notes.push(`new chunks: ${extra.join(", ")}`);
  if (gone.length) notes.push(`gone from baseline: ${gone.join(", ")}`);
}

for (const note of notes) console.log(`NOTE: ${note}`);

const errors = assertions.concat(drift);
if (errors.length) {
  console.error(`\nFAILED with ${errors.length} error(s):`);
  for (const e of errors) console.error(`  [ERROR] ${e}`);
  process.exit(1);
}

console.log("SUCCESS: build output matches baseline");
