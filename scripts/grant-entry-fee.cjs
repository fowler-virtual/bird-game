/**
 * 既存ユーザーの参加費を免除する（owner が grantPaid を呼ぶ）。
 * 使い方: node scripts/grant-entry-fee.cjs 0xAddr1 0xAddr2 ...
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
const hre = require("hardhat");

const ENTRY_FEE_ABI = [
  "function grantPaid(address[] calldata players) external",
  "function hasPaid(address) view returns (bool)",
];

async function main() {
  const contractAddress = (process.env.VITE_ENTRY_FEE_ADDRESS || "").trim();
  if (!contractAddress) {
    console.error("VITE_ENTRY_FEE_ADDRESS not set in .env");
    process.exitCode = 1;
    return;
  }

  const addresses = process.argv.slice(2).filter((a) => a.startsWith("0x"));
  if (addresses.length === 0) {
    console.error("Usage: node scripts/grant-entry-fee.cjs 0xAddr1 0xAddr2 ...");
    process.exitCode = 1;
    return;
  }

  const [signer] = await hre.ethers.getSigners();
  console.log("Granting entry fee for", addresses.length, "address(es) from", signer.address);

  const contract = new hre.ethers.Contract(contractAddress, ENTRY_FEE_ABI, signer);
  const tx = await contract.grantPaid(addresses);
  console.log("tx:", tx.hash);
  await tx.wait();
  console.log("Done. Verifying...");

  for (const addr of addresses) {
    const paid = await contract.hasPaid(addr);
    console.log(" ", addr, "->", paid ? "OK" : "FAILED");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
