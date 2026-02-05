import type { GameState, Gems, Bird, DeckSlots, BirdTypeKey } from '../types';
import {
  DECK_SLOT_IDS,
  applyAccrualPure,
  getNextUnlockCost,
  INITIAL_UNLOCKED_DECK_COUNT,
  isSlotActive,
  BIRD_SPECIES,
  BIRD_COLORS,
  makeBirdTypeKeyFromParts,
  parseBirdTypeKey,
  generateBirdId,
  rollGachaRarity,
} from '../types';

const GACHA_COST = 10;

const GAME_STATE_KEY = 'bird-game-state';
const BIRD_CURRENCY_KEY = 'bird-game-currency';
const WALLET_KEY = 'bird-game-wallet';

/** ウォレットアドレスごとのストレージキー用（同一アドレスは大文字小文字同一扱い） */
function storagePrefix(address: string | null): string {
  if (!address || typeof address !== 'string') return '';
  return address.toLowerCase();
}

function stateKeyFor(prefix: string): string {
  return prefix ? `bird-game-state-${prefix}` : GAME_STATE_KEY;
}

function currencyKeyFor(prefix: string): string {
  return prefix ? `bird-game-currency-${prefix}` : BIRD_CURRENCY_KEY;
}

const DEFAULT_GEMS: Gems = {
  sapphire: 0,
  ruby: 0,
  emerald: 0,
  diamond: 0,
};

function defaultGameState(): GameState {
  return {
    gems: { ...DEFAULT_GEMS },
    birdsOwned: [],
    deckSlots: DECK_SLOT_IDS.map(() => null),
    lastAccrualAt: new Date().toISOString(),
    unlockedDeckCount: INITIAL_UNLOCKED_DECK_COUNT,
    loftLevel: 1,
    inventory: {},
    hasFreeGacha: true,
    hasShownPlacementHint: false,
    seed: 0,
    onboardingStep: 'need_gacha',
  };
}

function parseGameState(raw: string | null): GameState {
  if (!raw) return defaultGameState();
  try {
    const parsed = JSON.parse(raw) as Partial<GameState>;
    const g: Gems = {
      sapphire: Number(parsed.gems?.sapphire) || 0,
      ruby: Number(parsed.gems?.ruby) || 0,
      emerald: Number(parsed.gems?.emerald) || 0,
      diamond: Number(parsed.gems?.diamond) || 0,
    };
    const birdsOwned: Bird[] = Array.isArray(parsed.birdsOwned)
      ? parsed.birdsOwned.filter(
          (b): b is Bird =>
            b != null &&
            typeof b === 'object' &&
            typeof b.id === 'string' &&
            typeof b.rarity === 'string' &&
            typeof b.createdAt === 'string'
        )
      : [];
    const deckSlots: DeckSlots = Array.isArray(parsed.deckSlots)
      ? parsed.deckSlots.slice(0, 8).map((v) => (typeof v === 'string' ? v : null))
      : DECK_SLOT_IDS.map(() => null);
    while (deckSlots.length < 8) deckSlots.push(null);
    const lastAccrualAt =
      typeof parsed.lastAccrualAt === 'string' ? parsed.lastAccrualAt : new Date().toISOString();
    const rawUnlocked = parsed.unlockedDeckCount;
    const rawCount = typeof rawUnlocked === 'number' ? rawUnlocked : INITIAL_UNLOCKED_DECK_COUNT;
    const unlockedDeckCount = Math.min(8, Math.max(2, Math.round(rawCount / 2) * 2)) as 2 | 4 | 6 | 8;
    const rawLoft = parsed.loftLevel;
    const loftLevel =
      typeof rawLoft === 'number' && rawLoft >= 1 && rawLoft <= 4 ? rawLoft : Math.min(4, Math.max(1, unlockedDeckCount / 2));
    for (let i = unlockedDeckCount; i < deckSlots.length; i++) {
      deckSlots[i] = null;
    }

    // inventory / hasFreeGacha / hasShownPlacementHint のマイグレーション
    const inventory: Record<BirdTypeKey, number> =
      (parsed as GameState).inventory && typeof (parsed as GameState).inventory === 'object'
        ? { ...(parsed as GameState).inventory }
        : {};
    const hasFreeGacha =
      typeof (parsed as GameState).hasFreeGacha === 'boolean'
        ? (parsed as GameState).hasFreeGacha
        : true;
    const hasShownPlacementHint =
      typeof (parsed as GameState).hasShownPlacementHint === 'boolean'
        ? (parsed as GameState).hasShownPlacementHint
        : false;
    const seed =
      typeof (parsed as GameState).seed === 'number' && (parsed as GameState).seed >= 0
        ? (parsed as GameState).seed
        : Number(parsed.gems?.diamond) || 0;
    const rawStep = (parsed as GameState).onboardingStep;
    const onboardingStep =
      rawStep === 'need_gacha' || rawStep === 'need_place' || rawStep === 'need_farming' || rawStep === 'done'
        ? rawStep
        : 'done';

    return {
      gems: g,
      birdsOwned,
      deckSlots,
      lastAccrualAt,
      unlockedDeckCount,
      loftLevel,
      inventory,
      hasFreeGacha,
      hasShownPlacementHint,
      seed,
      onboardingStep,
    };
  } catch {
    return defaultGameState();
  }
}

