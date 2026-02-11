/**
 * 報酬プールへ $SEED を入金（owner が mint(プールアドレス, 量) を実行）。
 * .env: OWNER_PRIVATE_KEY, RPC_URL, SEED_TOKEN_ADDRESS, REWARD_POOL_PRIVATE_KEY（未設定時は OWNER のアドレスに mint）
 */
require("dotenv").config();
const { Contract, Wallet, JsonRpcProvider } = require("ethers");

const MINT_ABI = ["function mint(address to, uint256 amount) external"];
const DECIMALS = 18n;
const AMOUNT = 1_000_000n * 10n ** DECIMALS; // 1M SEED

async function main() {
  const ownerKey = process.env.OWNER_PRIVATE_KEY;
  const poolKey = process.env.REWARD_POOL_PRIVATE_KEY || process.env.OWNER_PRIVATE_KEY;
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const tokenAddress = process.env.SEED_TOKEN_ADDRESS;

  if (!ownerKey || !tokenAddress) {
    console.error("Set OWNER_PRIVATE_KEY, SEED_TOKEN_ADDRESS in .env");
    process.exitCode = 1;
    return;
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const ownerWallet = new Wallet(ownerKey, provider);
  const poolWallet = new Wallet(poolKey, provider);
  const poolAddress = await poolWallet.getAddress();

  console.log("Funding reward pool:", poolAddress, "with", AMOUNT / 10n ** DECIMALS, "SEED");
  const contract = new Contract(tokenAddress, MINT_ABI, ownerWallet);
  const tx = await contract.mint(poolAddress, AMOUNT);
  await tx.wait();
  console.log("Done. Tx:", tx.hash);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
