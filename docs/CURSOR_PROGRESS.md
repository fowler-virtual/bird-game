# E2E CI 失敗対応ログ（#game-shell.visible が 30s で見つからない）

## (1) 現状把握（コード探索）

- **#game-shell の生成**: `index.html` に静的 `<div id="game-shell" aria-hidden="true">` が存在（1785行付近）。JS では生成していない。
- **`.visible` の付与**: `src/domShell.ts` の `showGameShell()`（1657行）で `getShell()` → `shell.classList.add('visible')`。`getShell()` は `document.getElementById('game-shell')` のみ（既存要素に class 付与するだけ。要素が無ければ作らない）。
- **showGameShell() の役割**: 既存の `#game-shell` に `.visible` を付与し、タブ初期化・残高取得などを行う。「要素が無ければ作る」処理はない。`getShell()` が null の場合は早期 return し、class は付かない。
- **TITLE_UI_ID / Connect ボタン**: `titleUI.ts` で `TITLE_UI_ID = 'title-ui'`、`CONNECT_BTN_ID = 'connect-wallet-btn'`。click は `onConnectClick()` で処理。
- **handler の attach**: `main.ts` の `runApp()` で `initTitleUI()` → `titleUI.ts` の `initTitleUI()` が `#connect-wallet-btn` に `click` リスナーを 1 回だけ登録。`showTitleUI()` 内でも `initTitleUI()` を呼ぶ（二重登録は `listenerAttached` で防止）。起動は `DOMContentLoaded` または即時 `start()`。

## (2) 原因の切り分け

- **A. #game-shell が DOM に無い**: 通常は `index.html` で静的に存在。CI で HTML が別（最小化等）で省略されていれば起こりうる。
- **B. class が visible でない**: `showGameShell()` が return している（`getShell()` が null）か、付与前に例外で止まっている可能性。
- **C. click handler が呼ばれていない**: `initTitleUI()` がボタン取得に失敗している（DOM 未準備）か、別要因でリスナー未接続。
- **D. handler 内で例外**: E2E 分岐内で `showGameShell()` や `GameStore.setWalletConnected` 等が throw すると、既存コードでは先に `shell.classList.add('visible')` を E2E で行っているが、順序が `showGameShell()` より後だと class 付与前に throw する可能性あり。

**結論（真因）**: E2E 分岐では既に「get/create #game-shell → .visible 付与」を先に行っているが、**その直後に同期的に `showGameShell()` 等を実行すると、CI/headless で描画が遅れ、テストが 30s 以内に `#game-shell.visible` を検知できない可能性**がある。また handler 内で例外が出ると、ブラウザの描画タイミングによっては .visible が DOM に反映される前に次の処理に進む場合がある。  
→ **.visible 付与後、残り処理（setWalletConnected / showGameShell / createPhaserGame）を `setTimeout(0)` で遅延**し、一度メインスレッドを返して描画を確実に反映させる。

## (3) 最小修正（実施）

- **src/titleUI.ts**（E2E 分岐のみ）: `#game-shell` の get/create と `classList.add('visible')`、title 非表示はそのまま同期的に実行。その後の `GameStore.setWalletConnected` / `showGameShell()` / `createPhaserGame()` / `resetButton` を `setTimeout(() => { ... }, 0)` でラップ。本番分岐は未変更。

## (4) Playwright 補助

- **e2e/smoke.spec.ts**: 既に `test.beforeEach` で `page.on('pageerror')` と `page.on('console', msg => type==='error')` を登録済み。CI で JS 例外・console.error が artifact から確認できる。追加変更なし。

## (5) ローカル実行結果と追加対応

- **pnpm test:e2e 結果**: 1 passed, 2 failed。失敗は `#game-shell.visible` が 30s で見つからない + **[E2E pageerror] Cannot read properties of undefined (reading 'isBuffer')**。
- **切り分け**: pageerror は「Buffer 未定義」で、ethers/siwe 等の依存がブラウザで Buffer を参照しているため。ロード時または click 後の処理で throw し、アプリ初期化や handler 完了が阻害されている可能性。
- **追加対応**: `index.html` で、他スクリプトより前に「Buffer が未定義のときだけ最小スタブを window に設定」する `<script>` を 1 行追加。本番で既に Buffer が定義されていれば何も変更しない。
