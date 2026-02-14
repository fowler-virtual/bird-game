# 検証開始条件（Definition of Ready）と実行手順

監査・UI検証を開始する前に、以下を満たしていることを確認してください。

## 検証開始条件（DoR）

1. **TOP が表示される**  
   タイトル画面（Connect Wallet ボタン）が表示され、崩れや白画面になっていないこと。

2. **Connect Wallet が反応する**  
   ボタンクリックで「Connecting...」やゲーム画面への遷移など、何らかの DOM 変化またはログが起こること。

3. **Farming / Deck / AdOPT のいずれかへ遷移できる**  
   接続後、タブで FARMING / LOFT / ADOPT を選択して画面が切り替わること。

上記は **Playwright のスモークテスト** で自動確認できます（E2E モード時はウォレットをモックするため、MetaMask なしで実行可能）。

## E2E モード（モック接続）

- **`VITE_E2E_MODE=1`**（検証開始条件では E2E_MODE=1 と表記する場合あり）を付けて起動すると、ウォレット接続・ログインを **モック** します。
- UI は「接続済み」状態になり、Farming / Deck / Adopt などの画面遷移を検証できます。
- **本番ビルド・本番起動では使用しないでください。** 本番ではこの環境変数を与えず、挙動は一切変わりません。

## 実行手順

### 1. 依存のインストール

```bash
pnpm install
# または npm install
```

### 2. Playwright ブラウザのインストール（初回のみ）

```bash
pnpm exec playwright install
# または npx playwright install
```

### 3. スモークテストの実行（ローカル CI 相当）

```bash
pnpm test:e2e
# または npm run test:e2e
```

- 内部で `VITE_E2E_MODE=1` を付けて開発サーバを起動し、Chromium でスモークテストを実行します。
- **開発サーバが未起動でも実行可能**（テスト開始時に自動起動）。

### 4. 期待結果

- 全テストが **PASS** すること。
  - `TOP が表示される`
  - `Connect Wallet ボタンをクリックすると何らかの反応がある`
  - `Farming / Deck / Adopt のいずれかへ遷移できる`
- いずれかが失敗する場合は、TOP 非表示・Connect 無反応・タブ遷移不可などの不具合があるため、先に修正してから監査・UI 検証に進んでください。

### 5. 手動で E2E モードの UI を確認する場合

```bash
VITE_E2E_MODE=1 pnpm dev
# または VITE_E2E_MODE=1 npm run dev
```

ブラウザで http://localhost:5173 を開き、「Connect Wallet」をクリックすると、モックで接続済みになりゲーム画面に遷移します（MetaMask 不要）。

## トラブルシューティング

- **テストが「Connect Wallet で反応がない」で失敗する**  
  - `VITE_E2E_MODE=1` が開発サーバに渡っているか確認。  
  - `playwright.config.ts` の `webServer.env` で `VITE_E2E_MODE: '1'` が設定されていること。

- **TOP が表示されない**  
  - コンソールに JavaScript エラーが出ていないか確認。  
  - `main.ts` の `DOMContentLoaded` 以降で `runApp()` が実行されているか確認。

- **pnpm がない場合**  
  - `npm run test:e2e` で同様に実行できます。
