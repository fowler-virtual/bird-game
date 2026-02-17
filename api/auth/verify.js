/**
 * POST /api/auth/verify (or /auth/verify if base is Claim API root).
 * Body: { message, signature, address }. Verifies SIWE, consumes nonce, sets session cookie.
 */
import { setCorsHeaders } from "../_lib/cors.js";
import { consumeNonce } from "../_lib/siweNonceStore.js";
import { setSessionCookie } from "../_lib/sessionCookie.js";
import { SiweMessage } from "siwe";

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const { message, signature, address: bodyAddress } = req.body || {};
  if (typeof message !== "string" || typeof signature !== "string" || typeof bodyAddress !== "string") {
    return res.status(400).json({ ok: false, error: "Missing message, signature, or address." });
  }

  try {
    const siweMessage = new SiweMessage(message);
    const result = await siweMessage.verify({ signature });
    const msg = result?.data ?? result;
    if (!msg?.address || !msg?.nonce) {
      return res.status(400).json({ ok: false, error: "Invalid signature." });
    }
    const address = (msg.address || "").toLowerCase();
    if (!address || address !== bodyAddress.toLowerCase()) {
      return res.status(400).json({ ok: false, error: "Address mismatch." });
    }
    const nonce = msg.nonce;
    if (!nonce) return res.status(400).json({ ok: false, error: "No nonce in message." });
    if (!(await consumeNonce(address, nonce))) {
      return res.status(400).json({ ok: false, error: "Invalid or expired nonce." });
    }
    if (!setSessionCookie(res, address)) {
      return res.status(500).json({ ok: false, error: "Session not configured." });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    const msg = e?.message || String(e);
    return res.status(400).json({ ok: false, error: msg || "Verify failed." });
  }
}
