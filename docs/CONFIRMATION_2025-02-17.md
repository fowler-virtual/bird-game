# 確認結果（2025-02-17）

依頼された不具合3件について、コード上の事実を確認した結果を記録する。**推測は明示し、修正は行っていない。**

---

## 1. リセットボタンが正しく機能しない（初回ガチャ画面にならない）

### 現状の実装

- **リセットボタン**: `index.html` の `dom-debug-reset-disconnect`（DEBUG タブ内）。`domShell.ts` の `initDebugPaneListeners()` でクリックリスナーを登録。
- **クリック時の処理**（`domShell.ts` 1467–1488 行付近）:
  1. 確認ダイアログで OK なら、接続中なら `GameStore.clearCurrentWalletData()`、未接続なら `GameStore.resetToInitial()` を実行。
  2. `clearNetworkStateCache()`、`sessionStorage` に SUPPRESS_CHAIN_DISPLAY_KEY を設定。
  3. `disconnectCallback` があればそれを実行。なければ `GameStore.disconnectWallet()` → `hideGameShell()` → `destroyPhaserGame()` → **`showTitleUI()`** → `revokeWalletPermissions()`。

つまり、**リセット後は必ずタイトル画面（Connect Wallet）に戻る**実装になっている。

- **期待されていた挙動（依頼者）**: リセット後に「初回ガチャ画面」になる。
- **初回ガチャ画面**: `onboardingStep === 'need_gacha'` のときに Adopt タブを開いた状態（初回用オーバーレイ・暗転あり）。`GameStore.resetToInitial()` は `defaultGameState()` を代入し、`defaultGameState()` は `onboardingStep: 'need_gacha'` を持つ（`GameStore.ts` 44–56 行付近）。しかしリセット後は **showTitleUI() によりゲームシェルが隠れ、タイトルに戻る**ため、need_gacha のゲーム画面は表示されない。

### 結論（確認範囲）

- リセット＝「状態を need_gacha に戻しつつ、ゲーム内で初回ガチャ画面（Adopt タブ＋オーバーレイ）を表示する」のか、  
  リセット＝「タイトルに戻すだけ」なのかは、**仕様の確認が必要**。
- 現状コードは「リセット → タイトルに戻す」のみ。need_gacha の画面を出すには、リセット後にタイトルに戻さずゲームシェルを表示し、`onboardingStep` を `need_gacha` にして Adopt タブを表示する経路が必要。

---

## 2. 初回ガチャの暗転範囲がおかしい

### 現状の実装

- **初回ガチャ用オーバーレイ**: `adopt-onboarding-overlay`（`index.html` 2029 行付近）。`shell-content-inner` の直下にあり、`position: absolute; inset: 0`（`index.html` 859–866 行付近）。親は `shell-content-inner`（`position: relative`）。
- **意図（コメント）**: 「オンボーディング暗転: コンテンツと一緒にスクロールするよう absolute（親は shell-content-inner）」。
- **表示条件**: `domShell.ts` の `updateAdoptOnboardingOverlay()`。`onboardingStep === 'need_gacha'` かつ Adopt タブがアクティブなときのみ表示。スポットライト（穴あき）の位置は `positionAdoptOnboardingOverlay()` で `adopt-cta-card` の `getBoundingClientRect()` から計算し、`adopt-onboarding-dim-spotlight` に top/left/width/height を設定。

### 想定される原因（コード上）

- 暗転の「範囲」は **shell-content-inner に対する absolute + inset:0** で決まる。つまり **ビューポート全体ではなく、シェル内のスクロール領域**に限定されている。スクロールやレイアウト（ヘッダー・タブ・ステータスパネルの高さなど）によって、見た目上の「暗転範囲」が期待とずれる可能性がある。
- スポットライト位置は `adopt-cta-card` 基準。Adopt タブのレイアウトやスクロール位置でカードの位置がずれると、穴の位置もずれる。

### 結論（確認範囲）

- 「おかしい」が「暗転が画面全体を覆わない」のか「穴の位置がずれる」のかは、**実機・環境ごとの再現条件の確認が必要**。
- 上記のとおり、暗転は shell-content-inner 内に限定されている事実は確認済み。

---

## 3. 初回デッキ編成画面の SAVE ボタンが出てこない

