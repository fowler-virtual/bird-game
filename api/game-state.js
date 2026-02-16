/**
 * GET/PUT /api/game-state
 * Requires session (SIWE). GET returns state or initial; PUT updates with version check.
 */

import { getSessionAddress } from "./_lib/sessionCookie.js";
import { setCorsHeaders } from "./_lib/cors.js";
import {
  get,
  getInitialStateExport,
  validateState,
  set,
} from "./_lib/gameStateStore.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const sessionAddress = getSessionAddress(req);
  if (!sessionAddress) {
    return res.status(401).json({ error: "Not logged in. Sign in with your wallet first." });
  }

  if (req.method === "GET") {
    const data = get(sessionAddress);
    if (!data) {
      return res.status(200).json({
        state: getInitialStateExport(),
        version: 1,
      });
    }
    const payload = { state: data.state, version: data.version };
    if (data.updatedAt) payload.updatedAt = data.updatedAt;
    return res.status(200).json(payload);
  }

  if (req.method === "PUT") {
    const { state, version } = req.body || {};
    if (state == null || typeof state !== "object") {
      return res.status(400).json({ error: "Missing or invalid state." });
    }
    if (typeof version !== "number" || version < 1) {
      return res.status(400).json({ error: "Missing or invalid version." });
    }
    const validation = validateState(state);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    const result = set(sessionAddress, state, version);
    if (!result.ok) {
      return res.status(409).json({
        code: "STALE_DATA",
        message: "Data was updated from another device.",
      });
    }
    return res.status(200).json({ version: result.version });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
