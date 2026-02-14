# Claim 安全化 具体設計・変更一覧

A寄せ最小仕様に沿った Claim 周りの安全化。変更ファイルと実装順をまとめる。

---

## 変更ファイル一覧

| # | 種別 | ファイル | 内容 |
|---|------|----------|------|
| 1 | API | `api/claim.js` | 無効化フラグ、amount 拒否→差分署名・EIP-712・SIWE 検証・CORS/rate limit |
| 2 | API | `api/auth/nonce.js` (新規) | SIWE 用 nonce 返却 |
| 3 | API | `api/auth/verify.js` (新規) | SIWE 検証＋セッション確立 |
| 4 | API | `api/claimable.js` (新規) | GET で address の claimable 差分返却（認証必須想定） |
| 5 | サーバ | 永続層 | address ごと claimable_total, claimed_total, nonce。Vercel では KV や JSON ファイル等。ここでは `api/_store/` に JSON ファイル＋ロック想定（最小実装） |
| 6 | コントラクト | `contracts/RewardClaim.sol` | EIP-712 検証、deadline、campaignId 追加。新関数 claimEIP712 |
| 7 | フロント | `src/claimApi.ts` | requestClaim(address only)、SIWE 用 nonce/verify 呼び出し |
| 8 | フロント | 新規 | SIWE ログインフロー（Connect 後に署名→/auth/verify） |
| 9 | フロント | domShell 等 | Claim ボタンから SIWE 未ログインならログイン促す。署名取得→claim tx。期限切れ・0 の UX |
| 10 | UI | NetworkState 表示 | 「公式値ではない」明示 or 表示削除（どちらかで確定） |

---

## 実装順（依存関係）

1. **Claim API: 無効化＋amount 拒否** — 即時安全化。body.amount を使わない。CLAIM_DISABLED で 503。
2. **コントラクト: EIP-712 + deadline + campaignId** — 新 claimEIP712。既存 claim は残して無効化 or 削除。
3. **API: 永続層＋差分計算** — claimable_total, claimed_total, nonce を保持。B) 方式（deadline 短＋イベント検知で claimed 更新）で進める（実装が軽い）。
4. **API: SIWE** — /auth/nonce, /auth/verify。セッションは cookie または JWT（Vercel では cookie 推奨）。
5. **API: /claim 実装** — 認証必須、差分のみ EIP-712 署名、nonce 単調増加、CORS 固定、rate limit。
6. **フロント: SIWE ログイン** — Connect 後に SIWE 署名→verify→セッション。
7. **フロント: Claim フロー** — 認証済みで /claim 呼び出し、返却署名で claimEIP712 実行。期限切れ・0 のメッセージ。
8. **NetworkState** — UI に「公式値ではない」注釈 or 表示削除。

---

## 二重請求対策（採用方針）

**B) claimed_total 更新はチェーン成功検知後**

- 署名時に claimed_total は増やさない。
- nonce は 1 回限り使用（コントラクトで usedNonces）。
- deadline を短く（例: 5 分）にして、署名の流用・二重送信を抑止。
- バックエンドで「Claimed イベント」または「該当 nonce の on-chain 成功」を検知したら、そのタイミングで claimed_total を増やす（手動 or 定期ジョブ or webhook）。  
  最小実装では「署名発行時に nonce を消費し、同じ nonce では再署名しない」＋「後からイベント取り込みで claimed_total を更新するバッチを別途用意」でも可。  
  または「署名発行時に reserved を立てず、claimed_total の更新は管理者がイベントを見て手動で行う」でも仕様は満たす。
- より厳密には: 署名返却時に「この nonce で amount を予約した」とメモリ/DB に記録し、フロントが claim tx を送る。バックエンドがイベント/チェーンを監視し、成功したら claimed_total に加算し予約を消す。並列では同じ nonce を 2 回返さないので、二重成功は防げる。

今回の最小実装では以下とする：
- 署名時に nonce をインクリメントして使用。同じ address から同時に 2 回リクエストが来た場合は、2 回目は「差分 0」または「nonce は前回の次」で 1 回分の差分だけ返す（1 回目の署名でまだ claimed を増やしていないので、2 回目も同じ差分が計算される問題がある）。  
→ よって **reserve 方式**を簡略化: 署名を返すときに「この address のこの nonce で amount を発行した」を DB に記録（issued_claims テーブル）。claimed_total は「イベント確認済みのものだけ」加算する。同じ address から再度 /claim を叩いたときは、claimable_total - claimed_total - (未確定の issued 合計) で差分を計算する。这样就能防止并行请求导致的双重签名。
- つまり: **issued テーブル**に (address, nonce, amount, expires_at) を入れ、署名時に 1 行追加。差分は claimable_total - claimed_total - sum(issued の同一 address の amount)。イベント検知で claimed_total に加算し、該当 issued を削除 or 確定フラグを立てる。

実装量を最小にするなら: **nonce を 1 回限り使い、署名発行時に「この nonce をこの amount で使った」を DB に記録**。claimed_total は「オンチェーンで Claimed イベントを見た後」に更新する（手動スクリプト or 将来の cron）。同一 address で連続で /claim を呼ぶと、1 回目で差分 100 を署名して nonce を消費、2 回目は「差分 = claimable_total - claimed_total」だが、1 回目の claim がまだ on-chain で完了していないので claimed_total は増えていない。すると 2 回目も 100 が返ってしまう。  
→ 防ぐには: **署名発行時に「この address の未確定発行額」を加味する**。つまり issued を保持し、差分 = claimable_total - claimed_total - sum(issued for this address)。署名を返すときに issued に (address, nonce, amount) を追加。イベントで確定したら claimed_total += amount して issued から削除。これで並列・連続でも二重に同じ額を署名しない。

以上を設計に反映し、実装では「issued の記録」まで行う。イベント取り込みは「手動 or 別スクリプト」としてドキュメントに書く。
