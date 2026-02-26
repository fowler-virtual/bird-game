/**
 * POST /api/admin/grant-seed
 * Admin-only endpoint to grant seed to a player, bypassing validation.
 *
 * Headers: x-admin-secret: <ADMIN_SECRET>
 * Body:    { "address": "0x...", "amount": 1000 }
 */

import { setCorsHeaders } from "../_lib/cors.js";
import { getAsync, setAsync } from "../_lib/gameStateStore.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Validate ADMIN_SECRET
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length < 16) {
    return res.status(503).json({ error: "Admin endpoint not configured." });
  }

  const provided = req.headers["x-admin-secret"];
  if (provided !== secret) {
    return res.status(403).json({ error: "Forbidden." });
  }

  // Parse body
  const { address, amount } = req.body || {};
  if (typeof address !== "string" || !address.startsWith("0x") || address.length < 10) {
    return res.status(400).json({ error: "Invalid address." });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number." });
  }

  // Read current state, add seed, write back (1 retry on version conflict)
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await getAsync(address);
    if (!data) {
      return res.status(404).json({ error: "No game state found for this address." });
    }

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
    // Version conflict → retry once
  }

  return res.status(409).json({ error: "Version conflict after retry." });
}
