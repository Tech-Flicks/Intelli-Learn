import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests: the built app (vite preview) driven in Chromium the way a parent and a
 * child would use it, at phone and tablet size, with the mock AI server beside it.
 *
 *   npm run e2e                  both sizes
 *   npm run e2e -- --project=phone
 *
 * The tests save their own screenshots under e2e/screenshots/<project>/.
 */
export const APP_PORT = 4173;
export const MOCK_AI_PORT = 8787;
export const APP_URL = `http://localhost:${APP_PORT}`;
export const MOCK_AI_URL = `http://127.0.0.1:${MOCK_AI_PORT}`;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  // One browser at a time: the tests share the mock AI server and its request log.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: APP_URL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    // A service worker would keep serving an older build between runs.
    serviceWorkers: 'block',
    locale: 'en-US',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 } },
    { name: 'tablet', use: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 } },
  ],
  webServer: [
    {
      command: `npm run build && npx vite preview --port ${APP_PORT} --strictPort`,
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'node tools/mock-ai/server.mjs',
      url: `${MOCK_AI_URL}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { MOCK_PORT: String(MOCK_AI_PORT), MOCK_QUIET: '1', MOCK_LOG_LIMIT: '5000' },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
