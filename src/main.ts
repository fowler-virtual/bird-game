import { Buffer } from 'buffer';
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { GameStore } from './store/GameStore';
import { initTitleUI, showTitleUI } from './titleUI';
import { setupAccountChangeReload, revokeWalletPermissions } from './wallet';

function runApp(): void {
  try {
    GameStore.load();
  } catch (e) {
    console.error('[Bird Game] GameStore.load failed:', e);
  }

  setupAccountChangeReload();
  initTitleUI();

  // 仕様: 必ず TOP を表示する。ゲーム画面へは Connect Wallet 押下後のみ遷移する。
  showTitleUI();
  // タイトル表示時に接続許可を取り消し、Connect 押下で必ずウォレット接続ダイアログが出るようにする。
  revokeWalletPermissions().catch(() => {});
}

function start(): void {
  if (import.meta.env.VITE_E2E_MODE === '1') {
    document.documentElement.setAttribute('data-e2e', '1');
    let shell = document.getElementById('game-shell');
    if (!shell) {
      shell = document.createElement('div');
      shell.id = 'game-shell';
      document.body.appendChild(shell);
    }
    shell.classList.add('visible');
  }
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
