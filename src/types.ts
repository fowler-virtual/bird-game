export type GemType = 'sapphire' | 'ruby' | 'emerald' | 'diamond';

export interface Gems {
  sapphire: number;
  ruby: number;
  emerald: number;
  diamond: number;
}

export type BirdRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';

// 鳥の種族：文鳥・インコの2種、各4色で8種類。レアリティ5種で全40種類
export type BirdSpecies = 'bengalese' | 'parrot'; // 文鳥, インコ
export const BIRD_SPECIES: BirdSpecies[] = ['bengalese', 'parrot'];

export type BirdColor = 'white' | 'brown' | 'blue' | 'gold';
export const BIRD_COLORS: BirdColor[] = ['white', 'brown', 'blue', 'gold'];

/** 待機リストの行順：文鳥4色 → インコ4色（8行） */
export const BIRD_TYPE_ROW_ORDER: { species: BirdSpecies; color: BirdColor }[] = (() => {
  const rows: { species: BirdSpecies; color: BirdColor }[] = [];
  for (const species of BIRD_SPECIES) {
    for (const color of BIRD_COLORS) {
      rows.push({ species, color });
    }
  }
  return rows;
})();

/** rarity + species + color で定義されるキー例: "C_finch_white" */
export type BirdTypeKey = string;

export function makeBirdTypeKeyFromParts(
  rarity: BirdRarity,
  species: BirdSpecies,
  color: BirdColor
): BirdTypeKey {
  const r =
    rarity === 'Common'
      ? 'C'
      : rarity === 'Uncommon'
        ? 'U'
        : rarity === 'Rare'
          ? 'R'
          : rarity === 'Epic'
            ? 'E'
            : 'L';
  return `${r}_${species}_${color}`;
}

const RARITY_CODE: Record<string, BirdRarity> = {
  C: 'Common',
  U: 'Uncommon',
  R: 'Rare',
  E: 'Epic',
  L: 'Legendary',
};

/** レアリティの列順（待機リストの列＝レアリティ） */
export const RARITY_COLUMN_ORDER: BirdRarity[] = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

/** 指定レアリティの全 BirdTypeKey（species × color）を返す */
export function getBirdTypeKeysByRarity(rarity: BirdRarity): BirdTypeKey[] {
  const keys: BirdTypeKey[] = [];
  for (const species of BIRD_SPECIES) {
    for (const color of BIRD_COLORS) {
      keys.push(makeBirdTypeKeyFromParts(rarity, species, color));
    }
  }
  return keys;
}

/** 待機リストグリッドの (row, col) に対応する BirdTypeKey。row 0..7, col 0..4（レアリティ列） */
export function getBirdTypeKeyForInventoryCell(row: number, col: number): BirdTypeKey | null {
  const r = BIRD_TYPE_ROW_ORDER[row];
  const rarity = RARITY_COLUMN_ORDER[col];
  if (!r || !rarity) return null;
  return makeBirdTypeKeyFromParts(rarity, r.species, r.color);
}

/** BirdTypeKey を rarity/species/color に分解 */
export function parseBirdTypeKey(key: BirdTypeKey): { rarity: BirdRarity; species: BirdSpecies; color: BirdColor } | null {
  const parts = key.split('_');
  if (parts.length !== 3) return null;
  const rarity = RARITY_CODE[parts[0]];
  const species = parts[1] as BirdSpecies;
  const color = parts[2] as BirdColor;
  if (!rarity || !BIRD_SPECIES.includes(species) || !BIRD_COLORS.includes(color)) return null;
  return { rarity, species, color };
}

/** レアリティ → Phaser テクスチャキー（public/*.png を preload で読み込む） */
export const RARITY_TEXTURE_KEYS: Record<BirdRarity, string> = {
  Common: 'rarity-common',
  Uncommon: 'rarity-uncommon',
  Rare: 'rarity-rare',
  Epic: 'rarity-epic',
  Legendary: 'rarity-legendary',
};

export const RARITY_COEFFICIENTS: Record<BirdRarity, number> = {
  Common: 1.0,
  Uncommon: 1.3,
  Rare: 1.8,
  Epic: 2.6,
  Legendary: 4.0,
};

export interface Bird {
  id: string;
  rarity: BirdRarity;
  createdAt: string;
  /** 追加情報。既存セーブには入っていない可能性があるため optional */
  species?: BirdSpecies;
  color?: BirdColor;
}

export type DeckSlotId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

export type DeckSlots = (string | null)[];

