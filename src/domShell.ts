/**
 * HyperFarm-style DOM shell: header, tabs, status cards.
 * Shown after wallet connect; tab clicks drive Phaser scene/screen.
 */

import { GameStore } from './store/GameStore';
import type { BirdRarity } from './types';
import * as farmingView from './views/farmingView';
import * as deckView from './views/deckView';

const SHELL_ID = 'game-shell';

const ASSET_BASE =
  (() => {
    try {
      const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
      return typeof env?.BASE_URL === 'string' ? env.BASE_URL : '/';
    } catch {
      return '/';
    }
  })();

/** レアリティ → public の画像パス（Summon 結果・Farming/Deck DOM 表示・Vite base 対応） */
export const RARITY_IMAGE_SRC: Record<BirdRarity, string> = {
  Common: ASSET_BASE + 'common.png',
  Uncommon: ASSET_BASE + 'uncommon.png',
  Rare: ASSET_BASE + 'rare.png',
  Epic: ASSET_BASE + 'epic.png',
  Legendary: ASSET_BASE + 'legendary.png',
};
const TAB_ACTIVE = 'active';

function getShell(): HTMLElement | null {
  return document.getElementById(SHELL_ID);
}

const CANVAS_CARD_ID = 'shell-canvas-card';
const CANVAS_HIDDEN_CLASS = 'canvas-card-hidden';
const CANVAS_DECK_VIEW_CLASS = 'canvas-card-deck-view';

/** 切り分け用: 直前のタブ（Summon から戻ったか判定用） */
let lastTabId = '';
const DEBUG_LAYOUT = true;

/** Summon に隠す直前に保存したキャンバスカードのサイズ。Summon→Farming で getBoundingClientRect が 0 になるのを避ける。 */
let lastCanvasCardSize: { width: number; height: number } | null = null;

export function getLastCanvasCardSize(): { width: number; height: number } | null {
  return lastCanvasCardSize;
}

/** デッキタブ時はキャンバスカードを高くし、ページスクロールで待機デッキまで全て表示。 */
export function setCanvasCardDeckView(deck: boolean): void {
  const el = document.getElementById(CANVAS_CARD_ID);
  if (!el) return;
  if (deck) el.classList.add(CANVAS_DECK_VIEW_CLASS);
  else el.classList.remove(CANVAS_DECK_VIEW_CLASS);
}

/** 初回表示などで呼ぶ。refresh で Phaser が undefined.width を読む場合があるため try/catch で保護。 */
export function refreshPhaserScale(): void {
  const game = (window as unknown as { __phaserGame?: { scale?: { refresh?: () => void } } }).__phaserGame;
  const refresh = game?.scale?.refresh;
  if (!refresh) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        refresh();
      } catch (_e) {
        // RESIZE 直後などで scale 内部が未確定だと refresh が落ちるため握りつぶす
      }
    });
  });
}

/** リサイズ終了後に1回だけ Phaser scale を refresh（Farming/Deck は DOM のため不要）。 */
const RESIZE_DEBOUNCE_MS = 16;
let resizeTimeoutId = 0;
function onWindowResize(): void {
  if (!getShell()?.classList.contains('visible')) return;
  if (resizeTimeoutId) clearTimeout(resizeTimeoutId);
  resizeTimeoutId = window.setTimeout(() => {
    resizeTimeoutId = 0;
    const game = (window as unknown as { __phaserGame?: { scale?: { refresh?: () => void } } }).__phaserGame;
    try {
      game?.scale?.refresh?.();
    } catch (_e) {
      // scale 未確定時に refresh が落ちる場合があるため握りつぶす
    }
  }, RESIZE_DEBOUNCE_MS);
}

