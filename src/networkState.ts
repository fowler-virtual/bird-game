/**
 * NetworkState コントラクトの読み書き。
 * VITE_NETWORK_STATE_ADDRESS が .env に設定されているときのみ有効。
 */

import { BrowserProvider, Contract } from 'ethers';
import { GameStore } from './store/GameStore';

const ABI = [
  'function updatePower(uint256 newPower) external',
  'function setLoftLevel(uint256 level) external',
  'function addRarityCounts(uint256[5] calldata toAdd) external',
  'function getMyPower(address account) view returns (uint256)',
  'function getMyLoftLevel(address account) view returns (uint256)',
  'function loftLevel(address account) view returns (uint256)',
  'function getMyShareBps(address account) view returns (uint256)',
  'function getLevelCounts() view returns (uint256[6])',
  'function getGlobalRarityCounts() view returns (uint256[5])',
  'function totalPower() view returns (uint256)',
] as const;

function getContractAddress(): string | null {
  const addr = import.meta.env.VITE_NETWORK_STATE_ADDRESS;
  if (typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42) return addr;
  return null;
}

export function hasNetworkState(): boolean {
  return getContractAddress() != null;
}

/** domShell 用の別名 */
export function hasNetworkStateContract(): boolean {
  return hasNetworkState();
}

/** キャッシュ（refreshNetworkStateFromChain で更新） */
let cachedPower: number | null = null;
let cachedShareBps: number | null = null;
let cachedLevelCounts: number[] = [0, 0, 0, 0, 0, 0];
let cachedRarityCounts: number[] = [0, 0, 0, 0, 0];

export function getSeedPerDayFromChain(): number {
  if (cachedPower == null) return 0;
  return cachedPower * 24;
}

export function getNetworkSharePercentFromChain(): number {
  if (cachedShareBps == null) return 0;
  return cachedShareBps / 100;
}

export function getCachedPower(): number | null {
  return cachedPower;
}

export function getCachedShareBps(): number | null {
  return cachedShareBps;
}

export function getCachedLevelCounts(): number[] {
  return [...cachedLevelCounts];
}

export function getCachedRarityCounts(): number[] {
  return [...cachedRarityCounts];
}

/** リセット／Disconnect 時に呼ぶ。オンチェーン用キャッシュを破棄し、ステータスバーが古いチェーン値を表示しないようにする。 */
export function clearNetworkStateCache(): void {
  cachedPower = null;
  cachedShareBps = null;
  cachedLevelCounts = [0, 0, 0, 0, 0, 0];
  cachedRarityCounts = [0, 0, 0, 0, 0];
  lastFetchError = null;
}

/** オンチェーンから自分のパワー・シェア・レベル分布・レアリティを取得してキャッシュする。1つ失敗しても他は更新する。 */
export async function refreshNetworkStateFromChain(): Promise<void> {
  const addr = GameStore.walletAddress;
  lastFetchError = null;
  const contractAddr = getContractAddress();
  if (!addr || !contractAddr) {
    cachedPower = null;
    cachedShareBps = null;
    if (!contractAddr) {
      lastFetchError = import.meta.env.DEV
        ? 'VITE_NETWORK_STATE_ADDRESS not set in .env. Add it and restart the dev server (npm run dev).'
        : 'ネットワーク統計は利用できません。';
    } else if (!addr) {
      lastFetchError = 'Wallet not connected.';
    }
    return;
  }
  // 想定チェーン（Sepolia 本番 / localhost ローカル）以外では取得しない。他チェーンではエラーを出さずスキップする。
  const expectedChainIds = [11155111, 31337]; // Sepolia, Hardhat local
  try {
    if (typeof window !== 'undefined' && window.ethereum) {
      const provider = new BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);
      if (!expectedChainIds.includes(chainId)) {
        cachedPower = null;
        cachedShareBps = null;
        return;
      }
    }
  } catch {
    return;
  }
  const [powerResult, shareBpsResult, countsResult, rarityResult] = await Promise.allSettled([
    fetchMyPower(addr),
    fetchMyShareBps(addr),
    fetchLevelCounts(),
    fetchGlobalRarityCounts(),
  ]);
  const setErrorFromRejection = (r: PromiseRejectedResult) => {
    if (lastFetchError) return;
    const raw = r.reason?.message ?? String(r.reason);
    lastFetchError =
      /CALL_EXCEPTION|missing revert|BAD_DATA|could not decode/i.test(raw)
        ? 'ネットワーク統計を取得できませんでした。ウォレットが正しいネットワーク（例: Sepolia）に接続されているか確認してください。'
        : raw.length > 120
          ? raw.slice(0, 117) + '...'
          : raw;
  };
  if (powerResult.status === 'fulfilled') {
    cachedPower = powerResult.value;
    lastFetchError = null;
  } else setErrorFromRejection(powerResult as PromiseRejectedResult);
  if (shareBpsResult.status === 'fulfilled') {
    cachedShareBps = shareBpsResult.value;
    if (powerResult.status === 'fulfilled') lastFetchError = null;
  } else setErrorFromRejection(shareBpsResult as PromiseRejectedResult);
  if (countsResult.status === 'fulfilled') {
    const counts = countsResult.value;
    cachedLevelCounts = counts.length >= 6 ? counts : [0, 0, 0, 0, 0, 0];
  } else setErrorFromRejection(countsResult as PromiseRejectedResult);
  if (rarityResult.status === 'fulfilled') {
    const rarityCounts = rarityResult.value;
    cachedRarityCounts = rarityCounts.length >= 5 ? rarityCounts : [0, 0, 0, 0, 0];
  } else setErrorFromRejection(rarityResult as PromiseRejectedResult);
}

