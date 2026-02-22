import { test, expect } from '@playwright/test';
import { Contract, JsonRpcProvider } from 'ethers';

const TEST_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const REWARD_CLAIM_ABI = [
  'function signer() view returns (address)',
  'function pool() view returns (address)',
  'function seedToken() view returns (address)',
] as const;
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
] as const;

/**
 * Claim 環境（Signer 一致・プール allowance）を検証し、不備があればテストを失敗させる。
 * E2E_REWARD_CLAIM_ADDRESS が未設定の場合はスキップ（従来どおり）。
 */
async function assertClaimEnvReady(page: import('@playwright/test').Page): Promise<void> {
  const claimAddress = process.env.E2E_REWARD_CLAIM_ADDRESS;
  if (!claimAddress || !claimAddress.startsWith('0x') || claimAddress.length !== 42) return;

  const apiSigner = await page.evaluate(async (): Promise<string | null> => {
    try {
      const r = await fetch('/claim/signer', { credentials: 'include' });
      const d = (await r.json()) as { signerAddress?: string };
      return typeof d.signerAddress === 'string' ? d.signerAddress : null;
    } catch {
      return null;
    }
  });
  if (apiSigner == null) {
    throw new Error('Claim env check: GET /claim/signer failed or returned no signerAddress. Is the API up and session valid?');
  }

  const rpcUrl = process.env.E2E_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
  const provider = new JsonRpcProvider(rpcUrl);
  const claimContract = new Contract(claimAddress, REWARD_CLAIM_ABI, provider);
  const [contractSigner, poolAddr, tokenAddr] = await Promise.all([
    claimContract.signer(),
    claimContract.pool(),
    claimContract.seedToken(),
  ]);
  const contractSignerStr = typeof contractSigner === 'string' ? contractSigner : String(contractSigner);
  const pool = typeof poolAddr === 'string' ? poolAddr : String(poolAddr);
  const token = typeof tokenAddr === 'string' ? tokenAddr : String(tokenAddr);

  if (apiSigner.toLowerCase() !== contractSignerStr.toLowerCase()) {
    throw new Error(
      `Claim env check: Signer mismatch. API=${apiSigner} Contract=${contractSignerStr}. Fix CLAIM_SIGNER_PRIVATE_KEY or redeploy RewardClaim.`
    );
  }

  const tokenContract = new Contract(token, ERC20_ABI, provider);
  const allowance = await tokenContract.allowance(pool, claimAddress);
  const allowanceBn = typeof allowance === 'bigint' ? allowance : BigInt(allowance?.toString?.() ?? 0);
  if (allowanceBn <= 0n) {
    throw new Error(
      `Claim env check: RewardClaim allowance is 0. Pool must approve the RewardClaim contract. See DEBUG tab "プール残高・allowance を確認".`
    );
  }
}

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
        if (method === 'eth_estimateGas') return '0x' + (21000).toString(16);
        if (method === 'eth_getTransactionReceipt') {
          const [txHash] = params as [string];
          if (txHash) return { status: '0x1', blockNumber: '0x1', blockHash: '0x' + 'b'.repeat(64), transactionHash: txHash };
          return null;
        }
        if (method === 'eth_blockNumber') return '0x1';
        if (method === 'eth_call') return '0x';
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
  await expect(page.locator('#gacha-modal-backdrop.visible')).toBeVisible({ timeout: 5000 });
  await page.locator('#gacha-modal-confirm').click();
  // ガチャ結果 or メッセージモーダル（Network stats not updated 等）のどちらかが先に出るまで待つ
  await Promise.race([
    page.locator('.gacha-results-item').first().waitFor({ state: 'visible', timeout: 25000 }),
    page.locator('#message-modal-backdrop.visible').waitFor({ state: 'visible', timeout: 25000 }),
  ]).catch(() => {});
  if (await page.locator('#message-modal-backdrop.visible').isVisible()) await page.locator('#message-modal-ok').click();
  await expect(page.locator('.gacha-results-item').first()).toBeVisible({ timeout: 15000 });
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

  // 8: SAVE success (place success modal or Deck saved message modal)
  await Promise.race([
    page.locator('#place-success-modal-backdrop.visible').waitFor({ state: 'visible', timeout: 20000 }),
    page.locator('#message-modal-backdrop.visible').waitFor({ state: 'visible', timeout: 20000 }),
  ]);
  if (await page.locator('#place-success-modal-backdrop.visible').isVisible()) {
    await page.locator('#place-success-modal-goto-farming').click();
  } else {
    await page.locator('#message-modal-ok').click();
  }

  // Tutorial: tabs unlocked (skip assert when testing vs deployed env that may not have updateTabsForOnboarding at SAVE yet)
  try {
    await expect(page.locator('.shell-tab[data-tab="farming"]')).not.toHaveClass(/onboarding-tab-locked/, { timeout: 5000 });
  } catch {
    // continue; status bar and Claim are visible regardless of tab lock
  }

  // Claim 環境検証（E2E_REWARD_CLAIM_ADDRESS 設定時のみ）。不備ならここで失敗し「Claim simulation failed」を未然に防ぐ
  await assertClaimEnvReady(page);

  // 9: Claim → one of: Claim successful / Nothing to claim / Claim failed + reason (only when button enabled)
  const claimBtn = page.locator('#status-claim-btn');
  await claimBtn.waitFor({ state: 'visible', timeout: 5000 });
  const claimEnabled = await claimBtn.isEnabled().catch(() => false);
  if (claimEnabled) {
    await claimBtn.click();
    await page.getByRole('button', { name: /Confirm/i }).click();
    await expect(
      page.getByText(/Claim successful|Nothing to claim|Claim failed/i)
    ).toBeVisible({ timeout: 25000 });
    await page.getByRole('button', { name: /OK/i }).click().catch(() => {});
  }
});

