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
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

let cached = { balance: null, at: 0 };
const CACHE_MS = 15_000;

/**
 * @returns {Promise<string|null>} Pool balance in wei (string) or null if unavailable.
 */
export async function getPoolBalanceWei() {
  const rpc = (process.env.RPC_URL || "").trim();
  const claimAddr = (process.env.REWARD_CLAIM_CONTRACT_ADDRESS || "").trim();
  if (!rpc || !claimAddr || !claimAddr.startsWith("0x")) return null;

  const now = Date.now();
  if (cached.balance !== null && now - cached.at < CACHE_MS) return cached.balance;

  try {
    const provider = new JsonRpcProvider(rpc);
    const claim = new Contract(claimAddr, REWARD_CLAIM_ABI, provider);
    const [poolAddr, tokenAddr] = await Promise.all([claim.pool(), claim.seedToken()]);
    const token = new Contract(tokenAddr, ERC20_ABI, provider);
    const balance = await token.balanceOf(poolAddr);
    const wei = typeof balance === "bigint" ? balance : BigInt(balance?.toString?.() ?? 0);
    cached = { balance: wei.toString(), at: now };
    return cached.balance;
  } catch (e) {
    console.warn("[poolBalance]", e?.message || e);
    return null;
  }
}
