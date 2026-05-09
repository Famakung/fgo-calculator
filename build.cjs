#!/usr/bin/env node
const { execSync } = require("child_process");
const fs = require("fs");
const crypto = require("crypto");

// Clean old outputs
for (const f of fs.readdirSync(".")) {
  if (/^(app\.min\.js|main\.min\.js|ce-match-worker\.min\.js|bond-lazy.*\.js|event-lazy.*\.js|chunk-.*\.js|styles\.min\.css)$/.test(f)) {
    fs.unlinkSync(f);
  }
}

// Build JS with code splitting
execSync(
  "npx esbuild src/main.js src/bond-lazy.js src/event-lazy.js " +
  "--bundle --outdir=. --minify --splitting --format=esm",
  { stdio: "inherit" }
);

// Build worker
execSync(
  "npx esbuild src/ce-match-worker.js --bundle --outfile=ce-match-worker.min.js --minify",
  { stdio: "inherit" }
);

// Minify CSS
execSync(
  "npx esbuild styles.css --outfile=styles.min.css --minify",
  { stdio: "inherit" }
);

// Rename entry points: bond-lazy.js -> bond-lazy.min.js, event-lazy.js -> event-lazy.min.js
for (const f of ["bond-lazy.js", "event-lazy.js"]) {
  if (fs.existsSync(f)) {
    const content = fs.readFileSync(f, "utf8");
    fs.writeFileSync(f.replace(".js", ".min.js"), content);
    fs.unlinkSync(f);
  }
}

// Rename main.js -> app.min.js for index.html compatibility
let mainJs = fs.readFileSync("main.js", "utf8");
// Fix dynamic import paths: .js -> .min.js for lazy entries
mainJs = mainJs.replace(/\.\/bond-lazy\.js/g, "./bond-lazy.min.js");
mainJs = mainJs.replace(/\.\/event-lazy\.js/g, "./event-lazy.min.js");
fs.writeFileSync("app.min.js", mainJs);
fs.unlinkSync("main.js");

// Fix all internal imports: .js -> .min.js for chunk references
for (const f of fs.readdirSync(".")) {
  if (f.endsWith(".js") && !f.startsWith("src/")) {
    let content = fs.readFileSync(f, "utf8");
    content = content.replace(/\.\/chunk-([A-Z0-9]+)\.js/g, "./chunk-$1.min.js");
    content = content.replace(/\.\/bond-lazy\.js/g, "./bond-lazy.min.js");
    content = content.replace(/\.\/event-lazy\.js/g, "./event-lazy.min.js");
    fs.writeFileSync(f, content);
  }
}

// Rename chunk files: .js -> .min.js
for (const f of fs.readdirSync(".")) {
  if (/^chunk-[A-Z0-9]+\.js$/.test(f)) {
    fs.renameSync(f, f.replace(".js", ".min.js"));
  }
}

// Update CSP style hash in index.html (from styles.min.css inline critical CSS)
const criticalCssMatch = fs.readFileSync("index.html", "utf8").match(/<style id="critical-css">([\s\S]*?)<\/style>/);
if (criticalCssMatch) {
  const criticalCss = criticalCssMatch[1];
  const hash = crypto.createHash("sha256").update(criticalCss).digest("base64");
  const cspHash = `sha256-${hash}`;
  console.log(`CSP style hash: ${cspHash}`);
  
  // Update CLAUDE.md with new hash
  let claudeMd = fs.readFileSync(".claude/CLAUDE.md", "utf8");
  claudeMd = claudeMd.replace(/sha256-[A-Za-z0-9+/]+= \(critical CSS\)/, `${cspHash} (critical CSS)`);
  fs.writeFileSync(".claude/CLAUDE.md", claudeMd);
}

// Set SW cache version from git commit (or timestamp in CI)
let cacheVersion;
try {
  cacheVersion = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {
  cacheVersion = Date.now().toString(36);
}
let swContent = fs.readFileSync("sw.js", "utf8");
const currentCache = swContent.match(/CACHE_NAME\s*=\s*"fgo-calc-[^"]+"/);
if (currentCache) {
  swContent = swContent.replace(
    /CACHE_NAME\s*=\s*"fgo-calc-[^"]+"/,
    `CACHE_NAME = "fgo-calc-${cacheVersion}"`
  );
  console.log(`SW cache: v${cacheVersion}`);
  // Update CLAUDE.md
  let claudeMd;
  try { claudeMd = fs.readFileSync(".claude/CLAUDE.md", "utf8"); } catch { claudeMd = null; }
  if (claudeMd) {
    claudeMd = claudeMd.replace(/`fgo-calc-[^`]+`/, `\`fgo-calc-${cacheVersion}\``);
    fs.writeFileSync(".claude/CLAUDE.md", claudeMd);
  }
}

// Update sw.js precache list with chunk filenames
const chunkFiles = [];
for (const f of fs.readdirSync(".")) {
  if (/^(bond-lazy|event-lazy|chunk-).*\.min\.js$/.test(f)) {
    chunkFiles.push(f);
  }
}
const lazyLines = chunkFiles.map(f => `  BASE + "${f}",`).join("\n");
swContent = swContent.replace(
  /  BASE + "bond-lazy\.min\.js",\n  BASE + "event-lazy\.min\.js",\n  BASE + "chunk-2V5TP7RE\.min\.js",\n  BASE + "chunk-VWF72PWK\.min\.js",/,
  lazyLines
);
fs.writeFileSync("sw.js", swContent);

// Report
const outputs = ["app.min.js", "ce-match-worker.min.js", "styles.min.css"];
for (const f of fs.readdirSync(".")) {
  if (/^(bond-lazy|event-lazy|chunk-).*\.min\.js$/.test(f)) {
    outputs.push(f);
  }
}

let total = 0;
console.log("\nBuild output:");
for (const f of outputs.sort()) {
  const size = fs.statSync(f).size;
  total += size;
  console.log(`  ${f}: ${(size / 1024).toFixed(1)} KB`);
}
console.log(`  Total: ${(total / 1024).toFixed(1)} KB`);