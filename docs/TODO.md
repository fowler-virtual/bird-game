# 残タスク・将来実装候補

今後実装する可能性がある項目をメモしておく用の一覧です。

---

## 反映されていない現在の事象・進捗（製造責任者が参照）

**ゲームデータ同期の事象**

- Connect 後、2 回目のウォレット（SIWE 署名）が開かない（Rabby / MetaMask 等）。その結果 Cookie が発行されず、GET/PUT が 401、「保存: 失敗」、毎回チュートリアルからになる。
- 要件: 1 クリックで「接続 → 署名」の 2 回ウォレットが開く。同じボタン 2 回押し・別ボタン・新規モーダルは NG。
- 実施済み: 処理順序変更（getGameState → ゲーム表示 → ensureSepolia / refreshSeedToken）、pending nonce（GET /auth/nonce アドレスなし）、nonce 失敗時の getAuthNonce フォールバック、api/auth/nonce.js・verify.js・siweNonceStore・sessionCookie の pending 対応。加えて本番でクライアントが API を叩けるよう **VITE_CLAIM_API_URL** を Vercel に設定する手順を実施（A 案）。

**Claim の根本原因（対応済み・2025-02）**

- **事象**: Claim を押してもウォレットが開かず「Claim failed」になる。シミュレーションでは revert（no data present）が出ていた。
- **根本原因**: ethers v6 の Contract 書き込みメソッドは、gasLimit を渡しても内部で estimateGas を呼ぶ場合がある。estimateGas が revert するとウォレットに tx が渡る前に例外になり、ウォレットが開かない。
- **実施済み**: **Interface.encodeFunctionData + signer.sendTransaction** で送信する経路に変更。estimateGas を一切経由しないため、ウォレットに必ず eth_sendTransaction が届く。詳細は **`docs/CLAIM_DEBUG_HANDOFF.md`**。
- **確認**: デプロイ後、Claim → ウォレットが開くこと・オンチェーンで revert しないことを実機またはエミュレーターで確認すること。

---

**データ同期・Vercel 本番（bird-game-udhr）まわり**

- **実施済み（コード側）**
  - **vercel.json**: `buildCommand` をダミー HTML 出力から **`npm run build`** に変更済み。`outputDirectory`: `dist`。ルートでゲームがビルド・表示される想定。
  - **docs/VERCEL_VITE_CLAIM_API_URL.md**: A 案の手順を記載。本番例は `https://bird-game-udhr.vercel.app/api`。
- **実施済み（依頼者側・報告ベース）**
  - Vercel の bird-game-udhr に `VITE_CLAIM_API_URL=https://bird-game-udhr.vercel.app/api` を設定し、リデプロイ済み。
- **補足**
  - 「落ちた」は Cursor のクラッシュを指していた。Vercel やサイトの障害ではない。
  - 修正が Git にコミット・push されていれば、Vercel は自動デプロイで `npm run build` が実行される。未コミットの場合は push 後にデプロイされる。
- **依頼者報告（現状）**
  - Git（fowler-virtual.github.io/bird-game）でも Vercel（bird-game-udhr.vercel.app）でも、ログイン試行時に**最初の接続（ウォレット接続）しか出ず、2 回目（SIWE 署名）は出ない**。
- **診断ログ（2回目ウォレットが出ない切り分け用）**
  - `src/claimApi.ts`: Claim API base、GET /auth/nonce の成否、signAndVerifyWithNonce 呼び出し・signMessage 前・verify 結果・エラーを `[Connect]` プレフィックスで console に出力。
  - `src/titleUI.ts`: requestAccounts 成功時の nonce 取得結果を `[Connect]` で出力。
  - **次の確認**: どちらかのサイトで Connect を押したあと、ブラウザの開発者ツール（F12）→ **Console** を開き、`[Connect]` で始まる行だけ見る。最後に出力された `[Connect]` の内容を共有してもらえれば、どこで止まっているか判断できる（例: base が (not set) → ビルドに VITE_CLAIM_API_URL が無い / nonce 失敗 → API や CORS / signMessage 直前まで出ている → ウォレットが 2 回目を出していない、など）。

---

## 最優先: Git版＋スマホでローカルと同様に動作させる

**現状**: ローカル（PC・Chrome）では問題なく動くが、Git デプロイ版をスマホのメタマスクブラウザで開くと、ローカルと違う動きになることがある（Connect で止まる、承認をキャンセルしても処理が進む など）。

