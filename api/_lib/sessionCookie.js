/**
 * Signed session cookie: stores address after SIWE verify.
 * SESSION_SECRET env required. Cookie name: claim_sid.
 * Also supports Bearer token fallback for WebViews that don't handle cookies.
 * ESM version for Vercel api/ (same contract as server/sessionCookie.cjs).
 */
import crypto from "crypto";

const COOKIE_NAME = "claim_sid";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) return null;
  return s;
}

function signPayload(address) {
  const secret = getSecret();
  if (!secret) return null;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(address.toLowerCase());
  return hmac.digest("hex");
}

/**
 * Create a session token (same format as cookie value) that can be returned
 * in the response body for clients that can't use cookies (e.g. WebView).
 */
export function createSessionToken(address) {
  const secret = getSecret();
  if (!secret) return null;
  const sig = signPayload(address);
  const payload = JSON.stringify({ address: address.toLowerCase(), sig });
  return Buffer.from(payload, "utf8").toString("base64url");
}

/**
 * Create cookie value: base64(JSON({ address, sig })).
 */
export function setSessionCookie(res, address) {
  const token = createSessionToken(address);
  if (!token) return false;
  res.setHeader("Set-Cookie", [
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${MAX_AGE_MS / 1000}`,
  ].join(""));
  return true;
}

/**
 * Verify a base64url token and return address (lowercase) or null.
 */
function verifyToken(token) {
  if (!token) return null;
  const secret = getSecret();
  if (!secret) return null;
  try {
    const payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    const { address, sig } = payload;
    if (!address || !sig) return null;
    const expected = signPayload(address);
    if (expected !== sig) return null;
    return address;
  } catch {
    return null;
  }
}

/**
 * Parse cookie and verify signature. Returns address (lowercase) or null.
 * Falls back to Authorization: Bearer <token> header if cookie is missing
 * (for WebView environments that don't store cookies).
 */
export function getSessionAddress(req) {
  const secret = getSecret();
  if (!secret) return null;

  // 1. Try cookie first
  const raw = req.headers?.cookie || "";
  const match = raw.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (match) {
    const addr = verifyToken(match[1]);
    if (addr) return addr;
  }

  // 2. Fallback: Authorization: Bearer <token>
  const authHeader = req.headers?.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const addr = verifyToken(token);
    if (addr) return addr;
  }

  return null;
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`);
}
