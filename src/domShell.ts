/**
 * HyperFarm-style DOM shell: header, tabs, status cards.
 * Shown after wallet connect; tab clicks drive Phaser scene/screen.
 */

import { GameStore, GACHA_COST } from './store/GameStore';
import { getProductionRatePerHour, getNetworkSharePercent } from './types';
import * as farmingView from './views/farmingView';
import * as deckView from './views/deckView';
import { RARITY_IMAGE_SRC } from './assets';

const SHELL_ID = 'game-shell';
const TAB_ACTIVE = 'active';

function getShell(): HTMLElement | null {
  return document.getElementById(SHELL_ID);
}

const CANVAS_CARD_ID = 'shell-canvas-card';
const CANVAS_HIDDEN_CLASS = 'canvas-card-hidden';
const CANVAS_DECK_VIEW_CLASS = 'canvas-card-deck-view';

/** 切り分け用: 直前のタブ（Adopt から戻ったか判定用） */
let lastTabId = '';
const DEBUG_LAYOUT = true;

/** Adopt に隠す直前に保存したキャンバスカードのサイズ。Adopt→Farming で getBoundingClientRect が 0 になるのを避ける。 */
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
  const tab = document.querySelector(`.shell-tab[data-tab="${tabId}"]`);
  const pane = document.getElementById(`pane-${tabId}`);
  if (tab) tab.classList.add(TAB_ACTIVE);
  if (pane) pane.classList.add(TAB_ACTIVE);

  const canvasCard = document.getElementById(CANVAS_CARD_ID);
  /* Farming / Deck は HTML ビューなのでキャンバスを非表示にし、下に Phaser の名残が出ないようにする */
  const hideCanvas = tabId === 'adopt' || tabId === 'debug' || tabId === 'farming' || tabId === 'deck';
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
  if (lastTabId === 'adopt' && tabId !== 'adopt') clearGachaResultsArea();
  lastTabId = tabId;

  if (tabId === 'debug') refreshDebugPane();
  if (tabId === 'farming') {
    if (GameStore.state.onboardingStep === 'need_farming') {
      GameStore.setState({ onboardingStep: 'done' });
      GameStore.save();
    }
    farmingView.refresh();
  }
  if (tabId === 'adopt') {
    hideGachaResultsSection();
    updateAdoptPaneForOnboarding();
  }
  if (tabId === 'deck') {
    updateDeckPaneVisibility();
    deckView.refresh();
  }
  updateTabsForOnboarding();
}

/** オンボーディング状態に応じてタブのロックを更新。Deck で鳥を置いた直後にも呼ぶ */
export function updateTabsForOnboarding(): void {
  const step = GameStore.state.onboardingStep;
  const lockFarming = step === 'need_gacha' || step === 'need_place';
  const farmingTab = document.querySelector('.shell-tab[data-tab="farming"]');
  if (farmingTab) {
    farmingTab.classList.toggle('onboarding-tab-locked', lockFarming);
    farmingTab.setAttribute('aria-disabled', lockFarming ? 'true' : 'false');
  }
}

function onTabClick(e: Event): void {
  const target = (e.target as HTMLElement).closest('.shell-tab');
  if (!target) return;
  const tabId = target.getAttribute('data-tab');
  if (!tabId) return;
  const step = GameStore.state.onboardingStep;
  if (tabId === 'farming' && (step === 'need_gacha' || step === 'need_place')) {
    return;
  }
  switchToTab(tabId);
}

/** Adoptタブでは普段「Adopted birds」枠を非表示。タブ表示時は非表示にしておく。 */
function hideGachaResultsSection(): void {
  const section = document.getElementById('gacha-results-section');
  if (!section) return;
  section.classList.add('gacha-results-section--hidden');
}

/** ガチャ成功時だけ結果枠を表示する */
function showGachaResultsSection(): void {
  const section = document.getElementById('gacha-results-section');
  if (!section) return;
  section.classList.remove('gacha-results-section--hidden');
}