export interface GameState {
  gems: Gems;
  birdsOwned: Bird[];
  deckSlots: DeckSlots;
  lastAccrualAt: string;
  unlockedDeckCount: number;
  /** Loft Lv（1〜4）。Lv1=2枠, Lv2=4枠, Lv3=6枠, Lv4=8枠。未存在時マイグレーションで1。 */
  loftLevel: number;
  /** BirdTypeKey ごとの待機数（個体ではなくスタック管理） */
  inventory: Record<BirdTypeKey, number>;
  /** 初回無料ガチャ権利 */
  hasFreeGacha: boolean;
  /** 「配置してSEEDを集めよう」チュートリアルを既に表示したか */
  hasShownPlacementHint: boolean;
  /** 放置で増える通貨（持ち帰り報酬） */
  seed: number;
  /** 初回プレイ導線: need_gacha → need_place → need_farming → done */
  onboardingStep?: 'need_gacha' | 'need_place' | 'need_farming' | 'done';
}

const DECK_SLOT_IDS: DeckSlotId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
export { DECK_SLOT_IDS };

/** Loft解放コスト（SEED + $Bird）。2→4→6→8枠の3回解放 */
export const DECK_UNLOCK_COSTS: { seed: number; bird: number }[] = [
  { seed: 500, bird: 200 },
  { seed: 1200, bird: 500 },
  { seed: 2500, bird: 1200 },
];

export function getNextUnlockCost(unlockedDeckCount: number): { seed: number; bird: number } | null {
  if (unlockedDeckCount >= 8) return null;
  const index = unlockedDeckCount === 2 ? 0 : unlockedDeckCount === 4 ? 1 : unlockedDeckCount === 6 ? 2 : -1;
  if (index < 0) return null;
  return DECK_UNLOCK_COSTS[index] ?? null;
}

export const INITIAL_UNLOCKED_DECK_COUNT = 2;

/** Loft Lv1=2枠, Lv2=4枠, Lv3=6枠, Lv4=8枠 */
export const MAX_LOFT_LEVEL = 4;

export function getActiveSlotsByLoftLevel(loftLevel: number): number {
  const lv = Math.min(MAX_LOFT_LEVEL, Math.max(1, loftLevel));
  return lv * 2;
}

/** その枠が有効（配置・accrual対象）か */
export function isSlotActive(state: GameState, slotIndex: number): boolean {
  const count = getActiveSlotsByLoftLevel(state.loftLevel);
  return slotIndex >= 0 && slotIndex < count;
}

/** 有効なデッキ枠のインデックス配列 */
export function getActiveSlotIndices(state: GameState): number[] {
  const count = getActiveSlotsByLoftLevel(state.loftLevel);
  return Array.from({ length: count }, (_, i) => i);
}

const BASE_RATE_PER_HOUR = 60;

/** セットボーナス種別（UI発光用） */
export type SetBonusKind = 'none' | 'species' | 'color' | 'speciesColor';

export interface SetBonusInfo {
  kind: SetBonusKind;
  multiplier: number;
}

/** 稼働中の鳥一覧からセットボーナスを判定（最大倍率1つのみ適用） */
export function evaluateSetBonus(birds: Bird[]): SetBonusInfo {
  if (birds.length === 0) return { kind: 'none', multiplier: 1 };

  const speciesAll = birds.map((b) => b.species).filter((v): v is BirdSpecies => v != null);
  const colorAll = birds.map((b) => b.color).filter((v): v is BirdColor => v != null);

  const sameSpecies =
    speciesAll.length > 0 && speciesAll.every((s) => s === speciesAll[0]);
  const sameColor = colorAll.length > 0 && colorAll.every((c) => c === colorAll[0]);

  if (sameSpecies && sameColor) {
    return { kind: 'speciesColor', multiplier: 1.5 };
  }
  if (sameSpecies) {
    return { kind: 'species', multiplier: 1.25 };
  }
  if (sameColor) {
    return { kind: 'color', multiplier: 1.15 };
  }
  return { kind: 'none', multiplier: 1 };
}

