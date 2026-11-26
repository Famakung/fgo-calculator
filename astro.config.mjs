import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";

function modulepreloadIntegration() {
  return {
    name: "fgo-modulepreload",
    hooks: {
      "astro:build:done"({ dir }) {
        const distDir = fileURLToPath(dir);
        const astroDir = path.join(distDir, "_astro");
        const indexPath = path.join(distDir, "index.html");
        if (!fs.existsSync(astroDir) || !fs.existsSync(indexPath)) return;
        const files = fs.readdirSync(astroDir).filter((f) => f.endsWith(".js"));
        const findChunk = (prefix) => files.find((f) => f.startsWith(`${prefix}.`) || f.startsWith(`${prefix}-`));
        const base = "/fgo-calculator/_astro/";
        const boot = ["main-entry", "constants-chunk", "data-chunk", "tab-navigator-chunk", "shared-ui-chunk", "rolldown-runtime"]
          .map(findChunk)
          .filter(Boolean);
        const links = boot.map((f) => `<link rel="modulepreload" href="${base}${f}" />`).join("");
        const byTab = {
          servantinfo: [findChunk("servant-info-lazy")].filter(Boolean).map((f) => `${base}${f}`),
          cefilter: [findChunk("ce-filter-chunk"), findChunk("selectors-chunk")].filter(Boolean).map((f) => `${base}${f}`),
          bond: [findChunk("bond-lazy"), findChunk("selectors-chunk")].filter(Boolean).map((f) => `${base}${f}`),
          event: [findChunk("event-lazy"), findChunk("selectors-chunk")].filter(Boolean).map((f) => `${base}${f}`),
        };
        const tabScript = `<script>(function(){var t=document.documentElement.getAttribute("data-tab")||"cefilter",m=${JSON.stringify(byTab)};(m[t]||[]).forEach(function(h){var l=document.createElement("link");l.rel="modulepreload";l.href=h;document.head.appendChild(l);});})();</script>`;
        const html = fs.readFileSync(indexPath, "utf8");
        if (html.includes("</head>")) {
          fs.writeFileSync(indexPath, html.replace("</head>", `${links}${tabScript}</head>`));
        }
      },
    },
  };
}

export default defineConfig({
  output: "static",
  base: "/fgo-calculator/",
  integrations: [modulepreloadIntegration()],
  // Bare `astro dev` / `astro preview` default to 4321; every script and doc here uses 3000.
  server: { port: 3000 },
  preview: { port: 3000 },
  vite: {
    worker: {
      format: "es",
    },
    build: {
      rolldownOptions: {
        output: {
          // Astro 7 = Vite 8 = Rolldown. The `manualChunks` function form is
          // deprecated and silently drops rules: on 7.4.5 it kept only 2 of the
          // 6 chunk names. `codeSplitting.groups` is Rolldown's replacement, and
          // `priority` preserves the old function's first-match-wins order.
          codeSplitting: {
            groups: [
              { name: "constants-chunk", test: /\/constants\.js$/, priority: 6 },
              { name: "data-chunk", test: /\/data\.js$/, priority: 5 },
              { name: "shared-ui-chunk", test: /\/(?:servant-filters|filter-sections|presentation)\.js$/, priority: 4 },
              { name: "selectors-chunk", test: /\/selectors\.js$/, priority: 4 },
              { name: "tab-navigator-chunk", test: /\/tab-navigator\.js$/, priority: 3 },
              { name: "ce-filter-chunk", test: /\/ce-filter-app\.js$/, priority: 2 },
              { name: "servant-info-lazy", test: /\/servant-info-(?:lazy|app)\.js$/, priority: 2 },
              { name: "main-entry", test: /\/main\.js$/, priority: 1 },
            ],
          },
        },
      },
    },
  },
});
