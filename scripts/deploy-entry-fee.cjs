/**
 * EntryFee コントラクトをデプロイ。
 * .env: SEPOLIA_DEPLOYER_KEY（デプロイアカウント）
 * デプロイ後、出力されたアドレスを .env の VITE_ENTRY_FEE_ADDRESS に設定すること。
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
const hre = require("hardhat");

// 0.001 ETH = 1000000000000000 wei (テスト用)
const FEE_AMOUNT = "1000000000000000";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying EntryFee with account:", deployer.address);
  console.log("Fee:", FEE_AMOUNT, "wei (0.001 ETH)");

  const EntryFee = await hre.ethers.getContractFactory("EntryFee");
  const entryFee = await EntryFee.deploy(FEE_AMOUNT);
  const receipt = await entryFee.deploymentTransaction().wait();
  const contractAddress = receipt.contractAddress || (await entryFee.getAddress());

  console.log("EntryFee deployed to:", contractAddress);
  console.log("\n--- Add to .env ---");
  console.log("VITE_ENTRY_FEE_ADDRESS=" + contractAddress);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
