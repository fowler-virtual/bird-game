# 開発引き継ぎドキュメント

このドキュメントは、開発を引き継ぐ人向けに、**プロジェクトの格納場所・現在の動作環境・ローカル／デプロイの動かし方・把握しておくべき事象**をまとめたものです。

---

## 1. プロジェクトの格納場所

| 種類 | 場所（プロジェクトルートからの相対パス） |
|------|------------------------------------------|
| **プロジェクトルート** | このリポジトリの一番上（`README.md`・`package.json` があるディレクトリ）。この PC では `c:\Users\yuta_\Desktop\bird-game`。 |
| **ドキュメント一式** | `docs/` |
| **フロントエンド（TypeScript）** | `src/` |
| **API（Vercel serverless）** | `api/` |
| **スマートコントラクト** | `contracts/` |
| **E2E テスト** | `e2e/` |
| **Cursor ルール** | `.cursor/rules/` |

- ドキュメント一覧・格納方針: **`docs/README.md`**
- 開発を続けるときはまず **`docs/SESSION_START.md`** を読み、そこに書かれた順にドキュメントを読み込む。

---

## 2. 現在どのような環境で動かしているか

### 2.1 開発・実行環境の種類

| 環境 | 用途 | 備考 |
|------|------|------|
| **ローカル（PC）** | 開発・デバッグ | `npm run dev` でフロントのみ、または `npm run services` でチェーン＋API サーバー＋フロントを同時起動。 |
| **Vercel** | 本番（またはステージング） | リポジトリを Vercel に連携し、push で自動デプロイ。フロント＋API（`api/`）が同じドメインで配信される。 |
| **GitHub Pages** | 静的デプロイ | GitHub Actions（`.github/workflows/deploy.yml`）で main に push すると `dist` を GitHub Pages にデプロイ。API はないため、**VITE_CLAIM_API_URL** 等で別の API を指す必要あり。 |

### 2.2 技術スタック

- **フロント**: Phaser 3 + TypeScript + Vite
- **ウォレット**: EIP-1193（`window.ethereum`）。MetaMask / Rabby 等。
- **本番チェーン**: Sepolia テストネット
- **API**: Vercel Serverless（`api/*.js`）。認証（SIWE）、game-state、Claim など。

### 2.3 現在運用しているデプロイ先（ドキュメント・会話から）

| 種別 | URL（例） | 説明 |
|------|-----------|------|
| **Vercel 本番** | `https://bird-game-udhr.vercel.app` | Vercel プロジェクト「bird-game-udhr」。`VITE_CLAIM_API_URL` を自ドメイン `/api` に設定済み。 |
| **GitHub Pages** | `https://fowler-virtual.github.io/bird-game` | main ブランチ push で Actions がビルド・デプロイ。リポジトリ: `fowler-virtual/bird-game`。 |

※ 上記 URL はドキュメントに記載されている例。実際の URL は Vercel ダッシュボード・GitHub の Settings → Pages で確認すること。

---

## 3. ローカルで動かす方法

### 3.1 フロントのみ（API は別サーバー／モック）

```bash
npm install
npm run dev
```

- デフォルト: `http://localhost:5174`
- API を叩く場合は `.env` に `VITE_CLAIM_API_URL` を設定（例: 本番 API を向けるか、ローカル API の URL）。

### 3.2 フルスタック（チェーン＋API サーバー＋フロント）

```bash
npm run services
```

- Hardhat ローカルチェーン（例: 127.0.0.1:8545）
- Express API サーバー（例: 3001）
- Vite フロント（5174）

`.env` にローカル用のアドレス・秘密鍵・`VITE_CLAIM_API_URL=http://localhost:3001` 等を設定する。` .env.example` をコピーして `.env` を作成し、必要な値を埋める。

### 3.3 ビルド・プレビュー

```bash
npm run build
npm run preview
```

### 3.4 主要 npm スクリプト

| コマンド | 内容 |
|----------|------|
| `npm run dev` | Vite 開発サーバー（ポート 5174） |
| `npm run build` | TypeScript コンパイル ＋ Vite ビルド → `dist/` |
| `npm run chain` | Hardhat ローカルノード |
| `npm run server` | Express API サーバー（ローカル用） |
| `npm run services` | chain + server + dev を同時起動 |
| `npm run test:e2e` | Playwright E2E（未設定時は localhost:5174 向け） |
| `npm run verify:deployed` | デプロイ先の疎通確認（省略時は bird-game-udhr.vercel.app） |

---

## 4. デプロイ環境の設定

### 4.1 Vercel