function parseBirdCurrency(raw: string | null): number {
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseWallet(raw: string | null): { connected: boolean; address: string | null } {
  if (!raw) return { connected: false, address: null };
  try {
    const p = JSON.parse(raw) as { connected?: boolean; address?: string | null };
    return {
      connected: p.connected === true,
      address: typeof p.address === 'string' ? p.address : null,
    };
  } catch {
    return { connected: false, address: null };
  }
}

export const GameStore = {
  state: defaultGameState() as GameState,
  birdCurrency: 0 as number,
  walletConnected: false,
  walletAddress: null as string | null,
  /** load() が一度でも成功していれば true。false の間は save() で上書きしない（接続時にデータが消えるのを防ぐ） */
  loadedFromStorage: false,

  load(): void {
    try {
      const wallet = parseWallet(localStorage.getItem(WALLET_KEY));
      this.walletConnected = wallet.connected;
      this.walletAddress = wallet.address;
      this.loadStateForCurrentWallet();
    } catch (e) {
      console.error('[Bird Game] GameStore.load failed, keeping in-memory state only:', e);
    }
  },

  /** 現在の walletAddress に紐づくゲームデータを localStorage から読み込む（ウォレットごとにデータを分離） */
  loadStateForCurrentWallet(): void {
    try {
      const prefix = storagePrefix(this.walletAddress);
      let rawState = localStorage.getItem(stateKeyFor(prefix));
      let rawCurrency: string | null = null;
      if (prefix) {
        if (!rawState) rawState = localStorage.getItem(GAME_STATE_KEY);
        rawCurrency = localStorage.getItem(currencyKeyFor(prefix));
        if (rawCurrency == null) rawCurrency = localStorage.getItem(BIRD_CURRENCY_KEY);
      } else {
        rawCurrency = localStorage.getItem(BIRD_CURRENCY_KEY);
      }
      this.state = parseGameState(rawState);
      this.birdCurrency = parseBirdCurrency(rawCurrency);
      this.rebuildInventory();
      this.normalizeOnboardingStep();
      this.loadedFromStorage = true;
    } catch (e) {
      console.error('[Bird Game] loadStateForCurrentWallet failed:', e);
    }
  },

  setWalletConnected(connected: boolean, address?: string | null): void {
    const nextAddress = connected && address != null ? address : null;
    const changed = this.walletAddress !== nextAddress;
    this.walletConnected = connected;
    this.walletAddress = nextAddress;
    if (changed && this.walletAddress) this.loadStateForCurrentWallet();
    this.persistWallet();
  },

  /** localStorage に現在のウォレット状態を書き込む（Disconnect 時も確実に反映） */
  persistWallet(): void {
    localStorage.setItem(
      WALLET_KEY,
      JSON.stringify({ connected: this.walletConnected, address: this.walletAddress })
    );
  },

  /** 永続化されたウォレット状態を読む（TitleScene はこれで判定し、メモリと不整合を防ぐ） */
  getPersistedWallet(): { connected: boolean; address: string | null } {
    return parseWallet(localStorage.getItem(WALLET_KEY));
  },

  /** 切断を明示的に実行。先に localStorage を上書きしてからメモリを更新する */
  disconnectWallet(): void {
    localStorage.setItem(WALLET_KEY, JSON.stringify({ connected: false, address: null }));
    this.walletConnected = false;
    this.walletAddress = null;
  },

  save(): void {
    if (!this.loadedFromStorage) return;
    const prefix = storagePrefix(this.walletAddress);
    localStorage.setItem(stateKeyFor(prefix), JSON.stringify(this.state));
    localStorage.setItem(currencyKeyFor(prefix), String(Math.max(0, Math.floor(this.birdCurrency))));
  },

  /** 読み込み後: デッキに鳥がいればオンボーディング完了扱いにして Farming を押せるようにする */
  normalizeOnboardingStep(): void {
    const step = this.state.onboardingStep;
    if (step === 'done') return;
    const hasBirdOnDeck = this.state.deckSlots.some((id) => id != null);
    if (hasBirdOnDeck) {
      this.state = { ...this.state, onboardingStep: 'done' };
    }
  },

  /** デバッグ用: ゲーム状態を初期化し、オンボーディングからやり直せるようにする */
  resetToInitial(): void {
    this.state = defaultGameState();
    this.birdCurrency = 0;
    if (this.loadedFromStorage) this.save();
  },

  setState(patch: Partial<GameState>): void {
    this.state = { ...this.state, ...patch };
    if (patch.gems) this.state = { ...this.state, gems: { ...this.state.gems, ...patch.gems } };
    if (patch.deckSlots) this.state = { ...this.state, deckSlots: [...patch.deckSlots] };
    if (patch.birdsOwned) this.state = { ...this.state, birdsOwned: [...patch.birdsOwned] };
    if (patch.unlockedDeckCount !== undefined) this.state = { ...this.state, unlockedDeckCount: patch.unlockedDeckCount };
    if (patch.loftLevel !== undefined) this.state = { ...this.state, loftLevel: patch.loftLevel };
    if (patch.inventory) this.state = { ...this.state, inventory: { ...patch.inventory } };
    if (patch.hasFreeGacha !== undefined) this.state = { ...this.state, hasFreeGacha: patch.hasFreeGacha };
    if (patch.hasShownPlacementHint !== undefined) this.state = { ...this.state, hasShownPlacementHint: patch.hasShownPlacementHint };
    if (patch.seed !== undefined) this.state = { ...this.state, seed: patch.seed };
    if (patch.onboardingStep !== undefined) this.state = { ...this.state, onboardingStep: patch.onboardingStep };
  },


  /** Bird から BirdTypeKey を生成（species/color 未設定時はデフォルトを補完） */
  getBirdTypeKey(bird: Bird): BirdTypeKey {
    const species = bird.species ?? BIRD_SPECIES[0];
    const color = bird.color ?? BIRD_COLORS[0];
    return makeBirdTypeKeyFromParts(bird.rarity, species, color);
  },

  /** birdsOwned / deckSlots から inventory を再構築する */
  rebuildInventory(): void {
    const inv: Record<BirdTypeKey, number> = {};
    const inDeck = new Set(this.state.deckSlots.filter((id): id is string => id != null));
    for (const bird of this.state.birdsOwned) {
      const key = this.getBirdTypeKey(bird);
      if (inDeck.has(bird.id)) continue;
      inv[key] = (inv[key] ?? 0) + 1;
    }
    this.state = { ...this.state, inventory: inv };
  },

  unlockNextDeckSlot(): boolean {
    const cost = getNextUnlockCost(this.state.unlockedDeckCount);
    if (!cost) return false;
    if (this.state.seed < cost.seed || this.birdCurrency < cost.bird) return false;
    const nextCount = (this.state.unlockedDeckCount + 2) as 2 | 4 | 6 | 8;
    this.state = {
      ...this.state,
      seed: this.state.seed - cost.seed,
      unlockedDeckCount: Math.min(8, nextCount),
      loftLevel: Math.min(4, nextCount / 2),
    };
    this.spendBirdCurrency(cost.bird);
    return true;
  },

  addBird(bird: Bird): void {
    // species / color が無ければランダムで補完
    if (!bird.species) {
      bird.species = BIRD_SPECIES[Math.floor(Math.random() * BIRD_SPECIES.length)];
    }
    if (!bird.color) {
      bird.color = BIRD_COLORS[Math.floor(Math.random() * BIRD_COLORS.length)];
    }
    const key = this.getBirdTypeKey(bird);

    this.state = {
      ...this.state,
      birdsOwned: [...this.state.birdsOwned, bird],
      inventory: {
        ...this.state.inventory,
        [key]: (this.state.inventory[key] ?? 0) + 1,
      },
    };
  },

  setDeckSlot(slotIndex: number, birdId: string | null): void {
    if (birdId != null && !isSlotActive(this.state, slotIndex)) return;
    const next = [...this.state.deckSlots];
    next[slotIndex] = birdId;
    this.state = { ...this.state, deckSlots: next };
  },

  /** 待機リストから鳥を1羽デッキに配置（inventory を 1 減らし、birdsOwned + deckSlots に追加） */
  placeBirdOnDeck(slotIndex: number, birdTypeKey: BirdTypeKey): boolean {
    if (!isSlotActive(this.state, slotIndex)) return false;
    if (this.state.deckSlots[slotIndex] != null) return false;
    const count = this.state.inventory[birdTypeKey] ?? 0;
    if (count < 1) return false;
    const parts = parseBirdTypeKey(birdTypeKey);
    if (!parts) return false;
    const bird: Bird = {
      id: generateBirdId(),
      rarity: parts.rarity,
      species: parts.species,
      color: parts.color,
      createdAt: new Date().toISOString(),
    };
    this.state = {
      ...this.state,
      birdsOwned: [...this.state.birdsOwned, bird],
      deckSlots: this.state.deckSlots.map((id, i) => (i === slotIndex ? bird.id : id)) as DeckSlots,
      inventory: { ...this.state.inventory, [birdTypeKey]: count - 1 },
    };
    return true;
  },

  /** デッキ枠の鳥を外して待機リストに戻す */
  removeBirdFromDeck(slotIndex: number): boolean {
    const birdId = this.state.deckSlots[slotIndex];
    if (birdId == null) return false;
    const bird = this.state.birdsOwned.find((b) => b.id === birdId);
    if (!bird) return false;
    const key = this.getBirdTypeKey(bird);
    const count = this.state.inventory[key] ?? 0;
    this.state = {
      ...this.state,
      birdsOwned: this.state.birdsOwned.filter((b) => b.id !== birdId),
      deckSlots: this.state.deckSlots.map((id, i) => (i === slotIndex ? null : id)) as DeckSlots,
      inventory: { ...this.state.inventory, [key]: count + 1 },
    };
    return true;
  },

  applyAccrual(now?: Date): number {
    const { state: nextState, delta } = applyAccrualPure(this.state, now);
    this.state = nextState;
    return delta;
  },

  spendBirdCurrency(amount: number): void {
    this.birdCurrency = Math.max(0, this.birdCurrency - amount);
  },

  /**
   * ガチャを N 回引く。1回目無料（hasFreeGacha）の場合はその1回は $BIRD 消費なし。
   * @returns ok: false のとき error にメッセージ、birds は空。ok: true のとき birds に今回引いた鳥。
   */
  pullGacha(count: 1 | 10): { ok: boolean; error?: string; birds: Bird[] } {
    if (!this.walletConnected) {
      return { ok: false, error: 'Please connect your wallet.', birds: [] };
    }
    const freePulls = this.state.hasFreeGacha ? 1 : 0;
    const paidPulls = Math.max(0, count - freePulls);
    const cost = paidPulls * GACHA_COST;
    if (this.birdCurrency < cost) {
      return { ok: false, error: `Not enough $BIRD. (Required: ${cost})`, birds: [] };
    }

    const birds: Bird[] = [];
    for (let i = 0; i < count; i++) {
      const isFree = i === 0 && this.state.hasFreeGacha;
      if (!isFree) this.spendBirdCurrency(GACHA_COST);
      else this.setState({ hasFreeGacha: false });

      const rarity = isFree ? 'Common' : rollGachaRarity();
      const species = BIRD_SPECIES[Math.floor(Math.random() * BIRD_SPECIES.length)];
      const color = BIRD_COLORS[Math.floor(Math.random() * BIRD_COLORS.length)];
      const bird: Bird = {
        id: generateBirdId(),
        rarity,
        createdAt: new Date().toISOString(),
        species,
        color,
      };
      this.addBird(bird);
      birds.push(bird);
    }

    this.applyAccrual();
    this.save();
    return { ok: true, birds };
  },
};
