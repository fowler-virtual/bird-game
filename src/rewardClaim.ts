/**
 * RewardClaim コントラクトの claimEIP712 をユーザーウォレットから実行（ガス代はユーザー負担）。
 * EIP-712 署名（deadline / campaignId 含む）を API から取得してから呼ぶ。
 * VITE_REWARD_CLAIM_ADDRESS が .env に設定されているときのみ有効。
 */

import { AbiCoder, BrowserProvider, Contract, Interface } from 'ethers';
import type { ClaimSignature } from './claimApi';

/** Revert data: Error(string) selector (Solidity require) */
const ERROR_STRING_SELECTOR = '0x08c379a0';

function decodeRevertReason(data: unknown): string | null {
  if (typeof data !== 'string' || !data.startsWith('0x')) return null;
  if (data.slice(0, 10).toLowerCase() !== ERROR_STRING_SELECTOR.toLowerCase()) return null;
  try {
    const tail = data.slice(10);
    if (tail.length < 128) return null;
    const abiCoder = AbiCoder.defaultAbiCoder();
    const decoded = abiCoder.decode(['string'], '0x' + tail);
    const msg = decoded?.[0];
    return typeof msg === 'string' ? msg : null;
  } catch {
    return null;
  }
}

const REWARD_CLAIM_ABI = [
  'function claimEIP712(address recipient, uint256 amount, uint256 nonce, uint256 deadline, bytes32 campaignId, uint8 v, bytes32 r, bytes32 s) external',
  'function signer() view returns (address)',
  'function pool() view returns (address)',
  'function seedToken() view returns (address)',
] as const;

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
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
 * 報酬プールの $SEED 残高と RewardClaim への allowance を取得（Claim 失敗時の確認用）。
 */
