/**
 * POST /api/admin/grant-seed-session
 * Grants seed to the current SIWE session user. Admin-only (ADMIN_ADDRESSES whitelist).
 * Body: { "amount": 1000 }
 */

import { getSessionAddress } from "../_lib/sessionCookie.js";
import { setCorsHeaders } from "../_lib/cors.js";
import { getAsync, forceUpdateState } from "../_lib/gameStateStore.js";

function getAdminAddresses() {
  const raw = process.env.ADMIN_ADDRESSES || "";
  return raw
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a.startsWith("0x"));
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const sessionAddress = getSessionAddress(req);
  if (!sessionAddress) {
    return res.status(401).json({ error: "Not logged in." });
  }

  const admins = getAdminAddresses();
  if (!admins.includes(sessionAddress.toLowerCase())) {
    return res.status(403).json({ error: "Forbidden." });
  }

  const { amount } = req.body || {};
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number." });
  }

  const data = await getAsync(sessionAddress);
  if (!data) {
    return res.status(404).json({ error: "No game state found." });
  }

  const previousSeed = data.state.seed || 0;
  const result = await forceUpdateState(sessionAddress, (s) => ({
    ...s,
    seed: (typeof s.seed === "number" ? s.seed : 0) + amount,
  }));

  if (!result.ok) {
    return res.status(500).json({ error: "Failed to update." });
  }

  return res.status(200).json({
    ok: true,
    previousSeed,
    grantedAmount: amount,
    newSeed: previousSeed + amount,
    version: result.version,
  });
}
