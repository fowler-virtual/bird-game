/**
 * Claim state store: per-address claimable_total, claimed_total, reserved, nonce, pendings.
 * File-based for local dev (single process). Production should use Redis/KV for multi-instance.
 * All amounts in wei (string).
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_PATH = path.join(process.cwd(), "claim-store.json");
const RESERVE_DEADLINE_SEC = 300; // 5 min

function getStorePath() {
  return process.env.CLAIM_STORE_PATH || DEFAULT_PATH;
}

function load() {
  const p = getStorePath();
  try {
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}

function save(data) {
  const p = getStorePath();
  fs.writeFileSync(p, JSON.stringify(data, null, 0), "utf8");
}

function getState(data, address) {
  const lower = address.toLowerCase();
  if (!data[lower]) {
    data[lower] = {
      claimable_total: "0",
      claimed_total: "0",
      reserved: "0",
      nonce: 0,
      pendings: [],
    };
  }
  return data[lower];
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Remove expired pendings and reduce reserved accordingly.
 */
function releaseExpired(state) {
  const now = nowSec();
  const kept = [];
  let released = 0n;
  for (const p of state.pendings) {
    if (p.expiresAt <= now) {
      released += BigInt(p.amount);
    } else {
      kept.push(p);
    }
  }
  state.pendings = kept;
  state.reserved = (BigInt(state.reserved) - released).toString();
  if (state.reserved < 0n) state.reserved = "0";
}

/**
 * Get claimable amount (wei string): claimable_total - claimed_total - reserved.
 * Expired pendings are released first.
 */
function getClaimable(address) {
  const data = load();
  const state = getState(data, address);
  releaseExpired(state);
  save(data);
  const total = BigInt(state.claimable_total);
  const claimed = BigInt(state.claimed_total);
  const reserved = BigInt(state.reserved);
  const available = total - claimed - reserved;
  return available < 0n ? 0n : available;
}

/**
 * Reserve amount and return { amountWei, nonce, expiresAt } or null if nothing to claim.
 * Caller must sign and return; on confirm we call confirmReservation.
 */
function reserve(address) {
  const data = load();
  const state = getState(data, address);
  releaseExpired(state);
  const total = BigInt(state.claimable_total);
  const claimed = BigInt(state.claimed_total);
  const reserved = BigInt(state.reserved);
  let available = total - claimed - reserved;
  if (available <= 0n) return null;
  state.nonce += 1;
  const nonce = state.nonce;
  const amountWei = available.toString();
  const expiresAt = nowSec() + RESERVE_DEADLINE_SEC;
  state.reserved = (reserved + available).toString();
  state.pendings.push({ nonce, amount: amountWei, expiresAt });
  save(data);
  return { amountWei, nonce, expiresAt };
}

/**
 * After successful on-chain claim: move reserved to claimed_total and remove pending.
 */
function confirmReservation(address, nonce, amountWei) {
  const data = load();
  const state = getState(data, address);
  const idx = state.pendings.findIndex((p) => p.nonce === nonce && p.amount === amountWei);
  if (idx === -1) return false;
  state.pendings.splice(idx, 1);
  state.claimed_total = (BigInt(state.claimed_total) + BigInt(amountWei)).toString();
  state.reserved = (BigInt(state.reserved) - BigInt(amountWei)).toString();
  if (state.reserved < 0n) state.reserved = "0";
  save(data);
  return true;
}

/**
 * Admin / testing: set claimable_total for an address (e.g. server-side event).
 */
function setClaimableTotal(address, weiString) {
  const data = load();
  const state = getState(data, address);
  state.claimable_total = String(weiString);
  save(data);
}

module.exports = {
  getClaimable,
  reserve,
  confirmReservation,
  releaseExpired,
  setClaimableTotal,
  getState: (addr) => getState(load(), addr),
};
