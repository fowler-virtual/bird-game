/**
 * Claim API クライアント。POST /claim で署名を取得し、フロントで RewardClaim.claim() を実行（ガス代はユーザー負担）。
 */

function getClaimApiBase(): string | null {
  const url = import.meta.env.VITE_CLAIM_API_URL;
  if (typeof url === "string" && url.length > 0) return url.replace(/\/$/, "");
  return null;
}

export type ClaimSignature = {
  amountWei: string;
  nonce: string;
  v: number;
  r: string;
  s: string;
};

export type ClaimResult = { ok: true; signature: ClaimSignature } | { ok: false; error: string };

/**
 * Claim 用の署名を API から取得する。取得後にフロントで RewardClaim.claim(amountWei, nonce, v, r, s) を送信すること。
 */
export async function requestClaim(address: string, amount: number): Promise<ClaimResult> {
  const base = getClaimApiBase();
  if (!base) return { ok: false, error: "Claim API not configured (VITE_CLAIM_API_URL)." };
  const amountInt = Math.floor(Number(amount));
  if (!address || amountInt <= 0) return { ok: false, error: "Invalid address or amount (need wallet connected and SEED > 0)." };

  try {
    const res = await fetch(`${base}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, amount: amountInt }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      ok?: boolean;
      amountWei?: string;
      nonce?: string;
      v?: number;
      r?: string;
      s?: string;
    };
    if (!res.ok) return { ok: false, error: data.error || `Claim failed (${res.status})` };
    if (data.error) return { ok: false, error: data.error };
    if (
      !data.amountWei ||
      data.nonce === undefined ||
      data.v === undefined ||
      !data.r ||
      !data.s
    ) {
      const missing = [];
      if (!data.amountWei) missing.push("amountWei");
      if (data.nonce === undefined) missing.push("nonce");
      if (data.v === undefined) missing.push("v");
      if (!data.r) missing.push("r");
      if (!data.s) missing.push("s");
      return { ok: false, error: `Invalid claim response (missing: ${missing.join(", ")}). Check server and VITE_CLAIM_API_URL.` };
    }
    return {
      ok: true,
      signature: {
        amountWei: data.amountWei,
        nonce: data.nonce,
        v: data.v,
        r: data.r,
        s: data.s,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