/** Adoptタブを離れたときにガチャ結果エリアを空にし、枠も非表示に戻す */
function clearGachaResultsArea(): void {
  const area = document.getElementById('gacha-results-area');
  if (!area) return;
  area.querySelectorAll('.gacha-results-item').forEach((el) => el.remove());
  area.querySelectorAll('.gacha-results-empty').forEach((el) => el.remove());
  const empty = document.createElement('p');
  empty.className = 'gacha-results-empty';
  empty.id = 'gacha-results-empty';
  empty.textContent = 'No birds adopted yet.';
  area.appendChild(empty);
  hideGachaResultsSection();
}

/** Deckタブ: 鳥を1羽も持っていない間はデッキ・インベントリを非表示にし、文言だけ表示 */
function updateDeckPaneVisibility(): void {
  const hasAnyBird = GameStore.state.birdsOwned.length > 0;
  const emptyHint = document.getElementById('deck-empty-hint');
  const contentWrap = document.getElementById('deck-content-with-birds');
  if (emptyHint) emptyHint.classList.toggle('deck-empty-hint--hidden', hasAnyBird);
  if (contentWrap) contentWrap.classList.toggle('deck-content-with-birds--hidden', !hasAnyBird);
}

/** オンボーディング中は Adopt で 10x を無効化（結果枠の表示は switchToTab / runGachaFromDom で制御） */
function updateAdoptPaneForOnboarding(): void {
  const step = GameStore.state.onboardingStep;
  const gacha10Btn = document.getElementById('shell-gacha-10');
  if (gacha10Btn) {
    const disabled = step === 'need_gacha';
    (gacha10Btn as HTMLButtonElement).disabled = disabled;
    gacha10Btn.classList.toggle('onboarding-locked', disabled);
  }
}

function updateGachaButtonsAndCosts(): void {
  const state = GameStore.state;
  const freePulls = state.hasFreeGacha ? 1 : 0;
  const cost1 = Math.max(0, 1 - freePulls) * GACHA_COST;
  const cost10 = Math.max(0, 10 - freePulls) * GACHA_COST;
  const bal = GameStore.birdCurrency;

  const btn1 = document.getElementById('shell-gacha-1') as HTMLButtonElement | null;
  const btn10 = document.getElementById('shell-gacha-10') as HTMLButtonElement | null;
  const cost1El = document.getElementById('gacha-cost-1');
  const cost10El = document.getElementById('gacha-cost-10');

  if (btn1) {
    if (state.hasFreeGacha) btn1.textContent = 'Adopt 1x (Free)';
    else btn1.textContent = `Adopt 1x (${cost1} $BIRD)`;
  }
  if (btn10) {
    btn10.textContent = `Adopt 10x (${cost10} $BIRD)`;
  }

  if (cost1El) {
    if (state.hasFreeGacha) cost1El.textContent = 'Cost: Free (first adoption)';
    else cost1El.textContent = `Cost: ${cost1} $BIRD`;
    cost1El.classList.toggle('gacha-cost-insufficient', bal < cost1);
  }
  if (cost10El) {
    cost10El.textContent = `Cost: ${cost10} $BIRD`;
    cost10El.classList.toggle('gacha-cost-insufficient', bal < cost10);
  }
}

