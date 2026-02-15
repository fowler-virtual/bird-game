import { defineConfig, devices } from '@playwright/test';

/**
 * E2E は VITE_E2E_MODE=1 で起動し、ウォレット接続をモックしてスモークテストする。
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5175',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // コマンド内で VITE_E2E_MODE を付与（Windows でも Playwright の env が子プロセスに渡らない場合があるため）
    command: 'npx cross-env VITE_E2E_MODE=1 pnpm exec vite --port 5175',
    url: 'http://localhost:5175',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, VITE_E2E_MODE: '1' },
  },
});
