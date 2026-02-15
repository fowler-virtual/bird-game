// Vercel serverless: Claim API（A寄せ最小仕様）
// 認証必須・amount は受け取らない・CORS 自ドメイン推奨・rate limit 補助。
// 署名返却は Express サーバ（永続層あり）で行い、Vercel では claimable 未実装のため 503 を返す。

import { getSessionAddress } from "./_lib/sessionCookie.js";
import { checkRateLimit, getClientKey } from "./_lib/rateLimit.js";
import { setCorsHeaders } from "./_lib/cors.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 認証必須: セッションがなければ 401
  const sessionAddress = getSessionAddress(req);
  if (!sessionAddress) {
    return res.status(401).json({ error: "Not logged in. Sign in with your wallet first." });
  }

  // rate limit（IP 単位・同一インスタンス内）
  const clientKey = getClientKey(req);
  if (!checkRateLimit(clientKey)) {
    return res.status(429).json({ error: "Too many requests. Try again later." });
  }

  if (process.env.CLAIM_DISABLED === "true") {
    return res.status(503).json({ error: "Claim is temporarily disabled." });
  }

  const body = req.body || {};
  if (body.amount !== undefined && body.amount !== null) {
    return res.status(400).json({
      error: "Do not send amount. Claimable amount is determined by the server only.",
    });
  }

  // body.address があればセッションと一致することを要求（本人のみ）
  if (body.address !== undefined && body.address !== null) {
    const lower = (body.address || "").toLowerCase();
    if (sessionAddress.toLowerCase() !== lower) {
      return res.status(403).json({ error: "Address does not match session." });
    }
  }

  // Vercel では永続層がないため署名を返さず 503（本番 claim は Express サーバを利用）
  const signerKey = (process.env.CLAIM_SIGNER_PRIVATE_KEY || "").trim();
  if (!signerKey) {
    return res.status(503).json({ error: "Server not configured (CLAIM_SIGNER_PRIVATE_KEY)." });
  }

  return res.status(503).json({
    error: "Claim is being updated. Server-side claimable is not yet available. Use the Express server for full claim flow.",
  });
}
