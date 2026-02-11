/**
 * Claim API: ユーザーが claim トランザクションを送れるよう、バックエンドが署名を発行する。
 * レスポンスの amountWei, nonce, v, r, s をフロントで RewardClaim.claim() に渡す（ガス代はユーザー負担）。
 * .env: CLAIM_SIGNER_PRIVATE_KEY（署名用）, SEED_TOKEN_ADDRESS は参照用（未使用だが設定推奨）。
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
const express = require("express");
const { Wallet, getAddress, keccak256, solidityPacked, getBytes, Signature } = require("ethers");

const DECIMALS = 18n;
const PORT = Number(process.env.CLAIM_API_PORT) || 3001;

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.post("/claim", async (req, res) => {
  const signerKey = (process.env.CLAIM_SIGNER_PRIVATE_KEY || "").trim();
  if (!signerKey) {
    return res.status(500).json({ error: "Server not configured (CLAIM_SIGNER_PRIVATE_KEY)." });
  }

  const { address, amount } = req.body || {};
  if (!address || typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: "Invalid address" });
  }
  const amountNum = Number(amount);
  if (!Number.isInteger(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: "Invalid amount (positive integer required)" });
  }

  const amountWei = BigInt(amountNum) * 10n ** DECIMALS;
  const userAddress = getAddress(address);
  const nonce = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));

  try {
    const wallet = new Wallet(signerKey);
    const hash = keccak256(solidityPacked(["address", "uint256", "uint256"], [userAddress, amountWei, nonce]));
    const sig = await wallet.signMessage(getBytes(hash));
    const sigObj = Signature.from(sig);
    const payload = {
      ok: true,
      amountWei: amountWei.toString(),
      nonce: nonce.toString(),
      v: Number(sigObj.v),
      r: String(sigObj.r),
      s: String(sigObj.s),
    };
    console.log("[claim] OK", address, amountNum, "SEED");
    return res.json(payload);
  } catch (err) {
    console.error("[claim]", err.message || err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Claim API listening on http://localhost:${PORT}`);
});
