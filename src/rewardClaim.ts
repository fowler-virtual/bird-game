/**
 * RewardClaim コントラクトの claim() をユーザーウォレットから実行（ガス代はユーザー負担）。
 * VITE_REWARD_CLAIM_ADDRESS が .env に設定されているときのみ有効。
 */

import { BrowserProvider, Contract } from 'ethers';
import type { ClaimSignature } from './claimApi';

const REWARD_CLAIM_ABI = [
  'function claim(uint256 amount, uint256 nonce, uint8 v, bytes32 r, bytes32 s) external',
] as const;

function getClaimContractAddress(): string | null {
  const addr = import.meta.env.VITE_REWARD_CLAIM_ADDRESS;
  if (typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42) return addr;
  return null;
}

export function hasClaimContract(): boolean {
  return getClaimContractAddress() != null;
}

/**
 * API から取得した署名を使って RewardClaim.claim() を送信する。
 * MetaMask でトランザクション承認（ガス代と +X $SEED の表示）が行われる。
 */
export async function executeClaim(signature: ClaimSignature): Promise<
  { ok: true; txHash: string } | { ok: false; error: string }
> {
  const contractAddress = getClaimContractAddress();
  if (!contractAddress) return { ok: false, error: 'RewardClaim contract not configured (VITE_REWARD_CLAIM_ADDRESS).' };
  if (typeof window === 'undefined' || !window.ethereum) return { ok: false, error: 'No wallet.' };

  try {
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new Contract(contractAddress, REWARD_CLAIM_ABI, signer);
    const amountWei = BigInt(signature.amountWei);
    const nonce = BigInt(signature.nonce);
    const tx = await contract.claim(
      amountWei,
      nonce,
      signature.v,
      signature.r,
      signature.s
    );
    const receipt = await tx.wait();
    const txHash = receipt?.hash ?? tx.hash;
    return { ok: true, txHash: typeof txHash === 'string' ? txHash : String(txHash) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/user rejected|user denied/i.test(msg)) return { ok: false, error: 'Transaction rejected.' };
    if (/execution reverted|CALL_EXCEPTION|revert|RewardClaim/i.test(msg)) {
      return { ok: false, error: 'Claim failed. The signature may have expired or already been used.' };
    }
    if (/Internal JSON-RPC error| -32603 /i.test(msg)) {
      const err = e as { data?: { message?: string }; info?: { error?: { message?: string } }; reason?: string };
      const detail = err?.data?.message ?? err?.info?.error?.message ?? err?.reason;
      const hint = 'Check that the local chain (npm run chain) is running and MetaMask is on the correct network (e.g. Bird Game → http://127.0.0.1:8545, Chain ID 31337).';
      return { ok: false, error: detail ? `${detail} ${hint}` : `RPC error. ${hint}` };
    }
    return { ok: false, error: msg || 'Claim transaction failed.' };
  }
}
