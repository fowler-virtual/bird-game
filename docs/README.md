# Bird Game ドキュメント

このフォルダ（`docs/`）を**ドキュメントの格納先**として集約する。コンテキスト・ToDo・仕様・進捗などはここに置き、参照時はこの一覧から探す。

**新セッションで開発を続けるとき**: まず **`docs/SESSION_START.md`** を参照し、そこに書かれた順にドキュメントを読み込む（Cursor のルールで「開発を続けます」「コンテキストを読み込んで」等の依頼時に自動で参照する想定）。

---

## 格納方針

| 方針 | 内容 |
|------|------|
| **格納先** | プロジェクト直下の **`docs/`** に統一する。製造責任と運用ルール（`RESPONSIBILITY_AND_RULES.md`）もここに含め、端末移行・新セッションのどちらも clone と「コンテキストを読み込んで」で揃う。 |
| **新規作成** | 新規ドキュメントは `docs/` に追加し、内容や日付が分かるファイル名を付ける（例: `CONFIRMATION_2025-02-17.md`）。 |
| **Cursor ルール** | `.cursor/rules/*.mdc` は **リポジトリに含める**（.gitignore で `.cursor/*` を無視しつつ `!.cursor/rules/` で除外）。端末を替えても `git clone` で同じルールが使える。 |

---

## ドキュメント一覧（docs/ 内）

### 仕様・要件・設計

| ファイル | 概要 |
|----------|------|
| **`REQUIREMENTS.md`** | **要件の集約**。対応環境・最優先目標・製品仕様要約・DoR・監査合意方針・参照一覧。 |
| `TODO.md` | 残タスク・将来実装候補。① (PC/スマホ parity) 達成済み。次はゲームバランス・エコノミクス。 |
| `GAME_STATE_SYNC_SPEC.md` | ゲーム状態同期の設計仕様。サーバー権威化・CAS・409 処理。 |
| `DEV_FLOW_AND_MOBILE.md` | 開発フローとスマホ・メタマスク検証の方針。エミュレーターでの確認手順など。 |
| `DEV_PROCESSES.md` | 開発プロセス・進め方のメモ。 |
| `ASSET_SPEC.md` | アセット仕様。 |
| `BIRD_IMAGE_PROMPT.md` | 鳥画像用プロンプト等。 |
| `SPRITE_LAYOUT_OPTIONS.md` | スプライトレイアウトの選択肢。 |
| `CLAIM_SAFETY_DESIGN.md` | Claim まわりの安全設計・変更一覧。 |
| `CLAIM_AND_DEPLOY.md` | Claim とデプロイに関するメモ。 |
| `CLAIM_DEBUG_HANDOFF.md` | Claim 不具合の引き継ぎ（解決済み）。根本原因・対応内容の記録。 |
| `CLAIM_ROOT_CAUSE_AND_E2E.md` | Claim 根本原因の詳細分析と E2E テスト設計。 |
| `TOKEN_LOCAL.md` | トークン（ローカル）まわりの仕様・メモ。 |
| `VERCEL_ENV_VARS.md` | Vercel 環境変数の一覧と説明。 |
| `VERCEL_VITE_CLAIM_API_URL.md` | VITE_CLAIM_API_URL の設定手順。 |

### 検証・監査・E2E

| ファイル | 概要 |
|----------|------|
| `PATH_TO_VERIFICATION.md` | ① チェックリスト（達成済み）とブロッカー対応の記録。 |
| `VERIFICATION.md` | 修正後の検証チェックリスト。 |
| `E2E_DEFINITION.md` | E2E テストの定義。シナリオ 1〜9 のカバー範囲。 |
| `GAME_STATE_SYNC_VERIFICATION.md` | ゲーム状態同期の検証結果。 |
| `AUDIT_RESPONSE.md` | 監査への対応。 |
| `AUDIT_REMEDIATION_PLAN.md` | 監査の是正計画。 |
| `FOR_REVIEWERS.md` | レビュアー向け説明。 |

（検証開始条件 DoR は `REQUIREMENTS.md` に集約済み。）

### セッション開始時・ルール・引き継ぎ

| ファイル | 概要 |
|----------|------|
| `SESSION_START.md` | **新セッションで最初に読む一覧**。ルール・格納先・ToDoを読み込む順序とパス。 |
| `RESPONSIBILITY_AND_RULES.md` | **製造責任と運用ルール**。返答前に必ず参照する。端末移行後も clone で同じ内容が使える。 |
| **`HANDOVER.md`** | **開発引き継ぎ用**。プロジェクト格納場所・動作環境・動かし方・環境変数・アーキテクチャ概要。 |

### 進捗・確認・メモ

| ファイル | 概要 |
|----------|------|
| `CONFIRMATION_2025-02-17.md` | 不具合3件（リセット・初回ガチャ暗転・初回デッキ SAVE）の確認結果。 |
| `FIX_RESET_BUTTON_2025-02-17.md` | リセットボタン仕様と実装の記録。 |
| `CHANGE_CONFIRMATION_PENDING_NONCE.md` | pending nonce 対応の変更記録。 |
| `SIWE_PENDING_NONCE_SERVER.md` | SIWE pending nonce のサーバー側対応。 |
| `GAME_STATE_SYNC_EVALUATION.md` | ゲーム状態同期の評価・比較メモ。 |
| `CHECK_GAME_STATE_ON_MOBILE.md` | モバイルでのゲーム状態確認手順。 |

### その他

| ファイル | 概要 |
|----------|------|
| **`HANDOFF_TO_CLAUDE.md`** | **Claude への開発引き継ぎ用プロンプト**。そのままコピーして Claude に渡す。 |
| `PROJECT_STATE` | プロジェクト状態のスナップショット。 |
| `GIT_IGNORE_UNTrack.md` | Git の ignore / 未追跡に関するメモ。 |
| `why-hyperfarm-layout-works-vs-ours.md` | レイアウト比較のメモ。 |

---

## リポジトリ直下

- **`README.md`** … 起動方法・仕様概要・ビルド・検証手順。`docs/` の詳細はこの `docs/README.md` を参照。

---

更新日: 2026-02-27（① 達成、サーバー権威化・モバイル対応完了）
