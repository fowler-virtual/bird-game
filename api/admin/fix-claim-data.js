/**
 * POST /api/admin/fix-claim-data
 * One-time fix: reset claimed_total to 0 and set seed to current claimable.
 *
 * Headers: x-admin-secret: <ADMIN_SECRET>
 * Body: { "address": "0x..." }
 */

import { setCorsHeaders } from "../_lib/cors.js";
import { getAsync, forceUpdateState } from "../_lib/gameStateStore.js";

const DECIMALS = 18n;
const CLAIM_PREFIX = "claim:";

function keyLower(address) {
  return (address || "").toLowerCase();
}

async function getBackend() {
  if (process.env.REDIS_URL) {
    const { createClient } = await import("redis");
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    return { type: "redis", client };
  }
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const m = await import("@vercel/kv");
    return { type: "vercel-kv", client: m.kv };
  }
  return null;
}

async function getClaimState(backend, address) {
  const k = CLAIM_PREFIX + keyLower(address);
  const defaultState = { claimed_total: "0", nonce: 0, pendings: [], reserved: "0" };
  if (!backend) return defaultState;
  try {
    if (backend.type === "redis") {
      const raw = await backend.client.get(k);
      if (!raw) return defaultState;
      return JSON.parse(raw);
    }
    const row = await backend.client.get(k);
    return row && typeof row === "object" ? row : defaultState;
  } catch {
    return defaultState;
  }
}

async function setClaimState(backend, address, state) {
  const k = CLAIM_PREFIX + keyLower(address);
  if (!backend) return;
  if (backend.type === "redis") {
    await backend.client.set(k, JSON.stringify(state));
  } else {
    await backend.client.set(k, state);
  }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length < 16) return res.status(503).json({ error: "Not configured." });
  if (req.headers["x-admin-secret"] !== secret) return res.status(403).json({ error: "Forbidden." });

  const { address } = req.body || {};
  if (typeof address !== "string" || !address.startsWith("0x")) {
    return res.status(400).json({ error: "Invalid address." });
  }

  const data = await getAsync(address);
  if (!data) return res.status(404).json({ error: "No game state found." });

  const backend = await getBackend();
  const claimState = await getClaimState(backend, address);

  const currentSeed = typeof data.state.seed === "number" ? data.state.seed : 0;
  const claimedTotal = BigInt(claimState.claimed_total || "0");
  const reserved = (claimState.pendings || [])
    .filter((p) => p.expiresAt > Math.floor(Date.now() / 1000))
    .reduce((sum, p) => sum + BigInt(p.amount), 0n);

  const claimableWei = BigInt(Math.floor(currentSeed)) * 10n ** DECIMALS - claimedTotal - reserved;
  const claimableSeed = Number(claimableWei > 0n ? claimableWei / 10n ** DECIMALS : 0n);

  // Set seed to claimable amount, reset claimed_total to 0
  const result = await forceUpdateState(address, (s) => ({
    ...s,
    seed: claimableSeed,
  }));

  if (!result.ok) return res.status(500).json({ error: "Failed to update game state." });

  // Reset claimed_total
  claimState.claimed_total = "0";
  await setClaimState(backend, address, claimState);

  return res.status(200).json({
    ok: true,
    address: keyLower(address),
    previousSeed: currentSeed,
    previousClaimedTotal: claimedTotal.toString(),
    newSeed: claimableSeed,
    newClaimedTotal: "0",
    version: result.version,
  });
}
