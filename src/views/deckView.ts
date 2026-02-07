/**
 * Deck tab: Deck slots + Inventory. Pure HTML+CSS, no Phaser.
 * Uses GameStore.placeBirdOnDeck / removeBirdFromDeck.
 */

import { GameStore } from '../store/GameStore';
import {
  DECK_SLOT_IDS,
  getBirdById,
  getActiveSlotIndices,
  getBirdTypeKeyForInventoryCell,
  parseBirdTypeKey,
  getProductionRatePerHour,
  getNetworkSharePercent,
} from '../types';
import { RARITY_IMAGE_SRC } from '../assets';
import { updateShellStatus, switchToTab, updateTabsForOnboarding } from '../domShell';

const DECK_GRID_ID = 'deck-grid';
const INVENTORY_GRID_ID = 'inventory-grid';
const DECK_INVENTORY_HINT_ID = 'deck-inventory-hint';

const INVENTORY_COLS = 5;
const INVENTORY_ROWS = 8;

let deckFullHintTimer = 0;

function getEl(id: string): HTMLElement | null {
  return document.getElementById(id);
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

const HINT_DEFAULT = 'Tap a bird to add to Loft (A→L in order). Tap a Loft slot to remove.';
const HINT_DECK_FULL = 'No empty slot. Unlock more with Loft upgrade.';
const HINT_ONBOARDING_PLACE = 'Tap your adopted bird below to place it on your Loft.';

function updateHint(text?: string): void {
  const hint = getEl(DECK_INVENTORY_HINT_ID);
  if (!hint) return;
  const step = GameStore.state.onboardingStep;
  const defaultText = step === 'need_place' ? HINT_ONBOARDING_PLACE : HINT_DEFAULT;
  hint.textContent = text ?? defaultText;
}

function renderDeck(): void {
  const grid = getEl(DECK_GRID_ID);
  if (!grid) return;

  const state = GameStore.state;
  const activeIndices = getActiveSlotIndices(state);

  grid.innerHTML = '';
  for (const i of activeIndices) {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'deck-slot';
    slot.setAttribute('data-slot-index', String(i));
    slot.setAttribute('aria-label', `Slot ${DECK_SLOT_IDS[i]}`);

    const idLabel = document.createElement('span');
    idLabel.className = 'deck-slot-id';
    idLabel.textContent = DECK_SLOT_IDS[i];
    slot.appendChild(idLabel);

    const birdId = state.deckSlots[i];
    if (birdId) {
      const bird = getBirdById(state, birdId);
      if (bird) {
        const img = document.createElement('img');
        img.className = 'deck-slot-bird';
        img.src = RARITY_IMAGE_SRC[bird.rarity];
        img.alt = bird.rarity;
        slot.appendChild(img);
      }
    }

    slot.addEventListener('click', () => {
      if (birdId) {
        GameStore.removeBirdFromDeck(i);
        GameStore.save();
        refresh();
      }
    });

    grid.appendChild(slot);
  }
}

function renderInventory(): void {
  const grid = getEl(INVENTORY_GRID_ID);
  if (!grid) return;

  const state = GameStore.state;

  grid.innerHTML = '';
  for (let row = 0; row < INVENTORY_ROWS; row++) {
    for (let col = 0; col < INVENTORY_COLS; col++) {
      const key = getBirdTypeKeyForInventoryCell(row, col);
      if (!key) continue;

      const count = state.inventory[key] ?? 0;
      const parts = parseBirdTypeKey(key);
      if (!parts) continue;

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'inventory-cell';
      if (count < 1) cell.classList.add('unowned');
      cell.setAttribute('data-bird-type-key', key);
      (cell as HTMLButtonElement).disabled = count < 1;

      if (count >= 1) {
        const img = document.createElement('img');
        img.src = RARITY_IMAGE_SRC[parts.rarity];
        img.alt = parts.rarity;
        cell.appendChild(img);
        const countSpan = document.createElement('span');
        countSpan.className = 'inventory-count';
        countSpan.textContent = String(count);
        cell.appendChild(countSpan);
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'inventory-unowned';
        placeholder.textContent = '?';
        cell.appendChild(placeholder);
      }

      cell.addEventListener('click', () => {
        if (count < 1) return;
        const state = GameStore.state;
        const activeIndices = getActiveSlotIndices(state);
        const firstEmpty = activeIndices.find((idx) => state.deckSlots[idx] === null);
        if (firstEmpty === undefined) {
          updateHint(HINT_DECK_FULL);
          if (deckFullHintTimer) window.clearTimeout(deckFullHintTimer);
          deckFullHintTimer = window.setTimeout(() => {
            updateHint();
            deckFullHintTimer = 0;
          }, 2000);
          return;
        }
        const ok = GameStore.placeBirdOnDeck(firstEmpty, key);
        if (ok) {
          // オンボーディング中: 初めて鳥をデッキに置いたら Farming 解放ステップへ
          if (GameStore.state.onboardingStep === 'need_place') {
            GameStore.setState({ onboardingStep: 'need_farming' });
          }
          GameStore.save();
          refresh();
        }
      });

      grid.appendChild(cell);
    }
  }
}

const DECK_SLOTS_CAPTION_ID = 'deck-slots-caption';

/** Call when Deck tab becomes visible. */
export function refresh(): void {
  const state = GameStore.state;
  const activeCount = getActiveSlotIndices(state).length;
  const captionEl = document.getElementById(DECK_SLOTS_CAPTION_ID);
  if (captionEl) captionEl.textContent = `（${activeCount} slots）`;

  renderDeck();
  renderInventory();
  updateHint();
  refreshShellStatus();

  const step = GameStore.state.onboardingStep;
  const ctaEl = document.getElementById('deck-onboarding-cta');
  const gotoBtn = document.getElementById('deck-onboarding-goto-farming');
  if (ctaEl) ctaEl.style.display = step === 'need_farming' ? 'block' : 'none';
  if (gotoBtn && !(gotoBtn as HTMLButtonElement).dataset.listener) {
    (gotoBtn as HTMLButtonElement).dataset.listener = '1';
    gotoBtn.addEventListener('click', () => switchToTab('farming'));
  }
  updateTabsForOnboarding();
}

/** Call once when shell is shown. */
export function init(): void {
  // No persistent listeners; we re-bind in renderDeck/renderInventory on refresh
}
