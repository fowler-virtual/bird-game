/**
 * Set claimable_total for an address (dev/testing). Server must be stopped or use a separate store path.
 * Usage: node scripts/set-claimable.cjs <address> <amount_wei>
 * Example: node scripts/set-claimable.cjs 0x1234... 1000000000000000000
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
const claimStore = require("../server/claimStore.cjs");

const [addr, amountWei] = process.argv.slice(2);
if (!addr || !amountWei) {
  console.error("Usage: node scripts/set-claimable.cjs <address> <amount_wei>");
  process.exit(1);
}
if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
  console.error("Invalid address");
  process.exit(1);
}
claimStore.setClaimableTotal(addr, amountWei);
console.log("Set claimable_total for", addr, "to", amountWei, "wei");
