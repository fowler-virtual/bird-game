# リセットボタン仕様と実装（2025-02-17）

## 仕様（依頼者確認済み）

リセットボタン押下時:

| 項目 | 仕様 |
|------|------|
| ウォレット | **切断してタイトル画面に戻る** |
| ゲームデータ | **初期化 → 初回ガチャ状態にする**（次回そのウォレットで接続すると初回ガチャ画面からになる） |
| オンチェーン | **初期化できないので対象外** |

## 実装（`src/domShell.ts`）

- 接続中: `GameStore.clearCurrentWalletData()` … 当該ウォレットの localStorage を削除し、`loadStateForCurrentWallet()` で空読み → `defaultGameState()`（`onboardingStep: 'need_gacha'`）が入り、`save()` でその状態を保存。次回同じウォレットで接続すると初回ガチャ状態で始まる。
- 未接続: `GameStore.resetToInitial()` でメモリ上の状態を初期化。
- 続けて `clearNetworkStateCache()`、`sessionStorage` に SUPPRESS_CHAIN_DISPLAY_KEY を設定。
- `disconnectCallback` があれば実行。なければ `GameStore.disconnectWallet()` → `hideGameShell()` → `destroyPhaserGame()` → **`showTitleUI()`** → `revokeWalletPermissions()`。

確認ダイアログ文言は上記仕様に合わせてある（「タイトルに戻る」「次回接続で初回ガチャ」「ウォレットは切断」「オンチェーンはリセット対象外」）。

## 履歴

- 2025-02-17: 当初「リセット後もゲーム内に留まり初回ガチャ画面を表示」とする案で実装したが、仕様と異なっていたため取りやめ。上記「切断してタイトルに戻す」「ゲームデータは初期化→次回接続で初回ガチャ」に合わせて実装を戻し、ドキュメントを本仕様に更新。

## 関連ドキュメント

- 確認結果: `docs/CONFIRMATION_2025-02-17.md`（リセット・初回ガチャ暗転・初回デッキ SAVE）
- ドキュメント一覧: `docs/README.md`
