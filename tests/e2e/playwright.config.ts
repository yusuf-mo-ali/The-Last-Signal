/**
 * End-to-end browser tests (TESTING.md, D-036).
 *
 * Default: starts the dev server (5173) and a production preview (4173) and runs every spec
 * against both, as the `dev` and `prod` projects. Specs branch on the project name where the two
 * builds differ (debug tools exist only in `dev`).
 *
 * Environment variables:
 * - `E2E_BASE_URL`: test an already-deployed build instead (e.g. a Vercel preview), as the
 *   `remote` project with production expectations. No local servers are started.
 * - `VERCEL_AUTOMATION_BYPASS_SECRET`: sent as `x-vercel-protection-bypass` for protected
 *   Vercel preview deployments.
 * - `PLAYWRIGHT_CHROMIUM_EXECUTABLE`: use an existing Chromium binary instead of the one installed
 *   by `npx playwright install chromium` (e.g. in containers with a pre-installed browser).
 */

import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const remote = process.env.E2E_BASE_URL;
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const DEV_URL = 'http://localhost:5173';
const PROD_URL = 'http://localhost:4173';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: `${root}test-results`,
  // Software WebGL is CPU-bound: one worker keeps timing-based checks stable.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    viewport: { width: 1366, height: 768 },
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? undefined,
      // Deterministic software WebGL, so results match on machines with and without a GPU.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
    ...(bypass
      ? {
          extraHTTPHeaders: {
            'x-vercel-protection-bypass': bypass,
            'x-vercel-set-bypass-cookie': 'true',
          },
        }
      : {}),
  },
  projects: remote
    ? [{ name: 'remote', use: { baseURL: remote } }]
    : [
        { name: 'dev', use: { baseURL: DEV_URL } },
        { name: 'prod', use: { baseURL: PROD_URL } },
      ],
  webServer: remote
    ? undefined
    : [
        {
          command: 'npm run dev -- --port 5173 --strictPort',
          url: DEV_URL,
          cwd: root,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
        {
          command: 'npm run build && npm run preview -- --port 4173 --strictPort',
          url: PROD_URL,
          cwd: root,
          reuseExistingServer: false,
          timeout: 180_000,
        },
      ],
});