async function getContract(signer = false): Promise<Contract | null> {
  const address = getContractAddress();
  if (!address || typeof window === 'undefined' || !window.ethereum) return null;
  try {
    const provider = new BrowserProvider(window.ethereum);
    const signerOrProvider = signer ? await provider.getSigner() : provider;
    return new Contract(address, ABI, signerOrProvider);
  } catch {
    return null;
  }
}

/** 接続エラー時に true。ログイン直後や Save 後もデータが取れない場合の表示用。 */
let lastFetchError: string | null = null;
export function getNetworkStateFetchError(): string | null {
  return lastFetchError;
}

/** 自分のパワー（SEED/時ベース）。未登録は 0。 */
export async function fetchMyPower(userAddress: string): Promise<number> {
  const contract = await getContract(false);
  if (!contract) throw new Error('Contract not available.');
  const raw = await contract.getMyPower(userAddress);
  return Number(raw);
}

/** 自分のシェア（basis points）。例: 5.25% => 525 */
export async function fetchMyShareBps(userAddress: string): Promise<number> {
  const contract = await getContract(false);
  if (!contract) throw new Error('Contract not available.');
  const raw = await contract.getMyShareBps(userAddress);
  return Number(raw);
}

/** 自分のLOFTレベル（1..6）。未登録は 1 */
export async function fetchMyLoftLevel(userAddress: string): Promise<number> {
  const contract = await getContract(false);
  if (!contract) return 1;
  try {
    const raw = await contract.getMyLoftLevel(userAddress);
    return Math.min(6, Math.max(1, Number(raw)));
  } catch {
    return 1;
  }
}

/** オンチェーン上の未登録判定用。0 = 未登録、1..6 = 登録済み */
export async function getLoftLevelRaw(userAddress: string): Promise<number> {
  const contract = await getContract(false);
  if (!contract) return 0;
  try {
    const raw = await contract.loftLevel(userAddress);
    return Number(raw);
  } catch {
    return 0;
  }
}

/** レベル1..6の人数配列。古いコントラクト（getLevelCounts なし）ではデコード失敗するので [0,0,0,0,0,0] を返す。 */
export async function fetchLevelCounts(): Promise<number[]> {
  const contract = await getContract(false);
  if (!contract) throw new Error('Contract not available.');
  try {
    const arr = await contract.getLevelCounts();
    return (Array.from(arr) as bigint[]).map((x) => Number(x));
  } catch {
    return [0, 0, 0, 0, 0, 0];
  }
}

/** デバッグ用。getLevelCounts のデコード失敗時も throw するので、原因を表示できる。 */
export async function fetchLevelCountsStrict(): Promise<number[]> {
  const contract = await getContract(false);
  if (!contract) throw new Error('Contract not available.');
  const arr = await contract.getLevelCounts();
  return (Array.from(arr) as bigint[]).map((x) => Number(x));
}

/** レアリティ別鳥数。古いコントラクトの場合は [0,0,0,0,0] を返し lastFetchError は触らない（他 fetches の結果でステータスカードを表示するため）。 */
export async function fetchGlobalRarityCounts(): Promise<number[]> {
  const contract = await getContract(false);
  if (!contract) return [0, 0, 0, 0, 0];
  try {
    const arr = await contract.getGlobalRarityCounts();
    return (Array.from(arr) as bigint[]).map((x) => Number(x));
  } catch {
    return [0, 0, 0, 0, 0];
  }
}

