# 監査指摘の対応順序と修正・テスト方針

指摘事項を**対応する順番**で並べ、各項目の**具体的な修正内容**と**テスト方法**をまとめています。

**前提**: A 寄せの**最小仕様**は `docs/AUDIT_RESPONSE.md` の「A 寄せの最小仕様（合意追記）」に記載している。実装は以下を満たすこと。

- Claim API は amount を受け取らない。サーバは `claimable_total` / `claimed_total` を保持し**差分のみ**署名。**原子的更新**必須。**セッション認証（SIWE 等）**必須。CORS/rate limit は補助。
- 署名は **EIP-712 ＋ deadline（短い有効期限）＋ domain に chainId / verifyingContract**。
- NetworkState は「公式値ではない」を UI/仕様で明示するか、表示を削る。

---

## 対応の順番（全体）

| 段階 | 内容 | 目的 |
|------|------|------|
| **Phase 0** | Claim の即時無効化 | 公開環境で API が叩かれても署名を返さないようにする |
| **Phase 1** | Claim API の修正（amount をサーバで決める・CORS・rate limit・nonce） | 重大 1 を解消し、Claim を再開できる土台を作る |
| **Phase 2** | Claim 署名の EIP-712 化（API + コントラクト） | 重大 2（ドメイン分離）を解消する |
| **Phase 3** | NetworkState の扱い明示（表示専用・UI 表記） | 重大「NetworkState を公式として扱わない」を運用で固定する |
| **Phase 4** | 権威データの分離（フロントの claimable 表示とサーバの値の関係） | クライアント改ざんが報酬に直結しないようにする |
| **Phase 5** | CI・秘密・監査の追加（npm audit, secret scan, build） | 中リスクの軽減と再発防止 |
| **Phase 6** | domShell 縮退・innerHTML の整理 | 高・中（構造と XSS）をリファクタで対応 |

以下、Phase ごとに「何を修正するか」「どうテストするか」を書きます。

---

## Phase 0：Claim の即時無効化

**目的**: 公開環境で「任意 amount で署名がもらえる」状態をすぐ止める。

### 修正内容

1. **Vercel（本番）**
   - 環境変数 `CLAIM_SIGNER_PRIVATE_KEY` を**削除する**か、空にする。  
   - または `CLAIM_DISABLED=true` のようなフラグを用意し、API 内で「このフラグが true なら 503 を返す」にする。
2. **API 側（推奨）**
   - `api/claim.js` の先頭で、`process.env.CLAIM_DISABLED === 'true'` のときは **503** と `{ error: 'Claim is temporarily disabled' }` を返して終了する。
   - 本番の Vercel で `CLAIM_DISABLED=true` を設定する（鍵は残しても、署名処理に到達しない）。
3. **フロント**
   - Claim ボタンを**無効化**するか、非表示にする（`VITE_CLAIM_DISABLED` などで制御してもよい）。  
   - 「API を止める」が本線なので、フロントは補助。

### テスト

| テスト | 手順 | 期待結果 |
|--------|------|----------|
| 本番 API が署名を返さない | 本番の `/api/claim` に POST（address + 任意 amount）を送る | 503 または 500（鍵未設定時）。レスポンスに `amountWei` / `v,r,s` が含まれないこと。 |
| フロントで Claim ができない | 本番フロントで Claim ボタンを押す／表示を確認 | ボタンが押せない、または押しても「無効」メッセージになる。 |

---

## Phase 1：Claim API の修正（サーバで amount を決める・claimable_total/claimed_total・認証・CORS・rate limit）

**目的**: クライアント申告の amount を信頼せず、サーバが「このアドレスが引き出せる額」だけを署名する。二重請求・並列リクエストを防ぐため、**claimable_total / claimed_total の差分と原子的更新**を行う。**セッション認証（SIWE 等）**を本質とし、CORS/rate limit は補助とする。

### 1-1. 仕様（合意済み最小仕様に準拠）

