# 残タスク・将来実装候補

今後実装する可能性がある項目をメモしておく用の一覧です。

---

## メインネット移行時: Loft Upgrade の予約方式（レースコンディション対策）

**現状**: Loft Upgrade は「on-chain $SEED burn → POST /api/loft-upgrade」の 2 ステップ。クライアント側で burn 前にサーバー state を確認しているが、2 デバイスで同時操作すると安いコストで上位レベルを得られるレースコンディションが理論上存在する。

**対策（メインネット移行時に実装）**: 予約方式（2 フェーズコミット）
1. `POST /api/loft-upgrade/reserve` → サーバーがレベル・コストを確定しロック（game state に `pendingUpgrade` フィールド、TTL 付き）
2. クライアントが確定コストで on-chain burn
3. `POST /api/loft-upgrade/confirm` → サーバーが upgrade 実行
4. 他デバイスが同時に reserve → 「Upgrade 進行中」で reject
5. タイムアウト（5 分）でロック自動解除

**ガチャも同様の構造**（on-chain burn → サーバー API）だが、コストが固定のため同じ問題は起きない。

---

## UX・表示

- **PC版: チュートリアル表示中にテキストカーソル（キャレット）が点滅して表示される** — 即時対応はせず要望のみ記録。
- **オンボーディングの暗転** — 現在はコンテンツと一緒にスクロールする一部暗転にしている。全画面固定に戻すか・現状のままかは要検討。

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

## 達成済み: ① Git版＋スマホで PC と同等に動作（2026-02-27 確認）

PC 環境とスマホ環境（MetaMask ブラウザ）で Claim・ガチャ・デッキ編成を交互に実施し、問題なく動作することを確認。`docs/PATH_TO_VERIFICATION.md` のチェックリスト 1〜9 を両環境でクリア。

**対応環境**: PC版 ＋ ウォレットアプリ内ブラウザ。スマホの通常ブラウザ（Chrome 等）での WalletConnect 対応は行わない。

---

## 実装済み（2026-02-27）

### サーバー権威化（ガチャ・Loft Upgrade）

- **サーバー側ガチャ API (`POST /api/gacha`)**: ガチャロジックをサーバーに移植。レアリティ抽選・鳥生成をサーバー側で実行し、CAS（Compare-And-Swap）でアトミック更新。新規ユーザーは初期 state を自動生成。
- **サーバー側 Loft Upgrade API (`POST /api/loft-upgrade`)**: アンロックコスト判定・state 更新をサーバー側で実行。CAS リトライ付き。
- **ガチャロジック共通モジュール (`api/_lib/gachaLogic.js`)**: `RARITY_WEIGHTS`, `BIRD_SPECIES`, `BIRD_COLORS`, `DECK_UNLOCK_COSTS`, `rollGachaRarity()`, `generateBirdId()`, `pullGachaServer()`, `createDefaultGameState()`, `getNextUnlockCost()` を ESM で実装。
- **クライアント API 関数**: `postGacha()`, `postLoftUpgrade()` を `gameStateApi.ts` に追加。

### デッキ同期の整理

- **Save まで同期しない**: デッキ編集（`placeBird`/`removeBird`）時の `scheduleServerSync()` を廃止。Save ボタン成功後にのみ `flushServerSync()` でサーバーへ送信。
- **savedDeckSlots で表示**: SEED/DAY と NETWORK SHARE の計算に、編集中のデッキではなく確定済みデッキ (`savedDeckSlots`) を使用。4 箇所の `updateShellStatus` 呼び出しすべてを修正。
- **タブ切替時のデッキ復元**: LOFT タブを離れる際、未 Save のデッキ編集を `revertDeckToSaved()` で元に戻す。

### マルチタブ・マルチデバイス対策

- **Loft Upgrade stale-state 防止**: Upgrade 実行前にサーバーの最新 state を取得し、別タブで既にレベルアップ済みなら burn せずに中断＋UI リフレッシュ。
- **409 ハンドラ簡素化**: マージロジックを廃止し、409 時はサーバー state をそのまま採用（ガチャ・Loft はサーバー API 経由のためマージ不要）。

### モバイル対応

- **スクロール二重化の解消**: `body` を `height: 100dvh; overflow: hidden;` に変更し、`.shell-content` のみがスクロールコンテナに。全タブで統一されたスクロール挙動を実現。
- **ネストされた touch-action 削除**: `.deck-pane-body`, `.deck-content-with-birds`, `.deck-section`, `.inventory-section`, `.deck-slot`, `.inventory-grid`, `.inventory-cell` から重複する `touch-action: pan-y` を削除。iOS Safari のスクロール引っかかりを解消。

### オンボーディング

- **初回ガチャ時のタブ制限**: `need_gacha` ステップで LOFT・NETWORK タブをグレーアウト（`lockDuringGacha`）。

---

## 実装済み（2026-02-25〜26）

