/**
 * GET /api/auth/nonce (or /auth/nonce if base is Claim API root).
 * Query: address (optional). If present, returns address-bound nonce; else returns pending nonce.
 */
import { setCorsHeaders } from "../_lib/cors.js";
import { createNonce, createPendingNonce } from "../_lib/siweNonceStore.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  const address = req.query?.address;
  const nonce = typeof address === "string" && address.trim()
    ? createNonce(address.trim())
    : createPendingNonce();
  return res.status(200).json({ nonce });
}
