/**
 * Signed nonce for SIWE (no DB). Vercel serverless compatible.
 * Nonce expires after SIWE_NONCE_TTL_SEC (default 300).
 */

import crypto from "crypto";

const TTL_SEC = Number(process.env.SIWE_NONCE_TTL_SEC) || 300;

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) return null;
  return s;
}

function sign(payload) {
  const secret = getSecret();
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Create a nonce string for the given address. No server-side store.
 */
export function createNonce(address) {
  const secret = getSecret();
  if (!secret) return null;
  const lower = (address || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(lower)) return null;
  const t = Math.floor(Date.now() / 1000);
  const r = crypto.randomBytes(12).toString("base64url");
  const payload = JSON.stringify({ address: lower, t, r });
  const b64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = sign(b64);
  return `${b64}.${sig}`;
}

/**
 * Verify the nonce from SIWE message: correct signature, address match, not expired.
 */
export function verifyNonce(nonce, address) {
  const secret = getSecret();
  if (!secret || !nonce || typeof nonce !== "string") return false;
  const dot = nonce.indexOf(".");
  if (dot === -1) return false;
  const b64 = nonce.slice(0, dot);
  const sig = nonce.slice(dot + 1);
  if (sign(b64) !== sig) return false;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.t + TTL_SEC < now) return false;
  const lower = (address || "").toLowerCase();
  return payload.address === lower;
}
