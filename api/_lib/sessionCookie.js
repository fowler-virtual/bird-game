/**
 * Signed session cookie for Vercel serverless. Same semantics as server/sessionCookie.cjs.
 */

import crypto from "crypto";

const COOKIE_NAME = "claim_sid";
const MAX_AGE_SEC = 7 * 24 * 60 * 60;

export function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) return null;
  return s;
}

function signPayload(address) {
  const secret = getSecret();
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update((address || "").toLowerCase()).digest("hex");
}

export function setSessionCookie(res, address) {
  if (!getSecret() || !address) return false;
  const sig = signPayload(address);
  const payload = JSON.stringify({ address: address.toLowerCase(), sig });
  const value = Buffer.from(payload, "utf8").toString("base64url");
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${MAX_AGE_SEC}`);
  return true;
}

export function getSessionAddress(req) {
  if (!getSecret()) return null;
  const raw = req.headers?.cookie || "";
  const match = raw.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  try {
    const payload = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
    const { address, sig } = payload;
    if (!address || !sig) return null;
    if (signPayload(address) !== sig) return null;
    return address;
  } catch {
    return null;
  }
}