- **amount は受け取らない**。サーバが署名する額は「そのアドレスが引き出せる額」のみ。
- サーバはアドレスごとに **`claimable_total`**（これまでに引き出し可能になった累計）と **`claimed_total`**（すでに引き出した累計）を保持する。**署名するのは差分 `claimable_total - claimed_total` のみ**。二重請求・並列リクエスト対策として必須。
- **nonce 単調増加だけでは二重取りは防げない**。**差分計算と原子的な更新**（署名を返す前に「このアドレスで claim する」ことを確定し、`claimed_total` を増やす等）が必須。
- **セッション認証（SIWE 等）を入れる**。Claim API は「そのリクエストが、そのアドレスを保有するユーザーによるものか」を認証する。CORS / rate limit は補助。
- 署名仕様（EIP-712 + deadline + domain）は Phase 2 で実装するが、Phase 1 の段階で「署名する payload の形」は Phase 2 と整合させる。

### 修正内容

1. **API `api/claim.js`**
   - `req.body` から **amount を受け取らない**。`address` と**セッション（SIWE の検証結果やセッション ID 等）**を受け取る。
   - **認証**: SIWE 等で「このリクエストがその address の所有者によるものか」を検証する。未認証なら 401。
   - **claimable の算出**: 永続化層（DB/KV）で `claimable_total[address]` と `claimed_total[address]` を保持。**差分 `amountToSign = claimable_total - claimed_total`** を計算。0 以下なら署名を返さず 400。
   - **原子的更新**: 署名を返す**前に**、該当アドレスの `claimed_total` を `claimed_total + amountToSign` に更新する（トランザクションやロックで一意に更新）。そのうえで `amountToSign` について署名を生成して返す。
   - **nonce**: アドレスごとに永続化し単調増加。署名 payload に含める（Phase 2 で EIP-712 に含める）。
   - **CORS**: `Access-Control-Allow-Origin` を許可するオリジンのみに限定（補助）。環境変数 `ALLOWED_CLAIM_ORIGIN` で指定。
   - **rate limit**: 同一 address や同一セッションで N 回/分 など制限する（補助）。

2. **フロント `claimApi.ts`**
   - `requestClaim(address, amount)` を **`requestClaim(address)`** に変更。body に `amount` を送らない。
   - レスポンスの `amountWei` をそのまま `RewardClaim.claim(...)` に渡す（サーバが決めた額だけ claim する）。

3. **Claim ボタン・UI**
   - 表示する「引き出し可能量」は、**サーバから取得する**（例: `GET /api/claimable?address=...` で `{ claimable: number }` を返す）。  
   - 暫定でサーバが常に 0 を返すなら、フロントは「0 のときは Claim ボタンを無効」にすればよい。

### テスト

| テスト | 手順 | 期待結果 |
|--------|------|----------|
| amount を送っても無視される | POST body に `amount: 999999` を付けて `/api/claim` を呼ぶ | サーバは body の amount を使わず、claimable_total - claimed_total の差分で署名する。 |
| 認証なしは拒否 | セッション（SIWE 等）なしで POST | 401。署名が返らない。 |
| 二重取り・並列対策 | 同一 address で連続 2 回 claim をリクエスト（差分が 100 のとき） | 1 回目: 100 が署名され、claimed_total が原子的に増える。2 回目: 差分 0 のため署名を返さず 400、または別の適切なエラー。 |
| 原子的更新 | 署名発行と claimed_total 更新が同時に行われているか | 署名を返した後、同じ address で再度 claim を叩くと「差分 0」となり、同じ額が二重に署名されない。 |
| CORS（補助） | 許可していない Origin から fetch | ブラウザが CORS エラーにする、または API が 403 を返す。 |
| rate limit（補助） | 同一 address で短時間に複数回 POST | 制限を超えたら 429 などで拒否される。 |
| フロント | Claim ボタンで「サーバが返した amount」だけ claim する | ボタン押下 → 認証付き requestClaim(address) → レスポンスの amountWei で claim() が呼ばれ、期待した額だけ transfer される。 |

---

## Phase 2：Claim 署名の EIP-712 化（deadline 含む）

**目的**: 署名に **EIP-712** を用い、**domain に chainId と verifyingContract** を含める。**deadline（短い有効期限）** を payload に含め、流用・リプレイを防ぐ。

