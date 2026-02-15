/**
 * CORS: ALLOWED_CLAIM_ORIGIN をカンマ区切りで複数指定可能にし、
 * リクエストの Origin が許可リストにあればそれを返す（ローカルでポート可変に対応）。
 */
function getAllowedOrigins() {
  const raw = process.env.ALLOWED_CLAIM_ORIGIN || "";
  if (!raw.trim()) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function chooseCorsOrigin(req, allowedOrigins) {
  const origin = req.headers?.origin;
  if (origin && allowedOrigins.length > 0 && allowedOrigins.includes(origin)) return origin;
  if (allowedOrigins.length > 0) return allowedOrigins[0];
  return "*";
}

export function setCorsHeaders(req, res) {
  const allowed = getAllowedOrigins();
  res.setHeader("Access-Control-Allow-Origin", chooseCorsOrigin(req, allowed));
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