/** ガチャタブの「1回回す」「10回回す」から呼ぶ。引いた鳥を「ガチャで出た鳥」に表示する。 */
function runGachaFromDom(count: 1 | 10): void {
  const step = GameStore.state.onboardingStep;
  if (step === 'need_gacha' && count !== 1) return;

  // ウォレット接続とコストを確認してから実行
  if (!GameStore.walletConnected) {
    const area = document.getElementById('gacha-results-area');
    if (area) {
      area.querySelectorAll('.gacha-results-empty').forEach((el) => el.remove());
      const msg = document.createElement('p');
      msg.className = 'gacha-results-empty';
      msg.textContent = 'Please connect your wallet first.';
      area.appendChild(msg);
    }
    return;
  }

  const state = GameStore.state;
  const freePulls = state.hasFreeGacha ? 1 : 0;
  const paidPulls = Math.max(0, count - freePulls);
  const cost = paidPulls * GACHA_COST;
  const bal = GameStore.birdCurrency;

  if (cost > 0 && bal < cost) {
    window.alert(`Insufficient $BIRD balance. You need ${cost} $BIRD. (Balance: ${bal} $BIRD)`);
    return;
  }

  let ok = true;
  if (cost === 0) {
    ok = window.confirm(`Use your free adoption to adopt ${count === 1 ? '1 bird' : `${count} birds`}?`);
  } else {
    ok = window.confirm(`Spend ${cost} $BIRD to adopt ${count === 1 ? '1 bird' : `${count} birds`}? (Balance: ${bal} $BIRD)`);
  }
  if (!ok) return;

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

  if (step === 'need_gacha' && count === 1) {
    GameStore.setState({ onboardingStep: 'need_place' });
    GameStore.save();
    switchToTab('deck');
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
  showGachaResultsSection();

  updateAdoptPaneForOnboarding();
  updateGachaButtonsAndCosts();
  updateDeckPaneVisibility();
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
  updateGachaButtonsAndCosts();
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
  const resetBtn = document.getElementById('dom-debug-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (!window.confirm('Reset game state and return to onboarding? (SEED, $Bird, birds, and Loft will be cleared.)')) return;
      GameStore.resetToInitial();
      refreshDebugPane();
      emitGameRefresh();
      const state = GameStore.state;
      updateShellStatus({
        seed: state.seed,
        seedPerDay: getProductionRatePerHour(state) * 24,
        loftLevel: state.loftLevel,
        networkSharePercent: getNetworkSharePercent(state),
      });
      switchToTab('adopt');
      farmingView.refresh();
      deckView.refresh();
    });
  }
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
  const themeBtn = document.getElementById('shell-theme-btn');
  if (themeBtn) themeBtn.addEventListener('click', () => {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    if (next === 'light') html.setAttribute('data-theme', 'light');
    else html.removeAttribute('data-theme');
    try { localStorage.setItem('bird-game-theme', next); } catch (_) {}
  });
  initDebugPaneListeners();
  farmingView.init();
  deckView.init();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onWindowResize);
  }
  updateAdoptPaneForOnboarding();
  updateGachaButtonsAndCosts();
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
  if (addrEl) {
    const addr = GameStore.walletAddress;
    addrEl.textContent = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—';
  }

  initTabListeners();

  /* 初回表示: オンボーディング中は Adopt から、そうでなければ Farming */
  const step = GameStore.state.onboardingStep;
  const firstTab = step === 'need_gacha' ? 'adopt' : 'farming';
  switchToTab(firstTab);
  updateTabsForOnboarding();
  hideGachaResultsSection();
  updateDeckPaneVisibility();

  refreshPhaserScale();
}

export function hideGameShell(): void {
  const shell = getShell();
  if (!shell) return;
  shell.classList.remove('visible');
  shell.setAttribute('aria-hidden', 'true');
}

/** Update DOM status cards (Current SEED, SEED/day, Network Share, Loft Lv). Called from GameScene when shell is visible. */
export function updateShellStatus(payload: {
  seed: number;
  seedPerDay: number;
  loftLevel: number;
  networkSharePercent: number;
}): void {
  const seedEl = document.getElementById('dom-seed');
  const seedPerDayEl = document.getElementById('dom-seed-per-day');
  const networkEl = document.getElementById('dom-network-share');
  const loftEl = document.getElementById('dom-loft-level');
  if (seedEl) seedEl.textContent = String(payload.seed);
  if (seedPerDayEl) seedPerDayEl.textContent = String(Math.floor(payload.seedPerDay));
  if (networkEl) networkEl.textContent = `${payload.networkSharePercent.toFixed(5)}%`;
  if (loftEl) loftEl.textContent = String(payload.loftLevel);
  farmingView.updateUpgradeButton();
}

export function isShellVisible(): boolean {
  const shell = getShell();
  return shell?.classList.contains('visible') ?? false;
}
