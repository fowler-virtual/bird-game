/**
 * HyperFarm-style DOM shell: header, tabs, status cards.
 * Shown after wallet connect; tab clicks drive Phaser scene/screen.
 */

import { GameStore, GACHA_COST } from './store/GameStore';
import { getProductionRatePerHour, getNetworkSharePercent, MAX_LOFT_LEVEL, RARITY_COLUMN_ORDER, RARITY_DROP_RATES } from './types';
import { refreshSeedTokenFromChain, burnSeedForAction } from './seedToken';
import { requestClaim, signInForClaim, postClaimConfirm } from './claimApi';
import { getGameState } from './gameStateApi';
import type { ClaimSignature } from './claimApi';
import { executeClaim } from './rewardClaim';
import { requestAccounts, revokeWalletPermissions } from './wallet';
import { showTitleUI } from './titleUI';
import { destroyPhaserGame } from './phaserBoot';
import {
  hasNetworkStateContract,
  refreshNetworkStateFromChain,
  getSeedPerDayFromChain,
  getNetworkSharePercentFromChain,
  getCachedShareBps,
  getCachedLevelCounts,
  getCachedRarityCounts,
  addRarityCountsOnChain,
  getNetworkStateFetchError,
  clearNetworkStateCache,
  getCachedPower,
  fetchMyPower,
  fetchMyShareBps,
  fetchLevelCountsStrict,
  fetchGlobalRarityCountsStrict,
  getLastAddRarityResult,
  getLastUpdatePowerResult,
} from './networkState';

/** リセット後は SAVE するまでステータスカードにオンチェーン値を出さない（sessionStorage） */
const SUPPRESS_CHAIN_DISPLAY_KEY = 'bird-game-suppress-chain-display';
export function clearSuppressChainDisplay(): void {
  try {
    sessionStorage.removeItem(SUPPRESS_CHAIN_DISPLAY_KEY);
  } catch (_) {}
}

const STATUS_CLAIM_BTN_ID = 'status-claim-btn';
const FARMING_ACCRUAL_HINT_ID = 'farming-accrual-hint';
import * as farmingView from './views/farmingView';
import * as deckView from './views/deckView';
import { RARITY_IMAGE_SRC } from './assets';

/** ガチャエフェクト用: レアリティの「強さ」順（高いほど強い） */
const RARITY_RANK: Record<string, number> = {
  Common: 0,
  Uncommon: 1,
  Rare: 2,
  Epic: 3,
  Legendary: 4,
};
/** 紙吹雪の累積パレット（レアリティが上がるごとにこの順で色が増えていく） */
const CONFETTI_PALETTE_BY_TIER: string[] = [
  '#94a3b8', '#cbd5e1', // Common
  '#22c55e', '#4ade80', // Uncommon
  '#3b82f6', '#60a5fa', // Rare
  '#a855f7', '#c084fc', // Epic
  '#eab308', '#fde047', // Legendary
];
const CONFETTI_COLORS_PER_TIER = 2;

/** レアリティに応じた紙吹雪の色リスト（ランクが高いほど色数が多い） */
function getConfettiColorsForRarity(rarity: string): string[] {
  const rank = RARITY_RANK[rarity] ?? 0;
  const count = (rank + 1) * CONFETTI_COLORS_PER_TIER;
  return CONFETTI_PALETTE_BY_TIER.slice(0, Math.min(count, CONFETTI_PALETTE_BY_TIER.length));
}

const SHELL_ID = 'game-shell';
const TAB_ACTIVE = 'active';

/** 同期ステータス表示用（取得/保存の結果） */
let _syncGet: 'ok' | 'fail' | null = null;
let _syncPut: 'ok' | 'fail' | null = null;
function updateSyncStatusEl(): void {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const parts: string[] = [];
  if (_syncGet === 'ok') parts.push('取得: OK');
  else if (_syncGet === 'fail') parts.push('取得: 未認証');
  if (_syncPut === 'ok') parts.push('保存: OK');
  else if (_syncPut === 'fail') parts.push('保存: 失敗');
  el.textContent = parts.length ? parts.join('  ') : '';
}
/** Connect 直後の getGameState 結果を表示用に渡す（titleUI から呼ぶ） */
export function setSyncStatusGet(r: 'ok' | 'fail'): void {
  _syncGet = r;
  updateSyncStatusEl();
}

function getShell(): HTMLElement | null {
  return document.getElementById(SHELL_ID);
}

const CANVAS_CARD_ID = 'shell-canvas-card';
const CANVAS_HIDDEN_CLASS = 'canvas-card-hidden';
const CANVAS_DECK_VIEW_CLASS = 'canvas-card-deck-view';

/** 切り分け用: 直前のタブ（Adopt から戻ったか判定用） */
let lastTabId = '';
/** モーダル表示中のガチャ結果（×で早期に閉じたときに全件をメインエリアへ反映する用） */
let lastGachaModalBirds: { rarity: string }[] = [];
const DEBUG_LAYOUT = true;
/** ガチャの流れをコンソールに出す（原因究明用）。本番では false に。 */
const DEBUG_GACHA = true;
function gachaLog(msg: string, data?: unknown): void {
  if (DEBUG_GACHA && typeof console !== 'undefined' && console.log) {
    if (data !== undefined) console.log('[Gacha]', msg, data);
    else console.log('[Gacha]', msg);
  }
}

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
  const hideCanvas = tabId === 'adopt' || tabId === 'debug' || tabId === 'farming' || tabId === 'deck' || tabId === 'network';
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
    refreshNetworkStateFromChain().then(() => farmingView.refresh());
  }
  if (tabId === 'adopt') {
    hideGachaResultsSection();
    updateAdoptPane();
    updateGachaButtonsAndCosts();
    updateAdoptPaneForOnboarding();
    updateAdoptOnboardingOverlay(true);
    refreshSeedTokenFromChain().then(() => {
      updateAdoptPane();
      updateGachaButtonsAndCosts();
      updateAdoptPaneForOnboarding();
    });
    // 初回表示で白枠が縮む問題: レイアウト確定後にリフロー＋resize 発火で再計算（リサイズ時は自然に直るのを初回でも再現）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const card = document.getElementById('adopt-cta-card');
        const pane = document.getElementById('pane-adopt');
        if (card) void card.offsetHeight;
        if (pane) void pane.offsetHeight;
        window.dispatchEvent(new Event('resize'));
      });
    });
  } else {
    updateAdoptOnboardingOverlay(false);
  }
  if (tabId === 'deck') {
    updateDeckPaneVisibility();
    deckView.refresh();
    farmingView.updateSaveWrapVisibility();
    updateDeckOnboardingPlaceOverlay();
  }
  if (tabId === 'network') {
    refreshNetworkStateFromChain().then(() => refreshNetworkStats());
  }
  updateTabsForOnboarding();
}

/** オンボーディング状態に応じてタブのロックを更新。Deck で鳥を置いた直後にも呼ぶ */
export function updateTabsForOnboarding(): void {
  const step = GameStore.state.onboardingStep;
  const lockFarming = step === 'need_gacha' || step === 'need_place' || step === 'need_save';
  const lockExceptDeck = step === 'need_place' || step === 'need_save';
  const tabs = [
    { id: 'farming', lock: lockFarming },
    { id: 'adopt', lock: step === 'need_gacha' || lockExceptDeck },
    { id: 'deck', lock: false },
    { id: 'network', lock: lockExceptDeck },
    { id: 'debug', lock: false },
  ];
  tabs.forEach(({ id, lock }) => {
    const tab = document.querySelector(`.shell-tab[data-tab="${id}"]`);
    if (tab) {
      tab.classList.toggle('onboarding-tab-locked', lock);
      tab.setAttribute('aria-disabled', lock ? 'true' : 'false');
    }
  });
}

function onTabClick(e: Event): void {
  const target = (e.target as HTMLElement).closest('.shell-tab');
  if (!target) return;
  const tabId = target.getAttribute('data-tab');
  if (!tabId) return;
  if (target.classList.contains('onboarding-tab-locked')) return;
  const step = GameStore.state.onboardingStep;
  if (step === 'need_gacha' && tabId !== 'adopt' && tabId !== 'debug') return;
  if ((step === 'need_place' || step === 'need_save') && tabId !== 'deck' && tabId !== 'debug') return;
  if (tabId === 'farming' && (step === 'need_gacha' || step === 'need_place' || step === 'need_save')) return;
  switchToTab(tabId);
}