以下は Git 修正履歴に基づく、2/25〜26 に実装・修正した項目の記録。

### サーバー同期の整合性強化

- **auto-connect 時に SIWE + server sync を実行**: 再接続時も必ずサーバーと同期し、stale な claim state を防止（890098a）
- **local/server seed 比較**: auto-connect 時に local が高ければサーバーへ push（431ced9）
- **サーバーを single source of truth に**: サーバー状態を常に信頼し、ローカルとの齟齬を排除（f8f9c62）
- **server state regression 防止**: サーバー側の古い状態でローカルの進捗を上書きしないよう対策（f1f2578）
- **debug grant-seed 後の server version sync**: 409 エラー防止（360e332）

### ガチャの整合性強化

- **on-chain 承認前に bird を付与しない**: ガチャで on-chain の approval が完了するまで鳥を追加しないよう修正（b964fb0）
- **on-chain 記録失敗時の free ガチャ rollback**: チェーン記録に失敗した場合に付与済みの鳥を取り消す（a8960ac）

### Admin・セキュリティ

- **Debug UI を admin whitelist に制限**: 指定アドレスのみ Debug タブを表示（e862660）
- **server-side seed validation**: サーバー側で seed 値を検証（d5c3e7b）
- **admin grant-seed endpoint**: 管理者がサーバー側で seed を付与可能に（d5c3e7b）
- **admin fix-claim-data endpoint**: Claim データの不整合を管理者が修正可能に（fcb62aa）

### WebView / モバイル対応

- **Bearer token fallback**: WebView 環境で Cookie が使えない場合に Bearer トークンで認証（46f81eb）

### UX 改善

- **MetaMask rejection 時の Network stats エラーモーダル抑制**: ユーザーがトランザクションをキャンセルした場合にエラーモーダルを出さない（2bd8d14）
- **sync diagnostic alert**: 接続時に同期診断アラートを表示（デバッグ用）（edbde1b）

### E2E テスト

- **ガチャテストの修正**: mock RPC と state isolation を修正（dfdb3bc）

### コード整理

- **未使用変数削除**: `isUserRejection` の削除（feea5a9）

---

## 解決済みの過去の事象（参考記録）

<details>
<summary>クリックで展開: SIWE 署名・Claim・データ同期・接続時ガス・ネットワーク表示</summary>

### ゲームデータ同期の事象（SIWE 署名 — 解決済み・2026-02-24）

- **現象**: Connect 後、2 回目のウォレット（SIWE 署名）が開かない（Rabby / MetaMask 等）。その結果 Cookie が発行されず、GET/PUT が 401、「保存: 失敗」、毎回チュートリアルからになる。
- **解決済み**: 1 クリックで「接続 → 署名」の 2 回ウォレットが正常に開くことを確認。処理順序変更、pending nonce 対応、nonce フォールバック、VITE_CLAIM_API_URL の Vercel 設定等により解消。

### Claim の根本原因（完全解決済み・2026-02-24）＋ 追加堅牢化（2026-02-25〜26）

- **根本原因**: デプロイ済みコントラクトが古いバージョン（`claim()` 関数のみ）で、現在のコードが呼ぶ `claimEIP712()` が存在しなかった。
- **解決**: 新しい `RewardClaim.sol` を Sepolia に再デプロイ（`0x4F4B9DE25eea339a31f6D716916C199502262f80`）、pool の approve 実施、Vercel 環境変数更新。
- **確認済み**: 本番で Claim 成功（tx: `0x763950215114937c2d7e9d6c24e2bc3e35658a51ccf4d297e8a1325cff601ce3`）。

### データ同期・Vercel 本番（bird-game-udhr）— 解決済み

- vercel.json: `buildCommand` を `npm run build` に変更済み。`outputDirectory`: `dist`。
- Vercel に `VITE_CLAIM_API_URL=https://bird-game-udhr.vercel.app/api` を設定しリデプロイ済み。
- Git 版・Vercel 版ともに接続 → SIWE 署名の 2 段階が正常に動作することを確認済み（2026-02-24）。

### 接続時ガス（メタマスクブラウザ）— 対応済み

- 接続直後の `setLoftLevel(1)` を廃止し、初回デッキ SAVE 時に `getLoftLevelRaw(addr) <= 0` なら `setLoftLevel(1)` を実行するように変更。

### 送金リクエスト・ネットワーク表示の根本原因 — 対応済み

- 接続成功後に Sepolia へ切り替える処理を追加済み（`wallet.ts` の `ensureSepolia`）。
- Connect Wallet 押下でガス代がかかる承認が出る問題 → Loft レベル登録を「初回デッキ SAVE 時」に移したことで解消。

</details>

---

## 追加するときのメモ

- 「もしかしたら実装するかも」というものは、上のようにセクションを分けて追記していく。
- 実装したら該当項目を「完了」にしたり、日付とともに記録してから削除する。
