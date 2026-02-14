/**
 * EIP-712 typed data for RewardClaim.claimEIP712.
 * Must match contract: ClaimRequest(address recipient,uint256 amount,uint256 nonce,uint256 deadline,bytes32 campaignId)
 */

const { getAddress } = require("ethers");

const DOMAIN_NAME = "BirdGame Claim";
const DOMAIN_VERSION = "1";

// Default campaign id (bytes32). Use 0x0...0 for single campaign.
const DEFAULT_CAMPAIGN_ID = "0x0000000000000000000000000000000000000000000000000000000000000000";

function getDomain(chainId, verifyingContract) {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: Number(chainId),
    verifyingContract: getAddress(verifyingContract),
  };
}

const CLAIM_REQUEST_TYPES = {
  ClaimRequest: [
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "campaignId", type: "bytes32" },
  ],
};

/**
 * Sign EIP-712 ClaimRequest. Returns { v, r, s, deadline, campaignId }.
 */
async function signClaimRequest(wallet, chainId, verifyingContract, recipient, amountWei, nonce, deadlineSec, campaignId) {
  const domain = getDomain(chainId, verifyingContract);
  const deadline = BigInt(deadlineSec);
  const value = {
    recipient: getAddress(recipient),
    amount: BigInt(amountWei),
    nonce: BigInt(nonce),
    deadline,
    campaignId: campaignId || DEFAULT_CAMPAIGN_ID,
  };
  const signature = await wallet.signTypedData(domain, CLAIM_REQUEST_TYPES, value);
  const { v, r, s } = require("ethers").Signature.from(signature);
  return {
    v: Number(v),
    r: String(r),
    s: String(s),
    deadline: deadline.toString(),
    campaignId: value.campaignId,
  };
}

module.exports = { signClaimRequest, DEFAULT_CAMPAIGN_ID, getDomain, CLAIM_REQUEST_TYPES };
