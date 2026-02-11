const hre = require("hardhat");

const MINT_AMOUNT = 1_000_000n * 10n ** 18n; // 1M $SEED (18 decimals)

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying $SEED with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  const SeedToken = await hre.ethers.getContractFactory("SeedToken");
  const token = await SeedToken.deploy();
  await token.waitForDeployment();
  const address = await token.getAddress();
  console.log("SeedToken deployed to:", address);

  const tx = await token.mint(deployer.address, MINT_AMOUNT);
  await tx.wait();
  console.log("Minted", MINT_AMOUNT.toString(), "to", deployer.address);

  const bal = await token.balanceOf(deployer.address);
  console.log("Deployer $SEED balance:", bal.toString());
  console.log("\n--- Add this to your .env or frontend ---");
  console.log("SEED_TOKEN_ADDRESS=" + address);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
