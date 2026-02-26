/**
 * GET /api/admin/snapshots?address=0x...
 * Returns snapshot history + current state for the given address.
 *
 * Headers: x-admin-secret: <ADMIN_SECRET>
 */

import { setCorsHeaders } from "../_lib/cors.js";
import { getAsync, getSnapshots } from "../_lib/gameStateStore.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length < 16) {
    return res.status(503).json({ error: "Admin endpoint not configured." });
  }
  if (req.headers["x-admin-secret"] !== secret) {
    return res.status(403).json({ error: "Forbidden." });
  }

  const address = req.query?.address;
  if (typeof address !== "string" || !address.startsWith("0x") || address.length < 10) {
    return res.status(400).json({ error: "Invalid or missing address query parameter." });
  }

  const [current, snapshots] = await Promise.all([
    getAsync(address),
    getSnapshots(address),
  ]);

  return res.status(200).json({
    address: address.toLowerCase(),
    current: current || null,
    snapshots,
    snapshotCount: snapshots.length,
  });
}
