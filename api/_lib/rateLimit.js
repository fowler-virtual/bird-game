/**
 * In-memory rate limit (per Vercel serverless instance). 補助対策。
 * CLAIM_RATE_LIMIT_MAX (default 10) requests per CLAIM_RATE_LIMIT_WINDOW_MS (default 60_000) per key.
 */

const MAX = Number(process.env.CLAIM_RATE_LIMIT_MAX) || 10;
const WINDOW_MS = Number(process.env.CLAIM_RATE_LIMIT_WINDOW_MS) || 60_000;

const entries = new Map();

function prune(now) {
  for (const [key, val] of entries.entries()) {
    if (val.windowEnd < now) entries.delete(key);
  }
}

/**
 * @param {string} key - e.g. IP or address
 * @returns {boolean} - true if allowed, false if over limit
 */
export function checkRateLimit(key) {
  if (!key || typeof key !== "string") return true;
  const now = Date.now();
  prune(now);
  const entry = entries.get(key);
  if (!entry) {
    entries.set(key, { count: 1, windowEnd: now + WINDOW_MS });
    return true;
  }
  if (now >= entry.windowEnd) {
    entry.count = 1;
    entry.windowEnd = now + WINDOW_MS;
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX;
}

export function getClientKey(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.headers?.["x-real-ip"] || req.socket?.remoteAddress || "";
  return ip || "unknown";
}
