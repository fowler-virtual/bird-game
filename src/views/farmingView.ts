/**
 * Farming tab: Loft grid + Upgrade. Pure HTML+CSS, no Phaser.
 * Reads/writes GameStore; calls updateShellStatus for status cards.
 */

import { GameStore } from '../store/GameStore';
import { getActiveSlotIndices, getBirdById, getNextUnlockCost, getProductionRatePerHour, getNetworkSharePercent, MAX_LOFT_LEVEL } from '../types';
import { COMMON_FRAME_SRCS } from '../assets';
import { updateShellStatus, showMessageModal, runConfirmBurnThenSuccess, refreshNetworkStats, clearSuppressChainDisplay, showPlaceSuccessModal, updateDeckOnboardingPlaceOverlay } from '../domShell';
import { hasNetworkStateContract, updatePowerOnChain, refreshNetworkStateFromChain, setLoftLevel, getCachedPower } from '../networkState';
import * as deckView from './deckView';

const LOFT_GRID_ID = 'loft-grid';
const LOFT_UPGRADE_BTN_ID = 'status-loft-upgrade-btn';
const LOFT_SAVE_WRAP_ID = 'loft-save-wrap';
const SAVE_DECK_BTN_ID = 'status-save-deck-btn';
const FARMING_ACCRUAL_HINT_ID = 'farming-accrual-hint';
const LOFT_MODAL_BACKDROP_ID = 'loft-modal-backdrop';
const LOFT_MODAL_COST_ID = 'loft-modal-cost';
const LOFT_MODAL_ERROR_ID = 'loft-modal-error';
const LOFT_MODAL_CANCEL_ID = 'loft-modal-cancel';
const LOFT_MODAL_CONFIRM_ID = 'loft-modal-confirm';
let accrualIntervalId = 0;
let accrualHintTimer = 0;
let hasShownSaveReminderThisSession = false;
let spriteTick = 0;
let spriteIntervalId = 0;
const SPRITE_FRAME_COUNT = COMMON_FRAME_SRCS.length;
const SPRITE_FRAME_MS = 500;
// 各鳥ごとにスタートまでのラグ（何tick待つか）をランダムに付与
const SPRITE_MAX_LAG_TICKS = 6;
// アニメーションシーケンス: 1→2→3→4→5→6→1→…
// 画像インデックスで表現（0-based）
const SPRITE_SEQUENCE: number[] = [0, 1, 2, 3, 4, 5];

function getEl(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function renderLoft(): void {
  const grid = getEl(LOFT_GRID_ID);
  if (!grid) return;

  const state = GameStore.state;
  const activeIndices = getActiveSlotIndices(state);

  grid.innerHTML = '';
  for (let slotIndex = 0; slotIndex < state.deckSlots.length; slotIndex++) {
    const cell = document.createElement('div');
    cell.className = 'loft-cell';
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('tabindex', '-1');
    const active = activeIndices.includes(slotIndex);
    if (!active) {
      cell.classList.add('locked');
      cell.setAttribute('aria-label', `Slot ${slotIndex + 1} locked`);
    } else {
      const birdId = state.deckSlots[slotIndex];
      if (birdId) {
        const bird = getBirdById(state, birdId);
        if (bird) {
          cell.classList.add('has-bird');
          cell.dataset.slotIndex = String(slotIndex);
          const img = document.createElement('img');
          // Loft ではレアリティに関係なく、共通のロフト用スプライトをアニメーション表示する。
          const lag = Math.floor(Math.random() * SPRITE_MAX_LAG_TICKS);
          img.src = COMMON_FRAME_SRCS[SPRITE_SEQUENCE[0]];
          img.dataset.commonLagTick = String(lag);
          img.dataset.commonSeqIndex = '0';
          img.className = 'loft-bird-img loft-bird-anim-common';
          img.alt = bird.rarity;
          cell.appendChild(img);
          cell.setAttribute('aria-label', `Slot ${slotIndex + 1}: ${bird.rarity}`);
        }
      } else {
        cell.setAttribute('aria-label', `Slot ${slotIndex + 1} empty`);
      }
    }
    grid.appendChild(cell);
  }
}

/** Update Loft Upgrade button in status bar (enabled/disabled). Exported so domShell can call on status refresh. */
export function updateUpgradeButton(): void {
  const btn = getEl(LOFT_UPGRADE_BTN_ID) as HTMLButtonElement | null;
  if (!btn) return;

  const state = GameStore.state;
  const cost = getNextUnlockCost(state.unlockedDeckCount);
  const canUpgrade = cost != null && state.loftLevel < MAX_LOFT_LEVEL;
  btn.disabled = !canUpgrade;
}

function refreshShellStatus(): void {
  const state = GameStore.state;
  const ratePerDay = getProductionRatePerHour(state) * 24;
  updateShellStatus({
    seed: state.seed,
    seedPerDay: ratePerDay,
    loftLevel: state.loftLevel,
    networkSharePercent: getNetworkSharePercent(state),
  });
}

function tickAccrual(): void {
  GameStore.applyAccrual();
  GameStore.save();
  refreshShellStatus();
}

function openUpgradeModal(): void {
  const cost = getNextUnlockCost(GameStore.state.unlockedDeckCount);
  if (!cost) return;

  const backdrop = getEl(LOFT_MODAL_BACKDROP_ID);
  const costEl = getEl(LOFT_MODAL_COST_ID);
  const errorEl = getEl(LOFT_MODAL_ERROR_ID);
  const titleEl = getEl('loft-modal-title');
  const confirmBtn = getEl(LOFT_MODAL_CONFIRM_ID) as HTMLButtonElement | null;
  if (!backdrop || !costEl) return;

  if (titleEl) {
    titleEl.textContent = 'Confirm Upgrade';
    titleEl.classList.remove('loft-modal-message--success');
  }
  costEl.textContent = `Spend ${cost.bird} $SEED to unlock 2 slots?`;
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.classList.remove('loft-modal-message--success');
  }
  if (confirmBtn) confirmBtn.disabled = false;

  backdrop.classList.add('visible');
  backdrop.setAttribute('aria-hidden', 'false');
}

