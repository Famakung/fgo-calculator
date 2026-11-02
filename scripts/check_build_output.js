#!/usr/bin/env node
/**
 * scripts/check_build_output.js
 *
 * Build-output gate for the Astro 5 -> 7 migration. Asserts that `dist/` still
 * contains the chunk layout the lazy tabs and the CE worker depend on, that the
 * critical CSS and the stale-version poller are still emitted into <head> in the
 * same order, and that the page's visible text has not changed.
 *
 * Baseline: scripts/build_baseline.json, captured on astro 5.18.2.
 *   node scripts/check_build_output.js          compare (exit 1 on any [ERROR])
 *   node scripts/check_build_output.js --write  rewrite the baseline (measurements only;
 *                                               assertions live in this file, so --write
 *                                               can never loosen a check)
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

// Chunk layout. The six *-chunk / main-entry names come from the manual chunking
// config in astro.config.mjs; the rest are split automatically and are what the
// first-visit tab imports and the CE filter worker resolve to.
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

// Must appear inside <head>, in this order. Critical CSS first, then the font
// preloads it references, then the inline scripts (the last one polls the build
// ETag and drives the "A new version is available" banner).
const REQUIRED_HEAD_MARKERS = ["<style>", "--bg:", 'fetchpriority="high"', "<script>", "fgo_build_etag"];

const MIN_BYTES_RATIO = 0.25;

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

// "data-chunk.0JmB4njH.js" -> "data-chunk"; leaves an unhashed filename alone.
function chunkBase(file) {
  return file.replace(/[-.][A-Za-z0-9_-]{8}\.js$/, "");
}

// Visible text of the page: script/style/comment bodies removed, tags collapsed to
// newlines, so each surviving line is one text node.
function visibleTextLines(html) {
  const withoutCode = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  return withoutCode
    .replace(/<[^>]*>/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function measure() {
  const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
  const chunkFiles = fs.readdirSync(path.join(distDir, "_astro")).filter((f) => f.endsWith(".js"));
  const chunks = {};
  for (const file of chunkFiles) {
    const base = chunkBase(file);
    chunks[base] = (chunks[base] || 0) + fs.statSync(path.join(distDir, "_astro", file)).size;
  }
  const head = html.slice(0, html.indexOf("</head>"));
  const lines = visibleTextLines(html);
  return {
    astroVersion: JSON.parse(fs.readFileSync(path.join(root, "node_modules", "astro", "package.json"), "utf8")).version,
    chunks: Object.keys(chunks).sort(),
    chunkBytes: chunks,
    head,
    rawTextSha: sha256(lines.join("\n")),
    normalisedTextSha: sha256(lines.join(" ").replace(/\s+/g, " ")),
  };
}

const errors = [];
const notes = [];
const write = process.argv.includes("--write");

if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, "index.html"))) {
  console.error("[ERROR] dist/ not built — run npm run build");
  process.exit(1);
}

const m = measure();

for (const name of REQUIRED_CHUNKS) {
  if (!m.chunks.includes(name)) errors.push(`missing chunk: ${name}`);
}

for (let i = 1; i < REQUIRED_HEAD_MARKERS.length; i++) {
  const prev = m.head.indexOf(REQUIRED_HEAD_MARKERS[i - 1]);
  const cur = m.head.indexOf(REQUIRED_HEAD_MARKERS[i]);
  if (prev < 0 || cur < 0) {
    errors.push(`head marker missing: ${REQUIRED_HEAD_MARKERS[prev < 0 ? i - 1 : i]}`);
  } else if (cur < prev) {
    errors.push(`head marker out of order: ${REQUIRED_HEAD_MARKERS[i]} before ${REQUIRED_HEAD_MARKERS[i - 1]}`);
  }
}

if (write) {
  const baseline = {
    astroVersion: m.astroVersion,
    chunks: m.chunks,
    chunkMinBytes: Object.fromEntries(
      Object.entries(m.chunkBytes).map(([name, bytes]) => [name, Math.floor(bytes * MIN_BYTES_RATIO)]),
    ),
    rawTextSha: m.rawTextSha,
    normalisedTextSha: m.normalisedTextSha,
  };
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
  for (const [name, bytes] of Object.entries(m.chunkBytes)) console.log(`  wrote ${name} ${bytes} B (floor ${baseline.chunkMinBytes[name]})`);
  console.log(`SUCCESS: baseline written to ${path.relative(root, baselinePath)} on astro ${m.astroVersion}`);
  process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
  errors.push("no baseline — run: node scripts/check_build_output.js --write");
} else {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  if (baseline.astroVersion !== m.astroVersion) {
    notes.push(`baseline captured on astro ${baseline.astroVersion}, running ${m.astroVersion}`);
  }
  for (const name of REQUIRED_CHUNKS) {
    const bytes = m.chunkBytes[name];
    if (bytes === undefined) continue;
    const floor = baseline.chunkMinBytes[name];
    if (floor !== undefined && bytes < floor) errors.push(`chunk shrank below floor: ${name} ${bytes} B < ${floor} B`);
    notes.push(`${name} ${bytes} B (floor ${floor ?? "none"})`);
  }
  for (const key of ["rawTextSha", "normalisedTextSha"]) {
    if (baseline[key] !== m[key]) errors.push(`${key} differs from baseline`);
  }
  const extra = m.chunks.filter((name) => !baseline.chunks.includes(name));
  const gone = baseline.chunks.filter((name) => !m.chunks.includes(name));
  if (extra.length) notes.push(`new chunks: ${extra.join(", ")}`);
  if (gone.length) notes.push(`gone from baseline: ${gone.join(", ")}`);
}

for (const note of notes) console.log(`NOTE: ${note}`);

if (errors.length) {
  console.error(`\nFAILED with ${errors.length} error(s):`);
  for (const e of errors) console.error(`  [ERROR] ${e}`);
  process.exit(1);
}

console.log("SUCCESS: build output matches baseline");