export async function getPoolBalanceAndAllowance(): Promise<{
  pool: string;
  seedToken: string;
  balanceWei: string;
  allowanceWei: string;
  balanceFormatted: string;
  allowanceFormatted: string;
} | null> {
  const contractAddress = getClaimContractAddress();
  if (!contractAddress || typeof window === 'undefined' || !window.ethereum) return null;
  try {
    const provider = new BrowserProvider(window.ethereum);
    const claimContract = new Contract(contractAddress, REWARD_CLAIM_ABI, provider);
    const [poolAddr, tokenAddr] = await Promise.all([
      claimContract.pool(),
      claimContract.seedToken(),
    ]);
    const pool = typeof poolAddr === 'string' ? poolAddr : String(poolAddr);
    const seedToken = typeof tokenAddr === 'string' ? tokenAddr : String(tokenAddr);
    const tokenContract = new Contract(seedToken, ERC20_ABI, provider);
    const [balanceWei, allowanceWei] = await Promise.all([
      tokenContract.balanceOf(pool),
      tokenContract.allowance(pool, contractAddress),
    ]);
    const bal = BigInt(balanceWei?.toString?.() ?? balanceWei ?? 0);
    const all = BigInt(allowanceWei?.toString?.() ?? allowanceWei ?? 0);
    const fmt = (n: bigint) => (Number(n) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
    const allowanceFormatted =
      all >= BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff') ? '無制限' : fmt(all);
    return {
      pool,
      seedToken,
      balanceWei: String(bal),
      allowanceWei: String(all),
      balanceFormatted: fmt(bal),
      allowanceFormatted,
    };
  } catch {
    return null;
  }
}

/**
 * コントラクトの signer() を取得（Claim revert 時の一致確認用）。
 */
export async function getContractSignerAddress(): Promise<string | null> {
  const contractAddress = getClaimContractAddress();
  if (!contractAddress || typeof window === 'undefined' || !window.ethereum) return null;
  try {
    const provider = new BrowserProvider(window.ethereum);
    const contract = new Contract(contractAddress, REWARD_CLAIM_ABI, provider);
    const signerAddr = await contract.signer();
    return typeof signerAddr === 'string' ? signerAddr : null;
  } catch {
    return null;
  }
}

/**
 * API から取得した EIP-712 署名を使って RewardClaim.claimEIP712 を送信する。
 * recipient は接続ウォレットのアドレス（署名の recipient と一致すること）。
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
    const recipient = await signer.getAddress();
    const amountWei = BigInt(signature.amountWei);
    const nonce = BigInt(signature.nonce);
    const deadline = BigInt(signature.deadline);
    const campaignId = signature.campaignId.startsWith('0x') ? signature.campaignId : `0x${signature.campaignId}`;
    const args = [
      recipient,
      amountWei,
      nonce,
      deadline,
      campaignId as `0x${string}`,
      signature.v,
      signature.r,
      signature.s,
    ] as const;

    // estimateGas を一切使わず送信する（ethers の Contract メソッドは gasLimit 指定でも内部で estimateGas を呼ぶことがあり、
    // シミュレーションが revert するとウォレットに届く前に例外になる。直接 sendTransaction でウォレットを必ず開く。）
    const iface = new Interface(REWARD_CLAIM_ABI as unknown as string[]);
    const data = iface.encodeFunctionData('claimEIP712', args);
    const GAS_LIMIT = 300_000;
    if (typeof console !== 'undefined' && console.log) {
      console.log('[Claim] eth_sendTransaction 送信直前', { to: contractAddress, dataLength: data?.length, gasLimit: GAS_LIMIT });
    }
    const tx = await signer.sendTransaction({
      to: contractAddress,
      data,
      gasLimit: GAS_LIMIT,
    });
    if (typeof console !== 'undefined' && console.log) {
      console.log('[Claim] トランザクション送信済み', tx.hash ?? '(hash pending)');
    }
    const receipt = await tx.wait();
    const txHash = receipt?.hash ?? tx.hash;
    return { ok: true, txHash: typeof txHash === 'string' ? txHash : String(txHash) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const err = e as {
      data?: string;
      error?: { data?: string; message?: string };
      info?: { error?: { data?: string } };
      code?: string;
      reason?: string;
      receipt?: { status?: number };
    };
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[Claim] executeClaim エラー', {
        message: msg?.slice(0, 120),
        code: err?.code,
        reason: err?.reason,
        dataLength: typeof err?.data === 'string' ? err.data.length : 0,
        hasReceipt: !!err?.receipt,
      });
    }
    if (/user rejected|user denied/i.test(msg)) return { ok: false, error: 'Transaction rejected.' };

    const revertData = err?.data ?? err?.error?.data ?? err?.info?.error?.data;
    const reason = revertData ? decodeRevertReason(revertData) : null;

    if (/execution reverted|CALL_EXCEPTION|revert|RewardClaim/i.test(msg) || reason) {
      if (reason) {
        if (/signature expired|expired/i.test(reason)) {
          return { ok: false, error: 'The claim signature has expired. Please try again to get a new one.' };
        }
        if (/nonce already used/i.test(reason)) {
          return { ok: false, error: 'This claim was already used. Request a new claim and try again.' };
        }
        if (/invalid signature/i.test(reason)) {
          return {
            ok: false,
            error:
              'Invalid signature: the contract signer does not match the server key. Check VERCEL_ENV_VARS.md — CLAIM_SIGNER_PRIVATE_KEY must correspond to the RewardClaim contract’s signer address.',
          };
        }
        if (/transfer failed/i.test(reason)) {
          return { ok: false, error: 'Claim reverted: reward pool transfer failed (e.g. insufficient balance or allowance).' };
        }
        if (/recipient must be caller/i.test(reason)) {
          return { ok: false, error: 'Claim failed: you must call claim from the same wallet that received the signature.' };
        }
        return { ok: false, error: `Claim failed: ${reason}` };
      }
      if (/expired|signature expired/i.test(msg)) {
        return { ok: false, error: 'The claim signature has expired. Please try again to get a new one.' };
      }
      return {
        ok: false,
        error:
          'Claim failed (revert). If it keeps happening, ensure the contract’s signer matches the server’s CLAIM_SIGNER_PRIVATE_KEY — see docs/VERCEL_ENV_VARS.md. Check /api/claim/signer on your site and compare with RewardClaim signer().',
      };
    }
    if (/429|Too Many Requests/i.test(msg)) {
      return {
        ok: false,
        error:
          'RPC rate limit (429). In your wallet (MetaMask / Rabby): Settings → Networks → Sepolia → set RPC URL to https://rpc.sepolia.org (or another provider), then try again.',
      };
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
