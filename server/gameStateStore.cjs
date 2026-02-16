/**
 * ゲーム状態の保存（1アドレス1レコード、version 付き）。
 * 不整合防止: PUT 時は client version と一致するときだけ上書き。
 * 初回はメモリのみ。永続化は後続で追加可。
 */
const key = (address) => address.toLowerCase();

/** 初期 state（仕様書と一致）。gems は廃止のため含めない。 */
function getInitialState() {
  return {
    gems: { sapphire: 0, ruby: 0, emerald: 0, diamond: 0 },
    birdsOwned: [],
    deckSlots: Array(12).fill(null),
    lastAccrualAt: new Date().toISOString(),
    unlockedDeckCount: 2,
    loftLevel: 1,
    inventory: {},
    hasFreeGacha: true,
    hasShownPlacementHint: false,
    seed: 0,
    onboardingStep: "need_gacha",
  };
}

const store = new Map();

function get(address) {
  const k = key(address);
  const row = store.get(k);
  if (!row) return null;
  return { version: row.version, state: row.state, updatedAt: row.updatedAt };
}

function getCurrentVersion(address) {
  const row = store.get(key(address));
  return row ? row.version : 0;
}

/**
 * 上書きする。clientVersion が現在バージョンと一致するときだけ成功。
 * 初回: レコードなし(current 0) で clientVersion 1（GET 初期応答）も許可。
 * @returns {{ ok: true, version: number }} または {{ ok: false, reason: 'STALE' }}
 */
function set(address, state, clientVersion) {
  const k = key(address);
  const current = getCurrentVersion(address);
  const allowed = current === clientVersion || (current === 0 && clientVersion === 1);
  if (!allowed) {
    return { ok: false, reason: "STALE" };
  }
  const nextVersion = current === 0 ? 1 : current + 1;
  store.set(k, {
    version: nextVersion,
    state,
    updatedAt: new Date().toISOString(),
  });
  return { ok: true, version: nextVersion };
}

module.exports = {
  get,
  getCurrentVersion,
  getInitialState,
  set,
  get key() {
    return key;
  },
  get store() {
    return store;
  },
};
