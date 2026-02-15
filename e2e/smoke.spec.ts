import { test, expect } from '@playwright/test';

/**
 * スモークテスト（検証開始条件 DoR）。
 * VITE_E2E_MODE=1 で開発サーバが起動しているため、ウォレットはモックされ MetaMask 不要。
 */

/** E2E モック用アドレス（src/wallet.ts の E2E_MOCK_ADDRESS と同一） */
const E2E_MOCK_ADDRESS = '0xe2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2';
/** E2E 用アドレスの state キー（GameStore と同一ロジック） */
const E2E_STATE_KEY = `bird-game-state-${E2E_MOCK_ADDRESS}`;

/** 毎回 TOP から開始。ウォレット未接続にし、E2E モック接続後に全タブアンロックになるよう state を仕込む。 */
async function gotoTop(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(
    ({ stateKey }) => {
      localStorage.removeItem('bird-game-wallet');
      const minimalState = {
        gems: { sapphire: 0, ruby: 0, emerald: 0, diamond: 0 },
        birdsOwned: [],
        deckSlots: [null, null, null, null, null, null, null, null],
        lastAccrualAt: new Date().toISOString(),
        unlockedDeckCount: 4,
        loftLevel: 1,
        inventory: {},
        hasFreeGacha: true,
        hasShownPlacementHint: false,
        seed: 0,
        onboardingStep: 'done' as const,
      };
      localStorage.setItem(stateKey, JSON.stringify(minimalState));
    },
    { stateKey: E2E_STATE_KEY }
  );
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#title-ui').waitFor({ state: 'visible', timeout: 10000 });
}

test.describe('Smoke (DoR)', () => {
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
    // 反応: 接続後 game-shell が表示される（E2E モックで接続済みになる）
    await expect(page.locator('#game-shell.visible')).toBeVisible({ timeout: 30000 });
  });

  test('Farming / Deck / Summon(Adopt) のいずれかへ遷移できる', async ({ page }) => {
    await gotoTop(page);
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await expect(page.locator('#game-shell.visible')).toBeVisible({ timeout: 30000 });

    // 初期表示は Farming
    await expect(page.locator('.shell-tab[data-tab="farming"].active')).toBeVisible();
    await expect(page.locator('#pane-farming')).toHaveClass(/active/);

    // Deck (LOFT) へ遷移
    await page.locator('.shell-tab[data-tab="deck"]').click();
    await expect(page.locator('.shell-tab[data-tab="deck"].active')).toBeVisible();
    await expect(page.locator('#pane-deck')).toHaveClass(/active/);

    // Adopt (Summon) へ遷移
    await page.locator('.shell-tab[data-tab="adopt"]').click();
    await expect(page.locator('.shell-tab[data-tab="adopt"].active')).toBeVisible();
    await expect(page.locator('#pane-adopt')).toHaveClass(/active/);
  });
});
