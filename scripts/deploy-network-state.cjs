/**
 * NetworkState コントラクトをデプロイ。
 * デプロイ後 .env に VITE_NETWORK_STATE_ADDRESS を追加する。
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
const hre = require("hardhat");

async function main() {
  const NetworkState = await hre.ethers.getContractFactory("NetworkState");
  const contract = await NetworkState.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log("NetworkState deployed to:", address);
  console.log("\n--- Add to .env ---");
  console.log("NETWORK_STATE_ADDRESS=" + address);
  console.log("VITE_NETWORK_STATE_ADDRESS=" + address);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
