// Vercel serverless: Claim API (A-spec). Session required; amount from server (claimable from game state seed).
// Reserve via claimStoreKV, sign EIP-712, return signature for RewardClaim.claimEIP712.

import { Wallet, getAddress, Signature } from "ethers";
import { getSessionAddress } from "./_lib/sessionCookie.js";
import { checkRateLimit, getClientKey } from "./_lib/rateLimit.js";
import { setCorsHeaders } from "./_lib/cors.js";
import { reserve } from "./_lib/claimStoreKV.js";

const DEFAULT_CAMPAIGN_ID = "0x0000000000000000000000000000000000000000000000000000000000000000";

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const sessionAddress = getSessionAddress(req);
  if (!sessionAddress) {
    return res.status(401).json({ error: "Not logged in. Sign in with your wallet first." });
  }

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

  if (body.address !== undefined && body.address !== null) {
    const lower = (body.address || "").toLowerCase();
    if (sessionAddress.toLowerCase() !== lower) {
      return res.status(403).json({ error: "Address does not match session." });
    }
  }

  const signerKey = (process.env.CLAIM_SIGNER_PRIVATE_KEY || "").trim();
  const chainId = process.env.REWARD_CLAIM_CHAIN_ID;
  const verifyingContract = process.env.REWARD_CLAIM_CONTRACT_ADDRESS;
  if (!signerKey || !chainId || !verifyingContract) {
    return res.status(503).json({
      error: "Server not configured (CLAIM_SIGNER_PRIVATE_KEY, REWARD_CLAIM_CHAIN_ID, REWARD_CLAIM_CONTRACT_ADDRESS).",
    });
  }

  const reserved = await reserve(sessionAddress);
  if (!reserved) {
    return res.status(400).json({ error: "No claimable amount." });
  }

  const { amountWei, nonce, expiresAt } = reserved;
  const userAddress = getAddress(sessionAddress);

  try {
    const wallet = new Wallet(signerKey);
    const domain = {
      name: "BirdGame Claim",
      version: "1",
      chainId: Number(chainId),
      verifyingContract: getAddress(verifyingContract),
    };
    const types = {
      ClaimRequest: [
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "campaignId", type: "bytes32" },
      ],
    };
    const value = {
      recipient: userAddress,
      amount: BigInt(amountWei),
      nonce: BigInt(nonce),
      deadline: BigInt(expiresAt),
      campaignId: DEFAULT_CAMPAIGN_ID,
    };
    const sigHex = await wallet.signTypedData(domain, types, value);
    const { v, r, s } = Signature.from(sigHex);

    const payload = {
      ok: true,
      amountWei,
      nonce: String(nonce),
      deadline: String(expiresAt),
      campaignId: DEFAULT_CAMPAIGN_ID,
      v: Number(v),
      r: String(r),
      s: String(s),
    };
    return res.status(200).json(payload);
  } catch (err) {
    console.error("[claim]", err?.message || err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
