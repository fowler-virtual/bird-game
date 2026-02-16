import { test, expect } from '@playwright/test';

/**
 * スモークテスト（検証開始条件 DoR）。
 * VITE_E2E_MODE=1 で開発サーバが起動しているため、ウォレットはモックされ MetaMask 不要。
 */

/** E2E モック用アドレス（src/wallet.ts の E2E_MOCK_ADDRESS と同一） */
const E2E_MOCK_ADDRESS = '0xe2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2';
/** E2E 用アドレスの state キー（GameStore と同一ロジック） */
const E2E_STATE_KEY = `bird-game-state-${E2E_MOCK_ADDRESS}`;

/** 最小の健全性チェック: E2E で起動し TOP（タイトル画面）が表示されることを検証する。 */
async function gotoTop(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-e2e', '1');
  await expect(page.locator('#title-ui')).toBeVisible({ timeout: 15000 });
}

test.describe('Smoke (DoR)', () => {
  test.beforeEach(({ page }) => {
    page.on('pageerror', (err) => {
      console.error('[E2E pageerror]', err.message);
    });
    page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error') console.error('[E2E console]', msg.text());
    });
  });

  test('TOP が表示される', async ({ page }) => {
    await gotoTop(page);
    await expect(page.locator('#title-ui')).toBeVisible();
    await expect(page.getByRole('button', { name: /connect wallet/i })).toBeVisible();
  });

  test('Connect Wallet ボタンをクリックすると何らかの反応がある（DOM 変化 or ログ）', async ({ page }) => {
    await gotoTop(page);
    const btn = page.getByRole('button', { name: /connect wallet/i });
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.locator('#game-shell.visible')).toBeVisible({ timeout: 30000 });
  });

  test('Farming / Deck / Summon(Adopt) のいずれかへ遷移できる', async ({ page }) => {
    await gotoTop(page);
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await expect(page.locator('#game-shell.visible')).toBeVisible({ timeout: 30000 }); // Connect でゲーム画面へ

    // 初期表示は onboarding に応じて Adopt または Farming のどちらか。いずれかのタブが active になるまで待つ
    await expect(
      page.locator('.shell-tab.active').first()
    ).toBeVisible({ timeout: 10000 });

    // Farming へ遷移
    await page.locator('.shell-tab[data-tab="farming"]').click();
    await expect(page.locator('.shell-tab[data-tab="farming"].active')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#pane-farming')).toHaveClass(/active/);

    // Deck (LOFT) へ遷移
    await page.locator('.shell-tab[data-tab="deck"]').click();
    await expect(page.locator('.shell-tab[data-tab="deck"].active')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#pane-deck')).toHaveClass(/active/);

    // Adopt (Summon) へ遷移
    await page.locator('.shell-tab[data-tab="adopt"]').click();
    await expect(page.locator('.shell-tab[data-tab="adopt"].active')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#pane-adopt')).toHaveClass(/active/);
  });
});
