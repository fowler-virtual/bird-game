/**
 * Game state store for Vercel serverless (ESM).
 * In-memory only; state may not persist across cold starts. For production consider Vercel KV or DB.
 */
const key = (address) => (address || "").toLowerCase();

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

export function get(address) {
  const k = key(address);
  const row = store.get(k);
  if (!row) return null;
  return { version: row.version, state: row.state, updatedAt: row.updatedAt };
}

function getCurrentVersion(address) {
  const row = store.get(key(address));
  return row ? row.version : 0;
}

export function getInitialStateExport() {
  return getInitialState();
}

export function validateState(state) {
  if (!state || typeof state !== "object") return { ok: false, error: "Invalid state." };
  if (!Array.isArray(state.birdsOwned)) return { ok: false, error: "birdsOwned must be an array." };
  if (!Array.isArray(state.deckSlots)) return { ok: false, error: "deckSlots must be an array." };
  if (state.deckSlots.length !== 12) return { ok: false, error: "deckSlots must have length 12." };
  const ids = new Set(
    state.birdsOwned.filter((b) => b && typeof b.id === "string").map((b) => b.id)
  );
  for (let i = 0; i < state.deckSlots.length; i++) {
    const slot = state.deckSlots[i];
    if (slot != null && slot !== "" && !ids.has(slot)) {
      return { ok: false, error: "deckSlots reference a bird not in birdsOwned." };
    }
  }
  const u = state.unlockedDeckCount;
  if (typeof u !== "number" || u < 2 || u > 12 || u % 2 !== 0) {
    return { ok: false, error: "unlockedDeckCount must be 2–12 and even." };
  }
  const l = state.loftLevel;
  if (typeof l !== "number" || l < 1 || l > 6) return { ok: false, error: "loftLevel must be 1–6." };
  if (typeof state.seed !== "number" || state.seed < 0) {
    return { ok: false, error: "seed must be a non-negative number." };
  }
  return { ok: true };
}

export function set(address, state, clientVersion) {
  const k = key(address);
  const current = getCurrentVersion(address);
  const allowed = current === clientVersion || (current === 0 && clientVersion === 1);
  if (!allowed) return { ok: false, reason: "STALE" };
  const nextVersion = current === 0 ? 1 : current + 1;
  store.set(k, {
    version: nextVersion,
    state,
    updatedAt: new Date().toISOString(),
  });
  return { ok: true, version: nextVersion };
}
