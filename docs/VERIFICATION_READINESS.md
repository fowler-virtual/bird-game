# 検証開始条件（Definition of Ready）と E2E 実行手順

監査・UI 検証を開始する前に、以下を満たすことを推奨します。

---

## 検証開始条件（DoR）

1. **TOP が表示される**  
   起動後、タイトル画面（Connect Wallet ボタンがある画面）が表示されること。

2. **Connect Wallet が反応する**  
   Connect Wallet ボタンをクリックすると、何らかの反応があること（ボタンが「Connecting...」に変わる、または接続後にゲームシェルが表示される等）。

3. **主要画面へ遷移できる**  
   Farming / Deck / Adopt(Summon) のいずれかのタブに遷移できること。

上記を **Playwright スモークテスト** で自動確認します。`pnpm test:e2e` が通れば DoR 満たしとみなします。

---

## E2E モード（モック接続）

- **`VITE_E2E_MODE=1`**（環境変数）のときのみ、ウォレット接続をモックします。
- モック時は **MetaMask 不要**。接続ボタンを押すと即「接続済み」となり、ゲームシェル（Farming 等）が表示されます。
- 本番ビルド・通常起動では `VITE_E2E_MODE` を設定しないため、**挙動は一切変わりません**。

---

## pnpm の準備（Windows で pnpm が見つからない場合）

このリポジトリは **pnpm 前提**です。Windows (PowerShell) で `pnpm` が未インストールのときは **corepack** で有効化します（Node.js 18 以上想定）。

```powershell
corepack enable
corepack prepare pnpm@latest --activate
pnpm -v
```

最後の `pnpm -v` でバージョンが表示されれば OK です。  
Node が 18 未満の場合は [nodejs.org](https://nodejs.org/) から LTS を入れ直してください。

---

## 実行手順

### 1. 依存と Playwright ブラウザの準備

```bash
pnpm install
pnpm exec playwright install chromium
```

（既に `playwright install` 済みの場合は省略可。）

### 2. スモークテストの実行（推奨: CI 的ローカル実行）

```bash
pnpm test:e2e
```

- 開発サーバーは **自動起動** されます（`VITE_E2E_MODE=1` で起動）。
- ポートは `http://localhost:5173` を想定。
- 既に同じポートで `npm run dev` 等が動いている場合は、`reuseExistingServer` により流用されます（CI では新規起動）。

### 3. 期待結果

- すべてのテストが **PASS** すること。
  - **TOP が表示される**: `#title-ui` と Connect Wallet ボタンが表示される。
  - **Connect Wallet ボタンをクリックすると何らかの反応がある**: クリック後、15 秒以内に `#game-shell.visible` が表示される（モック接続でゲームシェルへ遷移）。
  - **Farming / Deck / Summon のいずれかへ遷移できる**: Connect 後、Farming → Deck(LOFT) → Adopt(Summon) の順にタブをクリックし、それぞれのタブがアクティブかつ対応するペイン（`#pane-farming` / `#pane-deck` / `#pane-adopt`）が表示される。

### 4. 手動で E2E モードの画面を確認する場合

```bash
VITE_E2E_MODE=1 pnpm dev
```

ブラウザで `http://localhost:5173` を開き、Connect Wallet をクリックすると、MetaMask なしでゲームシェルまで進みます。

---

## トラブルシュート

- **Connect Wallet が反応しない**  
  - ブラウザコンソールにエラーがないか確認。
  - `docs/VERIFICATION_READINESS.md` の「E2E モード」で `VITE_E2E_MODE=1 pnpm dev` して再現するか確認。

- **`pnpm test:e2e` が失敗する**  
  - `pnpm exec playwright install chromium` を実行してから再実行。
  - ポート 5173 が他プロセスで使用中でないか確認（必要なら既存の dev サーバーを止める）。

- **本番でウォレットがモックされないか**  
  - 本番では `VITE_E2E_MODE` を設定しないこと。Vite のクライアント用 env のため、ビルド時に未設定ならモックは無効です。
