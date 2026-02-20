import { test, expect } from '@playwright/test';

const TEST_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

test.beforeEach(async ({ page }) => {
  const pk = TEST_PK;
  await page.addInitScript((key: string) => {
    (async () => {
      const { Wallet } = await import('https://cdn.jsdelivr.net/npm/ethers@6.13.0/+esm');
      const w = new Wallet(key);
      const request = async (args: { method: string; params?: unknown[] }) => {
        const { method, params = [] } = args;
        if (method === 'eth_requestAccounts') return [w.address];
        if (method === 'personal_sign') {
          const [messageHex] = params as [string, string];
          let msg = String(messageHex);
          if (typeof messageHex === 'string' && messageHex.startsWith('0x')) {
            const hex = messageHex.slice(2);
            const bytes = new Uint8Array(hex.length / 2);
            for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
            msg = new TextDecoder().decode(bytes);
          }
          return await w.signMessage(msg);
        }
        if (method === 'eth_sendTransaction') return '0x' + 'a'.repeat(64);
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        if (method === 'eth_chainId') return '0xaa36a7';
        throw new Error('E2E mock: ' + method);
      };
      (window as unknown as { ethereum: { request: typeof request } }).ethereum = { request };
    })();
  }, pk);
});

test('scenario 1: title shows Connect Wallet, no white screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Connect Wallet/i })).toBeVisible();
  await expect(page.locator('#title-ui')).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('scenario 2–9 and tutorial: full flow desktop', async ({ page }) => {
  await page.goto('/');

  // 1: title
  await expect(page.getByRole('button', { name: /Connect Wallet/i })).toBeVisible();

  // 2: connect → game shell
  await page.getByRole('button', { name: /Connect Wallet/i }).click();
  await expect(page.locator('#game-shell.visible')).toBeVisible({ timeout: 35000 });
  await expect(page.locator('#game-shell .shell-tabs')).toBeVisible();

  // 3: SIWE done by mock; shell visible = logged in
  await expect(page.locator('.shell-wallet-address')).toBeVisible();

  // 4: tabs and SEED
  await expect(page.locator('.shell-tab[data-tab="farming"]')).toBeVisible();
  await expect(page.locator('.shell-tab[data-tab="adopt"]')).toBeVisible();
  await expect(page.locator('.shell-tab[data-tab="deck"]')).toBeVisible();
  await expect(page.locator('.shell-tab[data-tab="network"]')).toBeVisible();
  await expect(page.getByText(/SEED|\\$SEED/i).first()).toBeVisible();

  // 5: Sepolia switch mocked; no error block
  await expect(page.locator('#network-state-error')).not.toHaveAttribute('style', /display:\s*block/);

  // Tutorial A: after connect, onboarding overlay or dim (we are already on ADOPT tab when need_gacha)
  const adoptOverlay = page.locator('#adopt-onboarding-overlay.visible');
  const adoptDim = page.locator('#adopt-onboarding-dim-spotlight');
  const hasAdoptGuide = (await adoptOverlay.isVisible()) || (await adoptDim.isVisible());
  expect(hasAdoptGuide).toBeTruthy();

  // 6: ADOPT pane is already active (firstTab=adopt when need_gacha); gacha 1x
  await expect(page.locator('#pane-adopt.active')).toBeVisible({ timeout: 5000 });
  await page.locator('#shell-gacha-1').click();
  await page.getByRole('button', { name: /Confirm/i }).click();
  await expect(page.locator('.gacha-results-item').first()).toBeVisible({ timeout: 20000 });
  await page.locator('#gacha-result-modal-close').click().catch(() => {});

  // Tutorial: LOFT 誘導（deck タブへ）
  await page.locator('.shell-tab[data-tab="deck"]').click();
  await expect(page.locator('#pane-deck.active')).toBeVisible();

  // 7: place bird: first inventory cell that has a bird
  const placeableCell = page.locator('.inventory-cell:not(.unowned)').first();
  await expect(placeableCell).toBeVisible({ timeout: 5000 });
  await placeableCell.click();
  const deckSlot = page.locator('.deck-slot').filter({ has: page.locator('img.deck-slot-bird') }).first();
  await expect(deckSlot).toBeVisible({ timeout: 5000 });

  // Tutorial: SAVE 誘導 → press SAVE
  await expect(page.locator('#status-save-deck-btn')).toBeVisible();
  await page.locator('#status-save-deck-btn').click();
  await page.getByRole('button', { name: /Confirm/i }).click();

  // 8: SAVE success message (Deck saved or place success modal)
  await expect(
    page.getByText(/Deck saved|Your power has been updated|Bird placed|saved|success/i)
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: /OK|Go to Farming/i }).click().catch(() => {});

  // Tutorial: tabs unlocked
  await expect(page.locator('.shell-tab[data-tab="farming"]')).not.toHaveClass(/onboarding-tab-locked/);

  // 9: Claim → one of: Claim successful / Nothing to claim / Claim failed + reason
  await page.locator('#status-claim-btn').click();
  await page.getByRole('button', { name: /Confirm/i }).click();
  await expect(
    page.getByText(/Claim successful|Nothing to claim|Claim failed/i)
  ).toBeVisible({ timeout: 25000 });
  await page.getByRole('button', { name: /OK/i }).click().catch(() => {});
});

test('scenario 2–9 and tutorial: full flow mobile', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: /Connect Wallet/i })).toBeVisible();
  await page.getByRole('button', { name: /Connect Wallet/i }).click();
  await expect(page.locator('#game-shell.visible')).toBeVisible({ timeout: 35000 });

  await expect(page.locator('.shell-tab[data-tab="farming"]')).toBeVisible();
  await expect(page.locator('.shell-tab[data-tab="adopt"]')).toBeVisible();
  await expect(page.locator('.shell-tab[data-tab="deck"]')).toBeVisible();
  await expect(page.locator('.shell-tab[data-tab="network"]')).toBeVisible();
  await expect(page.getByText(/SEED|\\$SEED/i).first()).toBeVisible();

  const adoptOverlay = page.locator('#adopt-onboarding-overlay.visible');
  const adoptDim = page.locator('#adopt-onboarding-dim-spotlight');
  const hasAdoptGuide = (await adoptOverlay.isVisible()) || (await adoptDim.isVisible());
  expect(hasAdoptGuide).toBeTruthy();

  await expect(page.locator('#pane-adopt.active')).toBeVisible({ timeout: 5000 });
  await page.locator('#shell-gacha-1').click();
  await page.getByRole('button', { name: /Confirm/i }).click();
  await expect(page.locator('.gacha-results-item').first()).toBeVisible({ timeout: 20000 });
  await page.locator('#gacha-result-modal-close').click().catch(() => {});

  await page.locator('.shell-tab[data-tab="deck"]').click();
  const placeableCell = page.locator('.inventory-cell:not(.unowned)').first();
  await expect(placeableCell).toBeVisible({ timeout: 5000 });
  await placeableCell.click();
  await expect(page.locator('.deck-slot').filter({ has: page.locator('img.deck-slot-bird') }).first()).toBeVisible({ timeout: 5000 });

  await page.locator('#status-save-deck-btn').click();
  await page.getByRole('button', { name: /Confirm/i }).click();
  await expect(
    page.getByText(/Deck saved|Your power has been updated|Bird placed|saved|success/i)
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: /OK|Go to Farming/i }).click().catch(() => {});

  await page.locator('#status-claim-btn').click();
  await page.getByRole('button', { name: /Confirm/i }).click();
  await expect(
    page.getByText(/Claim successful|Nothing to claim|Claim failed/i)
  ).toBeVisible({ timeout: 25000 });
});