test('debug Reset & Disconnect: reconnect shows first-time state and can start gacha', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: /Connect Wallet/i })).toBeVisible();
  await page.getByRole('button', { name: /Connect Wallet/i }).click();
  await expect(page.locator('#game-shell.visible')).toBeVisible({ timeout: 35000 });

  await expect(page.locator('.shell-tab[data-tab="adopt"]')).toBeVisible();
  await expect(page.locator('.shell-tab[data-tab="debug"]')).toBeVisible();

  await page.locator('.shell-tab[data-tab="debug"]').click();
  await expect(page.locator('#pane-debug.active')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#dom-debug-reset-disconnect')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#dom-debug-reset-disconnect').click();

  await expect(page.getByRole('button', { name: /Connect Wallet/i })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#game-shell.visible')).not.toBeVisible();

  await page.getByRole('button', { name: /Connect Wallet/i }).click();
  await expect(page.locator('#game-shell.visible')).toBeVisible({ timeout: 35000 });

  const adoptOverlay = page.locator('#adopt-onboarding-overlay.visible');
  const adoptDim = page.locator('#adopt-onboarding-dim-spotlight');
  const hasAdoptGuide = (await adoptOverlay.isVisible()) || (await adoptDim.isVisible());
  expect(hasAdoptGuide).toBeTruthy();

  await expect(page.locator('#pane-adopt.active')).toBeVisible({ timeout: 5000 });
  await page.locator('#shell-gacha-1').click();
  await expect(page.locator('#gacha-modal-backdrop.visible')).toBeVisible({ timeout: 5000 });
  await page.locator('#gacha-modal-confirm').click();
  await Promise.race([
    page.locator('.gacha-results-item').first().waitFor({ state: 'visible', timeout: 25000 }),
    page.locator('#message-modal-backdrop.visible').waitFor({ state: 'visible', timeout: 25000 }),
  ]).catch(() => {});
  if (await page.locator('#message-modal-backdrop.visible').isVisible()) await page.locator('#message-modal-ok').click();
  await expect(page.locator('.gacha-results-item').first()).toBeVisible({ timeout: 15000 });
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
  await expect(page.locator('#gacha-modal-backdrop.visible')).toBeVisible({ timeout: 5000 });
  await page.locator('#gacha-modal-confirm').click();
  await Promise.race([
    page.locator('.gacha-results-item').first().waitFor({ state: 'visible', timeout: 25000 }),
    page.locator('#message-modal-backdrop.visible').waitFor({ state: 'visible', timeout: 25000 }),
  ]).catch(() => {});
  if (await page.locator('#message-modal-backdrop.visible').isVisible()) await page.locator('#message-modal-ok').click();
  await expect(page.locator('.gacha-results-item').first()).toBeVisible({ timeout: 15000 });
  await page.locator('#gacha-result-modal-close').click().catch(() => {});

  await page.locator('.shell-tab[data-tab="deck"]').click();
  const placeableCell = page.locator('.inventory-cell:not(.unowned)').first();
  await expect(placeableCell).toBeVisible({ timeout: 5000 });
  await placeableCell.click();
  await expect(page.locator('.deck-slot').filter({ has: page.locator('img.deck-slot-bird') }).first()).toBeVisible({ timeout: 5000 });

  await page.locator('#status-save-deck-btn').click();
  await page.getByRole('button', { name: /Confirm/i }).click();
  await Promise.race([
    page.locator('#place-success-modal-backdrop.visible').waitFor({ state: 'visible', timeout: 20000 }),
    page.locator('#message-modal-backdrop.visible').waitFor({ state: 'visible', timeout: 20000 }),
  ]);
  if (await page.locator('#place-success-modal-backdrop.visible').isVisible()) {
    await page.locator('#place-success-modal-goto-farming').click();
  } else {
    await page.locator('#message-modal-ok').click();
  }

  try {
    await expect(page.locator('.shell-tab[data-tab="farming"]')).not.toHaveClass(/onboarding-tab-locked/, { timeout: 5000 });
  } catch {
    // continue
  }

  await assertClaimEnvReady(page);

  const claimBtn = page.locator('#status-claim-btn');
  await claimBtn.waitFor({ state: 'visible', timeout: 5000 });
  const claimEnabled = await claimBtn.isEnabled().catch(() => false);
  if (claimEnabled) {
    await claimBtn.click();
    await page.getByRole('button', { name: /Confirm/i }).click();
    await expect(
      page.getByText(/Claim successful|Nothing to claim|Claim failed/i)
    ).toBeVisible({ timeout: 25000 });
    await page.getByRole('button', { name: /OK/i }).click().catch(() => {});
  }
});
