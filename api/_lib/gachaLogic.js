/**
 * Server-side gacha logic and Loft unlock cost constants.
 * Mirrors types.ts definitions in ESM JS for use in Vercel serverless functions.
 */

export const RARITY_WEIGHTS = [
  { rarity: "Common", weight: 60 },
  { rarity: "Uncommon", weight: 25 },
  { rarity: "Rare", weight: 10 },
  { rarity: "Epic", weight: 4 },
  { rarity: "Legendary", weight: 1 },
];

export const BIRD_SPECIES = ["bengalese", "parrot"];
export const BIRD_COLORS = ["white", "brown", "blue", "gold"];

export const DECK_UNLOCK_COSTS = [
  { bird: 200 },   // 2→4
  { bird: 500 },   // 4→6
  { bird: 1200 },  // 6→8
  { bird: 2500 },  // 8→10
  { bird: 5000 },  // 10→12
];

const INITIAL_UNLOCKED_DECK_COUNT = 2;

/** 新規ユーザー用の初期 GameState を生成する */
export function createDefaultGameState() {
  return {
    gems: { sapphire: 0, ruby: 0, emerald: 0, diamond: 0 },
    birdsOwned: [],
    deckSlots: Array.from({ length: 12 }, () => null),
    lastAccrualAt: new Date().toISOString(),
    unlockedDeckCount: INITIAL_UNLOCKED_DECK_COUNT,
    loftLevel: 1,
    inventory: {},
    hasFreeGacha: true,
    hasShownPlacementHint: false,
    seed: 0,
    onboardingStep: "need_gacha",
  };
}

export function getNextUnlockCost(unlockedDeckCount) {
  if (unlockedDeckCount >= 12) return null;
  const index = (unlockedDeckCount - 2) / 2;
  if (!Number.isInteger(index)) return null;
  if (index < 0) return null;
  return DECK_UNLOCK_COSTS[index] ?? null;
}

export function rollGachaRarity() {
  const total = RARITY_WEIGHTS.reduce((s, r) => s + r.weight, 0);
  let r = Math.random() * total;
  for (const { rarity, weight } of RARITY_WEIGHTS) {
    r -= weight;
    if (r <= 0) return rarity;
  }
  return "Common";
}

export function generateBirdId() {
  return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function makeBirdTypeKeyFromParts(rarity, species, color) {
  const r =
    rarity === "Common"
      ? "C"
      : rarity === "Uncommon"
        ? "U"
        : rarity === "Rare"
          ? "R"
          : rarity === "Epic"
            ? "E"
            : "L";
  return `${r}_${species}_${color}`;
}

/**
 * Pull gacha on the server. Pure function — no side effects.
 * @param {object} state - Current GameState
 * @param {1|10} count - Number of pulls
 * @returns {{ newState: object, birds: object[] }}
 */
export function pullGachaServer(state, count) {
  const birds = [];
  let hasFreeGacha = state.hasFreeGacha;
  const newBirdsOwned = [...state.birdsOwned];
  const newInventory = { ...state.inventory };

  for (let i = 0; i < count; i++) {
    const isFree = count === 1 && i === 0 && hasFreeGacha;

    if (count === 1 && isFree) {
      hasFreeGacha = false;
    }
    if (count === 10 && i === 0 && hasFreeGacha) {
      hasFreeGacha = false;
    }

    const rarity = isFree ? "Common" : rollGachaRarity();
    const species = isFree
      ? BIRD_SPECIES[0]
      : BIRD_SPECIES[Math.floor(Math.random() * BIRD_SPECIES.length)];
    const color = isFree
      ? BIRD_COLORS[0]
      : BIRD_COLORS[Math.floor(Math.random() * BIRD_COLORS.length)];

    const bird = {
      id: generateBirdId(),
      rarity,
      createdAt: new Date().toISOString(),
      species,
      color,
    };

    const key = makeBirdTypeKeyFromParts(rarity, species, color);
    newBirdsOwned.push(bird);
    newInventory[key] = (newInventory[key] ?? 0) + 1;
    birds.push(bird);
  }

  const newState = {
    ...state,
    birdsOwned: newBirdsOwned,
    inventory: newInventory,
    hasFreeGacha,
  };

  return { newState, birds };
}
