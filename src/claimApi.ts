/**
 * Claim API client (A-spec): SIWE session, server-decided amount, EIP-712 signature, confirm after tx.
 */

import { BrowserProvider, getAddress } from "ethers";
import { SiweMessage } from "siwe";

function getClaimApiBase(): string | null {
  const url = import.meta.env.VITE_CLAIM_API_URL;
  if (typeof url === "string" && url.length > 0) return url.replace(/\/$/, "");
  return null;
}

const credentials: RequestCredentials = "include";

export type ClaimSignature = {
  amountWei: string;
  nonce: string;
  deadline: string;
  campaignId: string;
  v: number;
  r: string;
  s: string;
};

export type ClaimResult = { ok: true; signature: ClaimSignature } | { ok: false; error: string };

export type ClaimableResult = { ok: true; claimable: string } | { ok: false; error: string };

export type AuthNonceResult = { ok: true; nonce: string } | { ok: false; error: string };

export type AuthVerifyResult = { ok: true } | { ok: false; error: string };

function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getClaimApiBase();
  if (!base) throw new Error("Claim API not configured (VITE_CLAIM_API_URL).");
  return fetch(`${base}${path}`, { ...init, credentials });
}

/**
 * Get SIWE nonce for the given address. Pass address so only that wallet can use the nonce.
 */