### 修正内容（合意済み最小仕様）

1. **署名形式**
   - **EIP-712 Typed Data** で署名する。
   - **domain**: `name`, `version`, **`chainId`**, **`verifyingContract`**（RewardClaim のアドレス）を含める。
   - **メッセージ**（構造体）: `user`（address）, `amount`（uint256）, `nonce`（uint256）, **`deadline`**（uint256）。deadline は署名発行時刻から短い有効期限（例: 5 分）とする。

2. **コントラクト `RewardClaim.sol`**
   - EIP-712 の typedDataHash（domainSeparator + structHash）を検証する関数を用意する。payload に **deadline** を含め、`block.timestamp <= deadline` を require する。期限切れ署名は reject。
   - 既存の `claim` を置き換えるか、新関数 `claimEIP712(amount, nonce, deadline, v, r, s)` を追加し、旧 `claim` は無効化する。

3. **API `api/claim.js`**
   - ethers の EIP-712 サポート（`TypedDataEncoder` 等）で、上記 domain とメッセージ型で署名する。`deadline` は発行時刻 + 有効秒数（例: 300）。

4. **フロント**
   - API から `amount`, `nonce`, `deadline`, `v`, `r`, `s` を受け取り、コントラクトの `claimEIP712(...)` を呼ぶ。

### テスト

| テスト | 手順 | 期待結果 |
|--------|------|----------|
| 新署名で claim 成功 | フロントから Claim を実行（サーバが EIP-712 + deadline で署名） | トランザクションが成功し、プールからユーザーへ正しい額が転送される。 |
| deadline 検証 | 署名の deadline を過去のタイムスタンプにした payload で claim を呼ぶ | コントラクトで revert（期限切れ）。 |
| 旧形式の署名が通らない | 意図的に「user, amount, nonce」だけの旧ハッシュで署名し、claim を呼ぶ | コントラクトで `invalid signature` となり revert する。 |
| 別 chainId の署名が通らない | 別チェーンの chainId で署名した payload を渡す | コントラクトで検証に失敗する。 |

---

## Phase 3：NetworkState の扱い（公式値ではないことを明示、または表示削除）

**目的**: 合意済み最小仕様に従い、NetworkState を**「公式値ではない」**と UI/仕様で明示するか、**表示自体を削る**。どちらかで運用を確定する。

### 修正内容

1. **選択肢 A: 明示**
   - **ドキュメント**: `README.md` や `docs/FOR_REVIEWERS.md` に「NetworkState の totalPower / levelCounts / globalRarityCounts は**誰でも更新可能**であり、**公式値ではない・表示専用・参考値**である。報酬計算や権威データには使わない」と明記する。
   - **UI**: NETWORK タブや「ネットワークシェア」の近くに、短い注釈を表示する。例: 「表示は参考値です。公式の値ではありません。誰でも更新可能なオンチェーンデータに基づきます。」
2. **選択肢 B: 表示を削る**
   - NETWORK タブのオンチェーン統計（totalPower / levelCounts / globalRarityCounts 等）の表示を削除する。またはタブ自体を非表示にする。

コントラクトの変更は行わない（A 方針では「無害化」でよい）。

### テスト

| テスト | 手順 | 期待結果 |
|--------|------|----------|
| 注釈が表示される | フロントで NETWORK タブを開く | 「参考値」「誰でも更新可能」などの文言が表示される。 |
| ドキュメント | README / FOR_REVIEWERS を読む | NetworkState が表示専用である旨が書いてある。 |

---

## Phase 4：権威データの分離（claimable）

**目的**: クライアントの「表示用 SEED」と、サーバが署名に使う「claimable」を分離し、改ざんが報酬に直結しないようにする。

### 修正内容

1. **フロント**
   - 「Claim 可能量」の表示は、**サーバの GET /api/claimable の戻り値**を表示する（Phase 1 で API を用意している前提）。
   - GameStore の `state.seed` は**ゲーム内の演出・進行用**として残し、Claim ボタンの「引き出せる額」の表示には使わない。  
   - または「サーバの claimable」と「ローカルの seed」を両方表示し、「実際に引き出せるのはサーバが返した値」と説明する。
