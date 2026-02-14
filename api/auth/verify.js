/**
 * POST /api/auth/verify
 * Body: { message, signature, address }
 * Verifies SIWE message and sets session cookie.
 */

import { SiweMessage } from "siwe";
import { verifyNonce } from "../_lib/signedNonce.js";
import { setSessionCookie, getSecret } from "../_lib/sessionCookie.js";

const allowedOrigin = process.env.ALLOWED_CLAIM_ORIGIN || "*";

function getAddress(s) {
  if (!s || typeof s !== "string") return null;
  const a = s.toLowerCase().replace(/^0x/, "");
  if (a.length !== 40 || !/^[a-f0-9]{40}$/.test(a)) return null;
  return "0x" + a;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!getSecret()) {
    return res.status(503).json({ error: "Server not configured (SESSION_SECRET)." });
  }

  const { message, signature, address } = req.body || {};
  if (!message || typeof message !== "string" || !signature || typeof signature !== "string") {
    return res.status(400).json({ error: "Missing message or signature." });
  }
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: "Invalid address." });
  }

  try {
    const siweMessage = new SiweMessage(message);
    await siweMessage.verify({ signature });
    const recovered = getAddress(siweMessage.address);
    const requested = getAddress(address);
    if (!recovered || recovered !== requested) {
      return res.status(400).json({ error: "Address does not match signature." });
    }
    if (!verifyNonce(siweMessage.nonce, recovered)) {
      return res.status(400).json({ error: "Invalid or expired nonce." });
    }
    if (!setSessionCookie(res, recovered)) {
      return res.status(500).json({ error: "Failed to set session." });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(401).json({ error: e?.message || "Verification failed." });
  }
}
