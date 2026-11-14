import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './', // relative asset paths so the build works on itch.io and sub-path hosts
  // Accounts API (server/): run `npm run server` alongside `npm run dev` / `npm run preview`.
  server: { proxy: { '/api': 'http://localhost:8787' } },
  preview: { proxy: { '/api': 'http://localhost:8787' } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000, // Phaser itself is ~1.5 MB minified
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.mjs'],
    environment: 'node',
  },
});
