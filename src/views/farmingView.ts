/**
 * Farming tab: Loft grid + Upgrade. Pure HTML+CSS, no Phaser.
 * Reads/writes GameStore; calls updateShellStatus for status cards.
 */

import { GameStore } from '../store/GameStore';
import { getActiveSlotIndices, getBirdById, getNextUnlockCost, getProductionRatePerHour, getActiveSlotsByLoftLevel } from '../types';
import { RARITY_IMAGE_SRC } from '../domShell';
import { updateShellStatus } from '../domShell';
import { MAX_LOFT_LEVEL } from '../types';

const LOFT_GRID_ID = 'loft-grid';
const LOFT_UPGRADE_BTN_ID = 'loft-upgrade-btn';
const FARMING_ACCRUAL_HINT_ID = 'farming-accrual-hint';
const LOFT_MODAL_BACKDROP_ID = 'loft-modal-backdrop';
const LOFT_MODAL_COST_ID = 'loft-modal-cost';
const LOFT_MODAL_CANCEL_ID = 'loft-modal-cancel';
const LOFT_MODAL_CONFIRM_ID = 'loft-modal-confirm';

let accrualIntervalId = 0;
let accrualHintTimer = 0;

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
          img.src = RARITY_IMAGE_SRC[bird.rarity];
          img.alt = bird.rarity;
          img.className = 'loft-bird-img';
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
  const slots = getActiveSlotsByLoftLevel(state.loftLevel);
  updateShellStatus({
    seed: state.seed,
    seedPerDay: ratePerDay,
    loftLevel: state.loftLevel,
    slots: `${slots}/${MAX_LOFT_LEVEL * 2}`,
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
  renderLoft();
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
}

/** Call once when shell is shown to wire upgrade button and modal. */
export function init(): void {
  initModalListeners();
  const btn = getEl(LOFT_UPGRADE_BTN_ID);
  btn?.addEventListener('click', () => {
    if (getNextUnlockCost(GameStore.state.unlockedDeckCount) != null) openUpgradeModal();
  });
}
