/**
 * チェーン上の $SEED トークン残高取得・送金。
 * VITE_SEED_TOKEN_ADDRESS / VITE_SEED_TREASURY_ADDRESS が .env に設定されているときのみ有効。
 */

import { BrowserProvider, Contract } from 'ethers';
import { GameStore } from './store/GameStore';

const SEED_TOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function burn(uint256 amount)',
] as const;

const DECIMALS = 18n;

function getTokenAddress(): string | null {
  const addr = import.meta.env.VITE_SEED_TOKEN_ADDRESS;
  if (typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42) return addr;
  return null;
}

/** ゲームが $SEED を受け取るアドレス（ガチャ・Loft 支払い先）。未設定時は transfer 不可。 */
export function getTreasuryAddress(): string | null {
  const addr = import.meta.env.VITE_SEED_TREASURY_ADDRESS;
  if (typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42) return addr;
  return null;
}

/**
 * 接続中のウォレットの $SEED 残高をチェーンから取得し、GameStore.seedToken に反映する。
 * アドレス未設定・取得失敗時は何もしない（既存の localStorage 値のまま）。
 */
export async function refreshSeedTokenFromChain(): Promise<void> {
  const tokenAddress = getTokenAddress();
  const address = GameStore.walletAddress;
  if (!tokenAddress || !address || typeof window === 'undefined' || !window.ethereum) return;

  try {
    const provider = new BrowserProvider(window.ethereum);
    const contract = new Contract(tokenAddress, SEED_TOKEN_ABI, provider);
    const balance: bigint = await contract.balanceOf(address);
    const display = balance / 10n ** DECIMALS;
    GameStore.seedToken = Number(display);
    GameStore.save();
  } catch (e) {
    console.warn('[seedToken] Failed to fetch balance from chain:', e);
  }
}

/**
 * 接続ウォレットから treasury へ $SEED を送金する。
 * amount は表示単位（整数）。成功時は呼び出し側で refreshSeedTokenFromChain() を推奨。
 */
export async function transferSeedTokens(amount: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const tokenAddress = getTokenAddress();
  const treasury = getTreasuryAddress();
  if (!tokenAddress || !treasury) return { ok: false, error: 'Token or treasury address not configured.' };
  if (typeof window === 'undefined' || !window.ethereum) return { ok: false, error: 'No wallet.' };
  const address = GameStore.walletAddress;
  if (!address) return { ok: false, error: 'Wallet not connected.' };

  const amountWei = BigInt(Math.floor(amount)) * 10n ** DECIMALS;
  if (amountWei <= 0n) return { ok: false, error: 'Invalid amount.' };

  try {
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new Contract(tokenAddress, SEED_TOKEN_ABI, signer);
    const tx = await contract.transfer(treasury, amountWei);
    await tx.wait();
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/user rejected|user denied/i.test(msg)) return { ok: false, error: 'Transaction rejected.' };
    if (/insufficient balance/i.test(msg)) return { ok: false, error: 'Insufficient $SEED balance.' };
    if (/execution reverted|CALL_EXCEPTION|revert/i.test(msg)) {
      return { ok: false, error: 'Transfer failed. Your wallet may not have enough $SEED, or the contract rejected the transfer.' };
    }
    return { ok: false, error: msg || 'Transfer failed.' };
  }
}

/**
 * 接続ウォレットの $SEED を burn() する（ガチャ・Loft 支払い用）。
 * amount は表示単位（整数）。成功時は呼び出し側で refreshSeedTokenFromChain() を推奨。
 */
export async function burnSeedTokens(amount: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const tokenAddress = getTokenAddress();
  if (!tokenAddress) return { ok: false, error: 'Token address not configured.' };
  if (typeof window === 'undefined' || !window.ethereum) return { ok: false, error: 'No wallet.' };
  const amountWei = BigInt(Math.floor(amount)) * 10n ** DECIMALS;
  if (amountWei <= 0n) return { ok: false, error: 'Invalid amount.' };

  try {
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new Contract(tokenAddress, SEED_TOKEN_ABI, signer);
    const tx = await contract.burn(amountWei);
    await tx.wait();
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/user rejected|user denied/i.test(msg)) return { ok: false, error: 'Transaction rejected.' };
    if (/insufficient balance/i.test(msg)) return { ok: false, error: 'Not enough $SEED in your wallet.' };
    if (/Internal JSON-RPC|ECONNREFUSED|network|ENOTFOUND/i.test(msg)) {
      return { ok: false, error: 'Network error. Switch MetaMask to the correct network (e.g. localhost:8545) and try again.' };
    }
    if (/execution reverted|CALL_EXCEPTION|revert/i.test(msg)) {
      return { ok: false, error: 'The transaction failed. You may not have enough $SEED, or the contract rejected it.' };
    }
    return { ok: false, error: msg || 'The transaction failed.' };
  }
}

/**
 * ガチャ / Loft など「ゲーム内アクション」で $SEED を burn する共通ヘルパー。
 * - amount は表示単位（整数）
 * - 成功時はチェーンから残高を再取得する
 */
export async function burnSeedForAction(
  amount: number,
  context: 'gacha' | 'loft',
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (amount <= 0) return { ok: true };
  const result = await burnSeedTokens(amount);
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[${context}] burn failed`, result.error);
    return { ok: false, error: result.error };
  }
  await refreshSeedTokenFromChain();
  return { ok: true };
}
