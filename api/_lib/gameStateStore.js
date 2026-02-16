/**
 * Game state store for Vercel serverless (ESM).
 * Uses Redis when REDIS_URL or (KV_REST_API_URL + KV_REST_API_TOKEN) is set; otherwise in-memory (no persistence).
 */
const key = (address) => (address || "").toLowerCase();
const KV_PREFIX = "game-state:";

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

const memoryStore = new Map();

/** Cached backend: { type, client } or null */
let redisClientPromise;
async function getRedisBackend() {
  if (redisClientPromise !== undefined) return redisClientPromise;
  if (process.env.REDIS_URL) {
    redisClientPromise = (async () => {
      try {
        const { createClient } = await import("redis");
        const client = createClient({ url: process.env.REDIS_URL });
        await client.connect();
        return { type: "redis", client };
      } catch (e) {
        console.warn("[gameStateStore] redis (REDIS_URL) not available:", e?.message);
        return null;
      }
    })();
    return redisClientPromise;
  }
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    redisClientPromise = (async () => {
      try {
        const m = await import("@vercel/kv");
        return { type: "vercel-kv", client: m.kv };
      } catch (e) {
        console.warn("[gameStateStore] @vercel/kv not available:", e?.message);
        return null;
      }
    })();
    return redisClientPromise;
  }
  redisClientPromise = Promise.resolve(null);
  return redisClientPromise;
}

/**
 * Get stored state (async). Uses Redis if configured, else in-memory.
 */
export async function getAsync(address) {
  const backend = await getRedisBackend();
  const storeKey = `${KV_PREFIX}${key(address)}`;
  if (backend) {
    try {
      if (backend.type === "redis") {
        const raw = await backend.client.get(storeKey);
        if (!raw) return null;
        const row = JSON.parse(raw);
        if (!row || typeof row !== "object") return null;
        return { version: row.version, state: row.state, updatedAt: row.updatedAt };
      }
      const row = await backend.client.get(storeKey);
      if (!row || typeof row !== "object") return null;
      return { version: row.version, state: row.state, updatedAt: row.updatedAt };
    } catch (e) {
      console.error("[gameStateStore] get failed:", e);
      return null;
    }
  }
  const row = memoryStore.get(key(address));
  if (!row) return null;
  return { version: row.version, state: row.state, updatedAt: row.updatedAt };
}

/**
 * Set state (async). Uses Redis if configured, else in-memory.
 */
export async function setAsync(address, state, clientVersion) {
  const backend = await getRedisBackend();
  const k = key(address);
  const storeKey = `${KV_PREFIX}${k}`;
  const currentData = await getAsync(address);
  const current = currentData ? currentData.version : 0;
  const allowed = current === clientVersion || (current === 0 && clientVersion === 1);
  if (!allowed) return { ok: false, reason: "STALE" };
  const nextVersion = current === 0 ? 1 : current + 1;
  const row = {
    version: nextVersion,
    state,
    updatedAt: new Date().toISOString(),
  };
  if (backend) {
    try {
      if (backend.type === "redis") {
        await backend.client.set(storeKey, JSON.stringify(row));
      } else {
        await backend.client.set(storeKey, row);
      }
      return { ok: true, version: nextVersion };
    } catch (e) {
      console.error("[gameStateStore] set failed:", e);
      return { ok: false, reason: "STALE" };
    }
  }
  memoryStore.set(k, row);
  return { ok: true, version: nextVersion };
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
