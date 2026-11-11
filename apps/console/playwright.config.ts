import { defineConfig, devices } from '@playwright/test';

// Browser tests of the console's screens, on a desktop and on a phone. The API is answered by the
// tests themselves (page.route on /v1), so only the console runs.
const PORT = 3211;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // The dev server compiles on first visit and shares the CPU with the other project; 5 s was too tight for a
  // long flow like the onboarding (the assertions still fail fast when a screen is really wrong).
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, locale: 'pt-BR', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `node node_modules/next/dist/bin/next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