/** Adoptタブ用: 残高・Total adopted・レアリティプレビュー・初回無料バッジを更新 */
function updateAdoptPane(): void {
  const state = GameStore.state;
  const balanceEl = document.getElementById('adopt-balance-value');
  if (balanceEl) balanceEl.textContent = String(GameStore.seedToken);
  const totalEl = document.getElementById('adopt-total-count');
  if (totalEl) totalEl.textContent = String(state.birdsOwned.length);
  const badgeEl = document.getElementById('adopt-free-badge');
  const badgeRow = document.getElementById('gacha-cta-badge-row');
  if (badgeEl && badgeRow) {
    if (isFirstAdoptionFree()) {
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
  clearInsufficientBalanceMessage();
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

let deckOnboardingResizeHandler: (() => void) | null = null;

const DECK_ONBOARDING_MESSAGE_GAP = 10;
const DECK_ONBOARDING_MESSAGE_FALLBACK_HEIGHT = 56;

function positionDeckOnboardingMessageAboveInventory(): void {
  const placeOverlay = document.getElementById('deck-onboarding-place-overlay');
  const overlayDim = document.getElementById('deck-onboarding-place-overlay-dim');
  const messageWrap = document.getElementById('deck-onboarding-place-message-wrap');
  const inventorySection = document.getElementById('inventory-section');
  if (!placeOverlay || !overlayDim || !messageWrap || !inventorySection || !placeOverlay.classList.contains('visible')) return;
  const overlayRect2 = placeOverlay.getBoundingClientRect();
  const toOverlayTop2 = (y: number) => y - overlayRect2.top;
  const toOverlayLeft2 = (x: number) => x - overlayRect2.left;
  const invRect = inventorySection.getBoundingClientRect();
  const ow2 = overlayRect2.width;
  const oh2 = overlayRect2.height;
  let dTop = toOverlayTop2(invRect.top);
  let dLeft = toOverlayLeft2(invRect.left);
  let dW = invRect.width;
  let dH = invRect.height;
  dTop = Math.max(0, Math.min(dTop, oh2 - 1));
  dLeft = Math.max(0, Math.min(dLeft, ow2 - 1));
  dW = Math.max(0, Math.min(dW, ow2 - dLeft));
  dH = Math.max(0, Math.min(dH, oh2 - dTop));
  overlayDim.style.top = `${dTop}px`;
  overlayDim.style.left = `${dLeft}px`;
  overlayDim.style.width = `${dW}px`;
  overlayDim.style.height = `${dH}px`;
  const wrapRect = messageWrap.getBoundingClientRect();
  const wrapHeight = wrapRect.height > 0 ? wrapRect.height : DECK_ONBOARDING_MESSAGE_FALLBACK_HEIGHT;
  let top = dTop - wrapHeight - DECK_ONBOARDING_MESSAGE_GAP;
  top = Math.max(8, top);
  const left = dLeft + dW / 2;
  messageWrap.style.top = `${top}px`;
  messageWrap.style.left = `${left}px`;
  messageWrap.style.transform = 'translateX(-50%)';
}

/** need_save 時: SAVE ボタンだけ穴あき（それ以外は暗転）、メッセージは SAVE ボタン上に白字でゆらゆら */
function positionDeckOnboardingMessageForNeedSave(): void {
  const placeOverlay = document.getElementById('deck-onboarding-place-overlay');
  const overlayDim = document.getElementById('deck-onboarding-place-overlay-dim');
  const messageWrap = document.getElementById('deck-onboarding-place-message-wrap');
  const saveWrap = document.getElementById('loft-save-wrap');
  const saveBtn = document.getElementById('status-save-deck-btn') as HTMLButtonElement | null;
  if (!placeOverlay || !overlayDim || !messageWrap || !saveWrap || !saveBtn || !placeOverlay.classList.contains('visible')) return;

  const overlayRect = placeOverlay.getBoundingClientRect();
  const toOverlayTop = (y: number) => y - overlayRect.top;
  const toOverlayLeft = (x: number) => x - overlayRect.left;

  // 白抜き（穴）のサイズは SAVE ボタンよりわずかに大きく（矢印とかぶらない程度）。オーバーレイ内にクランプ。
  const SAVE_CUTOUT_PADDING = 12;
  const saveRect = saveBtn.getBoundingClientRect();
  const ow = overlayRect.width;
  const oh = overlayRect.height;
  let dTop = toOverlayTop(saveRect.top) - SAVE_CUTOUT_PADDING;
  let dLeft = toOverlayLeft(saveRect.left) - SAVE_CUTOUT_PADDING;
  let dW = Math.max(0, saveRect.width) + 2 * SAVE_CUTOUT_PADDING;
  let dH = Math.max(0, saveRect.height) + 2 * SAVE_CUTOUT_PADDING;
  dTop = Math.max(0, Math.min(dTop, oh - 1));
  dLeft = Math.max(0, Math.min(dLeft, ow - 1));
  dW = Math.max(0, Math.min(dW, ow - dLeft));
  dH = Math.max(0, Math.min(dH, oh - dTop));
  overlayDim.style.left = `${dLeft}px`;
  overlayDim.style.top = `${dTop}px`;
  overlayDim.style.width = `${dW}px`;
  overlayDim.style.height = `${dH}px`;

  const wrapHeight = messageWrap.getBoundingClientRect().height || DECK_ONBOARDING_MESSAGE_FALLBACK_HEIGHT;
  const msgTop = dTop - wrapHeight - DECK_ONBOARDING_MESSAGE_GAP;
  messageWrap.style.top = `${Math.max(8, msgTop)}px`;
  messageWrap.style.left = `${dLeft + dW / 2}px`;
  messageWrap.style.transform = 'translateX(-50%)';

  const msgEl = messageWrap.querySelector('.deck-onboarding-place-message');
  const pointerEl = messageWrap.querySelector('.deck-onboarding-place-pointer');
  const innerEl = messageWrap.querySelector('.deck-onboarding-place-message-inner');
  if (msgEl) msgEl.textContent = 'Press the SAVE button below.';
  if (pointerEl) (pointerEl as HTMLElement).textContent = '↓';
  if (innerEl) innerEl.classList.add('deck-onboarding-message-wobble');
}

/** need_place / need_save 時にオーバーレイを表示。need_place=インベントリ穴、need_save=SAVEボタンのみ穴。タブ切替時と SAVE 成功後のクリア用に export */
export function updateDeckOnboardingPlaceOverlay(): void {
  const step = GameStore.state.onboardingStep;
  const show = step === 'need_place' || step === 'need_save';
  const placeOverlay = document.getElementById('deck-onboarding-place-overlay');
  const messageWrap = document.getElementById('deck-onboarding-place-message-wrap');
  const messageInner = document.querySelector('.deck-onboarding-place-message-inner');

  if (deckOnboardingResizeHandler) {
    window.removeEventListener('resize', deckOnboardingResizeHandler);
    deckOnboardingResizeHandler = null;
  }

  if (placeOverlay) {
    placeOverlay.classList.toggle('visible', show);
    placeOverlay.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (show) {
      placeOverlay.style.top = '0';
      placeOverlay.style.bottom = '0';
    } else {
      const dim = document.getElementById('deck-onboarding-place-overlay-dim');
      if (dim) {
        dim.style.top = '';
        dim.style.left = '';
        dim.style.width = '';
        dim.style.height = '';
      }
      placeOverlay.style.width = '';
      placeOverlay.style.left = '';
      placeOverlay.style.right = '';
      placeOverlay.style.top = '';
      placeOverlay.style.bottom = '';
      if (messageInner) messageInner.classList.remove('deck-onboarding-message-wobble');
      const msgEl = document.querySelector('.deck-onboarding-place-message');
      if (msgEl) msgEl.textContent = 'Tap the bird you want to place on the Loft.';
    }
  }
  if (!show || !placeOverlay || !messageWrap) return;

  if (step === 'need_place') {
    const msgEl = document.querySelector('.deck-onboarding-place-message');
    if (msgEl) msgEl.textContent = 'Tap the bird you want to place on the Loft.';
    if (messageInner) messageInner.classList.remove('deck-onboarding-message-wobble');
    const runPosition = (): void => {
      requestAnimationFrame(() => {
        requestAnimationFrame(positionDeckOnboardingMessageAboveInventory);
      });
    };
    runPosition();
    deckOnboardingResizeHandler = runPosition;
    window.addEventListener('resize', deckOnboardingResizeHandler);
  } else {
    const msgEl = document.querySelector('.deck-onboarding-place-message');
    if (msgEl) msgEl.textContent = 'Press the SAVE button below.';
    if (messageInner) messageInner.classList.add('deck-onboarding-message-wobble');
    const runPosition = (): void => {
      requestAnimationFrame(() => {
        requestAnimationFrame(positionDeckOnboardingMessageForNeedSave);
      });
    };
    runPosition();
    deckOnboardingResizeHandler = runPosition;
    window.addEventListener('resize', deckOnboardingResizeHandler);
  }
}

let adoptOnboardingResizeHandler: (() => void) | null = null;

const ADOPT_ONBOARDING_MESSAGE_GAP = 10;
const ADOPT_ONBOARDING_MESSAGE_FALLBACK_HEIGHT = 48;

function positionAdoptOnboardingOverlay(): void {
  const overlay = document.getElementById('adopt-onboarding-overlay');
  const spotlight = document.getElementById('adopt-onboarding-dim-spotlight');
  const messageWrap = document.getElementById('adopt-onboarding-message-wrap');
  const adoptCtaCard = document.getElementById('adopt-cta-card');
  if (!overlay || !spotlight || !messageWrap || !adoptCtaCard || !overlay.classList.contains('visible')) return;
  const overlayRect = overlay.getBoundingClientRect();
  const ctaRect = adoptCtaCard.getBoundingClientRect();
  const toOverlayTop = (y: number) => y - overlayRect.top;
  const toOverlayLeft = (x: number) => x - overlayRect.left;
  // Adopt ボックスと白抜きをできるだけ一致させるためわずかに余白を付与
  const ADOPT_CUTOUT_PADDING = 8;
  const ow = overlayRect.width;
  const oh = overlayRect.height;
  let sTop = toOverlayTop(ctaRect.top) - ADOPT_CUTOUT_PADDING;
  let sLeft = toOverlayLeft(ctaRect.left) - ADOPT_CUTOUT_PADDING;
  let sW = ctaRect.width + 2 * ADOPT_CUTOUT_PADDING;
  let sH = ctaRect.height + 2 * ADOPT_CUTOUT_PADDING;
  sTop = Math.max(0, Math.min(sTop, oh - 1));
  sLeft = Math.max(0, Math.min(sLeft, ow - 1));
  sW = Math.max(0, Math.min(sW, ow - sLeft));
  sH = Math.max(0, Math.min(sH, oh - sTop));
  spotlight.style.top = `${sTop}px`;
  spotlight.style.left = `${sLeft}px`;
  spotlight.style.width = `${sW}px`;
  spotlight.style.height = `${sH}px`;
  const wrapRect = messageWrap.getBoundingClientRect();
  const wrapHeight = wrapRect.height > 0 ? wrapRect.height : ADOPT_ONBOARDING_MESSAGE_FALLBACK_HEIGHT;
  let top = sTop - wrapHeight - ADOPT_ONBOARDING_MESSAGE_GAP;
  const statusPanel = document.getElementById('status-panel');
  if (statusPanel) {
    const statusBottom = statusPanel.getBoundingClientRect().bottom;
    const minTop = toOverlayTop(statusBottom) + 8;
    top = Math.max(minTop, top);
  }
  top = Math.max(12, top);
  const left = sLeft + sW / 2;
  messageWrap.style.top = `${top}px`;
  messageWrap.style.left = `${left}px`;
  messageWrap.style.transform = 'translateX(-50%)';
}

/** need_gacha 時に Adopt タブで ADOPTION 強調・全面暗転（カードだけ穴あき）・メッセージ＋矢印を表示。Adopt タブでないときは常に非表示。 */
function updateAdoptOnboardingOverlay(adoptTabActive?: boolean): void {
  const step = GameStore.state.onboardingStep;
  const show = (adoptTabActive !== false) && step === 'need_gacha';
  const overlay = document.getElementById('adopt-onboarding-overlay');
  const spotlight = document.getElementById('adopt-onboarding-dim-spotlight');

  if (adoptOnboardingResizeHandler) {
    window.removeEventListener('resize', adoptOnboardingResizeHandler);
    adoptOnboardingResizeHandler = null;
  }

  if (overlay) {
    overlay.classList.toggle('visible', show);
    overlay.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (!show) {
      overlay.style.width = '';
      overlay.style.left = '';
      overlay.style.right = '';
      overlay.style.top = '';
      overlay.style.bottom = '';
      if (spotlight) {
        spotlight.style.top = '';
        spotlight.style.left = '';
        spotlight.style.width = '';
        spotlight.style.height = '';
      }
    }
  }
  if (!show || !overlay) return;

  const runPosition = (): void => {
    requestAnimationFrame(() => {
      requestAnimationFrame(positionAdoptOnboardingOverlay);
    });
  };
  runPosition();
  adoptOnboardingResizeHandler = runPosition;
  window.addEventListener('resize', adoptOnboardingResizeHandler);
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

/** 初回 adoption（1x）を無料とするか。hasFreeGacha またはまだ1羽も持っていない場合は無料扱い。 */
function isFirstAdoptionFree(): boolean {
  const state = GameStore.state;
  if (state.hasFreeGacha) return true;
  return state.birdsOwned.length === 0;
}

function updateGachaButtonsAndCosts(): void {
  const freeFirst = isFirstAdoptionFree();
  const cost1 = freeFirst ? 0 : GACHA_COST;
  const cost10 = 10 * GACHA_COST;
  const bal = GameStore.seedToken;

  const btn1 = document.getElementById('shell-gacha-1') as HTMLButtonElement | null;
  const btn10 = document.getElementById('shell-gacha-10') as HTMLButtonElement | null;
  const cost1El = document.getElementById('gacha-cost-1');
  const cost10El = document.getElementById('gacha-cost-10');

  if (btn1) btn1.textContent = 'Adopt 1x';
  if (btn10) btn10.textContent = 'Adopt 10x';

  if (cost1El) {
    if (freeFirst) cost1El.textContent = 'Cost: Free (first adoption)';
    else if (bal < cost1) cost1El.textContent = `Cost: ${cost1} $SEED (you have ${bal})`;
    else cost1El.textContent = `Cost: ${cost1} $SEED`;
    cost1El.classList.toggle('gacha-cost-insufficient', bal < cost1);
  }
  if (bal >= cost1 && bal >= cost10) clearInsufficientBalanceMessage();
  if (cost10El) {
    if (bal < cost10) cost10El.textContent = `Cost: ${cost10} $SEED (you have ${bal})`;
    else cost10El.textContent = `Cost: ${cost10} $SEED`;
    cost10El.classList.toggle('gacha-cost-insufficient', bal < cost10);
  }
}

/** 残高不足メッセージを Adoption ボックス内（コスト表示の下）にテキストのみで表示 */
function showInsufficientBalanceMessage(): void {
  const el = document.getElementById('gacha-insufficient-message');
  if (!el) return;
  el.textContent = 'Not enough $SEED.';
}

/** 残高不足メッセージを消す（残高が足りる場合やガチャ成功時など） */
function clearInsufficientBalanceMessage(): void {
  const el = document.getElementById('gacha-insufficient-message');
  if (el) el.textContent = '';
}

/** 表示エフェクトに使うレアリティ（1引き＝その1羽、10引き＝一番強いレアリティ） */
function getEffectRarity(birds: { rarity?: string }[]): string {
  if (birds.length === 0) return 'Common';
  const first = birds[0].rarity;
  if (birds.length === 1) return typeof first === 'string' && RARITY_RANK[first] !== undefined ? first : 'Common';
  let best: string = typeof first === 'string' && RARITY_RANK[first] !== undefined ? first : 'Common';
  for (let i = 1; i < birds.length; i++) {
    const r = birds[i].rarity;
    if (typeof r === 'string' && (RARITY_RANK[r] ?? -1) > (RARITY_RANK[best] ?? -1)) best = r;
  }
  return best;
}

/** ガチャ結果モーダル用: バックドロップを body 直下に移して確実に最前面に表示する */
function moveGachaModalToBody(): void {
  const backdrop = document.getElementById('gacha-result-modal-backdrop');
  if (!backdrop || backdrop.parentElement === document.body) return;
  document.body.appendChild(backdrop);
}

/** ガチャ結果モーダル用: バックドロップを shell 内の元の位置に戻す */
function moveGachaModalBackToShell(): void {
  const backdrop = document.getElementById('gacha-result-modal-backdrop');
  const container = document.getElementById('shell-content-inner');
  const before = document.getElementById('shell-canvas-card');
  if (!backdrop || backdrop.parentElement !== document.body) return;
  if (container && before) container.insertBefore(backdrop, before);
  else if (container) container.appendChild(backdrop);
}

/** モーダルが使えない環境用：結果をメインの Adopted birds エリアに直接表示する */
function appendGachaResultToMainArea(birds: { rarity: string }[]): void {
  const mainArea = document.getElementById('gacha-results-area');
  if (!mainArea) return;
  mainArea.querySelectorAll('.gacha-results-empty').forEach((el) => el.remove());
  mainArea.querySelectorAll('.gacha-results-item').forEach((el) => el.remove());
  birds.forEach((bird) => {
    const img = document.createElement('img');
    img.className = `gacha-results-item gacha-results-item--${bird.rarity.toLowerCase()}`;
    img.src = RARITY_IMAGE_SRC[bird.rarity as keyof typeof RARITY_IMAGE_SRC];
    img.alt = bird.rarity;
    img.loading = 'lazy';
    mainArea.appendChild(img);
  });
  showGachaResultsSection();
}

/** ガチャ結果をモーダルで表示（スマホでも見切れない）。閉じたらメインエリアにも同じ結果を表示する */
function showGachaResultModal(
  birds: { rarity: string }[],
  count: 1 | 10
): void {
  gachaLog('showGachaResultModal entered', { birdsCount: birds.length, count });
  lastGachaModalBirds = birds.slice();
  const backdrop = document.getElementById('gacha-result-modal-backdrop');
  const modalArea = document.getElementById('gacha-result-modal-area');
  const modalFeedback = document.getElementById('gacha-result-modal-feedback');
  const modalConfettiWrap = document.getElementById('gacha-result-modal-confetti-wrap');
  if (!backdrop || !modalArea) {
    gachaLog('BLOCKED: backdrop or modalArea null', { hasBackdrop: !!backdrop, hasModalArea: !!modalArea });
    appendGachaResultToMainArea(birds);
    return;
  }
  gachaLog('moving modal to body and adding visible');
  moveGachaModalToBody();
  backdrop.classList.add('visible');
  backdrop.setAttribute('aria-hidden', 'false');

  const effectRarity = getEffectRarity(birds);
  const confettiColors = getConfettiColorsForRarity(effectRarity);
  const effectRarityKey = effectRarity.toLowerCase();

  const modal = backdrop.querySelector<HTMLElement>('.gacha-result-modal');
  modal?.classList.toggle('gacha-result-modal--ten', birds.length === 10);

  modalArea.innerHTML = '';
  modalArea.classList.toggle('gacha-results-area--single', birds.length === 1);
  if (modalFeedback) modalFeedback.textContent = '';
  if (modalConfettiWrap) {
    modalConfettiWrap.innerHTML = '';
    ['common', 'uncommon', 'rare', 'epic', 'legendary'].forEach((r) =>
      modalConfettiWrap!.classList.remove(`gacha-confetti-wrap--${r}`)
    );
    modalConfettiWrap.classList.add(`gacha-confetti-wrap--${effectRarityKey}`);
  }

  const opening = document.createElement('div');
  opening.className = 'gacha-opening';
  opening.textContent = 'Opening…';
  modalArea.appendChild(opening);

  const REVEAL_DELAY_MS = 220;
  const OPENING_MS = 550;

  window.setTimeout(() => {
    opening.remove();

    if (modalConfettiWrap && birds.length > 0) {
      const numDots = effectRarity === 'Legendary' ? 20 : effectRarity === 'Epic' ? 16 : 12;
      for (let i = 0; i < numDots; i++) {
        const dot = document.createElement('div');
        dot.className = 'gacha-confetti';
        dot.style.left = `${10 + Math.random() * 80}%`;
        dot.style.top = '10px';
        dot.style.background = confettiColors[i % confettiColors.length];
        dot.style.animationDelay = `${Math.random() * 0.2}s`;
        modalConfettiWrap.appendChild(dot);
      }
      window.setTimeout(() => {
        modalConfettiWrap.innerHTML = '';
      }, effectRarity === 'Legendary' ? 2200 : effectRarity === 'Epic' ? 1800 : 1500);
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
        const rarityKey = bird.rarity.toLowerCase();
        const isRarePlus = ['rare', 'epic', 'legendary'].includes(rarityKey);
        const img = document.createElement('img');
        img.className = `gacha-results-item gacha-results-item--${rarityKey}${isRarePlus ? ' gacha-results-item--glow' : ''}`;
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
          modalFeedback.textContent = `You got ${count === 1 ? bird.rarity : effectRarity}!`;
        }
      }, index * REVEAL_DELAY_MS);
    });
  }, OPENING_MS);
}

