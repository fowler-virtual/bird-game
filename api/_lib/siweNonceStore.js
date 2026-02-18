/**
 * SIWE nonce store (ESM). Address-bound and pending (no address at issue).
 * Uses Redis when REDIS_URL is set (Vercel multi-instance); otherwise in-memory per-instance.
 */
const SIWE_NONCE_TTL_SEC = Number(process.env.SIWE_NONCE_TTL_SEC) || 300;
const PREFIX = "siwe:";
const store = new Map();
const pendingStore = new Map();

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function prune() {
  const now = nowSec();
  for (const [key, val] of store.entries()) {
    if (val.expiresAt <= now) store.delete(key);
  }
  for (const [key, val] of pendingStore.entries()) {
    if (val <= now) pendingStore.delete(key);
  }
}

/** SIWE requires nonce to be alphanumeric and length > 8. No hyphen. */
function generateNonce() {
  return `${Date.now()}${Math.random().toString(36).slice(2, 12)}`;
}

let redisClientPromise;
async function getRedis() {
  if (redisClientPromise !== undefined) return redisClientPromise;
  if (process.env.REDIS_URL) {
    redisClientPromise = (async () => {
      try {
        const { createClient } = await import("redis");
        const client = createClient({ url: process.env.REDIS_URL });
        await client.connect();
        return client;
      } catch (e) {
        console.warn("[siweNonceStore] redis (REDIS_URL) not available:", e?.message);
        return null;
      }
    })();
    return redisClientPromise;
  }
  redisClientPromise = Promise.resolve(null);
  return redisClientPromise;
}

export async function createNonce(address) {
  const nonce = generateNonce();
  const redis = await getRedis();
  if (redis) {
    const lower = address.toLowerCase();
    const key = `${PREFIX}addr:${lower}`;
    const val = JSON.stringify({ nonce, expiresAt: nowSec() + SIWE_NONCE_TTL_SEC });
    await redis.setEx(key, SIWE_NONCE_TTL_SEC, val);
    return nonce;
  }
  prune();
  const lower = address.toLowerCase();
  store.set(lower, { nonce, expiresAt: nowSec() + SIWE_NONCE_TTL_SEC });
  return nonce;
}

export async function createPendingNonce() {
  const nonce = generateNonce();
  const redis = await getRedis();
  if (redis) {
    const key = `${PREFIX}pending:${nonce}`;
    await redis.setEx(key, SIWE_NONCE_TTL_SEC, "1");
    return nonce;
  }
  prune();
  pendingStore.set(nonce, nowSec() + SIWE_NONCE_TTL_SEC);
  return nonce;
}

export async function consumeNonce(address, nonce) {
  const redis = await getRedis();
  if (redis) {
    const lower = (address || "").toLowerCase();
    const addrKey = `${PREFIX}addr:${lower}`;
    const raw = await redis.get(addrKey);
    if (raw) {
      try {
        const entry = JSON.parse(raw);
        if (entry && entry.nonce === nonce) {
          await redis.del(addrKey);
          return true;
        }
      } catch (_) {}
    }
    const pendingKey = `${PREFIX}pending:${nonce}`;
    const exists = await redis.get(pendingKey);
    if (exists != null) {
      await redis.del(pendingKey);
      return true;
    }
    return false;
  }
  prune();
  const lower = (address || "").toLowerCase();
  const entry = store.get(lower);
  if (entry && entry.nonce === nonce) {
    store.delete(lower);
    return true;
  }
  const pendingExp = pendingStore.get(nonce);
  if (pendingExp != null && pendingExp > nowSec()) {
    pendingStore.delete(nonce);
    return true;
  }
  return false;
}
