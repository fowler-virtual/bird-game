/**
 * EIP-1193 ウォレット接続
 * eth_requestAccounts は必ず「ユーザー操作の直接の応答」で同期的に呼ぶこと。
 */

export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
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