function closeGachaResultModal(): void {
  const backdrop = document.getElementById('gacha-result-modal-backdrop');
  const modalArea = document.getElementById('gacha-result-modal-area');
  const mainArea = document.getElementById('gacha-results-area');
  const modalConfettiWrap = document.getElementById('gacha-result-modal-confetti-wrap');
  if (!backdrop || !modalArea) return;

  if (modalConfettiWrap) {
    modalConfettiWrap.classList.remove(
      'gacha-confetti-wrap--common',
      'gacha-confetti-wrap--uncommon',
      'gacha-confetti-wrap--rare',
      'gacha-confetti-wrap--epic',
      'gacha-confetti-wrap--legendary'
    );
  }
  backdrop.classList.remove('visible');
  backdrop.setAttribute('aria-hidden', 'true');
  const modal = backdrop.querySelector<HTMLElement>('.gacha-result-modal');
  modal?.classList.remove('gacha-result-modal--ten');

  if (mainArea && lastGachaModalBirds.length > 0) {
    appendGachaResultToMainArea(lastGachaModalBirds);
  }
  lastGachaModalBirds = [];
  modalArea.innerHTML = '';
  moveGachaModalBackToShell();
}

/** 初回 Loft 配置完了時: モーダル＋レジェンド同様の〇が降るエフェクトを表示。「Go to Farming」で閉じてタブ切り替え。 */
export function showPlaceSuccessModal(): void {
  const backdrop = document.getElementById('place-success-modal-backdrop');
  const confettiWrap = document.getElementById('place-success-modal-confetti-wrap');
  if (!backdrop || !confettiWrap) return;
  backdrop.classList.add('visible');
  backdrop.setAttribute('aria-hidden', 'false');
  confettiWrap.innerHTML = '';
  const confettiColors = getConfettiColorsForRarity('Legendary');
  const numDots = 20;
  for (let i = 0; i < numDots; i++) {
    const dot = document.createElement('div');
    dot.className = 'gacha-confetti';
    dot.style.left = `${10 + Math.random() * 80}%`;
    dot.style.top = '10px';
    dot.style.background = confettiColors[i % confettiColors.length];
    dot.style.animationDelay = `${Math.random() * 0.2}s`;
    confettiWrap.appendChild(dot);
  }
  window.setTimeout(() => {
    confettiWrap.innerHTML = '';
  }, 2200);
}

