import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './', // relative asset paths so the build works on itch.io and sub-path hosts
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000, // Phaser itself is ~1.5 MB minified
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