2. **サーバ**
   - claimable の算出ロジックを、将来 DB や信頼ソースに差し替え可能な形にしておく（Phase 1 で 0 を返す実装にしている場合、その拡張ポイントを用意する）。

### テスト

| テスト | 手順 | 期待結果 |
|--------|------|----------|
| 表示と署名の一致 | サーバが claimable=100 を返す場合、フロントに 100 と表示され、Claim で 100 だけ引き出せる | 表示と実際の claim 額が一致する。 |
| ローカル改ざんが効かない | localStorage の seed を手で書き換えても、Claim 可能量が変わらない | 表示はサーバの claimable に依存し、署名もサーバの値のみ。 |

---

## Phase 5：CI・秘密・監査の追加

**目的**: 依存関係の脆弱性検知、秘密の混入防止、ビルドの安定化。

### 修正内容

1. **CI（GitHub Actions）**
   - 既存の `deploy.yml` の `build` ジョブの前に、以下を追加する（別ジョブでも可）。
     - `run: npm audit --audit-level=high`（high 以上で失敗にする等）。
     - `run: npm run build` は既存のまま。
   - オプション: `run: npx secretlint '**/*'` や、GitHub の `secret-scanning` が有効であることを確認する。
2. **ドキュメント**
   - 「`VITE_` で始まる環境変数はクライアントにバンドルされるため、秘密（鍵・トークン）を入れない」と README や開発者向けドキュメントに明記する。
3. **.gitignore**
   - `.env` が含まれていることを確認。`.env.local` なども無視する。

### テスト

| テスト | 手順 | 期待結果 |
|--------|------|----------|
| npm audit | リポジトリで `npm audit --audit-level=high` を実行 | high 以上がなければ成功。 |
| CI | main に push して Actions を実行 | audit と build が通る。 |
| 秘密の有無 | リポジトリ内を grep で秘密らしき文字列を検索（任意） | 鍵や API キーがソースに含まれていない。 |

---

## Phase 6：domShell 縮退・innerHTML の整理

**目的**: 変更時の事故を減らし、XSS リスクを下げる（高・中リスクの構造と innerHTML 指摘への対応）。

### 修正内容

1. **domShell**
   - 責務を「タブ切替＋共通ヘッダ・ラッパー」に縮小する。モーダル生成・ガチャ実行・ネットワーク統計の描画などは、可能な範囲で **views** や専用モジュールに移す。
2. **innerHTML**
   - 新規コードでは `textContent` + `createElement` を使う。既存の `innerHTML` は、リファクタで domShell や views を触るときに、数値・固定文言だけを差し込んでいる箇所を `textContent` に置き換える。やむを得ず `innerHTML` を残す箇所には「ユーザー入力・外部データを通さない」とコメントする。

### テスト

| テスト | 手順 | 期待結果 |
|--------|------|----------|
| 動作回帰なし | リファクタ後にタブ切替・ガチャ・SAVE・Claim・モーダル表示を手動で確認 | 従来どおり動く。 |
| ビルド | `npm run build` | 成功する。 |

---

## 実施順の一覧（チェックリスト用）

1. [ ] **Phase 0** — Claim 無効化（API + フロント）
2. [ ] **Phase 1** — Claim API: amount をサーバで決める、CORS、rate limit、nonce 単調増加
3. [ ] **Phase 2** — EIP-712 署名（API + コントラクト）
4. [ ] **Phase 3** — NetworkState を表示専用と明示（ドキュメント + UI 注釈）
5. [ ] **Phase 4** — 権威データ分離（claimable 表示をサーバ由来に）
6. [ ] **Phase 5** — CI に npm audit、秘密・env のドキュメント
7. [ ] **Phase 6** — domShell 縮退、innerHTML の整理

Phase 0 は**すぐ実施**。Phase 1 が終われば「Claim を再開できる」状態にできます。Phase 2 で署名の堅牢性を上げ、Phase 3〜4 で運用方針を固定したうえで、Phase 5〜6 で CI とリファクタを進める流れです。