export function closePlaceSuccessModal(): void {
  const backdrop = document.getElementById('place-success-modal-backdrop');
  if (!backdrop) return;
  backdrop.classList.remove('visible');
  backdrop.setAttribute('aria-hidden', 'true');
  switchToTab('farming');
}

/**
 * 確認→送金(burn)完了→成功時のみ onSuccess 実行の共通フロー。
 * ガチャ・LOFT アップグレードで同じ順序を保証する。
 */
export async function runConfirmBurnThenSuccess(options: {
  getConfirmResult: () => Promise<boolean>;
  amount: number;
  context: 'gacha' | 'loft';
  setProcessingMessage?: (message: string) => void;
  setError?: (message: string) => void;
  onSuccess: () => Promise<void>;
}): Promise<{ ok: true } | { ok: false; error?: string }> {
  const ok = await options.getConfirmResult();
  if (!ok) return { ok: false, error: 'Cancelled' };

  let processingShown = false;
  const showBurnProcessing = () => {
    if (processingShown) return;
    processingShown = true;
    const msg =
      options.context === 'gacha'
        ? 'Burning $SEED for adoption… This may take a few seconds.'
        : 'Burning $SEED for Loft upgrade… This may take a few seconds.';
    showProcessingModal(msg);
    options.setProcessingMessage?.('Waiting for the transaction to be confirmed…');
  };

  if (options.amount > 0) {
    showBurnProcessing();
    const burnResult = await burnSeedForAction(options.amount, options.context);
    if (!burnResult.ok) {
      if (processingShown) hideProcessingModal();
      options.setProcessingMessage?.('');
      options.setError?.(burnResult.error ?? 'Transaction failed.');
      return { ok: false, error: burnResult.error };
    }
    options.setProcessingMessage?.('');
  }

  await options.onSuccess();
  if (processingShown) hideProcessingModal();
  return { ok: true };
}

