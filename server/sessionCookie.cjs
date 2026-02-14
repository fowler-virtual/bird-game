/**
 * Signed session cookie: stores address after SIWE verify.
 * SESSION_SECRET env required. Cookie name: claim_sid.
 */

const crypto = require("crypto");

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
 * Create cookie value: base64(JSON({ address, sig })).
 */
function setSessionCookie(res, address) {
  const secret = getSecret();
  if (!secret) return false;
  const sig = signPayload(address);
  const payload = JSON.stringify({ address: address.toLowerCase(), sig });
  const value = Buffer.from(payload, "utf8").toString("base64url");
  res.setHeader("Set-Cookie", [
    `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_MS / 1000}`,
  ].join(""));
  return true;
}

/**
 * Parse cookie and verify signature. Returns address (checksummed) or null.
 */
function getSessionAddress(req) {
  const secret = getSecret();
  if (!secret) return null;
  const raw = req.headers.cookie || "";
  const match = raw.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  try {
    const payload = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
    const { address, sig } = payload;
    if (!address || !sig) return null;
    const expected = signPayload(address);
    if (expected !== sig) return null;
    return address;
  } catch {
    return null;
  }
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

module.exports = {
  setSessionCookie,
  getSessionAddress,
  clearSessionCookie,
  getSecret,
};