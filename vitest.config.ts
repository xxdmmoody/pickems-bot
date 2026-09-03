import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The bot logs at info on startup; tests open a database per case, so
    // without this every run buries the results in migration chatter.
    env: { LOG_LEVEL: 'silent' },
  },
});
