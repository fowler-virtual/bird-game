/**
 * HyperFarm-style DOM shell: header, tabs, status cards.
 * Shown after wallet connect; tab clicks drive Phaser scene/screen.
 */

import { GameStore } from './store/GameStore';
import type { BirdRarity } from './types';

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

/** レアリティ → public の画像パス（Summon 結果・Vite base 対応） */
const RARITY_IMAGE_SRC: Record<BirdRarity, string> = {
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

/** タブ切替用: 2 フレーム待って DOM リフローを確定させてから Phaser を更新し、アイコンサイズが初回と復帰時でずれないようにする。 */
function runPhaserAfterTabSwitch(tabId: string): void {
  const scene = (window as unknown as {
    __gameScene?: {
      showMain: () => void;
      showDeck: () => void;
      clearDeckParentSizeCache?: () => void;
      ensureScaleModeForTab?: (tabId: string) => void;
      forceLayoutAndRender?: () => void;
    };
  }).__gameScene;
  if (!scene) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (tabId === 'farming') scene.showMain?.();
      else if (tabId === 'deck') {
        scene.clearDeckParentSizeCache?.();
        scene.showDeck?.();
      }
      scene.ensureScaleModeForTab?.(tabId);
      requestAnimationFrame(() => {
        scene.forceLayoutAndRender?.();
      });
    });
  });
}

/** 初回表示などで呼ぶ。タブ切替では runPhaserAfterTabSwitch を使う。refresh で Phaser が undefined.width を読む場合があるため try/catch で保護。 */
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

/** リサイズ終了後に1回だけ refresh。連続 fire で毎フレーム refresh するとジリジリするため、短い debounce で止まってから即反映。 */
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
  if (canvasCard) {
    if (tabId === 'summon') {
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

  lastTabId = tabId;
  if (tabId === 'farming' || tabId === 'deck') runPhaserAfterTabSwitch(tabId);
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