**目標**: デプロイ版＋スマホ・メタマスクでも、ローカルで確認した動きと同等にすること。  
**進め方**: 「差異を出さない設計」（タイムアウト・フォールバック・同一コードパス）＋ エミュレーター or 実機での検証で、不具合が出たら原因を切り分けて解消する。細かい UX より先に、この parity を最優先する。（詳細は `docs/DEV_FLOW_AND_MOBILE.md` 参照。）

**対応環境（方針）**: **B. PC版 ＋ ウォレットアプリ内ブラウザのみ** で進める。スマホの通常ブラウザ（Chrome 等）での WalletConnect 対応は行わない。

---

## UX・表示

- **PC版: チュートリアル表示中にテキストカーソル（キャレット）が点滅して表示される** — 即時対応はせず要望のみ記録。
- **オンボーディングの暗転** — 現在はコンテンツと一緒にスクロールする一部暗転にしている。全画面固定に戻すか・現状のままかは要検討。
- **メタマスクブラウザ: Connect Wallet 押下でガス代がかかる承認が出る** — 対応済み。Loft レベル登録を接続直後から「初回デッキ SAVE 時」に移した（下記「接続時ガス」参照）。

---

## 接続時ガス（メタマスクブラウザ）— 対応済み

**対応内容**: 接続直後の `setLoftLevel(1)` を廃止し、**初回デッキ SAVE 時**に `getLoftLevelRaw(addr) <= 0` なら `setLoftLevel(1)` を実行するように変更（`farmingView.ts`）。Connect 時はガス不要。初回 SAVE で updatePower の前に Loft レベル 1 をオンチェーンに登録する。

**過去の原因メモ**:
- 接続成功直後に `titleUI.ts` で setLoftLevel(1) を呼んでいたため、メタマスクブラウザで「接続のたびにガス」と感じられていた。

---

## 送金リクエスト・ネットワーク表示の根本原因（対応済み）

**現象**: メタマスクブラウザで「送金リクエスト」（0 ETH）が出る。またネットワークが「イーサリアム（本番）」のままになる。

**根本原因**:
1. **送金リクエスト** — 0 ETH のリクエストは「ETH 送金」ではなくコントラクト呼び出し（setLoftLevel / updatePower / burn / addRarityCounts など）。Connect 時にはもう送っていないので、**SAVE・ガチャ・Loft アップグレードなどトランザクションを送る操作をしたタイミング**で出るのは仕様どおり。Connect 直後に出る場合はキャッシュで古いビルドが動いている可能性あり。
2. **ネットワークがイーサリアム本番** — アプリ側で **Sepolia へのチェーン切り替えを一度も行っていなかった**（`wallet_switchEthereumChain` 未実装）。そのため MetaMask が本番のままなら、すべてのコントラクト呼び出しが本番ネットワークに向かい、Sepolia 用コントラクトは本番にないため失敗または意図しない動作になる。

**対応**: 接続成功後に Sepolia へ切り替える処理を追加済み（`wallet.ts` の `ensureSepolia` → `titleUI.ts` で Connect 直後に呼ぶ）。未追加時は `wallet_addEthereumChain` で Sepolia を追加してから切り替え。これにより「ネットワークがイーサリアム」になる問題は解消する。

---

## UX・待ち時間のストレス軽減

- **トランザクション確定待ち中のモーダル／メッセージ**
  - 1回目のメタマスク承認後（burn のブロック確定待ち〜約10秒）に、処理中であることを伝えるモーダルやメッセージを表示する。
  - 例：「$SEED を消費しました。ブロックチェーンに反映されるまでお待ちください…」
  - 同様の「確定待ち」が発生する箇所（ガチャの burn 後など）でも、必要に応じて同じパターンで検討する。

---

## ゲームバランス・エコノミクス

- ガチャ排出率の調整
- ガチャに必要な$SEED量の調整
- 各レアリティのファーミング量の調整
- デッキボーナスの検討、内容調整
- 鳥自体をNFTにするか検討
- LOFTアップグレードの必要$SEED量の調整
- ファーミング量の半減期の導入
- トークンエコノミクスの検討
- 鑑賞モードの追加

---

## 追加するときのメモ

- 「もしかしたら実装するかも」というものは、上のようにセクションを分けて追記していく。
- 実装したら該当項目を「完了」にしたり、日付とともに記録してから削除する。
