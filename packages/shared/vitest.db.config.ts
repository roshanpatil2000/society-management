import { defineConfig } from 'vitest/config';

// Tests that need the local Supabase database (`pnpm db:start`). Run with `pnpm test:db`.
export default defineConfig({
  test: {
    include: ['src/__dbtests__/**/*.dbtest.ts'],
  },
});
