/**
 * EIP-1193 ウォレット接続
 * eth_requestAccounts は必ず「ユーザー操作の直接の応答」で同期的に呼ぶこと。
 */

export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, callback: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const REQUEST_TIMEOUT_MS = 60_000;

export type ConnectResult =
  | { ok: true; address: string }
  | { ok: false; error: string; code?: number };

export function getProvider(): EthereumProvider | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.ethereum;
}

export function hasWallet(): boolean {
  return !!getProvider();
}

/**
 * 既に許可済みのアカウントを取得（プロンプトなし）
 */
export async function getConnectedAccounts(): Promise<string[]> {
  const provider = getProvider();
  if (!provider) return [];
  try {
    const accounts = (await provider.request({ method: 'eth_accounts', params: [] })) as string[] | undefined;
    return Array.isArray(accounts)
      ? accounts.filter((a): a is string => typeof a === 'string' && a.length >= 40)
      : [];
  } catch {
    return [];
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string')
    return (err as { message: string }).message;
  return String(err);
}

/**
 * 接続要求。クリックハンドラ内で同期的に呼び、戻り値の Promise を then/catch で処理すること。
 * async/await をハンドラに使うとユーザージェスチャが失われるため使わないこと。
 */
export function requestAccounts(): Promise<ConnectResult> {
  const provider = getProvider();
  if (!provider)
    return Promise.resolve({ ok: false, error: 'No wallet (window.ethereum). Install MetaMask etc.' });

  // ユーザージェスチャを維持するため、ここで同期的に request を発行する
  const requestPromise = provider.request({
    method: 'eth_requestAccounts',
    params: [],
  }) as Promise<string[] | undefined>;

  const timeout = new Promise<ConnectResult>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), REQUEST_TIMEOUT_MS)
  );

  const result = requestPromise
    .then((accounts) => {
      const address = accounts?.[0];
      if (typeof address === 'string' && address.length >= 40) return { ok: true as const, address };
      return { ok: false as const, error: 'No account returned' };
    })
    .catch((err: unknown) => {
      const code = (err as { code?: number }).code;
      if (code === 4001) return { ok: false as const, error: 'User rejected', code: 4001 };
      console.error('[Wallet] requestAccounts error:', err);
      return { ok: false as const, error: formatError(err), code };
    });

  return Promise.race([result, timeout]).catch((err) => ({
    ok: false as const,
    error: err instanceof Error ? err.message : 'Timeout',
  }));
}

/** 接続（Gacha 等）。ユーザージェスチャ外で呼ぶとポップアップが出ない場合あり。 */
export function connectWallet(): Promise<ConnectResult> {
  return requestAccounts();
}

/** 本番用: Sepolia テストネットの chainId（EIP-155）。ガス・コントラクトは Sepolia 向け。 */
export const SEPOLIA_CHAIN_ID = '0xaa36a7'; // 11155111

/**
 * ウォレットが Sepolia でない場合に切り替えを要求する。接続直後に呼ぶと以降のトランザクションが Sepolia に向く。
 * 切り替えはガス不要（メタデータの更新のみ）。ユーザーが拒否した場合は { ok: false } を返す。
 */
export function ensureSepolia(): Promise<{ ok: true } | { ok: false; error: string }> {
  const provider = getProvider();
  if (!provider) return Promise.resolve({ ok: false, error: 'No wallet' });
  return (provider.request({ method: 'eth_chainId', params: [] }) as Promise<string>)
    .then(async (chainId) => {
      const normalized = typeof chainId === 'string' && chainId.startsWith('0x') ? chainId : `0x${Number(chainId).toString(16)}`;
      if (normalized.toLowerCase() === SEPOLIA_CHAIN_ID.toLowerCase()) return { ok: true as const };
      const switchResult = await switchToSepolia(provider);
      if (switchResult.ok) return { ok: true as const };
      if (isUnrecognizedChainError(switchResult.error)) {
        const addResult = await addSepoliaChain(provider);
        if (!addResult.ok) return addResult;
        return switchToSepolia(provider);
      }
      return switchResult;
    })
    .catch((err: unknown) => ({
      ok: false as const,
      error: formatError(err),
    }));
}