function closeUpgradeModal(): void {
  const backdrop = getEl(LOFT_MODAL_BACKDROP_ID);
  if (!backdrop) return;
  backdrop.classList.remove('visible');
  backdrop.setAttribute('aria-hidden', 'true');
}

async function confirmUpgrade(): Promise<void> {
  const cost = getNextUnlockCost(GameStore.state.unlockedDeckCount);
  if (!cost) return;
  if (!GameStore.walletAddress) {
    void showMessageModal({ message: 'Connect your wallet to upgrade your Loft.', success: false });
    closeUpgradeModal();
    return;
  }
  closeUpgradeModal();

  const result = await runConfirmBurnThenSuccess({
    getConfirmResult: () => Promise.resolve(true),
    amount: cost.bird,
    context: 'loft',
    onSuccess: async () => {
      if (!GameStore.unlockNextDeckSlot()) {
        void showMessageModal({ message: 'Unlock failed.', success: false });
        return;
      }
      GameStore.save();
      refresh();
      deckView.refresh();
      const levelResult = await setLoftLevel(GameStore.state.loftLevel, { waitForConfirmation: false });
      if (!levelResult.ok) {
        GameStore.rollbackLastLoftUpgrade();
        GameStore.save();
        refresh();
        deckView.refresh();
        void showMessageModal({
          title: 'Upgrade cancelled',
          message: 'The level update was not sent to the chain. Your Loft is unchanged. The $SEED for the upgrade was already spent; you can try the upgrade again.',
          success: false,
        });
        return;
      }
      void showMessageModal({ title: 'Upgrade complete', message: '2 slots unlocked.' });
      if (levelResult.tx) {
        levelResult.tx.wait().then(() => refreshNetworkStateFromChain()).then(refresh).catch(refresh);
      } else {
        refreshNetworkStateFromChain().then(refresh);
      }
    },
  });

  if (!result.ok && result.error && result.error !== 'Cancelled') {
    void showMessageModal({ message: result.error ?? 'Loft upgrade failed. Please try again.', success: false });
  }
}

function initModalListeners(): void {
  const cancel = getEl(LOFT_MODAL_CANCEL_ID);
  const confirm = getEl(LOFT_MODAL_CONFIRM_ID);
  const backdrop = getEl(LOFT_MODAL_BACKDROP_ID);
  cancel?.addEventListener('click', closeUpgradeModal);
  // Confirm は単にアップグレード処理をキックする（接続はタイトル画面で済ませる前提）
  confirm?.addEventListener('click', () => {
    void confirmUpgrade();
  });
  backdrop?.addEventListener('click', (e) => {
    if (e.target === backdrop) closeUpgradeModal();
  });
}

const LOFT_SAVE_POWER_HINT_ID = 'loft-save-power-hint';

/** LOFT セクションでは SAVE ボタン上の文章自体を出さない（デバッグ用にのみパワーを扱う）。 */
function updateSavePowerHint(): void {
  const el = document.getElementById(LOFT_SAVE_POWER_HINT_ID);
  if (!el) return;
  el.textContent = '';
}

/** Save ボタンは LOFT タブ内にあるため、LOFT タブ表示時などに表示切替する。 */
export function updateSaveWrapVisibility(): void {
  const saveWrap = getEl(LOFT_SAVE_WRAP_ID);
  if (saveWrap) saveWrap.style.display = hasNetworkStateContract() && GameStore.walletAddress ? 'flex' : 'none';
  updateSavePowerHint();
}

