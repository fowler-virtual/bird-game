/**
 * HyperFarm-style DOM shell: header, tabs, status cards.
 * Shown after wallet connect; tab clicks drive Phaser scene/screen.
 */

import { GameStore, GACHA_COST } from './store/GameStore';
import { getProductionRatePerHour, getNetworkSharePercent, MAX_LOFT_LEVEL, RARITY_COLUMN_ORDER, RARITY_DROP_RATES } from './types';
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
    updateAdoptPane();
    updateGachaButtonsAndCosts();
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

/** Adoptタブ用: 残高・Total adopted・レアリティプレビュー・初回無料バッジを更新 */
function updateAdoptPane(): void {
  const state = GameStore.state;
  const balanceEl = document.getElementById('adopt-balance-value');
  if (balanceEl) balanceEl.textContent = String(GameStore.birdCurrency);
  const totalEl = document.getElementById('adopt-total-count');
  if (totalEl) totalEl.textContent = String(state.birdsOwned.length);
  const badgeEl = document.getElementById('adopt-free-badge');
  const badgeRow = document.getElementById('gacha-cta-badge-row');
  if (badgeEl && badgeRow) {
    if (state.hasFreeGacha) {
      badgeEl.textContent = 'First free';
      badgeRow.classList.remove('gacha-cta-badge-row--hidden');
    } else {
      badgeRow.classList.add('gacha-cta-badge-row--hidden');
    }
  }
  const previewList = document.getElementById('adopt-rarity-preview-list');
  if (previewList && previewList.children.length === 0) {
    for (const rarity of RARITY_COLUMN_ORDER) {
      const rate = RARITY_DROP_RATES[rarity];
      const item = document.createElement('div');
      item.className = 'adopt-rarity-preview-item';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'adopt-rarity-name';
      nameSpan.textContent = rarity;
      const rateSpan = document.createElement('span');
      rateSpan.className = 'adopt-rarity-rate';
      rateSpan.textContent = `${rate}%`;
      const barWrap = document.createElement('div');
      barWrap.className = 'adopt-rarity-bar-wrap';
      const bar = document.createElement('div');
      bar.className = 'adopt-rarity-bar';
      bar.style.width = `${rate}%`;
      barWrap.appendChild(bar);
      item.appendChild(nameSpan);
      item.appendChild(rateSpan);
      item.appendChild(barWrap);
      previewList.appendChild(item);
    }
  }
  const emptyEl = document.getElementById('gacha-results-empty');
  if (emptyEl && document.getElementById('gacha-results-area')?.querySelectorAll('.gacha-results-item').length === 0) {
    emptyEl.textContent = state.hasFreeGacha
      ? 'No birds adopted yet. Your first adoption is free!'
      : 'No birds adopted yet.';
  }
}

function hideGachaResultsSection(): void {
  const section = document.getElementById('gacha-results-section');
  if (!section) return;
  section.classList.add('gacha-results-section--hidden');
}

function showGachaResultsSection(): void {
  const section = document.getElementById('gacha-results-section');
  if (!section) return;
  section.classList.remove('gacha-results-section--hidden');
}

