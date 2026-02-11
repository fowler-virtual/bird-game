# Claim 処理とデプロイ（ローカル → Git 公開後のテスト）の進め方

## 前提

- **Claim** = ゲーム内 SEED をユーザーウォレットへ $SEED で受け取る処理。
- オンチェーンでは `SeedToken.mint(ユーザーアドレス, 量)` を **owner** が実行する必要がある。
- owner の秘密鍵は **ブラウザに置けない** ため、**バックエンド（API）** が必須。

---

## フェーズ 1: ローカルで動かす

### 構成

- **フロント** (Vite): 今のリポジトリのまま。Claim 押下時に「Claim API」を呼ぶ。
- **Claim API** (Node): リポジトリ内に `server/` などを追加し、ローカルで実行。
  - 例: `POST /claim` で `{ address, amount }` を受け取り、owner 鍵で `mint(address, amount)` を実行。
- **環境変数（ローカル）**
  - バックエンド: `OWNER_PRIVATE_KEY`, `RPC_URL`（例: `http://127.0.0.1:8545`）, `SEED_TOKEN_ADDRESS`
  - フロント: `VITE_CLAIM_API_URL=http://localhost:3001`（など、API の URL）

### ローカルでの動かし方

1. Hardhat でローカルチェーン: `npm run chain`
2. 別ターミナルで SeedToken デプロイ: `npm run deploy:seed`
3. バックエンド起動: `npm run server`（または `node server/index.cjs`）
4. フロント起動: `npm run dev`
5. ウォレットは **owner とは別のアカウント**（例: Account #1）で接続し、Claim で $SEED を受け取る。

---

## フェーズ 2: Git に push したあと「テスト的に動く」ようにする

現在のデプロイ先は **GitHub Pages**（静的サイトのみ）です。  
**サーバー処理は GitHub Pages では動かせない** ため、Claim API は別の場所に置く必要があります。

### 選択肢 A: GitHub Pages（現状）＋ Claim API を別ホストにデプロイ（推奨）

- **フロント**: これまで通り GitHub Actions で GitHub Pages にデプロイ。
- **Claim API**: 次のいずれかにデプロイする。
  - **Vercel** … 同じリポジトリに `api/claim.js` などを置き、Vercel の「Serverless Function」としてデプロイ。Vercel の環境変数に `OWNER_PRIVATE_KEY`, `RPC_URL`, `SEED_TOKEN_ADDRESS` を設定。
  - **Railway / Render / Fly.io** … リポジトリの `server/` をデプロイ。各サービスの環境変数で上記を設定。

**運用イメージ**

1. リポジトリに `server/`（または `api/`）を追加し、Claim 用 API を実装。
2. Claim API 用に Vercel プロジェクト（または Railway 等）を 1 つ作り、環境変数を設定。デプロイは「main に push したとき」や「手動」などで実行。
3. フロントのビルド時に、**デプロイ先の Claim API URL** を渡す。
   - **GitHub Actions でビルドする場合**: Actions の「Environments」または「Secrets」に `VITE_CLAIM_API_URL` を設定し、`npm run build` の `env` に渡す。
   - 例: `VITE_CLAIM_API_URL=https://your-claim-api.vercel.app` または `https://your-app.railway.app`
4. 本番・テスト用チェーンは **テストネット（Sepolia など）** を推奨。  
   - RPC と SeedToken のデプロイ先をテストネットに合わせ、owner 鍵もテスト用ウォレットにすると安全です。

こうすると、「Git に push → GitHub Pages が更新され、Claim API は別ホストで常時稼働」という形で、**テスト的に Claim まで動く**状態にできます。

### 選択肢 B: フロントも API も Vercel にまとめる

- フロントを **Vercel** に移し、Claim 用の **Serverless Function**（例: `api/claim.js`）を同じリポジトリに置く。
- Push 1 回で「フロント ＋ Claim API」が同時にデプロイされる。
- 環境変数は Vercel のダッシュボードで一括設定（`OWNER_PRIVATE_KEY`, `RPC_URL`, `SEED_TOKEN_ADDRESS`, 必要なら `VITE_*`）。

**運用イメージ**

1. リポジトリを Vercel に連携（GitHub Pages は使わない、または併用しない）。
2. `api/claim.js`（または `api/claim.ts`）で mint 処理を実装。
3. Vercel の Environment Variables に上記を設定。
4. フロントは `VITE_CLAIM_API_URL` を空または自ドメイン（`/api/claim`）にし、同一オリジンで API を呼ぶ。

---

## テスト用チェーン（Git 公開後の「テスト的に動く」用）

- **ローカル**: Hardhat の `localhost:8545` ＋ 自前で `npm run chain`。
- **Git push 後のテスト**: 同じマシンのローカルチェーンは使えないので、**テストネット** を使う。
  - 例: **Sepolia**。  
    - SeedToken を Sepolia にデプロイ。  
    - Claim API の `RPC_URL` を Sepolia の RPC、`SEED_TOKEN_ADDRESS` をそのコントラクトに設定。  
    - owner 用のテストウォレットを 1 つ用意し、その秘密鍵を API の環境変数に設定。
  - ユーザーは MetaMask で Sepolia のウォレットを接続し、Claim で $SEED を受け取れるようにする。

---

## 進める順序の目安

| 順番 | やること |
|------|----------|
| 1 | リポジトリに **Claim 用バックエンド**（`server/` または `api/`）を追加し、**ローカル**で動作させる。 |
| 2 | フロントの Claim ボタンからその API を呼び、ローカルチェーンで「Claim → ウォレットに $SEED が増える」まで確認。 |
| 3 | Claim API を **Vercel / Railway 等** にデプロイし、環境変数を設定。 |
| 4 | フロントのビルドに `VITE_CLAIM_API_URL` を渡すようにし（GitHub Actions の env など）、GitHub Pages のデプロイでその URL が使われるようにする。 |
| 5 | Sepolia など **テストネット** に SeedToken をデプロイし、API の RPC とアドレスをテストネット向けに切り替える。 |
| 6 | Git に push し、公開されたページからウォレット接続 → Claim がテスト的に動くことを確認。 |

この順で進めれば、「ローカルで処理できる」状態から「Git にアップしたときにテスト的に動く」状態まで一貫した形で拡張できます。
