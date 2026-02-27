/**
 * POST /api/loft-upgrade  (no body needed)
 * Server-authoritative Loft upgrade: increments unlockedDeckCount and loftLevel.
 * Returns { ok: true, state, version, newLoftLevel } on success.
 */

import { getSessionAddress } from "./_lib/sessionCookie.js";
import { setCorsHeaders } from "./_lib/cors.js";
import { getAsync, setAsync, validateState } from "./_lib/gameStateStore.js";
import { getNextUnlockCost } from "./_lib/gachaLogic.js";

const MAX_CAS_RETRIES = 2;

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sessionAddress = getSessionAddress(req);
  if (!sessionAddress) {
    return res.status(401).json({ error: "Not logged in." });
  }

  // CAS loop: read → check cost → update → write
  for (let attempt = 0; attempt <= MAX_CAS_RETRIES; attempt++) {
    const data = await getAsync(sessionAddress);
    if (!data) {
      return res.status(404).json({ error: "No game state found. Play the game first." });
    }

    const state = data.state;
    const cost = getNextUnlockCost(state.unlockedDeckCount);
    if (!cost) {
      return res.status(400).json({ error: "Already at max level." });
    }

    const nextCount = Math.min(12, state.unlockedDeckCount + 2);
    const newLoftLevel = Math.min(6, nextCount / 2);

    const newState = {
      ...state,
      unlockedDeckCount: nextCount,
      loftLevel: newLoftLevel,
    };

    const validation = validateState(newState);
    if (!validation.ok) {
      return res.status(500).json({ error: "Generated invalid state: " + validation.error });
    }

    const result = await setAsync(sessionAddress, newState, data.version);
    if (result.ok) {
      return res.status(200).json({
        ok: true,
        state: newState,
        version: result.version,
        newLoftLevel,
      });
    }

    // CAS conflict — retry with fresh read
    if (result.reason === "STALE" && attempt < MAX_CAS_RETRIES) {
      console.warn(`[loft-upgrade] CAS conflict for ${sessionAddress}, retry ${attempt + 1}/${MAX_CAS_RETRIES}`);
      continue;
    }

    return res.status(409).json({
      error: "State was updated from another device. Please try again.",
      code: "STALE_DATA",
    });
  }
}
