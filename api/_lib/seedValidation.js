/**
 * Server-side seed validation.
 * Computes the theoretical maximum seed increase and caps values that exceed it.
 * Controlled by SEED_VALIDATION env var: "strict" = enforce, anything else = permissive.
 */

// --- Constants (mirrored from src/types.ts) ---
const GAME_START_MS = Date.UTC(2026, 2, 5); // 2026-03-05T00:00:00Z (month is 0-indexed)
const HALVING_INTERVAL_DAYS = 14;
const INITIAL_BASE_RATE = 120;

function getBaseRateAt(ms) {
  const daysSinceStart = Math.max(0, ms - GAME_START_MS) / 86400000;
  const epoch = Math.floor(daysSinceStart / HALVING_INTERVAL_DAYS);
  return INITIAL_BASE_RATE / Math.pow(2, epoch);
}

const RARITY_COEFFICIENTS = {
  Common: 1.0,
  Uncommon: 1.3,
  Rare: 1.8,
  Epic: 2.6,
  Legendary: 4.0,
};

const MAX_SET_BONUS = 1.5;
const MAX_LOFT_LEVEL = 6;
const CLOCK_DRIFT_SECONDS = 60;
const FIXED_TOLERANCE = 10;

/**
 * Parse a BirdTypeKey (e.g. "C_bengalese_white") to extract rarity code.
 */
function rarityFromBirdTypeKey(key) {
  const code = typeof key === "string" ? key.split("_")[0] : null;
  const map = { C: "Common", U: "Uncommon", R: "Rare", E: "Epic", L: "Legendary" };
  return map[code] || null;
}

/**
 * Collect all rarity coefficients from birdsOwned + inventory.
 * Returns a sorted (desc) array of coefficients for every bird the player owns.
 */
function collectAllRarityCoeffs(state) {
  const coeffs = [];

  // birdsOwned (individual Bird objects)
  if (Array.isArray(state.birdsOwned)) {
    for (const bird of state.birdsOwned) {
      const c = RARITY_COEFFICIENTS[bird?.rarity];
      if (c != null) coeffs.push(c);
    }
  }

  // inventory (BirdTypeKey → count)
  if (state.inventory && typeof state.inventory === "object") {
    for (const [typeKey, count] of Object.entries(state.inventory)) {
      if (typeof count !== "number" || count <= 0) continue;
      const rarity = rarityFromBirdTypeKey(typeKey);
      const c = RARITY_COEFFICIENTS[rarity];
      if (c != null) {
        for (let i = 0; i < count; i++) coeffs.push(c);
      }
    }
  }

  coeffs.sort((a, b) => b - a); // descending
  return coeffs;
}

/**
 * Compute the generous maximum seed increase between prevState and newState.
 * @param {object} prevState - previously saved game state
 * @param {object} newState  - incoming game state from client
 * @param {number} nowMs     - current server time in ms
 * @returns {number} maxDelta
 */
export function computeMaxSeedIncrease(prevState, newState, nowMs) {
  // Use the higher loftLevel (covers upgrade-then-save)
  const loftLevel = Math.min(
    MAX_LOFT_LEVEL,
    Math.max(prevState.loftLevel || 1, newState.loftLevel || 1)
  );
  const activeSlots = Math.min(loftLevel * 2, 12);

  // Union of all birds from both states → take the top N coefficients
  const prevCoeffs = collectAllRarityCoeffs(prevState);
  const newCoeffs = collectAllRarityCoeffs(newState);
  const allCoeffs = prevCoeffs.length >= newCoeffs.length ? prevCoeffs : newCoeffs;
  // Take top activeSlots coefficients
  const topCoeffs = allCoeffs.slice(0, activeSlots);
  const rarityCoeffSum = topCoeffs.reduce((s, c) => s + c, 0);

  if (rarityCoeffSum <= 0) return FIXED_TOLERANCE;

  const maxRate = getBaseRateAt(nowMs) * rarityCoeffSum * MAX_SET_BONUS;

  // Elapsed time from last accrual, with clock drift tolerance
  let lastAccrualMs;
  try {
    lastAccrualMs = new Date(prevState.lastAccrualAt).getTime();
    if (!Number.isFinite(lastAccrualMs)) lastAccrualMs = nowMs;
  } catch {
    lastAccrualMs = nowMs;
  }
  const elapsedMs = Math.max(0, nowMs - lastAccrualMs + CLOCK_DRIFT_SECONDS * 1000);
  const elapsedHours = elapsedMs / 3600000;

  const maxDelta = Math.floor(elapsedHours * maxRate) + FIXED_TOLERANCE;
  return maxDelta;
}

/**
 * Validate and optionally cap the seed in newState.
 * @param {object} newState  - incoming game state (will NOT be mutated)
 * @param {object|null} prevState - previously saved state, or null for first save
 * @returns {{ state: object, capped: boolean, original?: number }}
 */
export function validateAndCapSeed(newState, prevState) {
  // Permissive mode: pass through unchanged
  if (process.env.SEED_VALIDATION !== "strict") {
    return { state: newState, capped: false };
  }

  const newSeed = typeof newState.seed === "number" ? newState.seed : 0;

  // First save: cap at FIXED_TOLERANCE
  if (!prevState) {
    if (newSeed > FIXED_TOLERANCE) {
      console.warn(
        `[seedValidation] first save capped: ${newSeed} → ${FIXED_TOLERANCE}`
      );
      return {
        state: { ...newState, seed: FIXED_TOLERANCE },
        capped: true,
        original: newSeed,
      };
    }
    return { state: newState, capped: false };
  }

  const prevSeed = typeof prevState.seed === "number" ? prevState.seed : 0;

  // Seed decreased (e.g. after claim) → always safe
  if (newSeed <= prevSeed) {
    return { state: newState, capped: false };
  }

  // Compute generous cap
  const nowMs = Date.now();
  const maxDelta = computeMaxSeedIncrease(prevState, newState, nowMs);
  const cap = prevSeed + maxDelta;

  if (newSeed > cap) {
    console.warn(
      `[seedValidation] capped: ${newSeed} → ${cap} (prev=${prevSeed}, maxDelta=${maxDelta})`
    );
    return {
      state: { ...newState, seed: cap },
      capped: true,
      original: newSeed,
    };
  }

  return { state: newState, capped: false };
}