export async function getAuthNonce(address: string): Promise<AuthNonceResult> {
  try {
    const res = await apiFetch(`/auth/nonce?address=${encodeURIComponent(address)}`);
    const data = (await res.json().catch(() => ({}))) as { nonce?: string; error?: string };
    if (!res.ok) return { ok: false, error: data.error || `Failed (${res.status})` };
    if (!data.nonce) return { ok: false, error: "Invalid nonce response." };
    return { ok: true, nonce: data.nonce };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Get a pending SIWE nonce (no address). Use with connect: run in parallel with requestAccounts
 * so when both resolve we can call signAndVerifyWithNonce immediately (one fewer await before signMessage).
 * Server must support GET /auth/nonce without address.
 */
export async function getAuthNoncePending(): Promise<AuthNonceResult> {
  const base = getClaimApiBase();
  console.log("[Connect] Claim API base:", base ?? "(not set)");
  try {
    const res = await apiFetch("/auth/nonce");
    const data = (await res.json().catch(() => ({}))) as { nonce?: string; error?: string };
    if (!res.ok) {
      console.log("[Connect] GET /auth/nonce failed:", res.status, data.error ?? data);
      return { ok: false, error: data.error || `Failed (${res.status})` };
    }
    if (!data.nonce) {
      console.log("[Connect] GET /auth/nonce invalid response:", data);
      return { ok: false, error: "Invalid nonce response." };
    }
    console.log("[Connect] GET /auth/nonce ok");
    return { ok: true, nonce: data.nonce };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.log("[Connect] GET /auth/nonce error:", err);
    return { ok: false, error: err };
  }
}

/**
 * Build SIWE message, sign with wallet, verify on server. Call this immediately after getAuthNonce
 * so signMessage runs close to the user gesture (connect).
 */
const SEPOLIA_CHAIN_ID = 11155111;

export async function signAndVerifyWithNonce(address: string, nonce: string): Promise<AuthVerifyResult> {
  console.log("[Connect] signAndVerifyWithNonce called, address:", address?.slice(0, 10) + "...");
  if (typeof window === "undefined" || !window.ethereum) {
    console.log("[Connect] signAndVerifyWithNonce: no wallet");
    return { ok: false, error: "No wallet." };
  }
  try {
    const checksummed = getAddress(address);
    const provider = new BrowserProvider(window.ethereum);
    const chainId = SEPOLIA_CHAIN_ID;
    const siweMessage = new SiweMessage({
      domain: typeof window !== "undefined" ? window.location.host : "",
      address: checksummed,
      statement: "Sign in to claim $SEED rewards.",
      uri: typeof window !== "undefined" ? window.location.origin : "",
      version: "1",
      chainId,
      nonce,
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    const message = siweMessage.prepareMessage();
    const signer = await provider.getSigner();
    console.log("[Connect] calling signer.signMessage (wallet popup should open)");
    const signature = await signer.signMessage(message);
    console.log("[Connect] signMessage done, posting verify");
    const result = await postAuthVerify(message, signature, checksummed);
    console.log("[Connect] postAuthVerify:", result.ok ? "ok" : result.error);
    return result;
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : e && typeof e === "object"
            ? JSON.stringify(e)
            : String(e);
    console.log("[Connect] signAndVerifyWithNonce error:", msg);
    if (/user rejected|user denied/i.test(msg)) {
      return { ok: false, error: "Signature rejected." };
    }
    return { ok: false, error: msg || "Sign-in failed." };
  }
}

/**
 * Sign in with Ethereum for Claim: get nonce, build SIWE message, sign with wallet, verify on server.
 * Call this when /claim returns 401 (e.g. after Connect Wallet, before first claim).
 */
export async function signInForClaim(address: string): Promise<AuthVerifyResult> {
  if (typeof window === "undefined" || !window.ethereum) {
    return { ok: false, error: "No wallet." };
  }
  const nonceRes = await getAuthNonce(address);
  if (!nonceRes.ok) return nonceRes;
  return signAndVerifyWithNonce(address, nonceRes.nonce);
}

/**
 * Verify SIWE message and establish session (cookie).
 */
export async function postAuthVerify(message: string, signature: string, address: string): Promise<AuthVerifyResult> {
  try {
    const res = await apiFetch("/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature, address }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string | { message?: string } };
    const errStr = (v: unknown): string =>
      typeof v === "string" ? v : v && typeof v === "object" && "message" in v ? String((v as { message: unknown }).message) : JSON.stringify(v);
    if (!res.ok) return { ok: false, error: errStr(data.error) || `Failed (${res.status})` };
    return data.ok ? { ok: true } : { ok: false, error: errStr(data.error) || "Verify failed." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Get server-side claimable amount (wei string). Requires session.
 */
export async function getClaimable(): Promise<ClaimableResult> {
  const base = getClaimApiBase();
  if (!base) return { ok: false, error: "Claim API not configured." };
  try {
    const res = await apiFetch("/claimable");
    const data = (await res.json().catch(() => ({}))) as { claimable?: string; error?: string };
    if (res.status === 401) return { ok: false, error: "Not logged in." };
    if (!res.ok) return { ok: false, error: data.error || `Failed (${res.status})` };
    return { ok: true, claimable: data.claimable ?? "0" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Request claim signature from server. Amount is decided by server (claimable_total - claimed_total - reserved).
 * Call executeClaim() with the result, then postClaimConfirm() after tx success.
 */
export async function requestClaim(address: string): Promise<ClaimResult> {
  const base = getClaimApiBase();
  if (!base) return { ok: false, error: "Claim API not configured (VITE_CLAIM_API_URL)." };
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return { ok: false, error: "Invalid address." };
  }

  try {
    const res = await apiFetch("/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      ok?: boolean;
      amountWei?: string;
      nonce?: string;
      deadline?: string;
      campaignId?: string;
      v?: number;
      r?: string;
      s?: string;
    };
    if (res.status === 401) return { ok: false, error: "Not logged in. Sign in with your wallet first." };
    if (res.status === 400) return { ok: false, error: data.error || "Nothing to claim." };
    if (!res.ok) return { ok: false, error: data.error || `Claim failed (${res.status})` };
    if (
      !data.amountWei ||
      data.nonce === undefined ||
      data.deadline === undefined ||
      data.campaignId === undefined ||
      data.v === undefined ||
      !data.r ||
      !data.s
    ) {
      return { ok: false, error: "Invalid claim response (missing fields)." };
    }
    return {
      ok: true,
      signature: {
        amountWei: data.amountWei,
        nonce: String(data.nonce),
        deadline: String(data.deadline),
        campaignId: data.campaignId,
        v: data.v,
        r: data.r,
        s: data.s,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Notify server that on-chain claim succeeded so it can update claimed_total and release reserve.
 */
export async function postClaimConfirm(nonce: string, amountWei: string, _txHash?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch("/claim/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce, amountWei }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok) return { ok: false, error: data.error || `Confirm failed (${res.status})` };
    return data.ok ? { ok: true } : { ok: false, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
