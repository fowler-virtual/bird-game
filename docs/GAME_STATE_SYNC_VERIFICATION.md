# ゲーム状態同期 仕様照合結果

`docs/GAME_STATE_SYNC_SPEC.md` に基づく実装確認（実施日: コード確認時点）。

---

## 1. サーバー側

| 仕様 | 実装 | 結果 |
|------|------|------|
| §4 認証: GET/PUT は SIWE セッション必須、未認証は 401 | `requireSession` を GET/PUT に適用（`server/index.cjs`） | ✅ |
| §5.1 GET: レコードなし時は **初期状態 + version 1** を返す | `gameStateStore.get()` が null のとき `getInitialState()`, version 1 を返す | ✅ |
| §5.1 レスポンス: `{ state, version [, updatedAt ] }` | 200 で state, version を返し、保存済みなら updatedAt を付与 | ✅ |
| §5.2 PUT: ボディ `{ state, version }`、version は取得時のもの | リクエストから state, version を取得して検証・比較 | ✅ |
| §5.2 client < current → 409、ボディに STALE_DATA | `gameStateStore.set()` が `!allowed` で 409, `code: 'STALE_DATA'` | ✅ |
| §5.2 client === current → 検証後上書き、200 で `{ version }` | `allowed` のとき set し、`{ version: result.version }` を返す | ✅ |
| §5.2 client > current → 409 または 400 で拒否 | 現状は `!allowed` で 409 を返す（仕様どおり） | ✅ |
| §3.3 初期状態スキーマ | `getInitialState()`: deckSlots 12、unlockedDeckCount 2、seed 0、onboardingStep 'need_gacha' 等 | ✅ |
| §6 PUT 時検証: 型・範囲・参照整合性 | `gameStateStore.validateState()`: birdsOwned, deckSlots 長 12、デッキ参照、unlockedDeckCount 2–12 偶数、loftLevel 1–6、seed ≥ 0 | ✅ |

---

## 2. クライアント側

### 2.1 起動・ゲーム画面に入るとき（§7.1）

| 仕様 | 実装 | 結果 |
|------|------|------|
| SIWE 済みを前提に **GET /game-state** で状態取得 | `titleUI.ts` の `runPostConnectSteps`: `signInForClaim(address)` の後に `getGameState()` | ✅ |
| 取得した state, version をメモリと localStorage キャッシュに保持 | `setStateFromServer(gs.state, gs.version)` 後に `GameStore.save()` | ✅ |
| 表示の正はサーバーから取得した 1 件 | ゲーム表示は `setStateFromServer` 後の `GameStore.state` に依存 | ✅ |

### 2.2 保存のタイミング（§7.2）

| 仕様 | 実装 | 結果 |
|------|------|------|
| デバウンス: 状態変更から 1.5〜2 秒で PUT | `GameStore.save()` 内で `SERVER_SAVE_DEBOUNCE_MS = 2000` のタイマーで `_flushServerSave` | ✅ |
| 保存時は取得済み version をそのまま PUT に含める | `putGameState(GameStore.state, GameStore.serverStateVersion)` | ✅ |
| タブを閉じる前（beforeunload）に 1 回 PUT | `domShell.ts` で `beforeunload` に `GameStore.flushServerSave()` を登録 | ✅ |

### 2.3 PUT が 409 のとき（§7.3）

| 仕様 | 実装 | 結果 |
|------|------|------|
| 「データの更新がありました。タイトル画面に戻ります。」を表示 | `domShell.ts` の stale コールバックで `showMessageModal` に上記文言 | ✅ |
| タイトル画面に遷移 | 同一コールバックで `hideGameShell()` → `showTitleUI()` | ✅ |
| タイトルで GET を再度実行し最新 state, version で初期化 | モーダル OK 後に `getGameState()` → `setStateFromServer` → `GameStore.save()` | ✅ |

### 2.4 PUT が 200 のとき（§7.4）

| 仕様 | 実装 | 結果 |
|------|------|------|
| 返却 version を「取得済みバージョン」として保持 | `_flushServerSave` 内で `GameStore.serverStateVersion = r.version` | ✅ |

### 2.5 オフライン・保存失敗（§7.5）

| 仕様 | 実装 | 結果 |
|------|------|------|
| PUT 失敗時「保存に失敗しました。通信環境を確認のうえ、再度お試しください。」を表示 | `GameStore.setOnSaveFailedCallback` で上記文言のモーダルを表示（`domShell.ts`） | ✅ |
| 再試行時は同じ version で再度 PUT 可能 | 失敗時は `serverStateVersion` を更新しないため、次回 save で同じ version を送信 | ✅ |

### 2.6 メッセージ文案（§9）

| 場面 | 仕様例 | 実装 | 結果 |
|------|--------|------|------|
| 409 | 「データの更新がありました。タイトル画面に戻ります。」 | 同一文言 | ✅ |
| 保存失敗 | 「保存に失敗しました。通信環境を確認のうえ、再度お試しください。」 | 同一文言 | ✅ |

### 2.7 localStorage と「正」（§10）

| 仕様 | 実装 | 結果 |
|------|------|------|
| 「正」は常にサーバー。タイトル戻り後は必ず GET で最新取得 | 409 時はタイトル遷移後に GET → setStateFromServer。接続時は SIWE 後 GET → setStateFromServer | ✅ |
| オフライン用キャッシュ等に localStorage 利用可 | 接続時・409 再取得後に `GameStore.save()` で localStorage にキャッシュ | ✅ |

---

## 3. API クライアント（gameStateApi.ts）

| 項目 | 実装 | 結果 |
|------|------|------|
| GET: credentials include、401 時 ok: false | `getGameState()` で `credentials: "include"`、401 で `{ ok: false, error: "Not logged in." }` | ✅ |
| PUT: 409 時 stale: true を返す | 409 かつ body.code === 'STALE_DATA' のとき `stale: true` を付与 | ✅ |
| PUT 200 時返却 version をそのまま利用 | 呼び出し側で `GameStore.serverStateVersion = r.version` に反映 | ✅ |

---

## 4. 結論

- **サーバー**: GET/PUT の認証、初期状態・version 1、409/STALE_DATA、PUT 検証はいずれも仕様どおり。
- **クライアント**: 接続時の SIWE → GET → setStateFromServer、デバウンス保存・beforeunload、409 時のメッセージ・タイトル遷移・再 GET、保存失敗メッセージ、表示の正をサーバーにすることはいずれも仕様どおり。

**仕様通りに実装されていると判断できる。** 不具合報告（PC ログインでデータが初期化されていない）に対する修正（接続直後の SIWE 実行と GET 成功後の setStateFromServer + save）も、この照合結果と整合している。