/** DOM tab switch. Also called from Phaser (e.g. Back) to stay in sync. */
export function switchToTab(tabId: string): void {
  if (DEBUG_LAYOUT) {
    console.log('[BirdGame] switchToTab', { from: lastTabId || '(initial)', to: tabId });
  }
  document.querySelectorAll('.shell-tab').forEach((el) => el.classList.remove(TAB_ACTIVE));
  document.querySelectorAll('.tab-pane').forEach((el) => el.classList.remove(TAB_ACTIVE));
  document.querySelectorAll('.tab-intro').forEach((el) => el.classList.remove(TAB_ACTIVE));
  const tab = document.querySelector(`.shell-tab[data-tab="${tabId}"]`);
  const pane = document.getElementById(`pane-${tabId}`);
  const intro = document.querySelector(`.tab-intro[data-tab="${tabId}"]`);
  if (tab) tab.classList.add(TAB_ACTIVE);
  if (pane) pane.classList.add(TAB_ACTIVE);
  if (intro) intro.classList.add(TAB_ACTIVE);

  const canvasCard = document.getElementById(CANVAS_CARD_ID);
  /* Farming / Deck は HTML ビューなのでキャンバスを非表示にし、下に Phaser の名残が出ないようにする */
  const hideCanvas = tabId === 'summon' || tabId === 'debug' || tabId === 'farming' || tabId === 'deck';
  if (canvasCard) {
    if (hideCanvas) {
      const r = canvasCard.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        lastCanvasCardSize = { width: Math.floor(r.width), height: Math.floor(r.height) };
      }
      if (lastCanvasCardSize) {
        canvasCard.style.width = lastCanvasCardSize.width + 'px';
        canvasCard.style.height = lastCanvasCardSize.height + 'px';
      }
      canvasCard.classList.add(CANVAS_HIDDEN_CLASS);
    } else {
      canvasCard.classList.remove(CANVAS_HIDDEN_CLASS);
      canvasCard.style.width = '';
      canvasCard.style.height = '';
      const r = canvasCard.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        lastCanvasCardSize = { width: Math.floor(r.width), height: Math.floor(r.height) };
      }
    }
  }
  setCanvasCardDeckView(tabId === 'deck');

  if (DEBUG_LAYOUT && canvasCard) {
    const rect = canvasCard.getBoundingClientRect();
    const style = window.getComputedStyle(canvasCard);
    console.log('[BirdGame] canvas-card after switch', {
      tabId,
      hasHiddenClass: canvasCard.classList.contains(CANVAS_HIDDEN_CLASS),
      display: style.display,
      visibility: style.visibility,
      getBoundingClientRect: { width: rect.width, height: rect.height },
    });
  }

  if (lastTabId === 'farming' && tabId !== 'farming') farmingView.stop();
  lastTabId = tabId;

  if (tabId === 'debug') refreshDebugPane();
  if (tabId === 'farming') farmingView.refresh();
  if (tabId === 'deck') deckView.refresh();
}

function onTabClick(e: Event): void {
  const target = (e.target as HTMLElement).closest('.shell-tab');
  if (!target) return;
  const tabId = target.getAttribute('data-tab');
  if (!tabId) return;
  switchToTab(tabId);
}

/** ガチャタブの「1回回す」「10回回す」から呼ぶ。引いた鳥を「ガチャで出た鳥」に表示する。 */
function runGachaFromDom(count: 1 | 10): void {
  const result = GameStore.pullGacha(count);
  const area = document.getElementById('gacha-results-area');
  const emptyEl = document.getElementById('gacha-results-empty');
  if (!area) return;

  area.querySelectorAll('.gacha-results-item').forEach((el) => el.remove());
  if (emptyEl) emptyEl.remove();

  if (!result.ok) {
    const msg = document.createElement('p');
    msg.className = 'gacha-results-empty';
    msg.textContent = result.error ?? 'Error';
    area.appendChild(msg);
    return;
  }

  area.querySelectorAll('.gacha-results-empty').forEach((el) => el.remove());
  for (const bird of result.birds) {
    const img = document.createElement('img');
    img.className = 'gacha-results-item';
    img.src = RARITY_IMAGE_SRC[bird.rarity];
    img.alt = bird.rarity;
    img.loading = 'lazy';
    area.appendChild(img);
  }

  const game = (window as unknown as { __phaserGame?: { scene?: { get?: (k: string) => { events?: { emit?: (e: string) => void } } } } }).__phaserGame;
  game?.scene?.get?.('GameScene')?.events?.emit?.('refresh');
}

function emitGameRefresh(): void {
  const game = (window as unknown as { __phaserGame?: { scene?: { get?: (k: string) => { events?: { emit?: (e: string) => void } } } } }).__phaserGame;
  game?.scene?.get?.('GameScene')?.events?.emit?.('refresh');
}

function refreshDebugPane(): void {
  const seedEl = document.getElementById('dom-debug-seed');
  const birdEl = document.getElementById('dom-debug-bird');
  const loftEl = document.getElementById('dom-debug-loft');
  if (seedEl) seedEl.textContent = String(GameStore.state.seed);
  if (birdEl) birdEl.textContent = String(GameStore.birdCurrency);
  if (loftEl) loftEl.textContent = String(GameStore.state.loftLevel);
}

