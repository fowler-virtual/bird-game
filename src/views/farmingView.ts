/**
 * Farming tab: Loft grid + Upgrade. Pure HTML+CSS, no Phaser.
 * Reads/writes GameStore; calls updateShellStatus for status cards.
 */

import { GameStore } from '../store/GameStore';
import { getActiveSlotIndices, getBirdById, getNextUnlockCost, getProductionRatePerHour, getNetworkSharePercent, MAX_LOFT_LEVEL } from '../types';
import { RARITY_IMAGE_SRC, COMMON_FRAME_SRCS } from '../assets';
import { updateShellStatus } from '../domShell';

const LOFT_GRID_ID = 'loft-grid';
const LOFT_UPGRADE_BTN_ID = 'loft-upgrade-btn';
const FARMING_ACCRUAL_HINT_ID = 'farming-accrual-hint';
const LOFT_MODAL_BACKDROP_ID = 'loft-modal-backdrop';
const LOFT_MODAL_COST_ID = 'loft-modal-cost';
const LOFT_MODAL_CANCEL_ID = 'loft-modal-cancel';
const LOFT_MODAL_CONFIRM_ID = 'loft-modal-confirm';

let accrualIntervalId = 0;
let accrualHintTimer = 0;
let spriteTick = 0;
let spriteIntervalId = 0;
const SPRITE_FRAME_COUNT = COMMON_FRAME_SRCS.length;
const SPRITE_FRAME_MS = 500;
// 各鳥ごとにスタートまでのラグ（何tick待つか）をランダムに付与
const SPRITE_MAX_LAG_TICKS = 6;

function getEl(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function renderLoft(): void {
  const grid = getEl(LOFT_GRID_ID);
  if (!grid) return;

  const state = GameStore.state;
  const activeIndices = getActiveSlotIndices(state);

  grid.innerHTML = '';
  for (let slotIndex = 0; slotIndex < 8; slotIndex++) {
    const cell = document.createElement('div');
    cell.className = 'loft-cell';
    cell.setAttribute('role', 'gridcell');
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
          if (bird.rarity === 'Common') {
            // Common は frame1 から 1→2→3→4 の順番で進む。
            // startLagTick によって「飛び始めるタイミング」だけランダムにずらす。
            const lag = Math.floor(Math.random() * SPRITE_MAX_LAG_TICKS);
            img.src = COMMON_FRAME_SRCS[0];
            img.dataset.commonLagTick = String(lag);
            img.dataset.commonFrameIndex = '0';
            img.className = 'loft-bird-img loft-bird-anim-common';
          } else {
            img.src = RARITY_IMAGE_SRC[bird.rarity];
            img.className = 'loft-bird-img';
          }
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

function updateUpgradeButton(): void {
  const btn = getEl(LOFT_UPGRADE_BTN_ID) as HTMLButtonElement | null;
  if (!btn) return;

  const state = GameStore.state;
  const cost = getNextUnlockCost(state.unlockedDeckCount);
  const canUpgrade = cost != null && state.loftLevel < MAX_LOFT_LEVEL;
  const canAfford = cost != null && state.seed >= cost.seed && GameStore.birdCurrency >= cost.bird;

  btn.disabled = !canUpgrade || !canAfford;
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

function showAccrualHint(delta: number): void {
  const el = getEl(FARMING_ACCRUAL_HINT_ID);
  if (!el) return;
  if (accrualHintTimer) window.clearTimeout(accrualHintTimer);
  el.textContent = `+${delta} SEED`;
  accrualHintTimer = window.setTimeout(() => {
    el.textContent = '';
    accrualHintTimer = 0;
  }, 1200);
}

function tickAccrual(): void {
  const delta = GameStore.applyAccrual();
  GameStore.save();
  if (delta > 0) showAccrualHint(delta);
  refreshShellStatus();
}

function openUpgradeModal(): void {
  const cost = getNextUnlockCost(GameStore.state.unlockedDeckCount);
  if (!cost) return;

  const backdrop = getEl(LOFT_MODAL_BACKDROP_ID);
  const costEl = getEl(LOFT_MODAL_COST_ID);
  const confirmBtn = getEl(LOFT_MODAL_CONFIRM_ID) as HTMLButtonElement | null;
  if (!backdrop || !costEl) return;

  costEl.textContent = `SEED ${cost.seed} + $BIRD ${cost.bird}`;
  const canAfford = GameStore.state.seed >= cost.seed && GameStore.birdCurrency >= cost.bird;
  if (confirmBtn) confirmBtn.disabled = !canAfford;

  backdrop.classList.add('visible');
  backdrop.setAttribute('aria-hidden', 'false');
}

function closeUpgradeModal(): void {
  const backdrop = getEl(LOFT_MODAL_BACKDROP_ID);
  if (!backdrop) return;
  backdrop.classList.remove('visible');
  backdrop.setAttribute('aria-hidden', 'true');
}

function confirmUpgrade(): void {
  if (!GameStore.unlockNextDeckSlot()) return;
  GameStore.save();
  closeUpgradeModal();
  refresh();
}

function initModalListeners(): void {
  const cancel = getEl(LOFT_MODAL_CANCEL_ID);
  const confirm = getEl(LOFT_MODAL_CONFIRM_ID);
  const backdrop = getEl(LOFT_MODAL_BACKDROP_ID);

  cancel?.addEventListener('click', closeUpgradeModal);
  confirm?.addEventListener('click', confirmUpgrade);
  backdrop?.addEventListener('click', (e) => {
    if (e.target === backdrop) closeUpgradeModal();
  });
}

/** Call when Farming tab becomes visible. Renders loft, starts accrual interval, updates status. */
export function refresh(): void {
  renderLoft();
  updateUpgradeButton();
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
    if (SPRITE_FRAME_COUNT <= 0) return;
    spriteTick += 1;
    document.querySelectorAll<HTMLImageElement>('.loft-bird-anim-common').forEach((img) => {
      const lag = Number(img.dataset.commonLagTick ?? '0');
      const started = img.dataset.commonStarted === '1';
      if (!started) {
        // ラグ分だけ待機。超えたら frame1 からスタート。
        if (spriteTick >= lag) {
          img.dataset.commonStarted = '1';
          img.dataset.commonFrameIndex = '0';
          img.src = COMMON_FRAME_SRCS[0];
        } else {
          img.src = COMMON_FRAME_SRCS[0];
        }
        return;
      }
      // 開始後は各鳥ごとに 0→1→2→3→0… と進める
      const current = Number(img.dataset.commonFrameIndex ?? '0');
      const next = (current + 1) % SPRITE_FRAME_COUNT;
      img.dataset.commonFrameIndex = String(next);
      img.src = COMMON_FRAME_SRCS[next];
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
  if (spriteIntervalId) {
    clearInterval(spriteIntervalId);
    spriteIntervalId = 0;
  }
}

/** Call once when shell is shown to wire upgrade button and modal. */
export function init(): void {
  initModalListeners();
  const btn = getEl(LOFT_UPGRADE_BTN_ID);
  btn?.addEventListener('click', () => {
    if (getNextUnlockCost(GameStore.state.unlockedDeckCount) != null) openUpgradeModal();
  });
}
