/**
 * GET /api/claimable — server-side claimable amount (wei string). Requires session.
 */

import { getSessionAddress } from "./_lib/sessionCookie.js";
import { setCorsHeaders } from "./_lib/cors.js";
import { getClaimableAsync } from "./_lib/claimStoreKV.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  const sessionAddress = getSessionAddress(req);
  if (!sessionAddress) {
    return res.status(401).json({ error: "Not logged in. Sign in with your wallet first." });
  }

  try {
    const claimable = await getClaimableAsync(sessionAddress);
    return res.status(200).json({ claimable: claimable.toString() });
  } catch (e) {
    console.error("[claimable]", e?.message || e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
