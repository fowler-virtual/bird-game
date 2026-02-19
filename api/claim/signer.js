/**
 * GET /api/claim/signer — 署名に使っているアドレスを返す（Claim revert 時の signer 一致確認用）。
 * 認証不要。コントラクトの signer() と比較してください。
 */

import { Wallet } from "ethers";
import { setCorsHeaders } from "../_lib/cors.js";

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  const signerKey = (process.env.CLAIM_SIGNER_PRIVATE_KEY || "").trim();
  if (!signerKey) {
    return res.status(503).json({
      error: "CLAIM_SIGNER_PRIVATE_KEY is not configured.",
      signerAddress: null,
    });
  }

  try {
    const wallet = new Wallet(signerKey);
    const signerAddress = wallet.address;
    return res.status(200).json({
      signerAddress,
      hint: "This must match the signer address in your RewardClaim contract (e.g. call contract.signer() on Sepolia).",
    });
  } catch (err) {
    console.error("[claim/signer]", err?.message || err);
    return res.status(500).json({
      error: err?.message || String(err),
      signerAddress: null,
    });
  }
}