### 現状の実装

- **SAVE ボタン**: `loft-save-wrap` 内の `status-save-deck-btn`（`index.html` 1908–1910 行付近）。**Deck（LOFT）タブ内**の「Loft」セクションにあり、`deck-content-with-birds` 内。
- **表示制御**: `farmingView.updateSaveWrapVisibility()`（`farmingView.ts` 217–220 行付近）。  
  `saveWrap.style.display = hasNetworkStateContract() && GameStore.walletAddress ? 'flex' : 'none'`
- **呼び出しタイミング**: Deck タブ表示時（`domShell.ts` の `switchToTab('deck')`）で `deckView.refresh()` → `farmingView.updateSaveWrapVisibility()` が呼ばれる。`deckView.refresh()` 内でも同様に `updateSaveWrapVisibility()` が呼ばれる（`deckView.ts` 205 行付近）。

### 表示条件

- **hasNetworkStateContract()**: `networkState.ts` の `getContractAddress()` が `import.meta.env.VITE_NETWORK_STATE_ADDRESS` を参照。`.env` に `VITE_NETWORK_STATE_ADDRESS` が正しく設定されていないビルドでは **常に false** となり、SAVE は非表示。
- **GameStore.walletAddress**: 未接続のときは falsy となり、SAVE は非表示。

### need_save 時の流れ

- `onboardingStep === 'need_save'` のとき、`showGameShell()` 内で `firstTab = 'deck'` となり `switchToTab('deck')` が実行される（`domShell.ts` 1683–1685 行付近）。
- Deck タブでは `updateDeckPaneVisibility()` で「鳥を1羽以上持っている」場合は `deck-content-with-birds` を表示。need_save の時点ではすでに鳥を1羽置いている想定なので、Loft セクション（およびその中の `loft-save-wrap`）は表示される構造になっている。
- したがって、**SAVE が出てこない**場合は、次のいずれかが考えられる（コード上）:
  1. **VITE_NETWORK_STATE_ADDRESS が未設定**で `hasNetworkStateContract()` が false。
  2. **表示のタイミング**で何らかの理由により `updateSaveWrapVisibility()` が呼ばれていない、または別の処理で上書きされている（未確認のため要追加調査の可能性あり）。
  3. **CSS や DOM の親**により、ボタンが隠れている（未確認のため要追加調査の可能性あり）。

### 結論（確認範囲）

- SAVE 表示条件は「契約アドレスあり ＋ ウォレット接続済み」のみ。契約アドレスが無い環境では出ない設計。
- 過去バージョンでは出ていたとのことなので、**契約アドレスや表示ロジックの変更履歴**を確認すると原因に近づける可能性がある。

---

## 参照したファイル一覧

| ファイル | 参照箇所の概要 |
|----------|----------------|
| `src/titleUI.ts` | Connect、resetButton |
| `src/store/GameStore.ts` | defaultGameState, resetToInitial, onboardingStep |
| `src/domShell.ts` | リセットボタン、showGameShell, switchToTab, オンボーディングオーバーレイ、updateSaveWrapVisibility 呼び出し |
| `src/views/farmingView.ts` | updateSaveWrapVisibility の条件 |
| `src/views/deckView.ts` | refresh, need_place / need_save 時のオーバーレイと updateSaveWrapVisibility |
| `src/networkState.ts` | hasNetworkStateContract, getContractAddress |
| `index.html` | loft-save-wrap, adopt-onboarding-overlay, deck-onboarding-place-overlay, shell-content-inner |

---

## 修正・仕様確定（リセット）

- **2025-02-17**: リセットの仕様を「ウォレット切断してタイトルに戻す」「ゲームデータは初期化→次回接続で初回ガチャ」「オンチェーンは対象外」と確定。実装はこの仕様どおり（切断→タイトル）。詳細は **`docs/FIX_RESET_BUTTON_2025-02-17.md`** を参照。
2. **暗転範囲**: 再現環境（デバイス・画面サイズ・スクロール有無）の共有があれば、CSS/親要素の変更案を検討できる。
3. **SAVE ボタン**: 使用しているビルドで `VITE_NETWORK_STATE_ADDRESS` が設定されているか確認。設定済みでも出ない場合は、表示タイミングや CSS の追加調査が必要。
