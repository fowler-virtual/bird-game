import { defineConfig, devices } from '@playwright/test';

const useDeployed = !!process.env.E2E_BASE_URL;
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5174';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  webServer: useDeployed
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  timeout: 120_000,
  expect: { timeout: 10_000 },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        isMobile: false,
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 393, height: 851 },
        isMobile: true,
      },
    },
  ],
});
