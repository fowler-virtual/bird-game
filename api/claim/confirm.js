/**
 * POST /api/claim/confirm — after on-chain claim success, update claimed_total and release reserve.
 */

import { getSessionAddress } from "../_lib/sessionCookie.js";
import { setCorsHeaders } from "../_lib/cors.js";
import { confirmReservation } from "../_lib/claimStoreKV.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const sessionAddress = getSessionAddress(req);
  if (!sessionAddress) {
    return res.status(401).json({ error: "Not logged in. Sign in with your wallet first." });
  }

  const { nonce, amountWei } = req.body || {};
  if (nonce == null || !amountWei) {
    return res.status(400).json({ error: "Missing nonce or amountWei." });
  }

  const ok = await confirmReservation(sessionAddress, String(nonce), String(amountWei));
  return res.status(200).json({ ok });
}
