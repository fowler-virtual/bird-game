/**
 * Claim state for Vercel serverless: claimable from game state seed, claimed/pendings in KV or memory.
 * Same backends as gameStateStore (REDIS_URL or @vercel/kv); fallback in-memory (no persistence).
 */

import { getAsync } from "./gameStateStore.js";

const DECIMALS = 18n;
const RESERVE_DEADLINE_SEC = 300;
const CLAIM_PREFIX = "claim:";

function key(address) {
  return (address || "").toLowerCase();
}

let redisClientPromise;
async function getBackend() {
  if (redisClientPromise !== undefined) return redisClientPromise;
  if (process.env.REDIS_URL) {
    redisClientPromise = (async () => {
      try {
        const { createClient } = await import("redis");
        const client = createClient({ url: process.env.REDIS_URL });
        await client.connect();
        return { type: "redis", client };
      } catch (e) {
        console.warn("[claimStoreKV] redis not available:", e?.message);
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
        console.warn("[claimStoreKV] @vercel/kv not available:", e?.message);
        return null;
      }
    })();
    return redisClientPromise;
  }
  redisClientPromise = Promise.resolve(null);
  return redisClientPromise;
}

const memoryClaimStore = new Map();

function getClaimKey(addr) {
  return CLAIM_PREFIX + key(addr);
}

function defaultClaimState() {
  return { claimed_total: "0", nonce: 0, pendings: [] };
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

async function getClaimState(address) {
  const backend = await getBackend();
  const k = getClaimKey(address);
  if (backend) {
    try {
      if (backend.type === "redis") {
        const raw = await backend.client.get(k);
        if (!raw) return defaultClaimState();
        const row = JSON.parse(raw);
        return row && typeof row === "object" ? row : defaultClaimState();
      }
      const row = await backend.client.get(k);
      return row && typeof row === "object" ? row : defaultClaimState();
    } catch (e) {
      console.error("[claimStoreKV] get failed:", e);
      return defaultClaimState();
    }
  }
  const row = memoryClaimStore.get(key(address));
  return row && typeof row === "object" ? row : defaultClaimState();
}

async function setClaimState(address, state) {
  const backend = await getBackend();
  const k = getClaimKey(address);
  if (backend) {
    try {
      if (backend.type === "redis") {
        await backend.client.set(k, JSON.stringify(state));
      } else {
        await backend.client.set(k, state);
      }
      return;
    } catch (e) {
      console.error("[claimStoreKV] set failed:", e);
      throw e;
    }
  }
  memoryClaimStore.set(key(address), state);
}

/**
 * Release expired pendings and return updated state.
 */
function releaseExpired(state) {
  const now = nowSec();
  const kept = state.pendings.filter((p) => p.expiresAt > now);
  let released = 0n;
  for (const p of state.pendings) {
    if (p.expiresAt <= now) released += BigInt(p.amount);
  }
  state.pendings = kept;
  state.reserved = (BigInt(state.reserved || "0") - released).toString();
  if (BigInt(state.reserved) < 0n) state.reserved = "0";
  return state;
}

/**
 * Get claimable wei for address: game state seed (as wei) - claimed_total - reserved (active pendings).
 */
export async function getClaimableAsync(address) {
  const data = await getAsync(address);
  const seed = data?.state?.seed;
  const seedNum = typeof seed === "number" && seed >= 0 ? Math.floor(seed) : 0;
  const claimableTotalWei = BigInt(seedNum) * 10n ** DECIMALS;

  const state = await getClaimState(address);
  if (!state.pendings) state.pendings = [];
  if (state.claimed_total === undefined) state.claimed_total = "0";
  const reserved = state.pendings
    .filter((p) => p.expiresAt > nowSec())
    .reduce((sum, p) => sum + BigInt(p.amount), 0n);
  const claimed = BigInt(state.claimed_total);
  const available = claimableTotalWei - claimed - reserved;
  return available < 0n ? 0n : available;
}

/**
 * Reserve full claimable amount; return { amountWei, nonce, expiresAt } or null.
 */
export async function reserve(address) {
  const available = await getClaimableAsync(address);
  if (available <= 0n) return null;

  const state = await getClaimState(address);
  releaseExpired(state);
  const reserved = (state.pendings || []).reduce((sum, p) => sum + BigInt(p.amount), 0n);
  const claimed = BigInt(state.claimed_total || "0");
  const data = await getAsync(address);
  const seed = data?.state?.seed;
  const seedNum = typeof seed === "number" && seed >= 0 ? Math.floor(seed) : 0;
  const totalWei = BigInt(seedNum) * 10n ** DECIMALS;
  let availableAgain = totalWei - claimed - reserved;
  if (availableAgain <= 0n) return null;

  state.nonce = (state.nonce || 0) + 1;
  const nonce = state.nonce;
  const amountWei = availableAgain.toString();
  const expiresAt = nowSec() + RESERVE_DEADLINE_SEC;
  state.pendings = state.pendings || [];
  state.pendings.push({ nonce, amount: amountWei, expiresAt });
  state.reserved = (BigInt(state.reserved || "0") + availableAgain).toString();
  await setClaimState(address, state);
  return { amountWei, nonce, expiresAt };
}

/**
 * Cap the reserved amount for a given nonce (e.g. to pool balance). Returns the new amount or null if not found.
 */
export async function capReservationAmount(address, nonce, maxAmountWei) {
  const state = await getClaimState(address);
  const pending = (state.pendings || []).find((p) => String(p.nonce) === String(nonce));
  if (!pending) return null;
  const current = BigInt(pending.amount);
  const cap = BigInt(maxAmountWei);
  if (current <= cap) return current.toString();
  const reduce = current - cap;
  pending.amount = cap.toString();
  state.reserved = (BigInt(state.reserved || "0") - reduce).toString();
  if (BigInt(state.reserved) < 0n) state.reserved = "0";
  await setClaimState(address, state);
  return cap.toString();
}

/**
 * After on-chain claim success: move reserved to claimed_total.
 */
export async function confirmReservation(address, nonce, amountWei) {
  const state = await getClaimState(address);
  const idx = (state.pendings || []).findIndex(
    (p) => String(p.nonce) === String(nonce) && p.amount === String(amountWei)
  );
  if (idx === -1) return false;
  state.pendings.splice(idx, 1);
  state.claimed_total = (BigInt(state.claimed_total || "0") + BigInt(amountWei)).toString();
  state.reserved = (BigInt(state.reserved || "0") - BigInt(amountWei)).toString();
  if (BigInt(state.reserved) < 0n) state.reserved = "0";
  await setClaimState(address, state);
  return true;
}
