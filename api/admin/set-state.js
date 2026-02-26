/**
 * POST /api/admin/set-state
 * Directly set a player's game state (emergency use).
 *
 * Headers: x-admin-secret: <ADMIN_SECRET>
 * Body:    { "address": "0x...", "state": { ... } }
 */

import { setCorsHeaders } from "../_lib/cors.js";
import { adminSetState, validateState } from "../_lib/gameStateStore.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length < 16) {
    return res.status(503).json({ error: "Admin endpoint not configured." });
  }
  if (req.headers["x-admin-secret"] !== secret) {
    return res.status(403).json({ error: "Forbidden." });
  }

  const { address, state } = req.body || {};
  if (typeof address !== "string" || !address.startsWith("0x") || address.length < 10) {
    return res.status(400).json({ error: "Invalid address." });
  }
  if (!state || typeof state !== "object") {
    return res.status(400).json({ error: "Missing or invalid state." });
  }

  const validation = validateState(state);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const result = await adminSetState(address, state);
  if (!result.ok) {
    return res.status(500).json({ error: result.reason });
  }

  return res.status(200).json({
    ok: true,
    address: address.toLowerCase(),
    version: result.version,
  });
}
