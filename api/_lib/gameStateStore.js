/**
 * Game state store for Vercel serverless (ESM).
 * Uses Redis when REDIS_URL or (KV_REST_API_URL + KV_REST_API_TOKEN) is set; otherwise in-memory (no persistence).
 */
const key = (address) => (address || "").toLowerCase();
const KV_PREFIX = "game-state:";
const SNAPSHOT_PREFIX = "game-state-snapshots:";
const MAX_SNAPSHOTS = 10;

/* ── Lua CAS script ── */
// Atomically check version and write. Returns 1 on success, 0 on conflict.
const LUA_CAS = `
local current = redis.call('GET', KEYS[1])
local expected = tonumber(ARGV[1])
if current == false then
  if expected == 0 then
    redis.call('SET', KEYS[1], ARGV[2])
    return 1
  end
  return 0
end
local row = cjson.decode(current)
if row['version'] == expected then
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
end
return 0
`;

/**
 * Atomic CAS write via Lua EVAL.
 * @returns {Promise<boolean>} true if write succeeded, false if version conflict
 */
async function casWrite(backend, storeKey, expectedVersion, newRowJSON) {
  if (!backend) return null; // signal caller to use in-memory path
  try {
    if (backend.type === "redis") {
      const result = await backend.client.eval(LUA_CAS, {
        keys: [storeKey],
        arguments: [String(expectedVersion), newRowJSON],
      });
      return Number(result) === 1;
    }
    // vercel-kv (Upstash REST)
    const result = await backend.client.eval(
      LUA_CAS,
      [storeKey],
      [String(expectedVersion), newRowJSON],
    );
    return Number(result) === 1;
  } catch (e) {
    console.error("[gameStateStore] casWrite EVAL failed:", e);
    return false;
  }
}

/* ── In-memory fallback for snapshots ── */
const memorySnapshotStore = new Map();

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
 * Set state (async). Uses Lua CAS for atomic version check + write on Redis.
 */
export async function setAsync(address, state, clientVersion) {
  const backend = await getRedisBackend();
  const k = key(address);
  const storeKey = `${KV_PREFIX}${k}`;

  // Read current state (for snapshot + early version check)
  const currentData = await getAsync(address);
  const current = currentData ? currentData.version : 0;
  const allowed = current === clientVersion || (current === 0 && clientVersion === 1);
  if (!allowed) return { ok: false, reason: "STALE" };

  // Save snapshot before overwriting
  if (currentData) {
    await saveSnapshot(address, currentData, "setAsync");
  }

  const nextVersion = current === 0 ? 1 : current + 1;
  const row = {
    version: nextVersion,
    state,
    updatedAt: new Date().toISOString(),
  };

  if (backend) {
    // Atomic CAS via Lua — prevents TOCTOU race between concurrent writers
    const rowJSON = JSON.stringify(row);
    const ok = await casWrite(backend, storeKey, current, rowJSON);
    if (!ok) return { ok: false, reason: "STALE" };
    return { ok: true, version: nextVersion };
  }

  // In-memory (Node.js single-threaded — safe without Lua)
  memoryStore.set(k, row);
  return { ok: true, version: nextVersion };
}

/**
 * Force-update state: read current, apply mutator, CAS write.
 * For server-internal use only (e.g. post-claim seed reduction).
 * Retries up to 3 times on CAS conflict (read → mutate → CAS loop).
 * @param {string} address
 * @param {(state: object) => object} mutator - receives current state, returns new state
 * @returns {{ ok: boolean, version?: number }}
 */
export async function forceUpdateState(address, mutator) {
  const backend = await getRedisBackend();
  const k = key(address);
  const storeKey = `${KV_PREFIX}${k}`;
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const currentData = await getAsync(address);
    if (!currentData) return { ok: false, reason: "NOT_FOUND" };

    // Save snapshot before overwriting (only on first attempt to avoid duplicates)
    if (attempt === 0) {
      await saveSnapshot(address, currentData, "forceUpdateState");
    }

    const newState = mutator(currentData.state);
    const nextVersion = currentData.version + 1;
    const row = {
      version: nextVersion,
      state: newState,
      updatedAt: new Date().toISOString(),
    };

    if (backend) {
      const rowJSON = JSON.stringify(row);
      const ok = await casWrite(backend, storeKey, currentData.version, rowJSON);
      if (ok) return { ok: true, version: nextVersion };
      // CAS failed — retry with fresh read
      console.warn(`[gameStateStore] forceUpdateState CAS conflict, attempt ${attempt + 1}/${MAX_RETRIES}`);
      continue;
    }

    // In-memory (Node.js single-threaded — safe without CAS)
    memoryStore.set(k, row);
    return { ok: true, version: nextVersion };
  }

  console.error("[gameStateStore] forceUpdateState failed after max retries");
  return { ok: false, reason: "CAS_CONFLICT" };
}

