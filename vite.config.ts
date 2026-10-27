import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    watch: {
      // captures/ e smoke/ contengono profili Chrome delle catture headless
      // (estensioni, centinaia di .html/.js esterni all'app): non vanno osservati.
      ignored: ['**/captures/**', '**/smoke/**'],
    },
  },
  // Vite, senza questa lista, analizza ogni *.html del progetto: finirebbe
  // dentro captures/**/Default/Extensions e la scansione delle dipendenze
  // fallirebbe su import tipo `chrome` fatti dalle estensioni del browser.
  optimizeDeps: {
    entries: ['index.html', 'harness.html', 'preview-building.html'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
