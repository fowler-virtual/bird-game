# Vercel 環境変数一覧（本番・Sepolia 想定）

Vercel の **Settings → Environment Variables** で設定する項目の一覧です。値は例です。本番では実際のアドレス・秘密鍵を設定してください。

---

## 必須（Claim が動くために必要）

| 変数名 | 説明 | 例（Sepolia） |
|--------|------|----------------|
| **CLAIM_SIGNER_PRIVATE_KEY** | Claim の EIP-712 署名に使う秘密鍵。RewardClaim の署名者として登録されたアドレスの秘密鍵。**絶対に公開しない。** | `0x...`（64 文字の hex など） |
| **REWARD_CLAIM_CHAIN_ID** | EIP-712 のチェーン ID。Sepolia は **11155111**。 | `11155111` |
| **REWARD_CLAIM_CONTRACT_ADDRESS** | RewardClaim コントラクトのアドレス（EIP-712 の verifyingContract）。`VITE_REWARD_CLAIM_ADDRESS` と同じでよい。 | `0x...` |
| **SESSION_SECRET** | セッション Cookie の署名用。16 文字以上の任意の文字列。 | ランダムな長い文字列 |
| **VITE_CLAIM_API_URL** | フロントが Claim API を叩くベース URL。**オリジン + `/api`**。 | `https://あなたのサイト.vercel.app/api` |
| **ALLOWED_CLAIM_ORIGIN** | CORS で許可するオリジン。カンマ区切りで複数可。本番 URL を必ず含める。 | `https://あなたのサイト.vercel.app` |

---

## ゲーム状態・Claim 永続化（推奨）

| 変数名 | 説明 | 例 |
|--------|------|-----|
| **REDIS_URL** | Redis の接続 URL。game-state と claim の永続化に使う。Vercel KV を使う場合は **KV_REST_API_URL** + **KV_REST_API_TOKEN** でも可。 | `redis://...` または Vercel KV を接続 |

※ Vercel KV を使う場合: **KV_REST_API_URL** と **KV_REST_API_TOKEN** を Vercel の Storage（KV）から取得して設定。

---

## フロント用（ビルド時に埋め込まれる）

| 変数名 | 説明 | 例（Sepolia） |
|--------|------|----------------|
| **VITE_SEED_TOKEN_ADDRESS** | $SEED トークンコントラクトのアドレス。 | `0x...` |
| **VITE_SEED_TREASURY_ADDRESS** | ガチャ・Loft 支払い先アドレス。 | `0x...` |
| **VITE_REWARD_CLAIM_ADDRESS** | RewardClaim コントラクトのアドレス（フロントの claim 実行用）。 | `0x...`（REWARD_CLAIM_CONTRACT_ADDRESS と同じ） |
| **VITE_NETWORK_STATE_ADDRESS** | （任意）NetworkState コントラクトのアドレス。 | `0x...` |

※ `VITE_*` を変更したあとは **再デプロイ** が必要です。

---

## 任意（未設定時はデフォルト）

| 変数名 | 説明 | デフォルト |
|--------|------|------------|
| **CLAIM_DISABLED** | `true` にすると Claim API が 503 を返す。 | 未設定（Claim 有効） |
| **CLAIM_RATE_LIMIT_MAX** | rate limit: 1 キーあたりの最大リクエスト数。 | `10` |
| **CLAIM_RATE_LIMIT_WINDOW_MS** | rate limit の窓（ミリ秒）。 | `60000` |
| **SIWE_NONCE_TTL_SEC** | SIWE の nonce 有効秒数。 | `300` |

---

## 設定後の確認

1. 上記の **必須** 6 項目がすべて設定されていること。
2. **VITE_*** を変更した場合は **Redeploy** する。
3. 本番で Connect → サインイン → Claim が通るか確認する。

---

## 検証時の注意（UI の場所）

- **SAVE ボタンは LOFT タブにのみある。FARMING タブには SAVE ボタンはない。** デッキのオンチェーン保存は LOFT タブで行う。
- Claim 可能量はサーバー側の game-state（seed）から計算する。デバッグで SEED を増やした場合は、**LOFT タブで SAVE** してから Claim すること。

## Claim で 429 (Too Many Requests) が出る場合

- ウォレット（MetaMask / Rabby など）が Sepolia に接続するとき使う **RPC**（例: Infura）のレート制限に当たっている。
- **対処**: ウォレットの設定 → ネットワーク → Sepolia → **RPC URL** を `https://rpc.sepolia.org` など別のプロバイダーに変更してから再度 Claim を試す。

## Claim がオンチェーンで revert する場合（invalid signature など）

- 画面に **「Invalid signature」** や **「the contract signer does not match」** と出る場合、RewardClaim コントラクトに登録されている **signer** と、Vercel の **CLAIM_SIGNER_PRIVATE_KEY** から導出したアドレスが一致していません。
- **確認手順（推奨）**
  1. **サーバーの signer アドレス**: ブラウザで `https://あなたのサイト.vercel.app/api/claim/signer` を開く。返る **signerAddress** をメモする。
  2. **コントラクトの signer**: Sepolia の RewardClaim で `signer()` を確認（ブロックエクスプローラーの「Read Contract」や `cast call <REWARD_CLAIM_ADDRESS> "signer()" --rpc-url <SEPOLIA_RPC>`）。
  3. 両者が**同じアドレス**になるようにする: コントラクトをデプロイしたときの signer と、Vercel の **CLAIM_SIGNER_PRIVATE_KEY** から導出したアドレスを一致させる（環境変数をその signer の秘密鍵に変更するか、逆にコントラクトを正しい signer で再デプロイする）。
- その他の revert（`signature expired` / `nonce already used` / `transfer failed`）は、画面のエラーメッセージに従って対処してください。
