/**
 * ゲーム状態の取得・保存 API。
 * VITE_CLAIM_API_URL が設定されているときはサーバー（/api/game-state）と同期し、
 * 未設定時はローカル（localStorage）のみ。Claim 可能量はサーバー側の state.seed から計算するため、本番ではサーバー同期が必須。
 */

import { GameStore, getStateKeyForAddress, parseGameStateFromRaw } from './store/GameStore';
import type { GameState } from './types';

const credentials: RequestCredentials = 'include';

function getClaimApiBase(): string | null {
  const url = import.meta.env.VITE_CLAIM_API_URL;
  if (typeof url === 'string' && url.length > 0) return url.replace(/\/$/, '');
  return null;
}

export type GetGameStateResult =
  | { ok: true; state: GameState; version: number }
  | { ok: false; error: string };

export type PutGameStateResult =
  | { ok: true; version: number }
  | { ok: false; error: string };

/**
 * 現在接続中のウォレットのゲーム状態を取得する。
 * VITE_CLAIM_API_URL 設定時はサーバー GET /game-state を優先し、未接続・失敗時は localStorage。
 */
export async function getGameState(): Promise<GetGameStateResult> {
  const address = GameStore.walletAddress;
  if (!address || typeof address !== 'string') {
    return { ok: false, error: 'Not logged in.' };
  }
  const base = getClaimApiBase();
  if (base) {
    try {
      const res = await fetch(`${base}/game-state`, { method: 'GET', credentials });
      const data = (await res.json().catch(() => ({}))) as { state?: GameState; version?: number; code?: string };
      if (res.status === 401) return { ok: false, error: 'Not logged in.' };
      if (res.ok && data.state != null && typeof data.version === 'number') {
        return { ok: true, state: data.state as GameState, version: data.version };
      }
      if (res.status === 409 || data.code === 'STALE_DATA') {
        return { ok: false, error: 'Stale data.' };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }
  try {
    const key = getStateKeyForAddress(address);
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    const state = parseGameStateFromRaw(raw);
    const version = GameStore.serverStateVersion || 1;
    return { ok: true, state, version };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * 現在接続中のウォレットのゲーム状態を保存する。
 * VITE_CLAIM_API_URL 設定時はサーバー PUT /game-state に送り、成功時に localStorage も更新。未設定時は localStorage のみ。
 */
export async function putGameState(state: GameState, version: number): Promise<PutGameStateResult> {
  const address = GameStore.walletAddress;
  if (!address || typeof address !== 'string') {
    return { ok: false, error: 'Not logged in.' };
  }
  const base = getClaimApiBase();
  if (base) {
    try {
      const res = await fetch(`${base}/game-state`, {
        method: 'PUT',
        credentials,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, version }),
      });
      const data = (await res.json().catch(() => ({}))) as { version?: number; code?: string };
      if (res.status === 401) return { ok: false, error: 'Not logged in.' };
      if (res.ok && typeof data.version === 'number') {
        if (typeof localStorage !== 'undefined') {
          const key = getStateKeyForAddress(address);
          localStorage.setItem(key, JSON.stringify(state));
        }
        GameStore.serverStateVersion = data.version;
        return { ok: true, version: data.version };
      }
      if (res.status === 409 || data.code === 'STALE_DATA') {
        return { ok: false, error: 'Stale data.' };
      }
      const errMsg = (data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? `Failed (${res.status})`;
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[gameStateApi] PUT /game-state failed:', res.status, errMsg);
      }
      return { ok: false, error: errMsg };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }
  try {
    const key = getStateKeyForAddress(address);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(state));
    }
    GameStore.serverStateVersion = version;
    return { ok: true, version };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** デバウンス用。save() のたびに呼ぶとサーバーへ PUT が遅延送信される。 */
const SERVER_SAVE_DEBOUNCE_MS = 2000;
let serverSyncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 現在の GameStore の状態をサーバーへ送る（デバウンス付き）。
 * VITE_CLAIM_API_URL が未設定のときは何もしない。GameStore.save() の後に呼ぶ想定。
 */
export function scheduleServerSync(): void {
  if (!getClaimApiBase()) return;
  if (serverSyncTimer != null) clearTimeout(serverSyncTimer);
  serverSyncTimer = setTimeout(async () => {
    serverSyncTimer = null;
    const v = GameStore.serverStateVersion || 1;
    const result = await putGameState(GameStore.state, v);
    if (!result.ok && result.error !== 'Stale data.') {
      console.warn('[gameStateApi] server sync failed:', result.error);
    }
  }, SERVER_SAVE_DEBOUNCE_MS);
}

/**
 * 未送信の状態をただちにサーバーへ送る（デバウンスタイマーをキャンセルして即実行）。
 * Claim 前に呼ぶと、デバッグで増やした SEED がサーバーに反映されてから claimable が計算される。
 * 409 (Stale data) のときはサーバー最新 version を取得して 1 回だけ再 PUT する。
 * @returns サーバーへの保存が成功したか（API 未設定の場合は true）
 */
export async function flushServerSync(): Promise<boolean> {
  if (serverSyncTimer != null) {
    clearTimeout(serverSyncTimer);
    serverSyncTimer = null;
  }
  if (!getClaimApiBase()) return true;
  const v = GameStore.serverStateVersion || 1;
  let result = await putGameState(GameStore.state, v);
  if (result.ok) return true;
  if (result.error === 'Stale data.') {
    const getResult = await getGameState();
    if (getResult.ok && typeof getResult.version === 'number') {
      result = await putGameState(GameStore.state, getResult.version);
      if (result.ok) return true;
    }
  }
  if (result.error !== 'Stale data.') {
    console.warn('[gameStateApi] flush server sync failed:', result.error);
  }
  return false;
}
