/**
 * 報酬プールが RewardClaim に SeedToken の無制限 approve を行う。
 * .env: REWARD_POOL_PRIVATE_KEY, RPC_URL, SEED_TOKEN_ADDRESS, REWARD_CLAIM_ADDRESS
 */
require("dotenv").config();
const { Contract, Wallet, JsonRpcProvider } = require("ethers");

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
];

async function main() {
  const poolKey = process.env.REWARD_POOL_PRIVATE_KEY;
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const tokenAddress = process.env.SEED_TOKEN_ADDRESS;
  const claimAddress = process.env.REWARD_CLAIM_ADDRESS;

  if (!poolKey || !tokenAddress || !claimAddress) {
    console.error("Set REWARD_POOL_PRIVATE_KEY, SEED_TOKEN_ADDRESS, REWARD_CLAIM_ADDRESS in .env");
    process.exitCode = 1;
    return;
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const poolWallet = new Wallet(poolKey, provider);
  const token = new Contract(tokenAddress, ERC20_ABI, poolWallet);
  const max = 2n ** 256n - 1n;
  const tx = await token.approve(claimAddress, max);
  await tx.wait();
  console.log("Approved RewardClaim to spend pool's $SEED. Tx:", tx.hash);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
