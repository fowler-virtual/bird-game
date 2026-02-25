import { Buffer } from 'buffer';
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { GameStore } from './store/GameStore';
import { initTitleUI, showTitleUI } from './titleUI';
import { setupAccountChangeReload } from './wallet';
import { createPhaserGame } from './phaserBoot';

const ENSURE_SEPOLIA_TIMEOUT_MS = 15_000;

/**
 * localStorage にウォレット情報が残っている場合の自動接続。
 * titleUI.ts の onConnectClick と同等の初期化（SIWE・game-state 同期・Sepolia 確認）を行う。
 */
async function autoConnect(): Promise<void> {
  const address = GameStore.walletAddress!;

  // ウォレット拡張の初期化を少し待つ
  await new Promise((r) => setTimeout(r, 300));

  // 1. ウォレットが実際に接続されているか確認（プロンプトなし）
  const { getConnectedAccounts, ensureSepolia } = await import('./wallet');
  const accounts = await getConnectedAccounts();
  if (!accounts.some((a) => a.toLowerCase() === address.toLowerCase())) {
    console.warn('[AutoConnect] Wallet no longer connected, showing title');
    GameStore.disconnectWallet();
    showTitleUI();
    return;
  }

  // 2. セッション確認: getGameState を試みる
  const { getGameState } = await import('./gameStateApi');
  let gs = await getGameState();

  // 3. 401（セッション切れ）なら SIWE 再署名してリトライ
  if (!gs.ok && gs.error === 'Not logged in.') {
    const { signInForClaim } = await import('./claimApi');
    const auth = await signInForClaim(address);
    if (auth.ok) {
      gs = await getGameState();
    } else {
      console.warn('[AutoConnect] SIWE failed:', auth.error);
    }
  }

  // 4. サーバー state を反映（取得できなかった場合は localStorage のまま続行）
  if (gs.ok) {
    GameStore.setStateFromServer(gs.state, gs.version);
    GameStore.save();
  }

  // 5. ゲーム画面表示
  document.getElementById('title-ui')?.classList.remove('visible');
  const { showGameShell, setSyncStatusGet } = await import('./domShell');
  setSyncStatusGet(gs.ok ? 'ok' : 'fail');
  showGameShell();
  createPhaserGame();

  // 6. Sepolia ネットワーク確認（タイムアウト付き）
  const networkResult = await Promise.race([
    ensureSepolia(),
    new Promise<{ ok: false; error: string }>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: 'Network switch timed out' }), ENSURE_SEPOLIA_TIMEOUT_MS)
    ),
  ]);
  if (!networkResult.ok) {
    console.warn('[AutoConnect] ensureSepolia failed or timed out:', networkResult.error);
  }
}

function runApp(): void {
  try {
    GameStore.load();
  } catch (e) {
    console.error('[Bird Game] GameStore.load failed:', e);
  }

  setupAccountChangeReload();
  initTitleUI();

  if (!GameStore.walletConnected || !GameStore.walletAddress) {
    showTitleUI();
  } else {
    autoConnect().catch((err) => {
      console.error('[AutoConnect] Error:', err);
      showTitleUI();
    });
  }
}

function start(): void {
  try {
    runApp();
  } catch (e) {
    console.error('[Bird Game] Startup error:', e);
    const titleEl = document.getElementById('title-ui');
    if (titleEl) {
      titleEl.classList.add('visible');
      titleEl.setAttribute('aria-hidden', 'false');
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

export { createPhaserGame, destroyPhaserGame } from './phaserBoot';
