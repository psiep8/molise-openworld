import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const page = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

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
    entries: ['index.html', 'harness.html', 'preview-building.html', 'characters.html'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: {
        main: page('index.html'),
        // Lo studio è una pagina autonoma: senza questa voce la build
        // produrrebbe solo index.html e /characters.html darebbe 404.
        characters: page('characters.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