/** ガチャ実行前の確認をモーダルで表示し、Confirm/Cancel で true/false を返す。 */
function showGachaConfirmModal(count: 1 | 10, cost: number, _bal: number): Promise<boolean> {
  return new Promise((resolve) => {
    const textEl = document.getElementById('gacha-modal-text');
    const backdrop = document.getElementById('gacha-modal-backdrop');
    if (!textEl || !backdrop) {
      resolve(false);
      return;
    }
    const message =
      cost === 0
        ? `Use your free adoption to adopt ${count === 1 ? '1 bird' : `${count} birds`}?`
        : `Spend ${cost} $SEED to adopt ${count === 1 ? '1 bird' : `${count} birds`}?`;
    textEl.textContent = message;
    backdrop.classList.add('visible');
    backdrop.setAttribute('aria-hidden', 'false');

    const finish = (value: boolean) => {
      backdrop.classList.remove('visible');
      backdrop.setAttribute('aria-hidden', 'true');
      cancelBtn?.removeEventListener('click', onCancel);
      confirmBtn?.removeEventListener('click', onConfirm);
      backdrop.removeEventListener('click', onBackdrop);
      resolve(value);
    };

    const cancelBtn = document.getElementById('gacha-modal-cancel');
    const confirmBtn = document.getElementById('gacha-modal-confirm');
    const onCancel = () => finish(false);
    const onConfirm = () => finish(true);
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === backdrop) finish(false);
    };

    cancelBtn?.addEventListener('click', onCancel);
    confirmBtn?.addEventListener('click', onConfirm);
    backdrop.addEventListener('click', onBackdrop);
  });
}

/** SAVE 確認モーダル（ガチャ・Claim と同様の Confirm/Cancel）。Confirm で true、Cancel で false。 */
export function showSaveConfirmModal(): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('gacha-modal-backdrop');
    const titleEl = document.getElementById('gacha-modal-title');
    const textEl = document.getElementById('gacha-modal-text');
    const cancelBtn = document.getElementById('gacha-modal-cancel');
    const confirmBtn = document.getElementById('gacha-modal-confirm');
    if (!backdrop || !textEl) {
      resolve(false);
      return;
    }
    if (titleEl) titleEl.textContent = 'Confirm Save';
    textEl.textContent = 'Save your deck power to the network? This will update your SEED/day and Network Share.';
    backdrop.classList.add('visible');
    backdrop.setAttribute('aria-hidden', 'false');

    const finish = (value: boolean) => {
      backdrop.classList.remove('visible');
      backdrop.setAttribute('aria-hidden', 'true');
      if (titleEl) titleEl.textContent = 'Confirm Adoption';
      cancelBtn?.removeEventListener('click', onCancel);
      confirmBtn?.removeEventListener('click', onConfirm);
      backdrop.removeEventListener('click', onBackdrop);
      resolve(value);
    };

    const onCancel = () => finish(false);
    const onConfirm = () => finish(true);
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === backdrop) finish(false);
    };

    cancelBtn?.addEventListener('click', onCancel);
    confirmBtn?.addEventListener('click', onConfirm);
    backdrop.addEventListener('click', onBackdrop);
  });
}

/** Claim 確認モーダル（ガチャ・LOFT と同様の Confirm/Cancel）。Confirm で true、Cancel で false。 */
function showClaimConfirmModal(amount: number): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('gacha-modal-backdrop');
    const titleEl = document.getElementById('gacha-modal-title');
    const textEl = document.getElementById('gacha-modal-text');
    const cancelBtn = document.getElementById('gacha-modal-cancel');
    const confirmBtn = document.getElementById('gacha-modal-confirm');
    if (!backdrop || !textEl) {
      resolve(false);
      return;
    }
    if (titleEl) titleEl.textContent = 'Confirm Claim';
    textEl.textContent = `Claim ${amount} $SEED? The rewards will be sent to your connected wallet.`;
    backdrop.classList.add('visible');
    backdrop.setAttribute('aria-hidden', 'false');

    const finish = (value: boolean) => {
      backdrop.classList.remove('visible');
      backdrop.setAttribute('aria-hidden', 'true');
      if (titleEl) titleEl.textContent = 'Confirm Adoption';
      cancelBtn?.removeEventListener('click', onCancel);
      confirmBtn?.removeEventListener('click', onConfirm);
      backdrop.removeEventListener('click', onBackdrop);
      resolve(value);
    };

    const onCancel = () => finish(false);
    const onConfirm = () => finish(true);
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === backdrop) finish(false);
    };

    cancelBtn?.addEventListener('click', onCancel);
    confirmBtn?.addEventListener('click', onConfirm);
    backdrop.addEventListener('click', onBackdrop);
  });
}

/** ガチャ確認モーダルと同じ見た目のメッセージモーダル（Claim 成功・LOFT 結果など）。OK で閉じる。 */
export function showMessageModal(options: { title?: string; message: string; success?: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('message-modal-backdrop');
    const titleEl = document.getElementById('message-modal-title');
    const textEl = document.getElementById('message-modal-text');
    const okBtn = document.getElementById('message-modal-ok');
    if (!backdrop || !textEl) {
      resolve();
      return;
    }
    if (titleEl) {
      titleEl.textContent = options.title ?? '';
    }
    textEl.textContent = options.message;
    textEl.classList.remove('message-modal-text--success', 'message-modal-text--error');
    if (options.success === true) textEl.classList.add('message-modal-text--success');
    else if (options.success === false) textEl.classList.add('message-modal-text--error');

    const finish = () => {
      backdrop.classList.remove('visible');
      backdrop.setAttribute('aria-hidden', 'true');
      okBtn?.removeEventListener('click', onOk);
      backdrop.removeEventListener('click', onBackdrop);
      resolve();
    };

    const onOk = () => finish();
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === backdrop) finish();
    };

    backdrop.classList.add('visible');
    backdrop.setAttribute('aria-hidden', 'false');
    okBtn?.addEventListener('click', onOk);
    backdrop.addEventListener('click', onBackdrop);
  });
}

/** 長い処理中（burn 待ち / claim / SAVE 実行中など）のシンプルな Processing モーダル */
export function showProcessingModal(message: string): void {
  const backdrop = document.getElementById('processing-modal-backdrop');
  const textEl = document.getElementById('processing-modal-text');
  if (!backdrop || !textEl) return;
  textEl.textContent = message;
  backdrop.classList.add('visible');
  backdrop.setAttribute('aria-hidden', 'false');
}

export function hideProcessingModal(): void {
  const backdrop = document.getElementById('processing-modal-backdrop');
  if (!backdrop) return;
  backdrop.classList.remove('visible');
  backdrop.setAttribute('aria-hidden', 'true');
}

