import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        codeSplitting: {
          // three.js in its own long-cached chunk: game-code releases do not re-download it.
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }],
        },
      },
    },
    // three's core is ~540 kB minified (~135 kB gzip) and WebGLRenderer pulls in almost all of
    // it, so it cannot shrink below the 500 kB default. 600 kB keeps the warning meaningful for
    // every other chunk (D-033).
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
