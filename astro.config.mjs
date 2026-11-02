import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  base: "/fgo-calculator/",
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
              { name: "selectors-chunk", test: /\/selectors\.js$/, priority: 4 },
              { name: "tab-navigator-chunk", test: /\/tab-navigator\.js$/, priority: 3 },
              { name: "ce-filter-chunk", test: /\/ce-filter-app\.js$/, priority: 2 },
              { name: "main-entry", test: /\/main\.js$/, priority: 1 },
            ],
          },
        },
      },
    },
  },
});