/* ── Snapshot helpers ── */

/**
 * Save a snapshot of the current row before overwriting.
 * Ring-buffer: keeps at most MAX_SNAPSHOTS entries.
 * Failures are swallowed so they never block the main write path.
 */
async function saveSnapshot(address, currentRow, trigger) {
  if (!currentRow || !currentRow.state) return;
  try {
    const backend = await getRedisBackend();
    const k = key(address);
    const snapshotKey = `${SNAPSHOT_PREFIX}${k}`;
    const entry = {
      version: currentRow.version,
      state: currentRow.state,
      updatedAt: currentRow.updatedAt,
      savedAt: new Date().toISOString(),
      trigger,
    };

    let list = [];
    if (backend) {
      if (backend.type === "redis") {
        const raw = await backend.client.get(snapshotKey);
        if (raw) list = JSON.parse(raw);
      } else {
        const stored = await backend.client.get(snapshotKey);
        if (Array.isArray(stored)) list = stored;
      }
    } else {
      list = memorySnapshotStore.get(k) || [];
    }

    list.push(entry);
    if (list.length > MAX_SNAPSHOTS) list = list.slice(list.length - MAX_SNAPSHOTS);

    if (backend) {
      if (backend.type === "redis") {
        await backend.client.set(snapshotKey, JSON.stringify(list));
      } else {
        await backend.client.set(snapshotKey, list);
      }
    } else {
      memorySnapshotStore.set(k, list);
    }
  } catch (e) {
    console.warn("[gameStateStore] saveSnapshot failed (non-blocking):", e?.message);
  }
}

/**
 * Get all snapshots for an address.
 */
export async function getSnapshots(address) {
  const backend = await getRedisBackend();
  const k = key(address);
  const snapshotKey = `${SNAPSHOT_PREFIX}${k}`;
  try {
    if (backend) {
      if (backend.type === "redis") {
        const raw = await backend.client.get(snapshotKey);
        return raw ? JSON.parse(raw) : [];
      }
      const stored = await backend.client.get(snapshotKey);
      return Array.isArray(stored) ? stored : [];
    }
    return memorySnapshotStore.get(k) || [];
  } catch (e) {
    console.error("[gameStateStore] getSnapshots failed:", e);
    return [];
  }
}

/**
 * Restore a snapshot by version number.
 * Before restoring, saves the current state as a snapshot (trigger: "pre-restore").
 */
export async function restoreSnapshot(address, targetVersion) {
  const snapshots = await getSnapshots(address);
  const target = snapshots.find((s) => s.version === targetVersion);
  if (!target) return { ok: false, reason: "SNAPSHOT_NOT_FOUND" };

  // Save current state before overwriting
  const currentData = await getAsync(address);
  if (currentData) {
    await saveSnapshot(address, currentData, "pre-restore");
  }

  const backend = await getRedisBackend();
  const k = key(address);
  const storeKey = `${KV_PREFIX}${k}`;
  const nextVersion = currentData ? currentData.version + 1 : 1;
  const row = {
    version: nextVersion,
    state: target.state,
    updatedAt: new Date().toISOString(),
  };

  if (backend) {
    try {
      if (backend.type === "redis") {
        await backend.client.set(storeKey, JSON.stringify(row));
      } else {
        await backend.client.set(storeKey, row);
      }
      return { ok: true, version: nextVersion, restoredFromVersion: targetVersion };
    } catch (e) {
      console.error("[gameStateStore] restoreSnapshot write failed:", e);
      return { ok: false, reason: "WRITE_ERROR" };
    }
  }
  memoryStore.set(k, row);
  return { ok: true, version: nextVersion, restoredFromVersion: targetVersion };
}

/**
 * Admin: directly set state for an address (emergency use).
 * Saves current state as a snapshot (trigger: "pre-admin-set") before overwriting.
 */
export async function adminSetState(address, newState) {
  const currentData = await getAsync(address);
  if (currentData) {
    await saveSnapshot(address, currentData, "pre-admin-set");
  }

  const backend = await getRedisBackend();
  const k = key(address);
  const storeKey = `${KV_PREFIX}${k}`;
  const nextVersion = currentData ? currentData.version + 1 : 1;
  const row = {
    version: nextVersion,
    state: newState,
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
      console.error("[gameStateStore] adminSetState failed:", e);
      return { ok: false, reason: "WRITE_ERROR" };
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
