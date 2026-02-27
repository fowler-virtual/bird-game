/**
 * POST /api/gacha  { count: 1 | 10 }
 * Server-authoritative gacha: rolls birds on the server and atomically updates state.
 * Returns { ok: true, birds, state, version } on success.
 */

import { getSessionAddress } from "./_lib/sessionCookie.js";
import { setCorsHeaders } from "./_lib/cors.js";
import { getAsync, setAsync, validateState } from "./_lib/gameStateStore.js";
import { pullGachaServer, createDefaultGameState } from "./_lib/gachaLogic.js";

const MAX_CAS_RETRIES = 2;

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sessionAddress = getSessionAddress(req);
  if (!sessionAddress) {
    return res.status(401).json({ error: "Not logged in." });
  }

  const { count } = req.body || {};
  if (count !== 1 && count !== 10) {
    return res.status(400).json({ error: "count must be 1 or 10." });
  }

  // CAS loop: read → generate birds → write
  for (let attempt = 0; attempt <= MAX_CAS_RETRIES; attempt++) {
    let data = await getAsync(sessionAddress);
    let currentVersion;

    if (!data) {
      // 新規ユーザー: 初期 state を作成して保存
      const initialState = createDefaultGameState();
      const initResult = await setAsync(sessionAddress, initialState, 1);
      if (!initResult.ok) {
        // 別リクエストが先に作成した → リトライで読み直す
        continue;
      }
      data = { state: initialState, version: initResult.version };
      currentVersion = initResult.version;
    } else {
      currentVersion = data.version;
    }

    const { newState, birds } = pullGachaServer(data.state, count);

    const validation = validateState(newState);
    if (!validation.ok) {
      return res.status(500).json({ error: "Generated invalid state: " + validation.error });
    }

    const result = await setAsync(sessionAddress, newState, currentVersion);
    if (result.ok) {
      return res.status(200).json({
        ok: true,
        birds,
        state: newState,
        version: result.version,
      });
    }

    // CAS conflict — retry with fresh read
    if (result.reason === "STALE" && attempt < MAX_CAS_RETRIES) {
      console.warn(`[gacha] CAS conflict for ${sessionAddress}, retry ${attempt + 1}/${MAX_CAS_RETRIES}`);
      continue;
    }

    return res.status(409).json({
      error: "State was updated from another device. Please try again.",
      code: "STALE_DATA",
    });
  }
}
