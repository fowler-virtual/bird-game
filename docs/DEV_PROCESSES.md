# 開発時に立ち上げるプロセス一覧

ゲーム開発・Claim テストで使うプロセスを整理したものです。

## 何を起動するか

| ターミナル | コマンド | 役割 | 必須なとき |
|-----------|----------|------|------------|
| **1. チェーン** | `npm run chain` | ローカルブロックチェーン（Hardhat）。$SEED の送受信先。 | ローカルでガチャ・Claim・Upgrade するとき |
| **2. Claim API** | `npm run server` | Claim 用 API（localhost:3001）。ゲーム内 SEED を $SEED でミント。 | **Claim ボタン**を使うとき |
| **3. ゲーム** | `npm run dev` | フロント（Vite）。ブラウザで http://localhost:5173 を開く。 | いつも |

## 起動順の目安

1. **チェーン** → `npm run chain`（ずっと起動したまま）
2. **Claim API** → `npm run server`（Claim したいときだけ）
3. **ゲーム** → `npm run dev`（開発中ずっと）

## いま何が必要？

- **ブラウザでゲームを触るだけ** → `npm run dev` だけで OK
- **Claim ボタンで $SEED を受け取りたい** → 上に加えて `npm run server`
- **ローカルでガチャ・Upgrade まで試す** → さらに `npm run chain`（先に `npm run deploy:seed` で $SEED コントラクトをデプロイ）

## 全部止めたいとき

各ターミナルで **Ctrl+C** を押すと、そのプロセスだけ止まります。  
（チェーンを止めると、再度 `npm run chain` → `npm run deploy:seed` が必要になります。）
