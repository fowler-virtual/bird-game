# ソースコードレビュー用メモ

エンジニアがソースを見る際の入口と、主要な構成をまとめています。

---

## リポジトリ・環境

- **リポジトリ**: `https://github.com/fowler-virtual/bird-game`（プライベートの場合はオーナーから招待または URL 共有）
- **技術スタック**: Phaser 3 + TypeScript + Vite。ウォレットは EIP-1193（`window.ethereum`）。本番は Sepolia テストネット。

---

## ローカルで動かす

```bash
git clone https://github.com/fowler-virtual/bird-game.git
cd bird-game
npm install
npm run dev
```

ブラウザで `http://localhost:5175` を開く。MetaMask は Sepolia に切り替えて使用。

- **ガチャ・デッキ SAVE・Claim などオンチェーン処理を試す場合**: `.env` を用意する（`.env.example` をコピーして必要な値を設定）。Sepolia 用のコントラクトアドレスや RPC が未設定だと、一部機能はエラーになるが、接続〜ゲーム画面表示までは確認できる。

- **ローカルで Claim を試すとき**（監査対応後のサーバ主導仕様）:
  1. `.env` に次を設定: `VITE_CLAIM_API_URL=http://localhost:3001`, `VITE_REWARD_CLAIM_ADDRESS`（デプロイ済み RewardClaim アドレス）, `ALLOWED_CLAIM_ORIGIN=http://localhost:5175`, `SESSION_SECRET`（16 文字以上）, `REWARD_CLAIM_CHAIN_ID=31337`, `REWARD_CLAIM_CONTRACT_ADDRESS`（上と同じアドレス）, `CLAIM_SIGNER_PRIVATE_KEY`（署名用鍵）。
  2. チェーン・サーバ起動: `npm run chain` のあと別ターミナルで `npm run server`。
  3. **サーバを止めて** `node scripts/set-claimable.cjs <接続するウォレットのアドレス> <量 wei>` で claimable を付与（例: `1000000000000000000` = 1 SEED）。その後 `npm run server` を再開。
  4. フロントで Connect → Sign-in（Claim 初回時）→ Claim 実行。

---

## ディレクトリ構成（押さえどころ）

| パス | 内容 |
|------|------|
| `src/` | フロントの TypeScript 本体 |
| `src/wallet.ts` | ウォレット接続・`ensureSepolia`・署名 |
| `src/titleUI.ts` | タイトル画面・Connect 押下後の流れ（接続→Sepolia 切り替え→ゲーム表示） |
| `src/views/farmingView.ts` | LOFT タブ・SAVE ボタン・初回 SAVE 時の `setLoftLevel(1)` |
| `src/domShell.ts` | シェル UI・ガチャ実行・モーダル・オンボーディング |
| `src/networkState.ts` | NetworkState コントラクトの読み書き（`setLoftLevel` / `updatePower` / `addRarityCounts` 等） |
| `src/seedToken.ts` | $SEED 残高取得・burn |
| `src/store/GameStore.ts` | ゲーム状態（localStorage 永続化） |
| `index.html` | 単一 HTML。Shell やモーダルのマークアップを含む |
| `api/` | Claim 用 API（Vercel 等にデプロイする想定） |
| `docs/` | 仕様・TODO・開発フロー（`TODO.md`, `DEV_FLOW_AND_MOBILE.md` 等） |

---

## 対応環境の方針

- **B. PC ブラウザ ＋ スマホのウォレットアプリ内ブラウザのみ** を想定。
- スマホの通常ブラウザ（Chrome 等）での WalletConnect 対応は行っていない。

---

## その他

- 残タスク・仕様メモは `docs/TODO.md` にあり。
- デプロイは GitHub Actions で GitHub Pages に出力している（` .github/workflows/` を参照）。
