/**
 * POST /api/admin/restore-snapshot
 * Restore a player's state to a specific snapshot version.
 *
 * Headers: x-admin-secret: <ADMIN_SECRET>
 * Body:    { "address": "0x...", "version": 5 }
 */

import { setCorsHeaders } from "../_lib/cors.js";
import { restoreSnapshot } from "../_lib/gameStateStore.js";

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