/** ガチャタブの「1回回す」「10回回す」から呼ぶ。引いた鳥をモーダルで表示し、閉じたらメインエリアにも表示。 */
async function runGachaFromDom(count: 1 | 10): Promise<void> {
  gachaLog('runGachaFromDom called', { count });
  if (gachaInProgress) {
    gachaLog('BLOCKED: gachaInProgress is true');
    return;
  }
  const step = GameStore.state.onboardingStep;
  if (step === 'need_gacha' && count !== 1) {
    gachaLog('BLOCKED: need_gacha and count !== 1', { step, count });
    return;
  }

  if (!GameStore.walletConnected) {
    gachaLog('BLOCKED: wallet not connected');
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

  const freeFirst = isFirstAdoptionFree();
  const cost =
    count === 1
      ? (freeFirst ? 0 : GACHA_COST)
      : 10 * GACHA_COST;
  const bal = GameStore.seedToken;
  gachaLog('cost/balance', { cost, bal, freeFirst });

  if (cost > 0 && bal < cost) {
    gachaLog('BLOCKED: insufficient balance', { cost, bal });
    showInsufficientBalanceMessage();
    return;
  }

  gachaInProgress = true;
  setGachaButtonsDisabled(true);

  const area = document.getElementById('gacha-results-area');
  const setGachaAreaMessage = (message: string) => {
    if (!area) return;
    area.querySelectorAll('.gacha-results-item').forEach((el) => el.remove());
    area.querySelectorAll('.gacha-results-empty').forEach((el) => el.remove());
    const p = document.createElement('p');
    p.className = 'gacha-results-empty';
    p.textContent = message;
    area.appendChild(p);
    showGachaResultsSection();
  };
  const clearGachaAreaMessage = () => {
    if (!area) return;
    area.querySelectorAll('.gacha-results-item').forEach((el) => el.remove());
    area.querySelectorAll('.gacha-results-empty').forEach((el) => el.remove());
  };

  try {
    const runResult = await runConfirmBurnThenSuccess({
      getConfirmResult: () => showGachaConfirmModal(count, cost, bal),
      amount: cost,
      context: 'gacha',
      // 待機中は「Adopted birds」ボックスを出さない（ガチャ結果モーダルが出た後にメインエリアへ反映）
      setProcessingMessage: undefined,
      setError: (msg) => {
        void showMessageModal({ title: 'Adoption failed', message: msg, success: false });
      },
      onSuccess: async () => {
        if (count === 1 && isFirstAdoptionFree() && !GameStore.state.hasFreeGacha) {
          GameStore.setState({ hasFreeGacha: true });
          GameStore.save();
        }
        gachaLog('calling pullGacha', { count });
        const result = GameStore.pullGacha(count);
        gachaLog('pullGacha result', { ok: result.ok, error: result.error, birdsCount: result.birds?.length });

        if (!area) return;
        clearGachaAreaMessage();
        if (!result.ok) {
          setGachaAreaMessage(result.error ?? 'Error');
          return;
        }

        clearInsufficientBalanceMessage();
        // 結果モーダルを出す前にオンチェーン処理をすべて完了する（MetaMask の送金承認が結果より先になるように）
        if (cost > 0) await refreshSeedTokenFromChain();
        const rarityCounts = [0, 0, 0, 0, 0];
        for (const bird of result.birds) {
          const idx = RARITY_COLUMN_ORDER.indexOf(bird.rarity);
          if (idx >= 0 && idx < 5) rarityCounts[idx]++;
        }
        let addRarityTx: { wait: () => Promise<unknown> } | undefined;
        if (rarityCounts.some((c) => c > 0) && hasNetworkStateContract()) {
          const isTransientRpcError = (err: string) =>
            /too many errors|retrying in|RPC endpoint|UNKNOWN_ERROR|-32002|coalesce|network error|ECONNREFUSED|ETIMEDOUT/i.test(err);
          let addResult = await addRarityCountsOnChain(rarityCounts, { waitForConfirmation: false });
          const maxRetries = 2;
          for (let r = 0; r < maxRetries && !addResult.ok && isTransientRpcError(addResult.error ?? ''); r++) {
            gachaLog('addRarityCountsOnChain transient error, retrying', { attempt: r + 2, error: addResult.error });
            await new Promise((res) => setTimeout(res, 1500));
            addResult = await addRarityCountsOnChain(rarityCounts, { waitForConfirmation: false });
          }
          if (addResult.ok && addResult.tx) addRarityTx = addResult.tx;
          if (!addResult.ok) {
            gachaLog('addRarityCountsOnChain failed', addResult.error);
            if (!isTransientRpcError(addResult.error ?? '')) {
              await showMessageModal({
                title: 'Network stats not updated',
                message: addResult.error + ' Redeploy the NetworkState contract (with addRarityCounts / getGlobalRarityCounts) and set VITE_NETWORK_STATE_ADDRESS to see rarity counts on the NETWORK tab.',
                success: false,
              });
            }
          }
        }
        const game = (window as unknown as { __phaserGame?: { scene?: { get?: (k: string) => { events?: { emit?: (e: string) => void } } } } }).__phaserGame;
        game?.scene?.get?.('GameScene')?.events?.emit?.('refresh');
        gachaLog('gacha flow done');
        // 結果モーダルを即表示（addRarityCounts の確定は待たない）
        gachaLog('calling showGachaResultModal', { birdsCount: result.birds.length });
        showGachaResultModal(result.birds, count);
        // 結果モーダル表示後にデッキへ切り替え（初回ガチャで「確認前にインベントリにいる」ように見えないようにする）
        if (step === 'need_gacha' && count === 1) {
          GameStore.setState({ onboardingStep: 'need_place' });
          GameStore.save();
          switchToTab('deck');
        }
        updateAdoptPane();
        updateAdoptPaneForOnboarding();
        updateGachaButtonsAndCosts();
        updateDeckPaneVisibility();
        // ステータス・NETWORKタブの更新はバックグラウンドで実行（モーダル表示をブロックしない）
        const applyStatus = () => {
          const state = GameStore.state;
          updateShellStatus({
            seed: state.seed,
            seedPerDay: getProductionRatePerHour(state) * 24,
            loftLevel: state.loftLevel,
            networkSharePercent: getNetworkSharePercent(state),
          });
          refreshNetworkStats();
        };
        if (addRarityTx) {
          addRarityTx.wait().then(() => refreshNetworkStateFromChain()).then(applyStatus).catch(() => applyStatus());
        } else {
          refreshNetworkStateFromChain().then(applyStatus);
        }
      },
    });

    if (!runResult.ok && runResult.error && runResult.error !== 'Cancelled') {
      setGachaAreaMessage(runResult.error);
    }
  } catch (err) {
    gachaLog('EXCEPTION in gacha flow', err);
    throw err;
  } finally {
    gachaInProgress = false;
    setGachaButtonsDisabled(false);
    updateAdoptPaneForOnboarding();
    gachaLog('finally: reset gachaInProgress and buttons');
  }
}

function emitGameRefresh(): void {
  const game = (window as unknown as { __phaserGame?: { scene?: { get?: (k: string) => { events?: { emit?: (e: string) => void } } } } }).__phaserGame;
  game?.scene?.get?.('GameScene')?.events?.emit?.('refresh');
}

/** Network タブ: オンチェーンのシェア％とLOFTレベル分布を表示。Save/ガチャ後にも呼ぶ。 */
export function refreshNetworkStats(): void {
  const levelList = document.getElementById('network-level-list');
  const distList = document.getElementById('network-dist-list');
  const totalEl = document.getElementById('network-total-birds');
  const demoNote = document.getElementById('network-demo-note');
  const myShareEl = document.getElementById('network-my-share');

  const counts = getCachedLevelCounts();
  const shareBps = getCachedShareBps();
  const totalLevelUsers = counts.reduce((a, b) => a + b, 0);
  const hasContract = hasNetworkStateContract() && GameStore.walletAddress;

  if (myShareEl) {
    if (hasContract && shareBps != null) {
      myShareEl.textContent = `${(shareBps / 100).toFixed(2)}%`;
      myShareEl.closest?.('.network-section')?.classList.remove('hidden');
    } else {
      myShareEl.textContent = '—';
    }
  }

  if (levelList) {
    levelList.innerHTML = '';
    for (let level = 1; level <= 6; level++) {
      const users = counts[level - 1] ?? 0;
      const pct = totalLevelUsers > 0 ? (users / totalLevelUsers) * 100 : 0;
      const row = document.createElement('div');
      row.className = 'network-stat-row';
      row.innerHTML = `
        <span class="network-stat-label">Level ${level}</span>
        <span class="network-stat-count">${users.toLocaleString()}</span>
        <div class="network-stat-bar-wrap">
          <div class="network-stat-bar" style="width: ${pct}%"></div>
        </div>
      `;
      levelList.appendChild(row);
    }
  }

  if (distList) {
    distList.innerHTML = '';
    const rarityNames = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
    const rarityCounts = getCachedRarityCounts();
    const rarityData = rarityNames.map((name, i) => ({ name, count: rarityCounts[i] ?? 0 }));
    const totalBirds = rarityData.reduce((s, d) => s + d.count, 0);
    for (const d of rarityData) {
      const pct = totalBirds > 0 ? (d.count / totalBirds) * 100 : 0;
      const row = document.createElement('div');
      row.className = 'network-stat-row';
      row.innerHTML = `
        <span class="network-stat-label">${d.name}</span>
        <span class="network-stat-count">${d.count.toLocaleString()}</span>
        <div class="network-stat-bar-wrap">
          <div class="network-stat-bar" style="width: ${pct}%"></div>
        </div>
      `;
      distList.appendChild(row);
    }
  }
  if (totalEl) {
    const totalBirds = getCachedRarityCounts().reduce((a, b) => a + b, 0);
    totalEl.textContent = String(totalBirds.toLocaleString());
  }
  if (demoNote) {
    const err = getNetworkStateFetchError();
    const totalBirds = getCachedRarityCounts().reduce((a, b) => a + b, 0);
    if (err) {
      demoNote.textContent = err;
      demoNote.classList.add('network-demo-note--error');
    } else {
      const disclaimer = ' (表示は参考値です。公式の確定値ではありません。)';
      demoNote.textContent = hasContract
        ? (totalBirds === 0
          ? 'On-chain data. Save your deck and pull gacha to update. Redeploy NetworkState (with getGlobalRarityCounts) to see rarity counts.'
          : 'On-chain data. Refresh page to see latest from other users.') + disclaimer
        : 'Connect wallet and deploy NetworkState to see live stats.';
      demoNote.classList.remove('network-demo-note--error');
    }
  }
}

function refreshDebugPane(): void {
  const seedEl = document.getElementById('dom-debug-seed');
  const birdEl = document.getElementById('dom-debug-bird');
  const loftEl = document.getElementById('dom-debug-loft');
  if (seedEl) seedEl.textContent = String(GameStore.state.seed);
  if (birdEl) birdEl.textContent = String(GameStore.seedToken);
  if (loftEl) loftEl.textContent = String(GameStore.state.loftLevel);
  const localPowerEl = document.getElementById('dom-debug-local-power');
  if (localPowerEl) localPowerEl.textContent = String(Math.floor(getProductionRatePerHour(GameStore.state)));
  updateGachaButtonsAndCosts();
  // 直近の書き込み結果は常に表示
  const addRarityEl = document.getElementById('dom-debug-last-addrarity');
  const updatePowerEl = document.getElementById('dom-debug-last-updatepower');
  const ar = getLastAddRarityResult();
  const up = getLastUpdatePowerResult();
  if (addRarityEl) addRarityEl.textContent = ar == null ? '—' : ar.ok ? 'OK' : `失敗: ${ar.error}`;
  if (updatePowerEl) updatePowerEl.textContent = up == null ? '—' : up.ok ? 'OK' : `失敗: ${up.error}`;
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
      const v = window.prompt('$SEED', String(GameStore.seedToken));
      if (v == null) return;
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n) || n < 0) return;
      GameStore.seedToken = n;
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
  const fetchOnchainBtn = document.getElementById('dom-debug-fetch-onchain');
  if (fetchOnchainBtn) {
    fetchOnchainBtn.addEventListener('click', async () => {
      const addr = GameStore.walletAddress;
      const levelsEl = document.getElementById('dom-debug-onchain-levels');
      const rarityEl = document.getElementById('dom-debug-onchain-rarity');
      const powerEl = document.getElementById('dom-debug-onchain-power');
      const shareEl = document.getElementById('dom-debug-onchain-share');
      const errorEl = document.getElementById('dom-debug-onchain-error');
      if (!addr || !hasNetworkStateContract()) {
        if (levelsEl) levelsEl.textContent = '—';
        if (rarityEl) rarityEl.textContent = '—';
        if (powerEl) powerEl.textContent = '—';
        if (shareEl) shareEl.textContent = '—';
        if (errorEl) errorEl.textContent = !addr ? 'Wallet not connected' : 'VITE_NETWORK_STATE_ADDRESS not set';
        return;
      }
      if (levelsEl) levelsEl.textContent = '取得中…';
      if (rarityEl) rarityEl.textContent = '取得中…';
      if (powerEl) powerEl.textContent = '取得中…';
      if (shareEl) shareEl.textContent = '取得中…';
      if (errorEl) errorEl.textContent = '—';
      const levelCountsPromise = fetchLevelCountsStrict().then((v) => ({ status: 'fulfilled' as const, value: v })).catch((e: unknown) => ({ status: 'rejected' as const, reason: e }));
      const rarityCountsPromise = fetchGlobalRarityCountsStrict().then((v) => ({ status: 'fulfilled' as const, value: v })).catch((e: unknown) => ({ status: 'rejected' as const, reason: e }));
      const myPowerPromise = fetchMyPower(addr).then((v) => ({ status: 'fulfilled' as const, value: v })).catch((e: unknown) => ({ status: 'rejected' as const, reason: e }));
      const mySharePromise = fetchMyShareBps(addr).then((v) => ({ status: 'fulfilled' as const, value: v })).catch((e: unknown) => ({ status: 'rejected' as const, reason: e }));
      const [levelRes, rarityRes, powerRes, shareRes] = await Promise.all([levelCountsPromise, rarityCountsPromise, myPowerPromise, mySharePromise]);
      const errParts: string[] = [];
      if (levelRes.status === 'fulfilled') {
        if (levelsEl) levelsEl.textContent = `[${levelRes.value.join(',')}]`;
      } else {
        if (levelsEl) levelsEl.textContent = 'エラー';
        errParts.push(`getLevelCounts: ${levelRes.reason instanceof Error ? levelRes.reason.message : String(levelRes.reason)}`);
      }
      if (rarityRes.status === 'fulfilled') {
        if (rarityEl) rarityEl.textContent = `[${rarityRes.value.join(',')}]`;
      } else {
        if (rarityEl) rarityEl.textContent = 'エラー';
        errParts.push(`getGlobalRarityCounts: ${rarityRes.reason instanceof Error ? rarityRes.reason.message : String(rarityRes.reason)}`);
      }
      if (powerRes.status === 'fulfilled') {
        if (powerEl) powerEl.textContent = String(powerRes.value);
      } else {
        if (powerEl) powerEl.textContent = 'エラー';
        errParts.push(`getMyPower: ${powerRes.reason instanceof Error ? powerRes.reason.message : String(powerRes.reason)}`);
      }
      if (shareRes.status === 'fulfilled') {
        if (shareEl) shareEl.textContent = String(shareRes.value);
      } else {
        if (shareEl) shareEl.textContent = 'エラー';
        errParts.push(`getMyShareBps: ${shareRes.reason instanceof Error ? shareRes.reason.message : String(shareRes.reason)}`);
      }
      if (errorEl) {
        if (errParts.length > 0) {
          errorEl.textContent = errParts.join(' / ');
          errorEl.title = 'getLevelCounts の BAD_DATA は、デプロイ済みコントラクトが現在の NetworkState（getLevelCounts/getGlobalRarityCounts あり）と一致していない可能性があります。contracts/NetworkState.sol を再デプロイし、.env の VITE_NETWORK_STATE_ADDRESS を新しいアドレスに更新してください。';
        } else {
          errorEl.textContent = 'なし';
          errorEl.title = '';
        }
      }
    });
  }

  const resetDisconnectBtn = document.getElementById('dom-debug-reset-disconnect');
  if (resetDisconnectBtn) {
    resetDisconnectBtn.addEventListener('click', () => {
      if (!window.confirm('Reset game state and disconnect? (SEED, $SEED, birds, and Loft will be cleared. You will return to the title screen.)\n\nNote: Reset only clears local data; it does not send a transaction.')) return;
      if (GameStore.walletAddress) {
        GameStore.clearCurrentWalletData();
      } else {
        GameStore.resetToInitial();
      }
      clearNetworkStateCache();
      try {
        sessionStorage.setItem(SUPPRESS_CHAIN_DISPLAY_KEY, '1');
      } catch (_) {}
      if (disconnectCallback) {
        disconnectCallback();
      } else {
        GameStore.disconnectWallet();
        hideGameShell();
        destroyPhaserGame();
        showTitleUI();
        revokeWalletPermissions().catch(() => {});
      }
    });
  }
}