/** デバッグ用。getGlobalRarityCounts のデコード失敗時も throw する。 */
export async function fetchGlobalRarityCountsStrict(): Promise<number[]> {
  const contract = await getContract(false);
  if (!contract) throw new Error('Contract not available.');
  const arr = await contract.getGlobalRarityCounts();
  return (Array.from(arr) as bigint[]).map((x) => Number(x));
}

/** デバッグ用: 直近の addRarityCountsOnChain の戻り値 */
let lastAddRarityResult: { ok: true } | { ok: false; error: string } | null = null;
export function getLastAddRarityResult(): typeof lastAddRarityResult {
  return lastAddRarityResult;
}

/** デバッグ用: 直近の updatePower の戻り値 */
let lastUpdatePowerResult: { ok: true } | { ok: false; error: string } | null = null;
export function getLastUpdatePowerResult(): typeof lastUpdatePowerResult {
  return lastUpdatePowerResult;
}

/** ガチャで引いた鳥のレアリティ内訳をオンチェーンに加算。counts は [Common, Uncommon, Rare, Epic, Legendary] */
/** waitForConfirmation: false のときは tx を送信するだけで待たず、戻り値に tx を含める（呼び出し側で tx.wait() をバックグラウンド実行可能） */
export async function addRarityCountsOnChain(
  counts: number[],
  opts?: { waitForConfirmation?: boolean },
): Promise<{ ok: true; tx?: { wait: () => Promise<unknown> } } | { ok: false; error: string }> {
  const waitForConfirmation = opts?.waitForConfirmation !== false;
  const contract = await getContract(true);
  if (!contract) {
    lastAddRarityResult = { ok: false, error: 'NetworkState not configured or no wallet.' };
    return lastAddRarityResult;
  }
  const arr = [0, 0, 0, 0, 0];
  for (let i = 0; i < 5 && i < counts.length; i++) arr[i] = Math.max(0, Math.floor(counts[i]));
  try {
    const tx = await contract.addRarityCounts(arr);
    if (waitForConfirmation) {
      await tx.wait();
      lastAddRarityResult = { ok: true };
      return lastAddRarityResult;
    }
    lastAddRarityResult = { ok: true };
    return { ok: true, tx };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/user rejected|user denied/i.test(msg)) lastAddRarityResult = { ok: false, error: 'Transaction rejected.' };
    else lastAddRarityResult = { ok: false, error: msg || 'Add rarity counts failed.' };
    return lastAddRarityResult;
  }
}

/** domShell 用の別名 */
export async function updatePowerOnChain(power: number): Promise<{ ok: true } | { ok: false; error: string }> {
  return updatePower(power);
}

/** デッキのパワーをオンチェーンに保存。編成のたびに1トランザクション */
export async function updatePower(power: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const contract = await getContract(true);
  if (!contract) {
    lastUpdatePowerResult = { ok: false, error: 'NetworkState not configured or no wallet.' };
    return lastUpdatePowerResult;
  }
  const amount = Math.floor(Number(power));
  if (amount < 0) {
    lastUpdatePowerResult = { ok: false, error: 'Invalid power.' };
    return lastUpdatePowerResult;
  }
  try {
    const tx = await contract.updatePower(amount);
    await tx.wait();
    lastUpdatePowerResult = { ok: true };
    return lastUpdatePowerResult;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/user rejected|user denied/i.test(msg)) lastUpdatePowerResult = { ok: false, error: 'Transaction rejected.' };
    else lastUpdatePowerResult = { ok: false, error: msg || 'Update failed.' };
    return lastUpdatePowerResult;
  }
}

/** LOFTレベルをオンチェーンに記録（レベルアップ時に burn のあとで呼ぶ） */
/** waitForConfirmation: false のときは送信のみで待たず、戻り値に tx を含める（呼び出し側でバックグラウンド待ち可能） */
export async function setLoftLevel(
  level: number,
  opts?: { waitForConfirmation?: boolean },
): Promise<{ ok: true; tx?: { wait: () => Promise<unknown> } } | { ok: false; error: string }> {
  const waitForConfirmation = opts?.waitForConfirmation !== false;
  const contract = await getContract(true);
  if (!contract) return { ok: false, error: 'NetworkState not configured or no wallet.' };
  const lv = Math.min(6, Math.max(1, Math.floor(level)));
  try {
    const tx = await contract.setLoftLevel(lv);
    if (waitForConfirmation) {
      await tx.wait();
      return { ok: true };
    }
    return { ok: true, tx };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/user rejected|user denied/i.test(msg)) return { ok: false, error: 'Transaction rejected.' };
    return { ok: false, error: msg || 'Set level failed.' };
  }
}
