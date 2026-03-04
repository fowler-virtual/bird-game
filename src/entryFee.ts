/**
 * EntryFee コントラクトとのやりとり。
 * VITE_ENTRY_FEE_ADDRESS が .env に設定されているときのみ有効。
 * 未設定時は参加費チェックをスキップ（従来通り無料で遊べる）。
 */

import { BrowserProvider, Contract } from 'ethers';

const ENTRY_FEE_ABI = [
  'function fee() view returns (uint256)',
  'function hasPaid(address) view returns (bool)',
  'function pay() payable',
] as const;

function getContractAddress(): string | null {
  const addr = import.meta.env.VITE_ENTRY_FEE_ADDRESS;
  if (typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42) return addr;
  return null;
}

/**
 * 指定アドレスが参加費を支払い済みかチェックする（read-only、署名不要）。
 * コントラクト未設定時は true を返す（参加費チェックをスキップ）。
 */
export async function checkEntryFeePaid(address: string): Promise<boolean> {
  const contractAddress = getContractAddress();
  if (!contractAddress) return true; // 未設定 → スキップ
  if (typeof window === 'undefined' || !window.ethereum) return true;

  try {
    const provider = new BrowserProvider(window.ethereum);
    const contract = new Contract(contractAddress, ENTRY_FEE_ABI, provider);
    return await contract.hasPaid(address);
  } catch (e) {
    console.warn('[entryFee] Failed to check hasPaid:', e);
    return true; // チェック失敗時はブロックしない
  }
}

/**
 * 参加費の額（wei）を取得する。表示用。
 */
export async function getEntryFeeAmount(): Promise<bigint | null> {
  const contractAddress = getContractAddress();
  if (!contractAddress) return null;
  if (typeof window === 'undefined' || !window.ethereum) return null;

  try {
    const provider = new BrowserProvider(window.ethereum);
    const contract = new Contract(contractAddress, ENTRY_FEE_ABI, provider);
    return await contract.fee();
  } catch (e) {
    console.warn('[entryFee] Failed to get fee amount:', e);
    return null;
  }
}

/**
 * 参加費を支払う（signer 必要、ETH 送金）。
 */
export async function payEntryFee(): Promise<{ ok: true } | { ok: false; error: string }> {
  const contractAddress = getContractAddress();
  if (!contractAddress) return { ok: false, error: 'Entry fee contract not configured.' };
  if (typeof window === 'undefined' || !window.ethereum) return { ok: false, error: 'No wallet.' };

  try {
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new Contract(contractAddress, ENTRY_FEE_ABI, signer);

    // fee() を読んで必要な ETH 額を取得
    const feeAmount: bigint = await contract.fee();
    const tx = await contract.pay({ value: feeAmount });
    await tx.wait();
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/user rejected|user denied/i.test(msg)) return { ok: false, error: 'Transaction rejected.' };
    if (/insufficient funds/i.test(msg)) return { ok: false, error: 'Insufficient ETH balance.' };
    if (/Already paid/i.test(msg)) return { ok: true }; // 既に支払い済みなら成功扱い
    if (/execution reverted|CALL_EXCEPTION|revert/i.test(msg)) {
      return { ok: false, error: 'Transaction failed. You may not have enough ETH, or the entry fee was already paid.' };
    }
    return { ok: false, error: msg || 'Payment failed.' };
  }
}
