import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    external: ['node:sqlite', 'sqlite'],
  },
  test: {
    environment: 'node',
    setupFiles: ['tests/setup-env.js'],
    threads: false,
    server: {
      deps: {
        external: ['node:sqlite', 'sqlite'],
      },
    },
    deps: {
      optimizer: {
        ssr: {
          exclude: ['node:sqlite', 'sqlite'],
        },
      },
    },
  },
});
