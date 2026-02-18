# Vercel で VITE_CLAIM_API_URL を設定する手順（A案）

クライアントが同じ Vercel の `/api`（auth/nonce, auth/verify, game-state など）を叩くために、本番ビルド時に API のベース URL を渡す手順です。

---

## 前提

- このリポジトリを Vercel にデプロイしていること。
- デプロイ後のサイトの URL（例: `https://プロジェクト名.vercel.app` やカスタムドメイン）が分かっていること。

---

## 手順

### 1. デプロイ URL を確認する

- Vercel のダッシュボードで対象プロジェクトを開く。
- **Deployments** の最新デプロイを開くか、**Settings → Domains** で本番の URL を確認する。
- 例:
  - `https://bird-game.vercel.app`
  - またはカスタムドメイン `https://your-domain.com`

この URL を **オリジン** として使います。末尾の `/` は付けません。

---

### 2. 環境変数を追加する

1. Vercel ダッシュボードで対象 **プロジェクト** を開く。
2. 上部タブの **Settings** をクリック。
3. 左メニューの **Environment Variables** をクリック。
4. **Key** に次をそのまま入力:
   ```text
   VITE_CLAIM_API_URL
   ```
5. **Value** に次を入力（`https://あなたの本番URL` の部分を実際のオリジンに置き換える）:
   ```text
   https://あなたの本番URL/api
   ```
   **例（本プロジェクトの本番）:**
   - `https://bird-game-udhr.vercel.app/api`
   - カスタムドメインを使う場合: `https://your-domain.com/api`
6. **Environment** で、本番用なら **Production** にチェック。プレビューでも同じ動きにしたい場合は **Preview** にもチェック。
7. **Save** で保存。

---

### 3. 再デプロイする

`VITE_*` はビルド時に埋め込まれるため、**環境変数を追加・変更したあとは再デプロイが必要**です。

- **方法 A（推奨）**: Deployments タブで、最新デプロイの右側の **⋯** → **Redeploy** を選び、**Redeploy** で実行。
- **方法 B**: 手元で `git commit`（空コミットでも可）して push し、Vercel の自動デプロイを待つ。

再デプロイが完了するまで 1〜2 分かかることがあります。

---

### 4. 設定が効いているか確認する

1. 本番のサイトを開く（シークレットウィンドウや別ブラウザだと確実）。
2. 開発者ツール（F12）→ **Console** を開く。
3. 「Connect Wallet」などで接続し、必要なら承認まで進む。
4. Console に `Claim API not configured (VITE_CLAIM_API_URL)` が出ていなければ、クライアントは設定済みの API を参照しています。
5. ネットワークタブ（**Network**）で、`/api/auth/nonce` や `/api/auth/verify` へのリクエストが出ており、期待どおり 200 などが返っていれば、API も動いています。

---

## 注意点

- **値の形式**: 必ず **オリジン + `/api`** にしてください。末尾スラッシュは不要です（例: `https://xxx.vercel.app/api`）。
- **Production だけ設定した場合**: Preview デプロイ（PR ごとの URL）では `VITE_CLAIM_API_URL` が空になり、本番と違う動きになります。Preview でも同じにしたい場合は、同じキーで **Preview** にも設定し、Preview 用の URL（例: `https://xxx-git-branch-xxx.vercel.app/api`）を入れるか、あるいは後述の B 案（未設定時は同一オリジンにフォールバック）を検討してください。
- **複数ドメイン**: 本番で複数ドメインがある場合は、クライアントが実際に開いている URL のオリジン + `/api` を指定する必要があります（開いているドメインと違うオリジンにすると CORS や Cookie の扱いで問題になることがあります）。

---

## まとめ

| 項目 | 内容 |
|------|------|
| 設定場所 | Vercel → プロジェクト → Settings → Environment Variables |
| Key | `VITE_CLAIM_API_URL` |
| Value | `https://本番のオリジン/api`（例: `https://bird-game.vercel.app/api`） |
| 必須作業 | 保存後に **再デプロイ** |

以上が A 案の詳しい手順です。
