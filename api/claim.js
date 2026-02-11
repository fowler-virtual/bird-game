// Vercel serverless function for Claim API
// POST /api/claim で署名を返し、フロント側で RewardClaim.claim() を実行する。
// ローカルの server/index.cjs と同じロジックを、Vercel Runtime 用に簡略化したものです。

import { Wallet, getAddress, keccak256, solidityPacked, getBytes, Signature } from 'ethers';

const DECIMALS = 18n;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signerKey = (process.env.CLAIM_SIGNER_PRIVATE_KEY || '').trim();
  if (!signerKey) {
    return res.status(500).json({ error: 'Server not configured (CLAIM_SIGNER_PRIVATE_KEY).' });
  }

  const { address, amount } = req.body || {};
  if (!address || typeof address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid address' });
  }
  const amountNum = Number(amount);
  if (!Number.isInteger(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'Invalid amount (positive integer required)' });
  }

  const amountWei = BigInt(amountNum) * 10n ** DECIMALS;
  const userAddress = getAddress(address);
  const nonce = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));

  try {
    const wallet = new Wallet(signerKey);
    const hash = keccak256(solidityPacked(['address', 'uint256', 'uint256'], [userAddress, amountWei, nonce]));
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
    // eslint-disable-next-line no-console
    console.log('[claim] OK', address, amountNum, 'SEED');
    return res.status(200).json(payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[claim]', err?.message || err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

