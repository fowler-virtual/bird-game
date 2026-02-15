/**
 * GET /api/auth/nonce?address=0x...
 * Returns a nonce for SIWE. No server-side store (signed nonce).
 */

import { createNonce } from "../_lib/signedNonce.js";
import { setCorsHeaders } from "../_lib/cors.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const address = req.query.address;
  if (!address || typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: "Invalid or missing address." });
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
    return res.status(503).json({ error: "Server not configured (SESSION_SECRET)." });
  }
  const nonce = createNonce(address);
  if (!nonce) return res.status(400).json({ error: "Invalid address." });
  return res.status(200).json({ nonce });
}
