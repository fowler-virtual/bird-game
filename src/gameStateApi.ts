/**
 * ゲーム状態同期 API（サーバー正・GET/PUT）。
 * 同一オリジンは Claim API と共通（VITE_CLAIM_API_URL）。
 */

import type { GameState } from "./types";

function getBase(): string | null {
  const url = import.meta.env.VITE_CLAIM_API_URL;
  if (typeof url === "string" && url.length > 0) return url.replace(/\/$/, "");
  return null;
}

const credentials: RequestCredentials = "include";

export type GetGameStateResult =
  | { ok: true; state: GameState; version: number }
  | { ok: false; error: string };

export type PutGameStateResult =
  | { ok: true; version: number }
  | { ok: false; error: string; stale?: boolean };

export async function getGameState(): Promise<GetGameStateResult> {
  const base = getBase();
  if (!base) return { ok: false, error: "VITE_CLAIM_API_URL not configured." };
  try {
    const res = await fetch(`${base}/game-state`, { method: "GET", credentials });
    if (res.status === 401) return { ok: false, error: "Not logged in." };
    if (!res.ok) return { ok: false, error: `Failed to load state (${res.status}).` };
    const data = (await res.json()) as { state?: unknown; version?: number };
    if (data.state == null || typeof data.version !== "number") {
      return { ok: false, error: "Invalid response." };
    }
    return { ok: true, state: data.state as GameState, version: data.version };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function putGameState(state: GameState, version: number): Promise<PutGameStateResult> {
  const base = getBase();
  if (!base) return { ok: false, error: "VITE_CLAIM_API_URL not configured." };
  try {
    const res = await fetch(`${base}/game-state`, {
      method: "PUT",
      credentials,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, version }),
    });
    if (res.status === 401) return { ok: false, error: "Not logged in." };
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      return {
        ok: false,
        error: body.code === "STALE_DATA" ? "Data was updated from another device." : "Conflict.",
        stale: true,
      };
    }
    if (res.status === 400) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error ?? "Bad request." };
    }
    if (!res.ok) return { ok: false, error: `Failed to save (${res.status}).` };
    const data = (await res.json()) as { version?: number };
    if (typeof data.version !== "number") return { ok: false, error: "Invalid response." };
    return { ok: true, version: data.version };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
