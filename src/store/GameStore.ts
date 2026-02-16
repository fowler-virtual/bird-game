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
  generateBirdId,
  rollGachaRarity,
} from '../types';
import { putGameState } from '../gameStateApi';

const SERVER_SAVE_DEBOUNCE_MS = 2000;
let _serverSaveTimer: ReturnType<typeof setTimeout> | null = null;
let _onStale: (() => void) | null = null;
let _onSaveFailed: (() => void) | null = null;
let _onSaveSuccess: (() => void) | null = null;
let _onBootstrapPutResult: ((ok: boolean) => void) | null = null;
/** serverStateVersion が 0 のとき、初回 save() で 1 回だけ PUT(1) を試す */
let _bootstrapPutAttempted = false;
function _resetBootstrapPutAttempted(): void {
  _bootstrapPutAttempted = false;
}

function _flushServerSave(): void {
  if (GameStore.serverStateVersion <= 0) return;
  putGameState(GameStore.state, GameStore.serverStateVersion).then((r) => {
    if (r.ok) {
      GameStore.serverStateVersion = r.version;
      _onSaveSuccess?.();
    } else if (r.stale) _onStale?.();
    else _onSaveFailed?.();
  });
}

export const GACHA_COST = 10;

const GAME_STATE_KEY = 'bird-game-state';
/** オンチェーンの $SEED 残高。接続時にチェーンから取得し、ガチャ・Loft アップグレードのコストに使用。ローカルにはキャッシュ用に保存することもある。 */
const SEED_TOKEN_KEY = 'bird-game-seed-token';
/** 旧キー（bird-game-currency）。$Bird 廃止前の互換用。 */
const LEGACY_CURRENCY_KEY = 'bird-game-currency';
const WALLET_KEY = 'bird-game-wallet';

/** ウォレットアドレスごとのストレージキー用（同一アドレスは大文字小文字同一扱い） */
function storagePrefix(address: string | null): string {
  if (!address || typeof address !== 'string') return '';
  return address.toLowerCase();
}

function stateKeyFor(prefix: string): string {
  return prefix ? `bird-game-state-${prefix}` : GAME_STATE_KEY;
}

