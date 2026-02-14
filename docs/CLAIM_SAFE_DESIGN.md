# Claim 安全化 設計・変更一覧

## 目的
- Claim API の任意額署名脆弱性を解消
- クライアント改ざんで不正請求できない設計
- 署名は EIP-712 + deadline + domain(chainId, verifyingContract)

## 変更ファイル一覧

| 種別 | ファイル | 内容 |
|------|----------|------|
| コントラクト | contracts/RewardClaim.sol | 既に EIP-712 + deadline + campaignId 済み。変更なし。 |
| サーバ | server/index.cjs | SIWE(/auth/nonce, /auth/verify)、/claimable、/claim(reserve+EIP712)、/claim/confirm、CORS固定、rate limit、cookie session |
| ストア | server/claimStore.cjs | 既に reserve/confirm 済み。変更なし。 |
| API(Vercel) | api/claim.js | 本番用: 無効化 or 同一仕様に合わせる（別タスク可） |
| フロント | src/rewardClaim.ts | claim → claimEIP712(recipient, amount, nonce, deadline, campaignId, v, r, s)、postClaimConfirm 呼び出しは domShell 側 |
| フロント | src/domShell.ts | Claim フロー: getClaimable→確認→requestClaim(address)→executeClaim→postClaimConfirm。SIWE 未ログイン時は促す。 |
| フロント | src/claimApi.ts | 既に requestClaim(address)、getClaimable、postClaimConfirm 型あり。要確認。 |
| UI | index.html or domShell | NetworkState 表示に「公式値ではない」注釈を追加 |
| ドキュメント | docs/ | 動作確認手順・テスト観点を追記 |

## 実装順
1. rewardClaim.ts を claimEIP712 対応に変更
2. server/index.cjs を全面差し替え（SIWE + claim + claimable + confirm + CORS + rate limit）
3. domShell.ts の Claim フローをサーバ claimable + requestClaim(address) + postClaimConfirm に変更、SIWE 未時は促す
4. NetworkState 注釈追加
5. 動作確認手順・テスト観点ドキュメント
