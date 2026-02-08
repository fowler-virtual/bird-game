/**
 * HyperFarm-style DOM shell: header, tabs, status cards.
 * Shown after wallet connect; tab clicks drive Phaser scene/screen.
 */

import { GameStore, GACHA_COST } from './store/GameStore';
import { getProductionRatePerHour, getNetworkSharePercent, MAX_LOFT_LEVEL, RARITY_COLUMN_ORDER, RARITY_DROP_RATES } from './types';
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
    farmingView.refresh();
  }
  if (tabId === 'adopt') {
    hideGachaResultsSection();
    updateAdoptPane();
    updateGachaButtonsAndCosts();
    updateAdoptPaneForOnboarding();
    updateAdoptOnboardingOverlay(true);
  } else {
    updateAdoptOnboardingOverlay(false);
  }
  if (tabId === 'deck') {
    updateDeckPaneVisibility();
    deckView.refresh();
    updateDeckOnboardingPlaceOverlay();
  }
  if (tabId === 'network') {
    refreshNetworkStats();
  }
  updateTabsForOnboarding();
}

/** オンボーディング状態に応じてタブのロックを更新。Deck で鳥を置いた直後にも呼ぶ */
export function updateTabsForOnboarding(): void {
  const step = GameStore.state.onboardingStep;
  const lockFarming = step === 'need_gacha' || step === 'need_place';
  const lockExceptDeck = step === 'need_place';
  const tabs = [
    { id: 'farming', lock: lockFarming },
    { id: 'adopt', lock: step === 'need_gacha' || lockExceptDeck },
    { id: 'deck', lock: false },
    { id: 'network', lock: lockExceptDeck },
    { id: 'debug', lock: lockExceptDeck },
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
  const step = GameStore.state.onboardingStep;
  if (step === 'need_gacha' && tabId !== 'adopt') return;
  if (step === 'need_place' && tabId !== 'deck') return;
  if (tabId === 'farming' && (step === 'need_gacha' || step === 'need_place')) return;
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
  const loftSection = document.getElementById('deck-section-loft');
  if (!placeOverlay || !overlayDim || !messageWrap || !inventorySection || !loftSection || !placeOverlay.classList.contains('visible')) return;
  const parent = placeOverlay.parentElement;
  if (!parent) return;
  const parentRect = parent.getBoundingClientRect();
  const loftRect = loftSection.getBoundingClientRect();
  overlayDim.style.top = `${loftRect.top - parentRect.top}px`;
  overlayDim.style.left = `${loftRect.left - parentRect.left}px`;
  overlayDim.style.width = `${loftRect.width}px`;
  overlayDim.style.height = `${loftRect.height}px`;
  const overlayRect = placeOverlay.getBoundingClientRect();
  const sectionRect = inventorySection.getBoundingClientRect();
  const wrapRect = messageWrap.getBoundingClientRect();
  const wrapHeight = wrapRect.height > 0 ? wrapRect.height : DECK_ONBOARDING_MESSAGE_FALLBACK_HEIGHT;
  const top = sectionRect.top - overlayRect.top - wrapHeight - DECK_ONBOARDING_MESSAGE_GAP;
  const left = sectionRect.left - overlayRect.left + sectionRect.width / 2;
  messageWrap.style.top = `${Math.max(8, top)}px`;
  messageWrap.style.left = `${left}px`;
  messageWrap.style.transform = 'translateX(-50%)';
}

/** need_place 時にオーバーレイとインベントリハイライトを表示。メッセージと矢印はインベントリ全体の中央上に固定し、リサイズ時も再計算する */
function updateDeckOnboardingPlaceOverlay(): void {
  const step = GameStore.state.onboardingStep;
  const show = step === 'need_place';
  const placeOverlay = document.getElementById('deck-onboarding-place-overlay');
  const messageWrap = document.getElementById('deck-onboarding-place-message-wrap');
  const inventorySection = document.getElementById('inventory-section');

  if (deckOnboardingResizeHandler) {
    window.removeEventListener('resize', deckOnboardingResizeHandler);
    deckOnboardingResizeHandler = null;
  }

  if (placeOverlay) {
    placeOverlay.classList.toggle('visible', show);
    placeOverlay.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (!show) {
      const dim = document.getElementById('deck-onboarding-place-overlay-dim');
      if (dim) {
        dim.style.top = '';
        dim.style.left = '';
        dim.style.width = '';
        dim.style.height = '';
      }
    }
  }
  if (inventorySection) {
    inventorySection.classList.toggle('onboarding-highlight', show);
  }
  if (!show || !placeOverlay || !messageWrap) return;

  const runPosition = (): void => {
    requestAnimationFrame(() => {
      requestAnimationFrame(positionDeckOnboardingMessageAboveInventory);
    });
  };
  runPosition();
  deckOnboardingResizeHandler = runPosition;
  window.addEventListener('resize', deckOnboardingResizeHandler);
}

let adoptOnboardingResizeHandler: (() => void) | null = null;

const ADOPT_ONBOARDING_MESSAGE_GAP = 10;
const ADOPT_ONBOARDING_MESSAGE_FALLBACK_HEIGHT = 48;
/** 暗転下端と ADOPTION 緑枠の間の余白（かぶり防止） */
const ADOPT_ONBOARDING_DIM_BOTTOM_GAP = 12;

function positionAdoptOnboardingOverlay(): void {
  const overlay = document.getElementById('adopt-onboarding-overlay');
  const dimStatus = document.getElementById('adopt-onboarding-dim-status');
  const dimMiddle = document.getElementById('adopt-onboarding-dim-middle');
  const dimRarity = document.getElementById('adopt-onboarding-dim-rarity');
  const messageWrap = document.getElementById('adopt-onboarding-message-wrap');
  const adoptCtaCard = document.getElementById('adopt-cta-card');
  const statusPanel = document.getElementById('status-panel');
  const rarityCard = document.getElementById('adopt-rarity-card');
  if (!overlay || !dimStatus || !dimMiddle || !dimRarity || !messageWrap || !adoptCtaCard || !statusPanel || !rarityCard || !overlay.classList.contains('visible')) return;
  const overlayRect = overlay.getBoundingClientRect();
  const statusRect = statusPanel.getBoundingClientRect();
  const rarityRect = rarityCard.getBoundingClientRect();
  const ctaRect = adoptCtaCard.getBoundingClientRect();
  const toOverlayTop = (y: number) => y - overlayRect.top;
  const toOverlayLeft = (x: number) => x - overlayRect.left;
  dimStatus.style.top = `${toOverlayTop(statusRect.top)}px`;
  dimStatus.style.left = `${toOverlayLeft(statusRect.left)}px`;
  dimStatus.style.width = `${statusRect.width}px`;
  dimStatus.style.height = `${statusRect.height}px`;
  const middleTop = toOverlayTop(statusRect.bottom);
  const middleBottom = Math.max(middleTop, toOverlayTop(ctaRect.top) - ADOPT_ONBOARDING_DIM_BOTTOM_GAP);
  const middleHeight = Math.max(0, middleBottom - middleTop);
  dimMiddle.style.top = `${middleTop}px`;
  dimMiddle.style.left = '0';
  dimMiddle.style.width = `${overlayRect.width}px`;
  dimMiddle.style.height = `${middleHeight}px`;
  dimRarity.style.top = `${toOverlayTop(rarityRect.top)}px`;
  dimRarity.style.left = `${toOverlayLeft(rarityRect.left)}px`;
  dimRarity.style.width = `${rarityRect.width}px`;
  dimRarity.style.height = `${rarityRect.height}px`;
  const wrapRect = messageWrap.getBoundingClientRect();
  const wrapHeight = wrapRect.height > 0 ? wrapRect.height : ADOPT_ONBOARDING_MESSAGE_FALLBACK_HEIGHT;
  const top = toOverlayTop(ctaRect.top) - wrapHeight - ADOPT_ONBOARDING_MESSAGE_GAP;
  const left = toOverlayLeft(ctaRect.left) + ctaRect.width / 2;
  messageWrap.style.top = `${Math.max(8, top)}px`;
  messageWrap.style.left = `${left}px`;
  messageWrap.style.transform = 'translateX(-50%)';
}

/** need_gacha 時に Adopt タブで ADOPTION 強調・ステータス/排出率を暗転・メッセージ＋矢印を表示。Adopt タブでないときは常に非表示。 */
function updateAdoptOnboardingOverlay(adoptTabActive?: boolean): void {
  const step = GameStore.state.onboardingStep;
  const show = (adoptTabActive !== false) && step === 'need_gacha';
  const overlay = document.getElementById('adopt-onboarding-overlay');
  const adoptCtaCard = document.getElementById('adopt-cta-card');
  const dimStatus = document.getElementById('adopt-onboarding-dim-status');
  const dimMiddle = document.getElementById('adopt-onboarding-dim-middle');
  const dimRarity = document.getElementById('adopt-onboarding-dim-rarity');

  if (adoptOnboardingResizeHandler) {
    window.removeEventListener('resize', adoptOnboardingResizeHandler);
    adoptOnboardingResizeHandler = null;
  }

  if (overlay) {
    overlay.classList.toggle('visible', show);
    overlay.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (!show) {
      if (dimStatus) {
        dimStatus.style.top = '';
        dimStatus.style.left = '';
        dimStatus.style.width = '';
        dimStatus.style.height = '';
      }
      if (dimMiddle) {
        dimMiddle.style.top = '';
        dimMiddle.style.left = '';
        dimMiddle.style.width = '';
        dimMiddle.style.height = '';
      }
      if (dimRarity) {
        dimRarity.style.top = '';
        dimRarity.style.left = '';
        dimRarity.style.width = '';
        dimRarity.style.height = '';
      }
    }
  }
  if (adoptCtaCard) {
    adoptCtaCard.classList.toggle('onboarding-highlight', show);
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
    else if (bal < cost1) cost1El.textContent = `Cost: ${cost1} $BIRD (you have ${bal})`;
    else cost1El.textContent = `Cost: ${cost1} $BIRD`;
    cost1El.classList.toggle('gacha-cost-insufficient', bal < cost1);
  }
  if (bal >= cost1 && bal >= cost10) clearInsufficientBalanceMessage();
  if (cost10El) {
    if (bal < cost10) cost10El.textContent = `Cost: ${cost10} $BIRD (you have ${bal})`;
    else cost10El.textContent = `Cost: ${cost10} $BIRD`;
    cost10El.classList.toggle('gacha-cost-insufficient', bal < cost10);
  }
}

/** 残高不足メッセージを Adoption ボックス内（コスト表示の下）にテキストのみで表示 */
function showInsufficientBalanceMessage(): void {
  const el = document.getElementById('gacha-insufficient-message');
  if (!el) return;
  el.textContent = 'Not enough $BIRD.';
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

/** ガチャタブの「1回回す」「10回回す」から呼ぶ。引いた鳥をモーダルで表示し、閉じたらメインエリアにも表示。 */
function runGachaFromDom(count: 1 | 10): void {
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

  const state = GameStore.state;
  const freePulls = state.hasFreeGacha ? 1 : 0;
  const cost =
    count === 1
      ? Math.max(0, 1 - freePulls) * GACHA_COST
      : 10 * GACHA_COST;
  const bal = GameStore.birdCurrency;
  gachaLog('cost/balance', { cost, bal, hasFreeGacha: state.hasFreeGacha });

  if (cost > 0 && bal < cost) {
    gachaLog('BLOCKED: insufficient balance', { cost, bal });
    showInsufficientBalanceMessage();
    return;
  }

  gachaInProgress = true;
  setGachaButtonsDisabled(true);
  try {
    const ok =
      cost === 0
        ? window.confirm(`Use your free adoption to adopt ${count === 1 ? '1 bird' : `${count} birds`}?`)
        : window.confirm(`Spend ${cost} $BIRD to adopt ${count === 1 ? '1 bird' : `${count} birds`}? (Balance: ${bal} $BIRD)`);
    if (!ok) {
      gachaLog('user cancelled confirm');
      return;
    }

    gachaLog('calling pullGacha', { count });
    const result = GameStore.pullGacha(count);
    gachaLog('pullGacha result', { ok: result.ok, error: result.error, birdsCount: result.birds?.length });

    const area = document.getElementById('gacha-results-area');
    const emptyEl = document.getElementById('gacha-results-empty');
    if (!area) {
      gachaLog('BLOCKED: gacha-results-area not found');
      return;
    }

    area.querySelectorAll('.gacha-results-item').forEach((el) => el.remove());
    if (emptyEl) emptyEl.remove();

    if (!result.ok) {
      gachaLog('pullGacha failed', result.error);
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
    area.querySelectorAll('.gacha-results-item').forEach((el) => el.remove());
    clearInsufficientBalanceMessage();

    gachaLog('calling showGachaResultModal', { birdsCount: result.birds.length });
    showGachaResultModal(result.birds, count);
    updateAdoptPane();
    updateAdoptPaneForOnboarding();
    updateGachaButtonsAndCosts();
    updateDeckPaneVisibility();
    const game = (window as unknown as { __phaserGame?: { scene?: { get?: (k: string) => { events?: { emit?: (e: string) => void } } } } }).__phaserGame;
    game?.scene?.get?.('GameScene')?.events?.emit?.('refresh');
    gachaLog('gacha flow done');
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

/** Network タブ: フロック全体の統計（現状はデモデータ。将来 API で差し替え可能） */
function refreshNetworkStats(): void {
  const levelList = document.getElementById('network-level-list');
  const distList = document.getElementById('network-dist-list');
  const totalEl = document.getElementById('network-total-birds');

  const levelData = [
    { level: 1, users: 21288 },
    { level: 2, users: 3615 },
    { level: 3, users: 557 },
    { level: 4, users: 125 },
    { level: 5, users: 10 },
    { level: 6, users: 2 },
  ];
  const totalLevelUsers = levelData.reduce((s, d) => s + d.users, 0);

  if (levelList) {
    levelList.innerHTML = '';
    for (const d of levelData) {
      const pct = totalLevelUsers > 0 ? (d.users / totalLevelUsers) * 100 : 0;
      const row = document.createElement('div');
      row.className = 'network-stat-row';
      row.innerHTML = `
        <span class="network-stat-label">Level ${d.level}</span>
        <span class="network-stat-count">${d.users.toLocaleString()}</span>
        <div class="network-stat-bar-wrap">
          <div class="network-stat-bar" style="width: ${pct}%"></div>
        </div>
      `;
      levelList.appendChild(row);
    }
  }

  const rarityData = [
    { name: 'Common', count: 45038 },
    { name: 'Uncommon', count: 22959 },
    { name: 'Rare', count: 26820 },
    { name: 'Epic', count: 23196 },
    { name: 'Legendary', count: 19782 },
  ];
  const totalBirds = rarityData.reduce((s, d) => s + d.count, 0);

  if (distList) {
    distList.innerHTML = '';
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
  if (totalEl) totalEl.textContent = totalBirds.toLocaleString();
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
  const claimBtn = document.getElementById(STATUS_CLAIM_BTN_ID);
  if (claimBtn) {
    claimBtn.addEventListener('click', () => {
      const amount = GameStore.claimSeed();
      if (amount <= 0) return;
      GameStore.save();
      const state = GameStore.state;
      updateShellStatus({
        seed: state.seed,
        seedPerDay: getProductionRatePerHour(state) * 24,
        loftLevel: state.loftLevel,
        networkSharePercent: getNetworkSharePercent(state),
      });
      const hintEl = document.getElementById(FARMING_ACCRUAL_HINT_ID);
      if (hintEl) {
        hintEl.textContent = `Claimed ${amount} SEED`;
        window.setTimeout(() => {
          hintEl.textContent = '';
        }, 2000);
      }
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
