/**
 * In-memory store for SIWE nonces: address -> { nonce, expiresAt }.
 * Nonces expire after SIWE_NONCE_TTL_SEC (default 300).
 */

const SIWE_NONCE_TTL_SEC = Number(process.env.SIWE_NONCE_TTL_SEC) || 300;
const store = new Map();

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function prune() {
  const now = nowSec();
  for (const [key, val] of store.entries()) {
    if (val.expiresAt <= now) store.delete(key);
  }
}

function createNonce(address) {
  prune();
  const lower = address.toLowerCase();
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  store.set(lower, { nonce, expiresAt: nowSec() + SIWE_NONCE_TTL_SEC });
  return nonce;
}

function consumeNonce(address, nonce) {
  const lower = address.toLowerCase();
  const entry = store.get(lower);
  if (!entry || entry.nonce !== nonce) return false;
  store.delete(lower);
  return true;
}

module.exports = { createNonce, consumeNonce };
