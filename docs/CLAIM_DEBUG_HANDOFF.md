# Claim 不具合の引き継ぎ（根本原因未特定）

**目的**: 新セッションで Claim 問題にすぐ着手できるよう、現状・試したこと・根本原因候補・次の一手をまとめる。  
**方針**: 表面上の解消ではなく、**根本原因を突き止めて解決する**（`.cursor/rules/root-cause-first.mdc` 参照）。

---

## 1. Claim の流れ（コード上の順序）

1. ユーザーが **Claim** ボタンを押す。
2. 確認モーダル「Claim X $SEED?」→ ユーザーが Confirm。
3. **flushServerSync()**: ゲーム状態をサーバーへ PUT（409 時は GET してから再 PUT）。
4. 約 1.8 秒待機。
5. **requestClaim(address)**: POST `/api/claim` で署名取得（reserve → EIP-712 署名返却）。
6. **runClaimWithSignature(signature)** → **executeClaim(signature)**:
   - staticCall でシミュレート（失敗しても続行、ログのみ）。
   - **contract.claimEIP712(..., { gasLimit: 300_000 })** で本番トランザクション送信（ウォレットが開く想定）。
   - tx.wait() で確定待ち → 成功時は postClaimConfirm、失敗時は revert 理由を表示。

オンチェーンでは **RewardClaim.claimEIP712** が実行され、  
`require(block.timestamp <= deadline)` → `require(recipient == msg.sender)` → nonce 重複チェック → ecrecover で signer 一致 → **transferFrom(pool, msg.sender, amount)** の順で検証される。

---

## 2. 現状の事象（ユーザー報告ベース）

