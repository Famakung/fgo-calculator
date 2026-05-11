import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  base: '/fgo-calculator/',
  vite: {
    worker: {
      format: 'es',
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('data.js')) return 'data-chunk';
            if (id.includes('selectors.js')) return 'selectors-chunk';
            if (id.includes('tab-navigator.js')) return 'tab-navigator-chunk';
            if (id.includes('ce-filter-app.js')) return 'ce-filter-chunk';
            if (id.includes('main.js')) return 'main-entry';
          },
        },
      },
    },
  },
});