function initDebugPaneListeners(): void {
  const seedSetBtn = document.getElementById('dom-debug-seed-set');
  const birdSetBtn = document.getElementById('dom-debug-bird-set');
  if (seedSetBtn) {
    seedSetBtn.addEventListener('click', () => {
      const v = window.prompt('SEED', String(GameStore.state.seed));
      if (v == null) return;
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n) || n < 0) return;
      GameStore.setState({ seed: n });
      GameStore.save();
      refreshDebugPane();
      emitGameRefresh();
    });
  }
  if (birdSetBtn) {
    birdSetBtn.addEventListener('click', () => {
      const v = window.prompt('$Bird', String(GameStore.birdCurrency));
      if (v == null) return;
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n) || n < 0) return;
      GameStore.birdCurrency = n;
      GameStore.save();
      refreshDebugPane();
      emitGameRefresh();
    });
  }
  document.querySelectorAll('.debug-loft-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const level = Number((btn as HTMLElement).getAttribute('data-level'));
      if (level < 1 || level > 4) return;
      GameStore.setState({
        loftLevel: level,
        unlockedDeckCount: (level * 2) as 2 | 4 | 6 | 8,
      });
      GameStore.save();
      refreshDebugPane();
      emitGameRefresh();
    });
  });
}

let tabListenersInited = false;
let disconnectCallback: (() => void) | null = null;

/** Called by GameScene when using DOM shell so header Disconnect button runs the same flow. */
export function setDisconnectCallback(fn: (() => void) | null): void {
  disconnectCallback = fn ?? null;
}

function initTabListeners(): void {
  if (tabListenersInited) return;
  document.querySelectorAll('.shell-tab').forEach((btn) => {
    btn.addEventListener('click', onTabClick);
  });
  const gacha1Btn = document.getElementById('shell-gacha-1');
  const gacha10Btn = document.getElementById('shell-gacha-10');
  if (gacha1Btn) gacha1Btn.addEventListener('click', () => runGachaFromDom(1));
  if (gacha10Btn) gacha10Btn.addEventListener('click', () => runGachaFromDom(10));
  const disconnectBtn = document.getElementById('shell-disconnect-btn');
  if (disconnectBtn) disconnectBtn.addEventListener('click', () => disconnectCallback?.());
  initDebugPaneListeners();
  farmingView.init();
  deckView.init();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onWindowResize);
  }
  tabListenersInited = true;
}

export function showGameShell(): void {
  const shell = getShell();
  if (!shell) return;
  shell.classList.add('visible');
  shell.setAttribute('aria-hidden', 'false');

  const canvasCard = document.getElementById(CANVAS_CARD_ID);
  if (canvasCard) {
    const r = canvasCard.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      lastCanvasCardSize = { width: Math.floor(r.width), height: Math.floor(r.height) };
    }
  }

  const addrEl = document.getElementById('shell-wallet-address');
  const networkEl = document.getElementById('shell-network');
  if (addrEl) {
    const addr = GameStore.walletAddress;
    addrEl.textContent = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—';
  }
  if (networkEl) networkEl.textContent = '—';

  initTabListeners();

  /* 初回表示でも switchToTab を通すことでキャンバスを非表示にし、下に名残が出ないようにする */
  switchToTab('farming');

  refreshPhaserScale();
}

export function hideGameShell(): void {
  const shell = getShell();
  if (!shell) return;
  shell.classList.remove('visible');
  shell.setAttribute('aria-hidden', 'true');
}

/** Update DOM status cards (Current SEED, SEED/day, Loft Lv, Slots). Called from GameScene when shell is visible. */
export function updateShellStatus(payload: {
  seed: number;
  seedPerDay: number;
  loftLevel: number;
  slots: string;
}): void {
  const seedEl = document.getElementById('dom-seed');
  const seedPerDayEl = document.getElementById('dom-seed-per-day');
  const loftEl = document.getElementById('dom-loft-level');
  const slotsEl = document.getElementById('dom-loft-slots');
  if (seedEl) seedEl.textContent = String(payload.seed);
  if (seedPerDayEl) seedPerDayEl.textContent = String(Math.floor(payload.seedPerDay));
  if (loftEl) loftEl.textContent = String(payload.loftLevel);
  if (slotsEl) slotsEl.textContent = payload.slots;
}

export function isShellVisible(): boolean {
  const shell = getShell();
  return shell?.classList.contains('visible') ?? false;
}