let tabListenersInited = false;
let gachaInProgress = false;
let disconnectCallback: (() => void) | null = null;
let beforeUnloadAttachedForGameState = false;

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
  const placeSuccessGoto = document.getElementById('place-success-modal-goto-farming');
  const placeSuccessBackdrop = document.getElementById('place-success-modal-backdrop');
  if (placeSuccessGoto) placeSuccessGoto.addEventListener('click', closePlaceSuccessModal);
  if (placeSuccessBackdrop) {
    placeSuccessBackdrop.addEventListener('click', (e) => {
      if (e.target === placeSuccessBackdrop) closePlaceSuccessModal();
    });
  }
  farmingView.init();
  const claimBtn = document.getElementById(STATUS_CLAIM_BTN_ID) as HTMLButtonElement | null;
  if (claimBtn) {
    claimBtn.addEventListener('click', () => {
      const amount = GameStore.state.seed;
      if (amount <= 0) return;
      showClaimConfirmModal(amount).then((confirmed) => {
        if (!confirmed) return;
        requestAccounts().then((connectResult) => {
          if (!connectResult.ok) return;
          const address = connectResult.address as string;
          if (claimBtn) claimBtn.disabled = true;

          function doRequestClaim() {
            return requestClaim(address);
          }

          doRequestClaim().then((result) => {
            if (!result.ok) {
              if (result.error === 'No claimable amount.') {
                showMessageModal({
                  title: 'Nothing to claim',
                  message: 'There is nothing to claim right now. Earn more SEED or try again later.',
                  success: false,
                }).then(() => { if (claimBtn) claimBtn.disabled = false; });
                return;
              }
              if (result.error === 'Not logged in. Sign in with your wallet first.') {
                showMessageModal({
                  title: 'Sign in to claim',
                  message: 'Your wallet will open. Sign the message to verify you own this address and enable claiming.',
                  success: true,
                }).then(() => {
                  signInForClaim(address).then((authResult) => {
                    if (!authResult.ok) {
                      showMessageModal({ title: 'Sign-in failed', message: authResult.error ?? 'Unknown error.', success: false }).then(() => {
                        if (claimBtn) claimBtn.disabled = false;
                      });
                      return;
                    }
                    doRequestClaim().then((retryResult) => {
                      if (!retryResult.ok) {
                        showMessageModal({ title: 'Claim failed', message: retryResult.error ?? 'Unknown error.', success: false }).then(() => {
                          if (claimBtn) claimBtn.disabled = false;
                        });
                        return;
                      }
                      runClaimWithSignature(retryResult.signature);
                    });
                  });
                });
                return;
              }
              showMessageModal({ title: 'Claim failed', message: result.error ?? 'Unknown error.', success: false }).then(() => {
                if (claimBtn) claimBtn.disabled = false;
              });
              return;
            }
            runClaimWithSignature(result.signature);
          });

          function runClaimWithSignature(signature: ClaimSignature): void {
            showProcessingModal('Claiming your $SEED rewards… This may take a few seconds.');
            executeClaim(signature).then((txResult) => {
              if (!txResult.ok) {
                showMessageModal({ title: 'Claim failed', message: txResult.error ?? 'Unknown error.', success: false }).then(() => {
                  if (claimBtn) claimBtn.disabled = false;
                });
                hideProcessingModal();
                return;
              }
              const claimedAmount = Math.floor(Number(BigInt(signature.amountWei) / 10n ** 18n));
              const currentSeed = GameStore.state.seed;
              const newSeed = Math.max(0, currentSeed - claimedAmount);
              GameStore.setState({ seed: newSeed });
              GameStore.save();
              const state = GameStore.state;
              updateShellStatus({
                seed: state.seed,
                seedPerDay: getProductionRatePerHour(state) * 24,
                loftLevel: state.loftLevel,
                networkSharePercent: getNetworkSharePercent(state),
              });
              refreshSeedTokenFromChain().then(() => {
                updateAdoptPane();
                updateGachaButtonsAndCosts();
                updateClaimButton();
                hideProcessingModal();
                showMessageModal({
                  title: 'Claim successful',
                  message: `${claimedAmount} $SEED acquired!`,
                }).then(() => {
                  if (claimBtn) claimBtn.disabled = false;
                });
              });
              postClaimConfirm(signature.nonce, signature.amountWei).catch(() => {});
            });
          }
        });
      });
    });
  }
  deckView.init();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onWindowResize);
  }
  updateAdoptPaneForOnboarding();
  updateGachaButtonsAndCosts();
  updateClaimButton();
  tabListenersInited = true;
}

