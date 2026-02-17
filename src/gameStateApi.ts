/**
 * ゲーム状態の取得・保存 API。
 * 現状はローカル（localStorage）のみ。同一ウォレットのストレージキーで読み書きする。
 */

import { GameStore, getStateKeyForAddress, parseGameStateFromRaw } from './store/GameStore';
import type { GameState } from './types';

export type GetGameStateResult =
  | { ok: true; state: GameState; version: number }
  | { ok: false; error: string };

export type PutGameStateResult =
  | { ok: true; version: number }
  | { ok: false; error: string };

/**
 * 現在接続中のウォレットのゲーム状態を取得する。
 * 未接続の場合は { ok: false, error: 'Not logged in.' }。
 */
export async function getGameState(): Promise<GetGameStateResult> {
  const address = GameStore.walletAddress;
  if (!address || typeof address !== 'string') {
    return { ok: false, error: 'Not logged in.' };
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
 * 未接続の場合は { ok: false, error: 'Not logged in.' }。
 */
export async function putGameState(state: GameState, version: number): Promise<PutGameStateResult> {
  const address = GameStore.walletAddress;
  if (!address || typeof address !== 'string') {
    return { ok: false, error: 'Not logged in.' };
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
