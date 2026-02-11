/**
 * 指定アドレスの $SEED 残高をチェーンから取得する（MetaMask 表示の確認用）。
 * 使い方: node scripts/check-seed-balance.cjs <アドレス>
 * 例: node scripts/check-seed-balance.cjs 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
 */
require("dotenv").config();
const { Contract, JsonRpcProvider } = require("ethers");

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
const DECIMALS = 18n;

async function main() {
  const address = process.argv[2] || process.env.CHECK_ADDRESS;
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    console.error("Usage: node scripts/check-seed-balance.cjs <0xYourAddress>");
    process.exitCode = 1;
    return;
  }

  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const tokenAddress = process.env.SEED_TOKEN_ADDRESS;
  if (!tokenAddress) {
    console.error("Set SEED_TOKEN_ADDRESS in .env");
    process.exitCode = 1;
    return;
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const contract = new Contract(tokenAddress, ERC20_ABI, provider);
  const balance = await contract.balanceOf(address);
  const display = balance / 10n ** DECIMALS;

  console.log("Network:", rpcUrl);
  console.log("Token (SEED):", tokenAddress);
  console.log("Address:", address);
  console.log("Balance (raw wei):", balance.toString());
  console.log("Balance (SEED):", display.toString());
  if (Number(display) > 0) {
    console.log("\n→ チェーン上では残高があります。MetaMask が 0 なら表示の不具合です。");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