function isUnrecognizedChainError(msg: string): boolean {
  return /unrecognized|4902|unknown chain|network.*not added/i.test(msg);
}

function switchToSepolia(provider: EthereumProvider): Promise<{ ok: true } | { ok: false; error: string }> {
  return (provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_CHAIN_ID }] }) as Promise<unknown>)
    .then(() => ({ ok: true as const }))
    .catch((err: unknown) => {
      const code = (err as { code?: number }).code;
      if (code === 4001) return { ok: false as const, error: 'User rejected network switch' };
      return { ok: false as const, error: formatError(err) };
    });
}

function addSepoliaChain(provider: EthereumProvider): Promise<{ ok: true } | { ok: false; error: string }> {
  return (provider.request({
    method: 'wallet_addEthereumChain',
    params: [
      {
        chainId: SEPOLIA_CHAIN_ID,
        chainName: 'Sepolia',
        nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://rpc.sepolia.org'],
        blockExplorerUrls: ['https://sepolia.etherscan.io'],
      },
    ],
  }) as Promise<unknown>)
    .then(() => ({ ok: true as const }))
    .catch((err: unknown) => {
      const code = (err as { code?: number }).code;
      if (code === 4001) return { ok: false as const, error: 'User rejected adding network' };
      return { ok: false as const, error: formatError(err) };
    });
}

/**
 * メッセージ署名（personal_sign）。Claim 等で「ウォレットで承認」を必ず出したいときに使う。
 * 戻りが ok ならユーザーが署名したことを意味する。
 */
export function signMessage(message: string, address: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const provider = getProvider();
  if (!provider) return Promise.resolve({ ok: false, error: 'No wallet' });
  const hexMessage =
    '0x' +
    Array.from(new TextEncoder().encode(message))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  return (provider.request({ method: 'personal_sign', params: [hexMessage, address] }) as Promise<unknown>)
    .then(() => ({ ok: true as const }))
    .catch((err: unknown) => {
      const code = (err as { code?: number }).code;
      if (code === 4001) return { ok: false as const, error: 'Signature rejected' };
      return { ok: false as const, error: formatError(err) };
    });
}

/** TOP の Connect Wallet から接続した直後はリロードしない（承認→Farming へ進むため） */
const JUST_CONNECTING_KEY = 'bird-game-just-connecting';
export function setJustConnectingFlag(): void {
  try {
    sessionStorage.setItem(JUST_CONNECTING_KEY, '1');
  } catch (_) {}
}
export function clearJustConnectingFlag(): void {
  try {
    sessionStorage.removeItem(JUST_CONNECTING_KEY);
  } catch (_) {}
}
export function isJustConnecting(): boolean {
  try {
    return sessionStorage.getItem(JUST_CONNECTING_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * アカウント変更時にページをリロードするリスナーを登録する。
 * ウォレットの切り替えや Disconnect 時に、正しいアドレスで状態を読み直すため。
 * TOP から Connect 承認直後はリロードしない（承認→Farming の流れを維持）。
 */
export function setupAccountChangeReload(): void {
  const provider = getProvider();
  if (!provider || typeof provider.on !== 'function') return;
  provider.on('accountsChanged', () => {
    if (isJustConnecting()) {
      clearJustConnectingFlag();
      return;
    }
    setTimeout(() => window.location.reload(), 150);
  });
}

/**
 * ウォレット側の権限を取り消す（EIP-2255 / MetaMask 等）。
 * Disconnect 時に呼ぶと、次回 Connect Wallet でウォレットの接続ダイアログが必ず出る。
 * 非対応プロバイダでは無視される。
 */
export function revokeWalletPermissions(): Promise<void> {
  const provider = getProvider();
  if (!provider) return Promise.resolve();
  return (provider.request({
    method: 'wallet_revokePermissions',
    params: [{ eth_accounts: {} }],
  }) as Promise<unknown>).then(
    () => {},
    () => {} // 非対応 or ユーザー拒否時は無視
  );
}
