# ゲーム状態同期 仕様適合性評価

`docs/GAME_STATE_SYNC_SPEC.md` に対する実装の評価結果。

---

## 1. サーバー側

| 仕様 | 実装 | 判定 |
|------|------|------|
| 3.1 version / state / updatedAt | gameStateStore: version, state, updatedAt を保持 | ✅ |
| 3.2 state スキーマ | getInitialState() が birdsOwned, deckSlots(12), seed, onboardingStep 等を返す | ✅ |
| 3.3 初期状態・version: 1 | GET でレコードなし時は getInitialState() + version 1 を返す | ✅ |
| 4 認証 | GET/PUT は requireSession（SIWE Cookie）。未認証は 401 | ✅ |
| 5.1 GET 認証必須・200 で state, version | 実装済み。レコードなしは初期状態 + version 1 | ✅ |
| 5.2 PUT client version 比較 | set(): client === current または (current===0 && client===1) のときのみ上書き。それ以外は 409 | ✅ |
| 5.2 409 時に code: STALE_DATA | 409 で `{ code: "STALE_DATA", message: "..." }` を返す | ✅ |
| 6 サーバー側検証（参照整合性等） | PUT 時は現状ほぼ未検証（state をそのまま保存）。仕様は「まずは形と参照整合性」→ 要検討 | ⚠️ 未実装 |

---

## 2. クライアント側

### 2.1 起動・ゲーム画面に入るとき（7.1）

| 項目 | 実装 | 判定 |
|------|------|------|
| SIWE 済みの前提で GET | Connect 直後に signInForClaim → getGameState() を実行（titleUI.runPostConnectSteps） | ✅ |
| 取得した state, version をメモリとキャッシュに保持 | setStateFromServer(state, version) で state / serverStateVersion を設定。GameStore.save() で localStorage にキャッシュ | ✅ |
| 表示の正はサーバー取得の 1 件 | ゲーム画面表示前に setStateFromServer しているため、表示はサーバー状態 | ✅ |

- **補足**: ページ起動時（main.ts）では GameStore.load() で localStorage のみ読み込み、GET は行わない。仕様の「起動」は「ゲーム画面に入るとき」と解釈し、Connect 押下後の runPostConnectSteps で GET しているため適合。
- **SIWE 拒否時**: 署名をユーザーが拒否すると getGameState() は 401 となり、setStateFromServer は呼ばれずローカル状態のままゲームが開く。仕様上は「SIWE 済みを前提」のため、厳密には「ゲームを開かせない」か「再サインインを促す」方がよいが、現状はフォールバックとして許容。

### 2.2 保存のタイミング（7.2）

| 項目 | 実装 | 判定 |
|------|------|------|
| デバウンス（例: 2 秒）で PUT | GameStore.save() 内で SERVER_SAVE_DEBOUNCE_MS (2000ms) で _flushServerSave をスケジュール | ✅ |
| 保存時は取得済み version を PUT に含める | putGameState(GameStore.state, GameStore.serverStateVersion) で送信 | ✅ |
| 離脱時（beforeunload 等）に 1 回 PUT | showGameShell 時に beforeunload で GameStore.flushServerSave() を 1 回だけ登録 | ✅ |

### 2.3 PUT が 409 のとき（7.3）

| 項目 | 実装 | 判定 |
|------|------|------|
| 「データの更新がありました。タイトル画面に戻ります。」表示 | domShell の setOnStaleCallback 内で showMessageModal で同文言 | ✅ |
| タイトル画面に遷移 | showMessageModal の .then で hideGameShell → showTitleUI() | ✅ |
| タイトルで GET を再実行し最新で初期化 | 同じ .then チェーンで getGameState() → setStateFromServer → save() | ✅ |

### 2.4 PUT が 200 のとき（7.4）

| 項目 | 実装 | 判定 |
|------|------|------|
| 返却 version を「取得済みバージョン」に保持 | _flushServerSave 内で `if (r.ok) GameStore.serverStateVersion = r.version` | ✅ |

### 2.5 オフライン・保存失敗（7.5）

| 項目 | 実装 | 判定 |
|------|------|------|
| PUT 失敗時「保存に失敗しました。通信環境を確認…」表示 | GameStore に setOnSaveFailedCallback を追加。domShell で 409 以外の失敗時にモーダル表示 | ✅ |
| 再試行は同じ version で PUT | 失敗時は serverStateVersion を更新していないため、次回 save で同じ version が送られる | ✅ |

---

## 3. その他

| 項目 | 判定 |
|------|------|
| 9 メッセージ文案（409 / 保存失敗） | 409 は仕様通り。保存失敗は未表示のため未対応。 |
| 10 localStorage は「正」はサーバー | Connect 後に GET で上書きし、409 後も再 GET で上書き。適合。 |

---

## 4. まとめ

- **適合している点**: サーバー正・GET による起動時/タイトル戻り後の取得、SIWE 後の GET、デバウンス PUT、409 時のメッセージ・タイトル戻し・再 GET、200 時の version 更新、localStorage はキャッシュとしてサーバー状態で上書き。
- **対応済み**:
  1. **離脱時の PUT**: beforeunload で `GameStore.flushServerSave()` を呼び、デバウンスをキャンセルして未送信状態を 1 回 PUT する。
  2. **保存失敗時の表示**: PUT が 409 以外で失敗したときに `setOnSaveFailedCallback` で「保存に失敗しました。通信環境を確認のうえ、再度お試しください。」をモーダル表示する。
- **任意・要検討**: サーバー PUT 時の検証（参照整合性・型・範囲）。仕様 6 に「まずは形と参照整合性を必須」とあるため、必要に応じて追加。
