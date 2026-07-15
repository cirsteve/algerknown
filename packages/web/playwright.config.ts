import { defineConfig, devices } from '@playwright/test';

/**
 * Chromium-only, deterministic, local-only configuration for the Phase 2
 * governance demo recording. No `webServer` block: scripts/governance/
 * run-demo.mjs starts and stops the real server itself, since it also
 * needs the server's env/port to seed data through the HTTP API before the
 * browser session starts.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../build/phase2-demo/playwright-output',
  use: {
    video: 'on',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 900 },
    baseURL: process.env.PHASE2_DEMO_BASE_URL ?? 'http://127.0.0.1:2393',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
