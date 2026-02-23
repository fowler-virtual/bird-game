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

## 2. 現状の事象（ユーザー報告ベース・直近更新）

- **本番で Claim を押すと「Claim failed」**。送信前シミュレーション（eth_call）で **revert** しているため、**送信は行っていない**（ガス節約のため revert 時は送信しない実装）。
- コンソール: `[Claim] 送信前シミュレーションで revert` → `reason: 'require(false)'`, `revertDataHex: '0x'`（理由なしの revert）。
- **Signer 一致**・**プール残高 968,096 $SEED**・**allowance 無制限**は DEBUG で確認済み。クライアントが読む残高・allowance は十分なのに **transferFrom 相当で revert** している状態。
- 直近のログ改善で `[Claim] FAILED` に **amountSEED / amountWei / poolBalanceWei / allowanceWei / poolAddress / tokenAddress** を出力済み。次回 Claim 失敗時にコンソールのオブジェクトを展開すると Etherscan 照合用のアドレスが取れる。

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
- **送信前シミュレーション**: 送信前に **eth_call** で必ずシミュレート。revert する場合は理由をデコードして表示し、**送信しない**（ガス節約＋理由を確実に表示）。RPC 別のエラー形状に対応するため `getRevertDataFromError` で revert データを一括取得。
- **API で署名量を min(プール残高, allowance) にキャップ**（transferFrom revert 防止）: `api/_lib/poolBalance.js` で `getPoolBalanceAndAllowanceWei` を取得し、`api/claim.js` で署名する amount を `min(balance, allowance)` でキャップ。allowance 不足でも transferFrom が revert しないようにした。
- **クライアント: 同期失敗時は Claim を要求しない**: `flushServerSync()` が false のときは `requestClaim` を呼ばず、「LOFT で Save してから再度 Claim を試してください」とモーダル表示。409 等でサーバー状態が古いまま Claim すると claimable ずれや revert の原因になるため。
- **revertData が '0x' のときもプール残高・allowance で切り分け**: `isRevertDataEmpty()` を追加し、RPC が理由を返さない場合でも getPoolBalanceAndAllowance で比較。amount > 残高 or allowance なら具体的メッセージ、そうでなければ「token may differ on-chain」ヒントをログに出力。
- **Claim FAILED ログに poolAddress / tokenAddress を追加**: Etherscan でトークンの balanceOf(pool)、allowance(pool, RewardClaim) を照合できるようにした。

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

5. **コンソールに `reason: 'require(false)'`, `revertDataHex: '0x'` が出る場合**  
   - RewardClaim の各 require にはメッセージがあるため、**revert データが空**なのは、**トークンの transferFrom 内で revert している**可能性が高い。  
   - トークンが revert 理由を返さない（またはカスタムエラーでデコードされない）と、RPC が `require(false)` と空データで返す。  
   - **確認**: DEBUG「プール残高・allowance」で、**請求量（amount）がプール残高・allowance を超えていないか**。また $SEED コントラクトの transferFrom 実装（手数料・Pause・制限）を確認する。

---

## 6. 次のセッションで行うこと（推奨順）

- **Claim の責務・失敗原因・E2E で再現しない理由・再現と解消方針**は **`docs/CLAIM_ROOT_CAUSE_AND_E2E.md`** に整理した。本番でまだ Claim が失敗する場合は同ドキュメントの「4. どうしたら E2E で再現し、解消できるか」に沿って E2E_BASE_URL + E2E_REWARD_CLAIM_ADDRESS を設定して E2E を実行し、通るまで修正する。

1. **シミュレーション revert（現状）の根本原因特定**
   - 本番では **送信前シミュレーション（eth_call）で revert** しており、`reason: 'require(false)'`, `revertDataHex: '0x'`。Signer・プール残高・allowance は十分なのに **transferFrom 相当で理由なし revert** している。
   - **次の一手**: デプロイ後にもう一度 Claim を試し、コンソールの `[Claim] FAILED` のオブジェクトを展開して **poolAddress** と **tokenAddress** を取得。Etherscan（Sepolia）で (1) トークン契約の `balanceOf(poolAddress)` と `allowance(poolAddress, RewardClaim アドレス)` を Read で実行し、ログの値と一致するか確認。(2) 一致していれば **$SEED トークンの実装**（fee-on-transfer、pause、制限など）を確認。不一致なら RewardClaim の `pool`/`seedToken` やデプロイ設定の見直し。
   - 必要なら Hardhat 等で同じ引数で claimEIP712 を呼び、revert 理由を再現する。

2. **PUT /api/game-state の 409**
   - 別件として、保存時に 409 Conflict が出ることがある。LOFT で SAVE 成功を待ってから Claim する、または 409 時の GET→再 PUT が正しく動いているか確認。

3. **ドキュメントの更新**
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

## 8. なぜ「以前は動いていた」のに動かなくなるか（開発側の整理）

**結論**: フロントの「送信するトランザクションの内容」は、一連の Claim 修正で**一切変えていない**。

- **変更したもの**: 送り方（estimateGas 回避 → sendTransaction 直接）、送信前シミュレーション、revert 理由の取り方・表示。  
- **変えていないもの**: `recipient`（signer.getAddress()）、`amountWei` / `nonce` / `deadline` / `campaignId` / `v` / `r` / `s`（すべて API の署名レスポンスのまま）。エンコードも `claimEIP712(recipient, amount, nonce, deadline, campaignId, v, r, s)` の並びで不変。

そのため「以前は成功していたのに今は revert する」場合、**コードの書き換えでトランザクションの中身が変わったのではなく**、次のどちらかの可能性が高い。

1. **環境の変化**  
   - Vercel の `CLAIM_SIGNER_PRIVATE_KEY` や `REWARD_CLAIM_CONTRACT_ADDRESS` の変更、RewardClaim の再デプロイ（signer の不一致）、プールの allowance 取り消し・残高不足など。
2. **もともと本番では成功していなかった**  
   - 動いていたのがローカルや別ネット・別設定だけで、Vercel + Sepolia の組み合わせでは一度も成功していなかった可能性。

**次の一手**: 送信前シミュレーションで表示される**具体的な revert 理由**（例: `RewardClaim: transfer failed`）を確認し、その理由に沿って signer 一致・プール残高・allowance・トークン仕様を確認する。コードを当てずっぽうでいじるより、表示された理由に基づいて環境・コントラクト側を直す。

---

## 9. このドキュメントの読み方

- **Claim の不具合を続きから調査・修正するとき**: セッション開始時に `docs/SESSION_START.md` の必須ドキュメントを読んだうえで、**このファイル（CLAIM_DEBUG_HANDOFF.md）を開き、「6. 次のセッションで行うこと」から着手**する。  
- **「なぜ前は動いていたのに」という疑問**: **8. なぜ「以前は動いていた」のに動かなくなるか**を参照。  
- 進捗や新たに分かった原因は、このファイルの該当セクションを更新して残す。
