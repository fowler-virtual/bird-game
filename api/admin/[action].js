/**
 * Dynamic admin router: /api/admin/:action
 * Consolidates all admin endpoints into a single serverless function
 * to stay within Vercel Hobby plan's 12-function limit.
 */

import { getSessionAddress } from "../_lib/sessionCookie.js";
import { setCorsHeaders } from "../_lib/cors.js";
import {
  getAsync,
  setAsync,
  forceUpdateState,
  adminSetState,
  validateState,
  getSnapshots,
  restoreSnapshot,
} from "../_lib/gameStateStore.js";

/* ── Helpers ── */

function getAdminAddresses() {
  const raw = process.env.ADMIN_ADDRESSES || "";
  return raw
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a.startsWith("0x"));
}

function requireAdminSecret(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length < 16) return { status: 503, error: "Admin endpoint not configured." };
  if (req.headers["x-admin-secret"] !== secret) return { status: 403, error: "Forbidden." };
  return null;
}

/* ── Action handlers ── */

async function handleCheck(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const sessionAddress = getSessionAddress(req);
  if (!sessionAddress) return res.status(200).json({ isAdmin: false });
  const admins = getAdminAddresses();
  return res.status(200).json({ isAdmin: admins.includes(sessionAddress.toLowerCase()) });
}

async function handleGrantSeed(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const authErr = requireAdminSecret(req);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  const { address, amount } = req.body || {};
  if (typeof address !== "string" || !address.startsWith("0x") || address.length < 10) {
    return res.status(400).json({ error: "Invalid address." });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number." });
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await getAsync(address);
    if (!data) return res.status(404).json({ error: "No game state found for this address." });
    const updatedState = { ...data.state, seed: (data.state.seed || 0) + amount };
    const result = await setAsync(address, updatedState, data.version);
    if (result.ok) {
      return res.status(200).json({
        ok: true,
        address: address.toLowerCase(),
        previousSeed: data.state.seed || 0,
        grantedAmount: amount,
        newSeed: updatedState.seed,
        version: result.version,
      });
    }
  }
  return res.status(409).json({ error: "Version conflict after retry." });
}

async function handleGrantSeedSession(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const sessionAddress = getSessionAddress(req);
  if (!sessionAddress) return res.status(401).json({ error: "Not logged in." });
  const admins = getAdminAddresses();
  if (!admins.includes(sessionAddress.toLowerCase())) return res.status(403).json({ error: "Forbidden." });

  const { amount } = req.body || {};
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number." });
  }

  const data = await getAsync(sessionAddress);
  if (!data) return res.status(404).json({ error: "No game state found." });

  const previousSeed = data.state.seed || 0;
  const result = await forceUpdateState(sessionAddress, (s) => ({
    ...s,
    seed: (typeof s.seed === "number" ? s.seed : 0) + amount,
  }));
  if (!result.ok) return res.status(500).json({ error: "Failed to update." });

  return res.status(200).json({
    ok: true,
    previousSeed,
    grantedAmount: amount,
    newSeed: previousSeed + amount,
    version: result.version,
  });
}

