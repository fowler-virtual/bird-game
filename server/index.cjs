/**
 * Claim API: サーバが claimable 差分を reserve し、EIP-712 署名を返す（A寄せ最小仕様）。
 * SIWE セッション必須。amount は body で受け取らない。
 * .env: CLAIM_SIGNER_PRIVATE_KEY, REWARD_CLAIM_CHAIN_ID, REWARD_CLAIM_CONTRACT_ADDRESS,
 *       SESSION_SECRET, CLAIM_API_PORT
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
const express = require("express");
const { Wallet, getAddress } = require("ethers");
const { SiweMessage } = require("siwe");
const claimStore = require("./claimStore.cjs");
const { signClaimRequest, DEFAULT_CAMPAIGN_ID } = require("./eip712Claim.cjs");
const siweNonceStore = require("./siweNonceStore.cjs");
const { setSessionCookie, getSessionAddress, getSecret } = require("./sessionCookie.cjs");

const PORT = Number(process.env.CLAIM_API_PORT) || 3001;

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_CLAIM_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/** Require valid session; set req.sessionAddress (checksummed). */
function requireSession(req, res, next) {
  const address = getSessionAddress(req);
  if (!address) {
    return res.status(401).json({ error: "Not logged in. Sign in with your wallet first." });
  }
  req.sessionAddress = getAddress(address);
  next();
}

// --- SIWE auth ---
app.get("/auth/nonce", (req, res) => {
  const address = req.query.address;
  if (!address || typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: "Invalid or missing address." });
  }
  const nonce = siweNonceStore.createNonce(getAddress(address));
  return res.json({ nonce });
});

app.post("/auth/verify", async (req, res) => {
  if (!getSecret()) {
    return res.status(503).json({ error: "Server not configured (SESSION_SECRET)." });
  }
  const { message, signature, address } = req.body || {};
  if (!message || typeof message !== "string" || !signature || typeof signature !== "string") {
    return res.status(400).json({ error: "Missing message or signature." });
  }
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: "Invalid address." });
  }
  try {
    const siweMessage = new SiweMessage(message);
    await siweMessage.verify({ signature });
    const recovered = getAddress(siweMessage.address);
    const requested = getAddress(address);
    if (recovered !== requested) {
      return res.status(400).json({ error: "Address does not match signature." });
    }
    if (!siweNonceStore.consumeNonce(recovered, siweMessage.nonce)) {
      return res.status(400).json({ error: "Invalid or expired nonce." });
    }
    if (!setSessionCookie(res, recovered)) {
      return res.status(500).json({ error: "Failed to set session." });
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(401).json({ error: e.message || "Verification failed." });
  }
});

if (process.env.CLAIM_DISABLED === "true") {
  app.post("/claim", (req, res) => {
    return res.status(503).json({ error: "Claim is temporarily disabled." });
  });
} else {
  app.post("/claim", requireSession, async (req, res) => {
    if (req.body && (req.body.amount !== undefined && req.body.amount !== null)) {
      return res.status(400).json({
        error: "Do not send amount. Claimable amount is determined by the server only.",
      });
    }
    const signerKey = (process.env.CLAIM_SIGNER_PRIVATE_KEY || "").trim();
    const chainId = process.env.REWARD_CLAIM_CHAIN_ID;
    const verifyingContract = process.env.REWARD_CLAIM_CONTRACT_ADDRESS;
    if (!signerKey || !chainId || !verifyingContract) {
      return res.status(503).json({ error: "Server not configured (signer, chainId, contract)." });
    }
    const userAddress = req.sessionAddress;
    const reserved = claimStore.reserve(userAddress);
    if (!reserved) {
      return res.status(400).json({ error: "No claimable amount." });
    }
    const { amountWei, nonce, expiresAt } = reserved;
    try {
      const wallet = new Wallet(signerKey);
      const sig = await signClaimRequest(
        wallet,
        chainId,
        verifyingContract,
        userAddress,
        amountWei,
        nonce,
        expiresAt,
        DEFAULT_CAMPAIGN_ID
      );
      const payload = {
        ok: true,
        amountWei,
        nonce: String(nonce),
        deadline: sig.deadline,
        campaignId: sig.campaignId,
        v: sig.v,
        r: sig.r,
        s: sig.s,
      };
      console.log("[claim] OK", userAddress, "amountWei", amountWei, "nonce", nonce);
      return res.json(payload);
    } catch (err) {
      console.error("[claim]", err.message || err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  });
}

app.post("/claim/confirm", requireSession, (req, res) => {
  const { nonce, amountWei } = req.body || {};
  if (nonce == null || !amountWei) {
    return res.status(400).json({ error: "Missing nonce or amountWei." });
  }
  const ok = claimStore.confirmReservation(req.sessionAddress, nonce, String(amountWei));
  return res.json({ ok });
});

app.get("/claimable", requireSession, (req, res) => {
  const wei = claimStore.getClaimable(req.sessionAddress);
  return res.json({ claimable: wei.toString() });
});

app.listen(PORT, () => {
  console.log(`Claim API listening on http://localhost:${PORT}`);
});
