/**
 * Get the reward pool's $SEED balance (wei string) for the RewardClaim contract.
 * Used to cap claim amount so transferFrom does not revert.
 * Requires RPC_URL and REWARD_CLAIM_CONTRACT_ADDRESS.
 */

import { JsonRpcProvider, Contract } from "ethers";

const REWARD_CLAIM_ABI = [
  "function pool() view returns (address)",
  "function seedToken() view returns (address)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

let cached = { balance: null, allowance: null, at: 0 };
const CACHE_MS = 15_000;

/**
 * @returns {Promise<string|null>} Pool balance in wei (string) or null if unavailable.
 */
export async function getPoolBalanceWei() {
  const pair = await getPoolBalanceAndAllowanceWei();
  return pair ? pair.balanceWei : null;
}

/**
 * Pool の $SEED 残高と RewardClaim への allowance を取得。
 * transferFrom が revert しないよう、署名量を min(balance, allowance) でキャップするために使用。
 * @param {object} [opts] - オプション
 * @param {boolean} [opts.bypassCache] - true の場合キャッシュを使わず必ず RPC で取得（Claim 署名時推奨）
 * @returns {Promise<{ balanceWei: string, allowanceWei: string }|null>}
 */
export async function getPoolBalanceAndAllowanceWei(opts = {}) {
  const rpc = (process.env.RPC_URL || "").trim();
  const claimAddr = (process.env.REWARD_CLAIM_CONTRACT_ADDRESS || "").trim();
  if (!rpc || !claimAddr || !claimAddr.startsWith("0x")) return null;

  const now = Date.now();
  const useCache = !opts.bypassCache && cached.balance !== null && cached.allowance !== null && now - cached.at < CACHE_MS;
  if (useCache) {
    return { balanceWei: cached.balance, allowanceWei: cached.allowance };
  }

  try {
    const provider = new JsonRpcProvider(rpc);
    const claim = new Contract(claimAddr, REWARD_CLAIM_ABI, provider);
    const [poolAddr, tokenAddr] = await Promise.all([claim.pool(), claim.seedToken()]);
    const pool = typeof poolAddr === "string" ? poolAddr : String(poolAddr);
    const token = new Contract(tokenAddr, ERC20_ABI, provider);
    const [balance, allowance] = await Promise.all([
      token.balanceOf(pool),
      token.allowance(pool, claimAddr),
    ]);
    const balanceWei = (typeof balance === "bigint" ? balance : BigInt(balance?.toString?.() ?? 0)).toString();
    const allowanceWei = (typeof allowance === "bigint" ? allowance : BigInt(allowance?.toString?.() ?? 0)).toString();
    cached = { balance: balanceWei, allowance: allowanceWei, at: now };
    return { balanceWei, allowanceWei };
  } catch (e) {
    console.warn("[poolBalance]", e?.message || e);
    return null;
  }
}