async function handleFixClaimData(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const authErr = requireAdminSecret(req);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  const { address } = req.body || {};
  if (typeof address !== "string" || !address.startsWith("0x")) {
    return res.status(400).json({ error: "Invalid address." });
  }

  const data = await getAsync(address);
  if (!data) return res.status(404).json({ error: "No game state found." });

  // Get claim backend
  const DECIMALS = 18n;
  const CLAIM_PREFIX = "claim:";
  const keyLower = (a) => (a || "").toLowerCase();

  let backend = null;
  if (process.env.REDIS_URL) {
    const { createClient } = await import("redis");
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    backend = { type: "redis", client };
  } else if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const m = await import("@vercel/kv");
    backend = { type: "vercel-kv", client: m.kv };
  }

  // Get claim state
  const claimKey = CLAIM_PREFIX + keyLower(address);
  const defaultClaimState = { claimed_total: "0", nonce: 0, pendings: [], reserved: "0" };
  let claimState = defaultClaimState;
  if (backend) {
    try {
      if (backend.type === "redis") {
        const raw = await backend.client.get(claimKey);
        if (raw) claimState = JSON.parse(raw);
      } else {
        const row = await backend.client.get(claimKey);
        if (row && typeof row === "object") claimState = row;
      }
    } catch { /* use default */ }
  }

  const currentSeed = typeof data.state.seed === "number" ? data.state.seed : 0;
  const claimedTotal = BigInt(claimState.claimed_total || "0");
  const reserved = (claimState.pendings || [])
    .filter((p) => p.expiresAt > Math.floor(Date.now() / 1000))
    .reduce((sum, p) => sum + BigInt(p.amount), 0n);

  const claimableWei = BigInt(Math.floor(currentSeed)) * 10n ** DECIMALS - claimedTotal - reserved;
  const claimableSeed = Number(claimableWei > 0n ? claimableWei / 10n ** DECIMALS : 0n);

  const result = await forceUpdateState(address, (s) => ({ ...s, seed: claimableSeed }));
  if (!result.ok) return res.status(500).json({ error: "Failed to update game state." });

  claimState.claimed_total = "0";
  if (backend) {
    if (backend.type === "redis") {
      await backend.client.set(claimKey, JSON.stringify(claimState));
    } else {
      await backend.client.set(claimKey, claimState);
    }
  }

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

async function handleRestoreSnapshot(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const authErr = requireAdminSecret(req);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  const { address, version } = req.body || {};
  if (typeof address !== "string" || !address.startsWith("0x") || address.length < 10) {
    return res.status(400).json({ error: "Invalid address." });
  }
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return res.status(400).json({ error: "version must be a positive integer." });
  }

  const result = await restoreSnapshot(address, version);
  if (!result.ok) {
    const status = result.reason === "SNAPSHOT_NOT_FOUND" ? 404 : 500;
    return res.status(status).json({ error: result.reason });
  }

  return res.status(200).json({
    ok: true,
    address: address.toLowerCase(),
    restoredFromVersion: result.restoredFromVersion,
    newVersion: result.version,
  });
}

async function handleSetState(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const authErr = requireAdminSecret(req);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  const { address, state } = req.body || {};
  if (typeof address !== "string" || !address.startsWith("0x") || address.length < 10) {
    return res.status(400).json({ error: "Invalid address." });
  }
  if (!state || typeof state !== "object") {
    return res.status(400).json({ error: "Missing or invalid state." });
  }

  const validation = validateState(state);
  if (!validation.ok) return res.status(400).json({ error: validation.error });

  const result = await adminSetState(address, state);
  if (!result.ok) return res.status(500).json({ error: result.reason });

  return res.status(200).json({
    ok: true,
    address: address.toLowerCase(),
    version: result.version,
  });
}

async function handleSnapshots(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const authErr = requireAdminSecret(req);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  const address = req.query?.address;
  if (typeof address !== "string" || !address.startsWith("0x") || address.length < 10) {
    return res.status(400).json({ error: "Invalid or missing address query parameter." });
  }

  const [current, snapshots] = await Promise.all([getAsync(address), getSnapshots(address)]);

  return res.status(200).json({
    address: address.toLowerCase(),
    current: current || null,
    snapshots,
    snapshotCount: snapshots.length,
  });
}

/* ── Router ── */

const routes = {
  check: handleCheck,
  "grant-seed": handleGrantSeed,
  "grant-seed-session": handleGrantSeedSession,
  "fix-claim-data": handleFixClaimData,
  "restore-snapshot": handleRestoreSnapshot,
  "set-state": handleSetState,
  snapshots: handleSnapshots,
};

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const action = req.query?.action;
  const routeHandler = routes[action];
  if (!routeHandler) {
    return res.status(404).json({ error: `Unknown admin action: ${action}` });
  }

  return routeHandler(req, res);
}