/** Call when Farming tab becomes visible. Renders loft, starts accrual interval, updates status. */
export function refresh(): void {
  renderLoft();
  updateUpgradeButton();
  updateSaveWrapVisibility();
  const localPower = Math.floor(getProductionRatePerHour(GameStore.state));
  const chainPower = getCachedPower();
  if (
    hasNetworkStateContract() &&
    GameStore.walletAddress &&
    localPower > 0 &&
    (chainPower === null || chainPower === 0) &&
    !hasShownSaveReminderThisSession
  ) {
    hasShownSaveReminderThisSession = true;
    showMessageModal({
      title: 'Save your deck on-chain',
      message: 'Your Loft has power but it has not been saved on-chain yet. Click the "Save" button below to update SEED/DAY and Network Share.',
      success: true,
    });
  }
  refreshShellStatus();

  if (accrualIntervalId) {
    clearInterval(accrualIntervalId);
    accrualIntervalId = 0;
  }
  accrualIntervalId = window.setInterval(tickAccrual, 2000);

  if (spriteIntervalId) {
    clearInterval(spriteIntervalId);
    spriteIntervalId = 0;
  }
  spriteIntervalId = window.setInterval(() => {
    if (SPRITE_FRAME_COUNT <= 0 || SPRITE_SEQUENCE.length === 0) return;
    spriteTick += 1;
    document.querySelectorAll<HTMLImageElement>('.loft-bird-anim-common').forEach((img) => {
      const lag = Number(img.dataset.commonLagTick ?? '0');
      const started = img.dataset.commonStarted === '1';
      if (!started) {
        // ラグ分だけ待機。超えたら frame1 からスタート。
        if (spriteTick >= lag) {
          img.dataset.commonStarted = '1';
          img.dataset.commonSeqIndex = '0';
          img.src = COMMON_FRAME_SRCS[SPRITE_SEQUENCE[0]];
        } else {
          img.src = COMMON_FRAME_SRCS[SPRITE_SEQUENCE[0]];
        }
        return;
      }
      // 開始後はシーケンスに従って 1→2→3→4→5→6→2→1→… の順に進める
      const seqLen = SPRITE_SEQUENCE.length;
      const prevSeq = Number(img.dataset.commonSeqIndex ?? '0');
      const nextSeq = (prevSeq + 1) % seqLen;
      img.dataset.commonSeqIndex = String(nextSeq);
      const frameIndex = SPRITE_SEQUENCE[nextSeq];
      img.src = COMMON_FRAME_SRCS[frameIndex];
    });
  }, SPRITE_FRAME_MS);
}

/** Call when leaving Farming tab. Stops accrual interval. */
export function stop(): void {
  if (accrualIntervalId) {
    clearInterval(accrualIntervalId);
    accrualIntervalId = 0;
  }
  if (accrualHintTimer) {
    clearTimeout(accrualHintTimer);
    accrualHintTimer = 0;
  }
  // 他タブに移動したら CURRENT SEED の「+◯ SEED」表示は必ず消しておく
  const hintEl = getEl(FARMING_ACCRUAL_HINT_ID);
  if (hintEl) {
    hintEl.textContent = '';
  }
  if (spriteIntervalId) {
    clearInterval(spriteIntervalId);
    spriteIntervalId = 0;
  }
}

/** Call once when shell is shown to wire upgrade button (in status bar) and modal. */
export function init(): void {
  initModalListeners();
  const btn = getEl(LOFT_UPGRADE_BTN_ID);
  btn?.addEventListener('click', () => {
    if (getNextUnlockCost(GameStore.state.unlockedDeckCount) != null) openUpgradeModal();
  });
  const saveBtn = getEl(SAVE_DECK_BTN_ID) as HTMLButtonElement | null;
  saveBtn?.addEventListener('click', async () => {
    if (!GameStore.walletAddress) return;
    const power = Math.floor(getProductionRatePerHour(GameStore.state));
    if (power <= 0) {
      await showMessageModal({
        message: 'Place birds on the Loft (Deck tab) first, then return here and click Save to update SEED/DAY and Network Share.',
        success: false,
      });
      return;
    }
    // 既にオンチェーンの値と同じパワーならトランザクションを送らない（ガス節約）
    const chainPower = getCachedPower();
    const alreadyUpToDate = chainPower != null && Math.floor(chainPower) === power;
    if (alreadyUpToDate) {
      await showMessageModal({
        message: 'Your deck power is already up-to-date on-chain. No Save needed.',
        success: true,
      });
      return;
    }

    saveBtn.disabled = true;
    try {
      const result = await updatePowerOnChain(power);
      if (result.ok) {
        clearSuppressChainDisplay();
        // モーダルを先に表示し、ステータス更新はバックグラウンドで実行
        refreshNetworkStateFromChain().then(() => {
          refreshShellStatus();
          refreshNetworkStats();
        });
        const wasNeedSave = GameStore.state.onboardingStep === 'need_save';
        if (wasNeedSave) {
          GameStore.setState({ onboardingStep: 'need_farming' });
          GameStore.save();
          deckView.refresh();
          updateDeckOnboardingPlaceOverlay();
          showPlaceSuccessModal();
        } else {
          await showMessageModal({ title: 'Deck saved', message: 'Your power has been updated on-chain.' });
        }
      } else {
        await showMessageModal({ message: result.error ?? 'Save failed.', success: false });
      }
    } finally {
      saveBtn.disabled = false;
    }
  });
  updateUpgradeButton();
}