function seedTokenKeyFor(prefix: string): string {
  return prefix ? `bird-game-seed-token-${prefix}` : SEED_TOKEN_KEY;
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
      ? parsed.deckSlots.slice(0, DECK_SLOT_IDS.length).map((v) => (typeof v === 'string' ? v : null))
      : DECK_SLOT_IDS.map(() => null);
    while (deckSlots.length < DECK_SLOT_IDS.length) deckSlots.push(null);
    const lastAccrualAt =
      typeof parsed.lastAccrualAt === 'string' ? parsed.lastAccrualAt : new Date().toISOString();
    const rawUnlocked = parsed.unlockedDeckCount;
    const rawCount = typeof rawUnlocked === 'number' ? rawUnlocked : INITIAL_UNLOCKED_DECK_COUNT;
    const unlockedDeckCount = Math.min(12, Math.max(2, Math.round(rawCount / 2) * 2));
    const rawLoft = parsed.loftLevel;
    const loftLevel =
      typeof rawLoft === 'number' && rawLoft >= 1 && rawLoft <= 6 ? rawLoft : Math.min(6, Math.max(1, unlockedDeckCount / 2));
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
      rawStep === 'need_gacha' || rawStep === 'need_place' || rawStep === 'need_save' || rawStep === 'need_farming' || rawStep === 'done'
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

function parseSeedToken(raw: string | null): number {
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
  /** オンチェーンの $SEED 残高（ガチャ・Loft 等のコストに使用）。接続時にチェーンから取得。 */
  seedToken: 0 as number,
  walletConnected: false,
  walletAddress: null as string | null,
  /** load() が一度でも成功していれば true。false の間は save() で上書きしない（接続時にデータが消えるのを防ぐ） */
  loadedFromStorage: false,
  /** サーバーから取得した状態のバージョン。PUT 時に送る。0 は未取得。 */
  serverStateVersion: 0 as number,

  /** 起動時はウォレットを復元しない（毎回タイトルから Connect させ、その都度サーバー状態を取得する） */
  load(): void {
    try {
      this.walletConnected = false;
      this.walletAddress = null;
    } catch (e) {
      console.error('[Bird Game] GameStore.load failed:', e);
    }
  },

  /** 現在の walletAddress に紐づくゲームデータを localStorage から読み込む（ウォレットごとにデータを分離） */
  loadStateForCurrentWallet(): void {
    try {
      const prefix = storagePrefix(this.walletAddress);
      let rawState: string | null;
      let rawToken: string | null;
      if (prefix) {
        rawState = localStorage.getItem(stateKeyFor(prefix));
        rawToken = localStorage.getItem(seedTokenKeyFor(prefix));
      } else {
        rawState = localStorage.getItem(GAME_STATE_KEY);
        rawToken = localStorage.getItem(SEED_TOKEN_KEY) ?? localStorage.getItem(LEGACY_CURRENCY_KEY);
      }
      this.state = parseGameState(rawState);
      this.seedToken = parseSeedToken(rawToken);
      this.rebuildInventory();
      this.normalizeOnboardingStep();
      this.loadedFromStorage = true;
    } catch (e) {
      console.error('[Bird Game] loadStateForCurrentWallet failed:', e);
    }
  },

  setWalletConnected(connected: boolean, address?: string | null, opts?: { skipLoadState?: boolean }): void {
    const nextAddress = connected && address != null ? address : null;
    const changed = this.walletAddress !== nextAddress;
    this.walletConnected = connected;
    this.walletAddress = nextAddress;
    if (changed && this.walletAddress && !opts?.skipLoadState) this.loadStateForCurrentWallet();
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
    this.serverStateVersion = 0;
    _resetBootstrapPutAttempted();
  },

  save(): void {
    if (!this.loadedFromStorage) return;
    const prefix = storagePrefix(this.walletAddress);
    localStorage.setItem(stateKeyFor(prefix), JSON.stringify(this.state));
    localStorage.setItem(seedTokenKeyFor(prefix), String(Math.max(0, Math.floor(this.seedToken))));
    if (this.serverStateVersion > 0) {
      if (_serverSaveTimer != null) clearTimeout(_serverSaveTimer);
      _serverSaveTimer = setTimeout(() => {
        _serverSaveTimer = null;
        _flushServerSave();
      }, SERVER_SAVE_DEBOUNCE_MS);
    } else if (!_bootstrapPutAttempted && this.walletAddress) {
      _bootstrapPutAttempted = true;
      putGameState(this.state, 1).then(
        (r) => {
          if (r.ok) this.serverStateVersion = r.version;
          _onBootstrapPutResult?.(r.ok);
        },
        () => _onBootstrapPutResult?.(false)
      );
    }
  },

  /** 409（別デバイスで更新済み）時に呼ばれるコールバックを登録。domShell で設定。 */
  setOnStaleCallback(cb: (() => void) | null): void {
    _onStale = cb;
  },

  /** PUT が 409 以外で失敗したとき（ネットエラー等）に呼ばれるコールバック。domShell で設定。 */
  setOnSaveFailedCallback(cb: (() => void) | null): void {
    _onSaveFailed = cb;
  },

  /** PUT 成功時に呼ばれるコールバック（同期ステータス表示用）。 */
  setOnSaveSuccessCallback(cb: (() => void) | null): void {
    _onSaveSuccess = cb;
  },

  /** 初回 save 時の bootstrap PUT の結果（ok/fail）で呼ばれるコールバック。 */
  setOnBootstrapPutResult(cb: ((ok: boolean) => void) | null): void {
    _onBootstrapPutResult = cb;
  },

  /** デバウンスをキャンセルし、未送信の状態を即時に PUT する（beforeunload 用）。 */
  flushServerSave(): void {
    if (_serverSaveTimer != null) {
      clearTimeout(_serverSaveTimer);
      _serverSaveTimer = null;
    }
    _flushServerSave();
  },

  /** サーバーから取得した状態で上書き（同期の正をサーバーにする）。 */
  setStateFromServer(serverState: GameState, version: number): void {
    this.state = parseGameState(JSON.stringify(serverState));
    this.rebuildInventory();
    this.normalizeOnboardingStep();
    this.serverStateVersion = version;
    this.loadedFromStorage = true;
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
    this.seedToken = 0;
    if (this.loadedFromStorage) this.save();
  },

  /** 接続中のウォレット用の保存データを削除し、そのウォレットを「初回」の状態にする */
  clearCurrentWalletData(): void {
    const prefix = storagePrefix(this.walletAddress);
    if (!prefix) return;
    localStorage.removeItem(stateKeyFor(prefix));
    localStorage.removeItem(seedTokenKeyFor(prefix));
    this.loadStateForCurrentWallet();
    this.save();
  },

  setState(patch: Partial<GameState>): void {
    this.state = { ...this.state, ...patch };
    if (patch.gems) this.state = { ...this.state, gems: { ...this.state.gems, ...patch.gems } };
    if (patch.deckSlots) this.state = { ...this.state, deckSlots: [...patch.deckSlots] };
    if (patch.birdsOwned) this.state = { ...this.state, birdsOwned: [...patch.birdsOwned] };
    if (patch.unlockedDeckCount !== undefined) {
      const nextCount = patch.unlockedDeckCount;
      // デッキ枠数を減らしたときは、はみ出しているスロットの編成を自動的に外す
      const nextSlots = [...this.state.deckSlots];
      if (typeof nextCount === 'number') {
        for (let i = nextCount; i < nextSlots.length; i++) {
          nextSlots[i] = null;
        }
      }
      this.state = { ...this.state, unlockedDeckCount: nextCount, deckSlots: nextSlots as DeckSlots };
    }
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

  /** その BirdTypeKey を何体持っているか（インベントリ＋デッキの合計） */
  getOwnedCountByKey(key: BirdTypeKey): number {
    const inv = this.state.inventory[key] ?? 0;
    const onDeck = this.state.deckSlots.filter((id) => {
      if (id == null) return false;
      const bird = this.state.birdsOwned.find((b) => b.id === id);
      return bird ? this.getBirdTypeKey(bird) === key : false;
    }).length;
    return inv + onDeck;
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
    const nextCount = this.state.unlockedDeckCount + 2;
    this.state = {
      ...this.state,
      unlockedDeckCount: Math.min(12, nextCount),
      loftLevel: Math.min(6, nextCount / 2),
    };
    return true;
  },

  /** setLoftLevel をキャンセルしたときにローカルだけロールバックする。burn 済み $SEED は戻らない。 */
  rollbackLastLoftUpgrade(): boolean {
    if (this.state.unlockedDeckCount <= INITIAL_UNLOCKED_DECK_COUNT || this.state.loftLevel <= 1) return false;
    this.setState({
      unlockedDeckCount: this.state.unlockedDeckCount - 2,
      loftLevel: this.state.loftLevel - 1,
    });
    return true;
  },

  /** 獲得SEEDをウォレットへ送る。現在のSEEDを0にし、送金した量を返す。実際の送金はウォレット/契約側で行う想定。 */
  claimSeed(): number {
    if (this.state.seed <= 0) return 0;
    const amount = this.state.seed;
    this.state = { ...this.state, seed: 0 };
    return amount;
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

  /** 待機リストから鳥を1羽デッキに配置（既存の鳥をスロットに割り当てるだけ。birdsOwned は増やさない） */
  placeBirdOnDeck(slotIndex: number, birdTypeKey: BirdTypeKey): boolean {
    if (!isSlotActive(this.state, slotIndex)) return false;
    if (this.state.deckSlots[slotIndex] != null) return false;
    const count = this.state.inventory[birdTypeKey] ?? 0;
    if (count < 1) return false;
    const inDeck = new Set(this.state.deckSlots.filter((id): id is string => id != null));
    const bird = this.state.birdsOwned.find(
      (b) => this.getBirdTypeKey(b) === birdTypeKey && !inDeck.has(b.id)
    );
    if (!bird) return false;
    const nextSlots = [...this.state.deckSlots] as DeckSlots;
    nextSlots[slotIndex] = bird.id;
    this.state = {
      ...this.state,
      deckSlots: nextSlots,
      inventory: { ...this.state.inventory, [birdTypeKey]: count - 1 },
    };
    return true;
  },

  /** デッキ枠の鳥を外して待機リストに戻す（鳥は birdsOwned に残し、inventory のみ増やす） */
  removeBirdFromDeck(slotIndex: number): boolean {
    const birdId = this.state.deckSlots[slotIndex];
    if (birdId == null) return false;
    const bird = this.state.birdsOwned.find((b) => b.id === birdId);
    if (!bird) return false;
    const key = this.getBirdTypeKey(bird);
    const count = this.state.inventory[key] ?? 0;
    const nextSlots = [...this.state.deckSlots] as DeckSlots;
    nextSlots[slotIndex] = null;
    this.state = {
      ...this.state,
      deckSlots: nextSlots,
      inventory: { ...this.state.inventory, [key]: count + 1 },
    };
    return true;
  },

  applyAccrual(now?: Date): number {
    const { state: nextState, delta } = applyAccrualPure(this.state, now);
    this.state = nextState;
    return delta;
  },

  spendSeedToken(amount: number): void {
    this.seedToken = Math.max(0, this.seedToken - amount);
  },

  /**
   * ガチャを N 回引く。1回引くときのみ初回無料（hasFreeGacha）。10連は常に 100 $SEED。
   * @returns ok: false のとき error にメッセージ、birds は空。ok: true のとき birds に今回引いた鳥。
   */
  pullGacha(count: 1 | 10): { ok: boolean; error?: string; birds: Bird[] } {
    if (!this.walletConnected) {
      return { ok: false, error: 'Please connect your wallet.', birds: [] };
    }
    const cost =
      count === 1
        ? (this.state.hasFreeGacha ? 0 : GACHA_COST)
        : 10 * GACHA_COST;
    if (this.seedToken < cost) {
      return { ok: false, error: `Not enough $SEED. (Required: ${cost})`, birds: [] };
    }

    if (count === 10) {
      this.spendSeedToken(cost);
      if (this.state.hasFreeGacha) this.setState({ hasFreeGacha: false });
    }

    const birds: Bird[] = [];
    for (let i = 0; i < count; i++) {
      const isFree = count === 1 && i === 0 && this.state.hasFreeGacha;
      if (count === 1 && !isFree) this.spendSeedToken(GACHA_COST);
      if (count === 1 && isFree) this.setState({ hasFreeGacha: false });

      const rarity = isFree ? 'Common' : rollGachaRarity();
      const species = isFree
        ? BIRD_SPECIES[0]
        : BIRD_SPECIES[Math.floor(Math.random() * BIRD_SPECIES.length)];
      const color = isFree
        ? BIRD_COLORS[0]
        : BIRD_COLORS[Math.floor(Math.random() * BIRD_COLORS.length)];
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
