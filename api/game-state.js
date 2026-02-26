/**
 * GET/PUT /api/game-state
 * Requires session (SIWE). GET returns state or initial; PUT updates with version check.
 */

import { getSessionAddress } from "./_lib/sessionCookie.js";
import { setCorsHeaders } from "./_lib/cors.js";
import {
  getAsync,
  getInitialStateExport,
  validateState,
  setAsync,
} from "./_lib/gameStateStore.js";
import { validateAndCapSeed } from "./_lib/seedValidation.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const sessionAddress = getSessionAddress(req);
  if (!sessionAddress) {
    return res.status(401).json({ error: "Not logged in. Sign in with your wallet first." });
  }

  if (req.method === "GET") {
    const data = await getAsync(sessionAddress);
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

    const prevData = await getAsync(sessionAddress);
    const prevState = prevData ? prevData.state : null;

    // ── State integrity checks (log only, never block) ──
    if (prevState) {
      const prevBirds = Array.isArray(prevState.birdsOwned) ? prevState.birdsOwned.length : 0;
      const newBirds = Array.isArray(state.birdsOwned) ? state.birdsOwned.length : 0;
      if (newBirds === 0 && prevBirds > 0) {
        console.error(`[ALERT] birdsOwned dropped to 0 | addr=${sessionAddress} prev=${prevBirds}`);
      } else if (prevBirds > 0 && newBirds < prevBirds * 0.5) {
        console.warn(`[WARNING] birdsOwned dropped >50% | addr=${sessionAddress} prev=${prevBirds} new=${newBirds}`);
      }
      const prevSeed = typeof prevState.seed === "number" ? prevState.seed : 0;
      const newSeed = typeof state.seed === "number" ? state.seed : 0;
      if (prevSeed >= 100 && newSeed === 0) {
        console.error(`[ALERT] seed dropped from ${prevSeed} to 0 | addr=${sessionAddress}`);
      }
    }

    const seedResult = validateAndCapSeed(state, prevState);
    const finalState = seedResult.state;

    const result = await setAsync(sessionAddress, finalState, version);
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
