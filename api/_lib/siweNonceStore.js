/**
 * In-memory SIWE nonce store (ESM). Address-bound and pending (no address at issue).
 * For serverless, in-memory is per-instance; use Redis if multi-instance.
 */
const SIWE_NONCE_TTL_SEC = Number(process.env.SIWE_NONCE_TTL_SEC) || 300;
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

export function createNonce(address) {
  prune();
  const lower = address.toLowerCase();
  const nonce = generateNonce();
  store.set(lower, { nonce, expiresAt: nowSec() + SIWE_NONCE_TTL_SEC });
  return nonce;
}

export function createPendingNonce() {
  prune();
  const nonce = generateNonce();
  pendingStore.set(nonce, nowSec() + SIWE_NONCE_TTL_SEC);
  return nonce;
}

export function consumeNonce(address, nonce) {
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
