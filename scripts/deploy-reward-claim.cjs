/**
 * RewardClaim コントラクトをデプロイ。
 * .env: SEED_TOKEN_ADDRESS, REWARD_POOL_PRIVATE_KEY（プールアドレス取得）, CLAIM_SIGNER_PRIVATE_KEY（署名者アドレス取得）
 * デプロイ後、プールから approve(RewardClaim, max) を実行すること（npm run approve-claim）。
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
const hre = require("hardhat");

async function main() {
  const tokenAddress = (process.env.SEED_TOKEN_ADDRESS || "").trim();
  const poolKey = (process.env.REWARD_POOL_PRIVATE_KEY || "").trim();
  const signerKey = (process.env.CLAIM_SIGNER_PRIVATE_KEY || "").trim();

  if (!tokenAddress || !poolKey || !signerKey) {
    const missing = [];
    if (!tokenAddress) missing.push("SEED_TOKEN_ADDRESS");
    if (!poolKey) missing.push("REWARD_POOL_PRIVATE_KEY");
    if (!signerKey) missing.push("CLAIM_SIGNER_PRIVATE_KEY");
    console.error("Missing in .env:", missing.join(", "));
    console.error("( .env は package.json と同じフォルダに置いてください。値の前後にスペースを入れないでください )");
    process.exitCode = 1;
    return;
  }

  const [deployer] = await hre.ethers.getSigners();
  const poolWallet = new hre.ethers.Wallet(poolKey, hre.ethers.provider);
  const signerWallet = new hre.ethers.Wallet(signerKey, hre.ethers.provider);
  const poolAddress = await poolWallet.getAddress();
  const signerAddress = await signerWallet.getAddress();

  console.log("Deploying RewardClaim with:");
  console.log("  SeedToken:", tokenAddress);
  console.log("  Pool:", poolAddress);
  console.log("  Signer:", signerAddress);

  const RewardClaim = await hre.ethers.getContractFactory("RewardClaim");
  const claim = await RewardClaim.deploy(tokenAddress, poolAddress, signerAddress);
  const receipt = await claim.deploymentTransaction().wait();
  const claimAddress = receipt.contractAddress || (await claim.getAddress());
  console.log("RewardClaim deployed to:", claimAddress);
  console.log("(SeedToken is at", tokenAddress + ")");
  console.log("\n--- Add to .env ---");
  console.log("REWARD_CLAIM_ADDRESS=" + claimAddress);
  console.log("VITE_REWARD_CLAIM_ADDRESS=" + claimAddress);
  console.log("\nThen run: npm run approve-claim");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
