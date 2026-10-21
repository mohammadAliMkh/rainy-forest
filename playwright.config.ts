import { defineConfig } from '@playwright/test';

// End-to-end checks in a real (headless) Chromium: `npm run test:e2e`.
// Without a GPU the browser renders in software, which is slow, hence the
// long timeouts. PW_CHROMIUM can point at an already installed Chromium.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 300_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5180',
    viewport: { width: 960, height: 540 },
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM || undefined,
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5180 --strictPort',
    url: 'http://127.0.0.1:5180',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
