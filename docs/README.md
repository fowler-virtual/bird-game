# Bird Game ドキュメント

このフォルダ（`docs/`）を**ドキュメントの格納先**として集約する。コンテキスト・ToDo・仕様・進捗などはここに置き、参照時はこの一覧から探す。

---

## 格納方針

| 方針 | 内容 |
|------|------|
| **格納先** | プロジェクト直下の **`docs/`** に統一する。 |
| **新規作成** | 新規ドキュメントは `docs/` に追加し、内容や日付が分かるファイル名を付ける（例: `CONFIRMATION_2025-02-17.md`）。 |
| **他場所** | 製造責任と運用ルールは **worktree 側**にあり、本リポジトリの `docs/` には含めない。参照先: `C:\Users\yuta_\.cursor\worktrees\bird-game\rme\docs\RESPONSIBILITY_AND_RULES.md`。 |

---

## ドキュメント一覧（docs/ 内）

### 仕様・要件・設計

| ファイル | 概要 |
|----------|------|
| `TODO.md` | 残タスク・将来実装候補。最優先は Git 版＋スマホメタマスクでローカルと同様に動かすこと。 |
| `DEV_FLOW_AND_MOBILE.md` | 開発フローとスマホ・メタマスク検証の方針。エミュレーターでの確認手順など。 |
| `DEV_PROCESSES.md` | 開発プロセス・進め方のメモ。 |
| `ASSET_SPEC.md` | アセット仕様。 |
| `BIRD_IMAGE_PROMPT.md` | 鳥画像用プロンプト等。 |
| `SPRITE_LAYOUT_OPTIONS.md` | スプライトレイアウトの選択肢。 |
| `CLAIM_SAFETY_DESIGN.md` / `CLAIM_SAFE_DESIGN.md` | Claim まわりの安全設計。 |
| `CLAIM_AND_DEPLOY.md` | Claim とデプロイに関するメモ。 |
| `TOKEN_LOCAL.md` | トークン（ローカル）まわりの仕様・メモ。 |

### 検証・監査

| ファイル | 概要 |
|----------|------|
| `VERIFICATION_READINESS.md` / `VERIFICATION_READY.md` | 検証開始条件（DoR）とスモークテストの手順。 |
| `VERIFICATION.md` | 検証内容のメモ。 |
| `AUDIT_RESPONSE.md` | 監査への対応。 |
| `AUDIT_REMEDIATION_PLAN.md` | 監査の是正計画。 |
| `FOR_REVIEWERS.md` | レビュアー向け説明。 |

### 進捗・確認・メモ

| ファイル | 概要 |
|----------|------|
| `CURSOR_PROGRESS.md` | E2E CI 失敗対応などの進捗ログ。 |
| `CONFIRMATION_2025-02-17.md` | 不具合3件（リセット・初回ガチャ暗転・初回デッキ SAVE）の確認結果。 |
| `FIX_RESET_BUTTON_2025-02-17.md` | リセットボタン仕様（切断→タイトル、ゲームデータ初期化→次回接続で初回ガチャ）と実装の記録。 |

### その他

| ファイル | 概要 |
|----------|------|
| `GIT_IGNORE_UNTrack.md` | Git の ignore / 未追跡に関するメモ。 |
| `why-hyperfarm-layout-works-vs-ours.md` | レイアウト比較のメモ。 |

---

## リポジトリ直下

- **`README.md`** … 起動方法・仕様概要・ビルド・検証手順。`docs/` の詳細はこの `docs/README.md` を参照。

---

## 本リポジトリ外で参照するドキュメント

| 場所 | ファイル | 用途 |
|------|----------|------|
| worktree (rme) | `docs/RESPONSIBILITY_AND_RULES.md` | 製造責任と運用ルール。製造担当は返答前に参照する。 |

更新日: 2025-02-17
