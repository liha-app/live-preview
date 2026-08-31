import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end coverage of the parts only a real browser can exercise: the
 * sandboxed preview iframe, the injected bridge, and the annotation overlay.
 *
 * Not part of `pnpm test` because it needs browser binaries. Run it with:
 *   npx playwright install chromium
 *   pnpm test:e2e
 * The API and web dev servers are started automatically.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    // The suite asserts on English copy; pin the locale so a translated string
    // never turns into a mystery failure.
    locale: 'en-US',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @liha/api db:migrate && pnpm --filter @liha/api dev',
      url: 'http://localhost:8787/api/health',
      cwd: '../..',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @liha/web dev',
      url: 'http://localhost:5173',
      cwd: '../..',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
