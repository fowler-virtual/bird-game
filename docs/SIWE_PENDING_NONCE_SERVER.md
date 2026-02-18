# サーバー: GET /auth/nonce でアドレスなし対応

## 目的
1クリックで「接続→署名」の2回ウォレットを開かせるため、nonce を接続と並列で取得できるようにする。

## 必要な変更
`GET /auth/nonce` を処理しているルートで:

- **クエリに `address` がある場合**: 従来どおり `createNonce(address)` を呼び `{ nonce }` を返す。
- **クエリに `address` がない場合**: `createPendingNonce()` を呼び `{ nonce }` を返す。

`server/siweNonceStore.cjs` はすでに `createPendingNonce` を export している。  
`consumeNonce(address, nonce)` は verify 時に、アドレス紐づきでなければ pending からも消費する。

## 例 (Node の場合は index.cjs など)
```js
const { createNonce, createPendingNonce } = require('./siweNonceStore.cjs');
// GET /auth/nonce
const address = req.query?.address;
const nonce = address ? createNonce(address) : createPendingNonce();
res.json({ nonce });
```

Vercel の場合は `api/auth/nonce.js` で同様に、address があれば createNonce、なければ createPendingNonce を呼ぶ。

---

## 実装状況（このリポジトリ内）

| 役割 | 場所 | 状態 |
|------|------|------|
| GET /auth/nonce（address 任意） | `api/auth/nonce.js` | 実装済み。address なしなら createPendingNonce()。 |
| POST /auth/verify | `api/auth/verify.js` | 実装済み。SIWE 検証 → consumeNonce → setSessionCookie。 |
| セッション Cookie 読書 | `api/_lib/sessionCookie.js` | 実装済み。game-state.js が参照。 |
| nonce ストア（pending 対応） | `api/_lib/siweNonceStore.js`, `server/siweNonceStore.cjs` | 両方とも consumeNonce で pending 消費対応済み。 |

Node の `server/index.cjs` で /auth を提供している場合は、nonce ルートのみ「address が無いとき createPendingNonce()」に変更。verify は既存の consumeNonce 呼び出しのままでよい（pending 対応済み）。
