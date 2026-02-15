import { Buffer } from 'buffer';
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { GameStore } from './store/GameStore';
import { initTitleUI, showTitleUI, hideTitleUI } from './titleUI';
import { setupAccountChangeReload } from './wallet';
import { createPhaserGame } from './phaserBoot';

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
    document.getElementById('title-ui')?.classList.remove('visible');
    import('./domShell').then(({ showGameShell }) => showGameShell());
    createPhaserGame();
  }
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