export function applyAccrualPure(
  state: GameState,
  now: Date = new Date()
): { state: GameState; delta: number } {
  let lastMs: number;
  try {
    lastMs = new Date(state.lastAccrualAt).getTime();
    if (!Number.isFinite(lastMs)) lastMs = now.getTime();
  } catch {
    lastMs = now.getTime();
  }
  const elapsedMs = Math.max(0, now.getTime() - lastMs);
  const elapsedHours = elapsedMs / 3600000;

  const activeIndices = getActiveSlotIndices(state);
  const activeBirds: Bird[] = [];
  let rarityCoeffSum = 0;
  for (const i of activeIndices) {
    const birdId = state.deckSlots[i];
    if (birdId == null) continue;
    const bird = state.birdsOwned.find((b) => b.id === birdId);
    if (!bird) continue;
    activeBirds.push(bird);
    const rarityCoeff = RARITY_COEFFICIENTS[bird.rarity] ?? 1;
    rarityCoeffSum += rarityCoeff;
  }

  if (activeBirds.length === 0 || rarityCoeffSum <= 0) {
    // 鳥が配置されていない場合も、次回の計算基準として時刻だけ更新
    return {
      state: {
        ...state,
        lastAccrualAt: now.toISOString(),
      },
      delta: 0,
    };
  }

  const { multiplier } = evaluateSetBonus(activeBirds);
  const sumRate = BASE_RATE_PER_HOUR * rarityCoeffSum * multiplier;

  const delta = Math.floor(elapsedHours * sumRate);
  if (delta <= 0) {
    // 端数が溜まるまで lastAccrualAt は更新しない（次回の経過時間が伸びる）
    return { state: { ...state }, delta: 0 };
  }
  // 加算した SEED に対応する時間だけ lastAccrualAt を進める（端数を残す）
  const consumedHours = delta / sumRate;
  const newLastMs = lastMs + consumedHours * 3600000;
  const newLastAccrualAt = new Date(newLastMs).toISOString();
  return {
    state: { ...state, seed: state.seed + delta, lastAccrualAt: newLastAccrualAt },
    delta,
  };
}

/** 現在の生産レート（SEED/時）。デッキ構成から算出 */
export function getProductionRatePerHour(state: GameState): number {
  const activeIndices = getActiveSlotIndices(state);
  let rarityCoeffSum = 0;
  const activeBirds: Bird[] = [];
  for (const i of activeIndices) {
    const birdId = state.deckSlots[i];
    if (birdId == null) continue;
    const bird = state.birdsOwned.find((b) => b.id === birdId);
    if (!bird) continue;
    activeBirds.push(bird);
    rarityCoeffSum += RARITY_COEFFICIENTS[bird.rarity] ?? 1;
  }
  if (activeBirds.length === 0 || rarityCoeffSum <= 0) return 0;
  const { multiplier } = evaluateSetBonus(activeBirds);
  return BASE_RATE_PER_HOUR * rarityCoeffSum * multiplier;
}

/** プロトタイプ用：ネットワーク全体の生産レート（仮）。本番ではAPIから取得 */
const SIMULATED_NETWORK_RATE_PER_HOUR = 700_000;

/** ユーザの生産力がネットワーク全体に占める割合（％） */
export function getNetworkSharePercent(state: GameState): number {
  const myRate = getProductionRatePerHour(state);
  if (SIMULATED_NETWORK_RATE_PER_HOUR <= 0) return 0;
  return (myRate / SIMULATED_NETWORK_RATE_PER_HOUR) * 100;
}

export function getBirdById(state: GameState, birdId: string): Bird | undefined {
  return state.birdsOwned.find((b) => b.id === birdId);
}

export function getStandbyBirds(state: GameState): Bird[] {
  const inDeck = new Set(state.deckSlots.filter((id): id is string => id != null));
  return state.birdsOwned.filter((b) => !inDeck.has(b.id));
}

/** デッキに配置されている鳥（有効枠のみ） */
export function getActiveBirdsInDeck(state: GameState): Bird[] {
  const birds: Bird[] = [];
  for (const i of getActiveSlotIndices(state)) {
    const birdId = state.deckSlots[i];
    if (birdId == null) continue;
    const bird = getBirdById(state, birdId);
    if (bird) birds.push(bird);
  }
  return birds;
}

const RARITY_WEIGHTS: { rarity: BirdRarity; weight: number }[] = [
  { rarity: 'Common', weight: 60 },
  { rarity: 'Uncommon', weight: 25 },
  { rarity: 'Rare', weight: 10 },
  { rarity: 'Epic', weight: 4 },
  { rarity: 'Legendary', weight: 1 },
];

export function rollGachaRarity(): BirdRarity {
  const total = RARITY_WEIGHTS.reduce((s, r) => s + r.weight, 0);
  let r = Math.random() * total;
  for (const { rarity, weight } of RARITY_WEIGHTS) {
    r -= weight;
    if (r <= 0) return rarity;
  }
  return 'Common';
}

export function generateBirdId(): string {
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