/** Adoptタブを離れたときにガチャ結果エリアを空にし、枠を非表示にする */
function clearGachaResultsArea(): void {
  const area = document.getElementById('gacha-results-area');
  if (!area) return;
  area.querySelectorAll('.gacha-results-item').forEach((el) => el.remove());
  area.querySelectorAll('.gacha-results-empty').forEach((el) => el.remove());
  const empty = document.createElement('p');
  empty.className = 'gacha-results-empty';
  empty.id = 'gacha-results-empty';
  empty.textContent = 'No birds adopted yet. Your first adoption is free!';
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
  const cost10 = 10 * GACHA_COST;
  const bal = GameStore.birdCurrency;

  const btn1 = document.getElementById('shell-gacha-1') as HTMLButtonElement | null;
  const btn10 = document.getElementById('shell-gacha-10') as HTMLButtonElement | null;
  const cost1El = document.getElementById('gacha-cost-1');
  const cost10El = document.getElementById('gacha-cost-10');

  if (btn1) btn1.textContent = 'Adopt 1x';
  if (btn10) btn10.textContent = 'Adopt 10x';

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

/** ガチャ結果をモーダルで表示（スマホでも見切れない）。閉じたらメインエリアにも同じ結果を表示する */
function showGachaResultModal(
  birds: { rarity: string }[],
  count: 1 | 10
): void {
  const backdrop = document.getElementById('gacha-result-modal-backdrop');
  const modalArea = document.getElementById('gacha-result-modal-area');
  const modalFeedback = document.getElementById('gacha-result-modal-feedback');
  const modalConfettiWrap = document.getElementById('gacha-result-modal-confetti-wrap');
  if (!backdrop || !modalArea) return;

  const modal = backdrop.querySelector<HTMLElement>('.gacha-result-modal');
  modal?.classList.toggle('gacha-result-modal--ten', birds.length === 10);

  modalArea.innerHTML = '';
  modalArea.classList.toggle('gacha-results-area--single', birds.length === 1);
  if (modalFeedback) modalFeedback.textContent = '';
  if (modalConfettiWrap) modalConfettiWrap.innerHTML = '';

  const opening = document.createElement('div');
  opening.className = 'gacha-opening';
  opening.textContent = 'Opening…';
  modalArea.appendChild(opening);

  backdrop.classList.add('visible');
  backdrop.setAttribute('aria-hidden', 'false');

  const REVEAL_DELAY_MS = 220;
  const OPENING_MS = 550;

  window.setTimeout(() => {
    opening.remove();

    if (modalConfettiWrap && birds.length > 0) {
      const colors = ['#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6'];
      for (let i = 0; i < 12; i++) {
        const dot = document.createElement('div');
        dot.className = 'gacha-confetti';
        dot.style.left = `${10 + Math.random() * 80}%`;
        dot.style.top = '10px';
        dot.style.background = colors[i % colors.length];
        dot.style.animationDelay = `${Math.random() * 0.2}s`;
        modalConfettiWrap.appendChild(dot);
      }
      window.setTimeout(() => {
        modalConfettiWrap.innerHTML = '';
      }, 1500);
    }

    const useCells = birds.length === 10;
    const cells: HTMLElement[] = [];
    if (useCells) {
      for (let i = 0; i < 10; i++) {
        const cell = document.createElement('div');
        cell.className = 'gacha-results-cell';
        modalArea.appendChild(cell);
        cells.push(cell);
      }
    }

    birds.forEach((bird, index) => {
      window.setTimeout(() => {
        const img = document.createElement('img');
        img.className = `gacha-results-item gacha-results-item--${bird.rarity.toLowerCase()}`;
        img.src = RARITY_IMAGE_SRC[bird.rarity as keyof typeof RARITY_IMAGE_SRC];
        img.alt = bird.rarity;
        img.loading = 'lazy';
        const scrollTarget = useCells && cells[index] ? cells[index] : img;
        if (useCells && cells[index]) {
          cells[index].appendChild(img);
        } else {
          modalArea.appendChild(img);
        }
        if (birds.length === 10) {
          scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }

        if (index === 0 && modalFeedback) {
          modalFeedback.textContent = count === 1
            ? `You got ${bird.rarity}!`
            : 'You got 10 birds!';
        }
      }, index * REVEAL_DELAY_MS);
    });
  }, OPENING_MS);
}

function closeGachaResultModal(): void {
  const backdrop = document.getElementById('gacha-result-modal-backdrop');
  const modalArea = document.getElementById('gacha-result-modal-area');
  const mainArea = document.getElementById('gacha-results-area');
  if (!backdrop || !modalArea) return;

  backdrop.classList.remove('visible');
  backdrop.setAttribute('aria-hidden', 'true');
  const modal = backdrop.querySelector<HTMLElement>('.gacha-result-modal');
  modal?.classList.remove('gacha-result-modal--ten');

  const items = modalArea.querySelectorAll('.gacha-results-item');
  if (mainArea && items.length > 0) {
    mainArea.querySelectorAll('.gacha-results-empty').forEach((el) => el.remove());
    mainArea.querySelectorAll('.gacha-results-item').forEach((el) => el.remove());
    items.forEach((img) => {
      const clone = img.cloneNode(true) as HTMLImageElement;
      mainArea.appendChild(clone);
    });
    showGachaResultsSection();
  }

  modalArea.innerHTML = '';
}

/** ガチャタブの「1回回す」「10回回す」から呼ぶ。引いた鳥をモーダルで表示し、閉じたらメインエリアにも表示。 */
function runGachaFromDom(count: 1 | 10): void {
  if (gachaInProgress) return;
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
  const cost =
    count === 1
      ? Math.max(0, 1 - freePulls) * GACHA_COST
      : 10 * GACHA_COST;
  const bal = GameStore.birdCurrency;

  if (cost > 0 && bal < cost) {
    window.alert(`Insufficient $BIRD balance. You need ${cost} $BIRD. (Balance: ${bal} $BIRD)`);
    return;
  }

  gachaInProgress = true;
  setGachaButtonsDisabled(true);
  let ok = true;
  if (cost === 0) {
    ok = window.confirm(`Use your free adoption to adopt ${count === 1 ? '1 bird' : `${count} birds`}?`);
  } else {
    ok = window.confirm(`Spend ${cost} $BIRD to adopt ${count === 1 ? '1 bird' : `${count} birds`}? (Balance: ${bal} $BIRD)`);
  }
  if (!ok) {
    setGachaButtonsDisabled(false);
    gachaInProgress = false;
    return;
  }

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
    setGachaButtonsDisabled(false);
    gachaInProgress = false;
    return;
  }

  if (step === 'need_gacha' && count === 1) {
    GameStore.setState({ onboardingStep: 'need_place' });
    GameStore.save();
    switchToTab('deck');
  }

  area.querySelectorAll('.gacha-results-empty').forEach((el) => el.remove());
  area.querySelectorAll('.gacha-results-item').forEach((el) => el.remove());

  showGachaResultModal(result.birds, count);

  updateAdoptPane();
  updateAdoptPaneForOnboarding();
  updateGachaButtonsAndCosts();
  updateDeckPaneVisibility();

  gachaInProgress = false;
  setGachaButtonsDisabled(false);
  updateAdoptPaneForOnboarding(); // 10x無効などオンボーディング状態を再適用

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
      if (level < 1 || level > MAX_LOFT_LEVEL) return;
      GameStore.setState({
        loftLevel: level,
        unlockedDeckCount: level * 2,
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
let gachaInProgress = false;
let disconnectCallback: (() => void) | null = null;

function setGachaButtonsDisabled(disabled: boolean): void {
  const gacha1 = document.getElementById('shell-gacha-1') as HTMLButtonElement | null;
  const gacha10 = document.getElementById('shell-gacha-10') as HTMLButtonElement | null;
  if (gacha1) gacha1.disabled = disabled;
  if (gacha10) gacha10.disabled = disabled;
}

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
  const resultModalClose = document.getElementById('gacha-result-modal-close');
  const resultModalBackdrop = document.getElementById('gacha-result-modal-backdrop');
  if (resultModalClose) resultModalClose.addEventListener('click', closeGachaResultModal);
  if (resultModalBackdrop) {
    resultModalBackdrop.addEventListener('click', (e) => {
      if (e.target === resultModalBackdrop) closeGachaResultModal();
    });
  }
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