- **Claim を押してもウォレットウィンドウが開かない**（開かないまま「Claim failed」モーダルが出る）。
- コンソールには「[Claim] シミュレーション失敗。送信は続行します: execution reverted (no data present; likely require(false)...」と出ている。
- つまり **staticCall は失敗しているが「送信は続行」まで進んでいる**。その後の **本番送信（contract.claimEIP712）の時点で、ウォレットが開かずにエラーになっている**可能性が高い。

---

## 3. すでに確認済み（原因として否定したもの）

| 項目 | 結果 |
|------|------|
| **Signer 一致** | DEBUG「Signer 確認」でサーバーとコントラクトの signer が一致（0x47bD5a85...）。 |
| **報酬プールの $SEED 残高** | DEBUG「プール残高・allowance を確認」で 968,096 $SEED あり。 |
| **RewardClaim への allowance** | 実質無制限。 |
| **PUT game-state 409** | 409 時に GET → 再 PUT する処理を追加済み。Claim 失敗の主因ではなさそう。 |

---

## 4. これまでに実施したコード変更（経緯）

- **revert 理由の表示**: オンチェーン revert 時に Error(string) をデコードしてメッセージ表示。
- **GET /api/claim/signer**: サーバーの signer アドレス確認用。
- **DEBUG「Signer 確認」「プール残高・allowance を確認」**: 画面上で signer・残高・allowance を確認可能に。
- **staticCall でシミュレート**: 送信前に revert 理由を取得しようとしたが、RPC が「no data present」で理由を返さないことが多い。
- **staticCall 失敗時も送信続行**: シミュレートで失敗しても本番送信は行うように変更（ウォレットを開かせる意図）。
- **gasLimit: 300_000 を指定**: ethers の内部 estimateGas が revert する問題を避けようとしたが、**ethers v6 は gasLimit を渡しても estimateGas を呼ぶ場合があり、ウォレットが開かない根本原因だった**。
- **根本対応（2025-02）**: Contract メソッド呼び出しを廃止し、**Interface.encodeFunctionData + signer.sendTransaction** で送信。estimateGas を一切経由しない経路に変更。あわせて [Claim] 診断ログを追加。

---

## 5. 根本原因（特定済み・2025-02 対応）

1. **ethers v6 の Contract 書き込みメソッドは、overrides で gasLimit を渡しても内部で estimateGas を呼ぶ場合がある**  
   → シミュレーション（estimateGas）が revert すると、ウォレットにトランザクションが渡る前に例外になり、ウォレットが開かない。  
   → **対応**: `contract.claimEIP712(...)` をやめ、**Interface.encodeFunctionData + signer.sendTransaction** で送信する経路に変更。estimateGas を一切経由しないため、ウォレットに必ず eth_sendTransaction が届く。

2. **実際の revert 理由が RPC から取れていない**  
   - staticCall も本番送信の catch も「no data present」「require(false)」のみ。  
   - コントラクト側のどの `require` で落ちているかが不明。  
   - 考えられる要因例: 署名期限切れ、nonce 重複、**トークンの transferFrom の仕様**（例: 手数料付きトークンで実際の転送量が異なる、別の revert など）。

3. **ウォレット拡張側の挙動**  
   - 同一トランザクションで estimateGas が失敗した場合に、ウォレットがポップアップを出さずにエラーを返している可能性（要調査）。

4. **$SEED トークンの実装**  
   - transferFrom が revert するパターン（例: 手数料、Pause、ホワイトリスト）がないか、コントラクト・デプロイ先を確認する必要がある。

---

## 6. 次のセッションで行うこと（推奨順）

1. **最新コードのデプロイ確認と「ウォレットが開くか」の確認**
   - 現在の main には **sendTransaction 直接送信**（estimateGas 回避）が入っている。  
   - デプロイ後、Claim → ウォレットが開くか確認する。  
   - 開く場合: オンチェーンで revert するか確認。revert するなら、その時のエラー（ウォレット表示・コンソールの [Claim] ログ）を記録する。  
   - 開かない場合: 下記 2 に進む。

2. **ウォレットが開かない場合の切り分け**
   - 現在はすでに **sendTransaction 直接送信**（estimateGas 経由なし）になっている。  
   - コンソールの `[Claim] eth_sendTransaction 送信直前` / `トランザクション送信済み` および `[Claim] executeClaim エラー` の有無で、どこで止まっているか確認する。  
   - 必要なら、`provider.send('eth_sendTransaction', [...])` を直接呼ぶなど、さらに低レベルな送信経路でウォレットが開くか試す。

3. **オンチェーンで revert する場合の根本原因特定**
   - どの `require` で落ちているかを特定する。  
   - 方法の例:  
     - ローカルで Hardhat などを使い、同じ引数で claimEIP712 を呼んで revert 理由を再現する。  
     - Sepolia 上の RewardClaim と $SEED トークンのデプロイ・設定（pool の allowance、トークンの仕様）を再確認する。  
   - **$SEED トークン**が通常の ERC20 か、fee-on-transfer や rebase などがないか確認する。

4. **ドキュメントの更新**
   - 上記で分かったこと（根本原因または候補の絞り込み）をこのファイルまたは `docs/CONFIRMATION_*.md` に追記する。  
   - 根本原因が特定できたら、`docs/TODO.md` の「Claim 根本原因」まわりを「対応済み」に更新する。

---

## 7. 関連ファイル

| 種類 | パス |
|------|------|
| Claim 実行（フロント） | `src/rewardClaim.ts`（executeClaim, getPoolBalanceAndAllowance, getContractSignerAddress） |
| Claim フロー（UI） | `src/domShell.ts`（Claim ボタン、flushServerSync → requestClaim → runClaimWithSignature） |
| Claim API | `api/claim.js`（reserve, EIP-712 署名）, `api/claim/signer.js`, `api/_lib/claimStoreKV.js` |
| コントラクト | `contracts/RewardClaim.sol` |
| 環境変数・確認手順 | `docs/VERCEL_ENV_VARS.md` |

---

## 8. このドキュメントの読み方

- **Claim の不具合を続きから調査・修正するとき**: セッション開始時に `docs/SESSION_START.md` の必須ドキュメントを読んだうえで、**このファイル（CLAIM_DEBUG_HANDOFF.md）を開き、「6. 次のセッションで行うこと」から着手**する。  
- 進捗や新たに分かった原因は、このファイルの該当セクションを更新して残す。