- **ビルド**: `vercel.json` で `buildCommand`: `pnpm run vercel-build`、`outputDirectory`: `dist`。
- **環境変数**: Vercel ダッシュボードの **Settings → Environment Variables** で設定。一覧と必須項目は **`docs/VERCEL_ENV_VARS.md`**。本番で Connect・Claim を動かすには少なくとも以下が必要:
  - `VITE_CLAIM_API_URL` = 自サイトのオリジン + `/api`（例: `https://bird-game-udhr.vercel.app/api`）
  - `CLAIM_SIGNER_PRIVATE_KEY`、`REWARD_CLAIM_CHAIN_ID`、`REWARD_CLAIM_CONTRACT_ADDRESS`、`SESSION_SECRET`、`ALLOWED_CLAIM_ORIGIN`
  - ゲーム状態・Claim 永続化: `REDIS_URL` または Vercel KV（`KV_REST_API_URL` + `KV_REST_API_TOKEN`）
- **VITE_*** を変更したあとは「Redeploy」が必要（ビルド時に埋め込まれる）。

手順の詳細: **`docs/VERCEL_VITE_CLAIM_API_URL.md`**。

### 4.2 GitHub Pages（GitHub Actions）

- **トリガー**: main への push、または手動（workflow_dispatch）。
- **ビルド**: `pnpm run build`。環境変数は GitHub の **Settings → Secrets and variables → Actions** の **Variables** で設定（`VITE_SEED_TOKEN_ADDRESS`、`VITE_NETWORK_STATE_ADDRESS`、`VITE_REWARD_CLAIM_ADDRESS`、`VITE_CLAIM_API_URL` 等）。
- **成果物**: `dist` を GitHub Pages にデプロイ。API は含まないため、`VITE_CLAIM_API_URL` で Vercel の API など別オリジンを指す構成になる。

---

## 5. 環境変数の参照先

- **ローカル用の例**: リポジトリ直下の **`.env.example`**（このファイルは Git に含める。実際の値は `.env` に書き、Git にはコミットしない）。
- **Vercel 本番用**: **`docs/VERCEL_ENV_VARS.md`** に一覧と説明あり。

---

## 6. 引き継ぎ時に把握しておくべき事象・進め方

### 6.1 現在の状況（2026-02-28）

- **① 達成済み**: デプロイ版（Vercel）＋ PC・スマホ（MetaMask ブラウザ）の両環境で、Connect → ガチャ → デッキ配置 → SAVE → Claim が一通り動作することを確認。チェックリスト 1〜9 クリア（**`docs/PATH_TO_VERIFICATION.md`**）。
- **既知のブロッカーなし**。過去のブロッカー（SIWE 署名・Claim revert）はすべて解決済み。
- **次のフェーズ**: ゲームバランス・エコノミクスの調整。詳細: **`docs/TODO.md`**。

### 6.2 アーキテクチャ概要

- **サーバー権威化**: ガチャ（`POST /api/gacha`）と Loft Upgrade（`POST /api/loft-upgrade`）はサーバー側で state を変更。クライアントは結果を受け取って表示するのみ。
- **デッキ同期**: Save ボタン押下まではサーバーに同期しない。Save 後に `flushServerSync()` で即時送信。
- **409 処理**: サーバー state をそのまま採用（マージなし）。

### 6.3 確認用チェックリスト

- 「一通り動く」の定義: **`docs/PATH_TO_VERIFICATION.md`**（① 達成済み）。
- 修正後の検証チェックリスト: **`docs/VERIFICATION.md`**。

### 6.4 E2E

- 定義: **`docs/E2E_DEFINITION.md`**。Claim を含むシナリオ 1〜9 をカバー。
- デプロイ先で Claim まで検証する場合は `.env` に `E2E_BASE_URL` と `E2E_REWARD_CLAIM_ADDRESS` を設定して `npm run test:e2e`。**`docs/CLAIM_ROOT_CAUSE_AND_E2E.md`** 参照。

---

## 7. 最初に読むドキュメント（推奨順）

1. **`docs/SESSION_START.md`** — 読み込み順と必須ドキュメント一覧。
2. **`docs/README.md`** — ドキュメント格納先と一覧。
3. **`docs/REQUIREMENTS.md`** — 要件・対応環境・最優先目標。
4. **`docs/TODO.md`** — 残タスク・現在の事象・進捗。
5. **`docs/RESPONSIBILITY_AND_RULES.md`** — 製造責任と運用ルール。
6. **`docs/PATH_TO_VERIFICATION.md`** — 確認用チェックリストとブロッカー。
7. （Claim を触る場合）**`docs/CLAIM_DEBUG_HANDOFF.md`**・**`docs/VERCEL_ENV_VARS.md`**。

---

## 8. このドキュメントの更新

- デプロイ URL・環境の変更、新たなブロッカーや運用ルールが分かったら、このファイルを更新する。
- 日付や変更内容を追記しておくと引き継ぎがしやすい。