export function showGameShell(): void {
  const shell = getShell();
  if (!shell) return;
  shell.classList.add('visible');
  shell.setAttribute('aria-hidden', 'false');

  GameStore.setOnStaleCallback(() => {
    showMessageModal({
      message: 'データの更新がありました。タイトル画面に戻ります。',
      success: false,
    })
      .then(() => {
        hideGameShell();
        showTitleUI();
        return getGameState();
      })
      .then((gs) => {
        if (gs?.ok) {
          GameStore.setStateFromServer(gs.state, gs.version);
          GameStore.save();
        }
      });
  });

  GameStore.setOnSaveFailedCallback(() => {
    showMessageModal({
      message: '保存に失敗しました。通信環境を確認のうえ、再度お試しください。',
      success: false,
    });
  });

  _syncGet = null;
  _syncPut = null;
  updateSyncStatusEl();
  GameStore.setOnSaveSuccessCallback(() => {
    _syncPut = 'ok';
    updateSyncStatusEl();
  });
  GameStore.setOnBootstrapPutResult((ok) => {
    _syncPut = ok ? 'ok' : 'fail';
    updateSyncStatusEl();
  });

  if (typeof window !== 'undefined' && !beforeUnloadAttachedForGameState) {
    beforeUnloadAttachedForGameState = true;
    window.addEventListener('beforeunload', () => GameStore.flushServerSave());
  }

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

  /* 初回表示: オンボーディング状態に応じて適切なタブから開始する */
  const step = GameStore.state.onboardingStep;
  let firstTab: 'farming' | 'adopt' | 'deck';
  if (step === 'need_gacha') firstTab = 'adopt';
  else if (step === 'need_place' || step === 'need_save') firstTab = 'deck';
  else firstTab = 'farming';
  switchToTab(firstTab);
  updateTabsForOnboarding();
  updateDeckPaneVisibility();

  /* ログイン時: 残高とネットワーク状態を取得（ステータスカード・NETWORKタブ用） */
  refreshSeedTokenFromChain().then(() => {
    updateAdoptPane();
    updateGachaButtonsAndCosts();
  });
  refreshNetworkStateFromChain().then(() => {
    const state = GameStore.state;
    updateShellStatus({
      seed: state.seed,
      seedPerDay: getProductionRatePerHour(state) * 24,
      loftLevel: state.loftLevel,
      networkSharePercent: getNetworkSharePercent(state),
    });
    refreshNetworkStats();
    // 初回のオンチェーン書き込みはデッキ編成後の SAVE 時のみ（Connect 直後に MetaMask を出さない）
  });

  refreshPhaserScale();
}

export function hideGameShell(): void {
  const shell = getShell();
  if (!shell) return;
  shell.classList.remove('visible');
  shell.setAttribute('aria-hidden', 'true');
}

/** Update DOM status cards (Current SEED, SEED/day, Network Share, Loft Lv). SEED/day と Network Share はオンチェーン契約がある場合はチェーン値を表示。 */
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
  const suppressChain = (() => {
    try {
      return sessionStorage.getItem(SUPPRESS_CHAIN_DISPLAY_KEY) === '1';
    } catch {
      return false;
    }
  })();
  const step = GameStore.state.onboardingStep;
  const cachedPower = getCachedPower();
  const hasBirdsOnDeck = GameStore.state.deckSlots.some((id) => id != null);
  const beforeDeckSave = step === 'need_gacha' || step === 'need_place' || step === 'need_save' || !hasBirdsOnDeck;
  const useChain =
    !beforeDeckSave &&
    hasNetworkStateContract() &&
    GameStore.walletAddress &&
    !suppressChain &&
    cachedPower != null &&
    cachedPower > 0;
  const seedPerDayToShow = beforeDeckSave ? 0 : (useChain ? getSeedPerDayFromChain() : payload.seedPerDay);
  const networkToShow = beforeDeckSave ? 0 : (useChain ? getNetworkSharePercentFromChain() : payload.networkSharePercent);

  if (seedEl) seedEl.textContent = payload.seed.toFixed(2);
  const accrualHintEl = document.getElementById(FARMING_ACCRUAL_HINT_ID);
  if (accrualHintEl) accrualHintEl.textContent = '';
  if (seedPerDayEl) seedPerDayEl.textContent = seedPerDayToShow.toFixed(2);
  if (networkEl) {
    networkEl.textContent = `${networkToShow.toFixed(5)}%`;
    networkEl.title = '参考値。公式の確定値ではありません。';
  }
  const seedPerDayCard = seedPerDayEl?.closest('.status-card');
  const networkCard = networkEl?.closest('.status-card');
  if (seedPerDayCard) (seedPerDayCard as HTMLElement).style.display = '';
  if (networkCard) (networkCard as HTMLElement).style.display = '';
  if (loftEl) loftEl.textContent = String(payload.loftLevel);
  const networkErrorEl = document.getElementById('network-state-error');
  if (networkErrorEl) {
    const err = getNetworkStateFetchError();
    if (err) {
      networkErrorEl.textContent = err.length > 100 ? err.slice(0, 97) + '...' : err;
      networkErrorEl.style.display = '';
    } else {
      networkErrorEl.textContent = '';
      networkErrorEl.style.display = 'none';
    }
  }
  farmingView.updateUpgradeButton();
  updateClaimButton();
}

function updateClaimButton(): void {
  const btn = document.getElementById(STATUS_CLAIM_BTN_ID) as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = GameStore.state.seed <= 0;
}

export function isShellVisible(): boolean {
  const shell = getShell();
  return shell?.classList.contains('visible') ?? false;
}
