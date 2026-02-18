# 変更内容確認: Pending Nonce 対応（1クリックで接続→署名）

## 1. 変更一覧

### クライアント

| ファイル | 変更内容 |
|----------|----------|
| `src/claimApi.ts` | `getAuthNoncePending()` 追加（GET /auth/nonce をアドレスなしで呼ぶ）。`signAndVerifyWithNonce` で `getNetwork()` をやめ固定 chainId (Sepolia)。 |
| `src/titleUI.ts` | 接続時を `Promise.all([requestAccounts(), getAuthNoncePending()])` に変更。両方揃ってから `signAndVerifyWithNonce(address, nonce)` を 1 回だけ呼ぶ。 |

### API（Vercel）

| ファイル | 役割 |
|----------|------|
| `api/_lib/siweNonceStore.js` | **新規**。ESM。`createNonce(address)`, `createPendingNonce()`, `consumeNonce(address, nonce)`。pending は nonce をキーに保持し、consume 時にアドレス紐づきが無ければ pending から消費。 |
| `api/auth/nonce.js` | **新規**。GET のみ。`address` クエリがあれば `createNonce(address)`、なければ `createPendingNonce()`。`{ nonce }` を返す。 |
| `api/auth/verify.js` | POST。body の `message`, `signature`, `address` で SIWE 検証 → `consumeNonce(address, nonce)` → `setSessionCookie(res, address)`。pending nonce も consumeNonce で消費されるため変更不要だったが、このリポジトリで verify 実装を担当するため実装済み。 |
| `api/_lib/sessionCookie.js` | セッション Cookie の set/get/clear。`setSessionCookie(res, address)`, `getSessionAddress(req)`。game-state.js および verify.js が参照。 |

### サーバー（Node 用ストア）

| ファイル | 変更内容 |
|----------|----------|
| `server/siweNonceStore.cjs` | `createPendingNonce()` 追加。`consumeNonce(address, nonce)` でアドレス紐づきが無ければ pending から消費。 |

### ドキュメント

| ファイル | 内容 |
|----------|------|
| `docs/SIWE_PENDING_NONCE_SERVER.md` | nonce ルートの仕様と、verify は変更不要である理由。実装状況表で api/auth と sessionCookie を「このリポジトリで実装済み」と明記。 |

---

## 2. 構成の整合性

- **フロー**: クリック → `requestAccounts()` と `getAuthNoncePending()` 並列 → 両方完了 → `signAndVerifyWithNonce(address, nonce)`（getSigner と signMessage のみ await）→ `postAuthVerify` で POST /auth/verify → Cookie 発行。
- **API パス**: クライアントは `VITE_CLAIM_API_URL` を base に `/auth/nonce` と `/auth/verify` を呼ぶ。Vercel で `api/auth/nonce.js` と `api/auth/verify.js` を置けば、base が `/api` なら `/api/auth/nonce`, `/api/auth/verify` で届く。
- **nonce 消費**: verify で `consumeNonce(address, nonce)` を 1 回だけ呼ぶ。アドレス紐づきが無い場合は `api/_lib/siweNonceStore.js` の pending から消費される。
- **Cookie**: verify 成功時に `setSessionCookie(res, address)`。game-state の GET/PUT は `getSessionAddress(req)` で 401 かどうかを判定。同一の `api/_lib/sessionCookie.js` を参照。

---

## 3. 確認済み・注意点

- **siwe の verify**: `SiweMessage.verify({ signature })` はライブラリにより resolve の形が異なる可能性あり。`api/auth/verify.js` では `result?.success` と `result.data` を参照している。失敗時に throw するバージョンなら try/catch で 400 を返しているため問題なし。siwe のバージョンに応じて戻り値の型だけ要確認。
- **VITE_CLAIM_API_URL**: 本番で Vercel API を指す場合、base が `https://xxx.vercel.app/api` であれば `/auth/nonce` は `https://xxx.vercel.app/api/auth/nonce` となり、`api/auth/nonce.js` が処理する。
- **server/index.cjs**: このワークスペースには存在しない。Node で /auth を提供している別デプロイがある場合は、nonce ルートのみ「address が無いとき createPendingNonce()」に変更すればよい（`server/siweNonceStore.cjs` は対応済み）。verify は既存の `consumeNonce` のままでよい。

---

## 4. 製造責任の所在

auth 周り（nonce / verify / session cookie）は **このリポジトリ内で一通り担当** している。

- GET /auth/nonce: `api/auth/nonce.js`
- POST /auth/verify: `api/auth/verify.js`
- セッション: `api/_lib/sessionCookie.js`
- nonce ストア: `api/_lib/siweNonceStore.js`（Vercel）, `server/siweNonceStore.cjs`（Node 用）

「どこか別にあるはず」に頼らず、上記ファイルで完結していることを把握したうえで処理する。
