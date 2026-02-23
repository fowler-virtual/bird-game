# Claim 根本究明：責務・失敗原因・E2E 差・再現と解消

**目的**: 「Claim が本番で失敗するのに E2E で通る」事象を、責務・原因・E2E の差・再現方法の 4 点から整理し、E2E で本番と同じ経路を検証して解消する。

---

## 1. そもそも Claim で何をすべきか（責務と正しい処理）

### 1.1 ユーザー視点の「成功」

- ユーザーが **Claim** を押す → 確認 → **ウォレットでトランザクション承認** → オンチェーンで `transferFrom(pool, user, amount)` が成功し、**$SEED がウォレットに届く**。画面には「Claim successful」が表示される。

### 1.2 システムが行うべき処理の流れ

| 段階 | 責務 | 実装場所 |
|------|------|----------|
| 1 | クライアントが **未送信のゲーム状態をサーバーに反映** する（claimable の元データを揃える） | `flushServerSync()` → PUT /api/game-state。409 時は GET して version を合わせて再 PUT。 |
| 2 | サーバーが **そのアドレスの claimable** を計算する（game-state の seed − claimed − reserved） | `getClaimableAsync(address)`。getAsync(address) で game-state 取得。 |
| 3 | サーバーが **署名する量をオンチェーンと整合** させる（transferFrom が revert しないようにする） | `getPoolBalanceAndAllowanceWei()` で min(balance, allowance) を取得し、署名量をその以下にキャップ。 |
| 4 | サーバーが **reserve して EIP-712 署名** を返す | `reserve()` → `capReservationAmount()` → 署名。 |
| 5 | クライアントが **送信前に eth_call でシミュレート** し、revert する場合は送信しない | `executeClaim()` 内の `provider.call({ to, data, from })`。revert 時はユーザーにメッセージを表示して送信しない。 |
| 6 | クライアントが **sendTransaction** で送信し、確定を待つ | `signer.sendTransaction({ to, data, gasLimit })`。 |

この流れがすべて揃って初めて「Claim が成功する」状態になる。

---

## 2. なぜ今できていないか（本番で失敗する原因）

### 2.1 現象

- 本番で **Claim** を押すと「Claim failed」となり、コンソールに **`[Claim] Simulation revert: require(false)`** および **`/api/game-state` の 409** が出ることがある。

### 2.2 原因の整理

- **eth_call シミュレーションが revert** している。RPC が返す理由が `require(false)` で **revert データが空** なため、Solidity の `require("...")` ではなく **トークンコントラクトの transferFrom 内で revert** している可能性が高い（RewardClaim の require にはメッセージがあるため、それらで落ちていればデータが返る）。

- transferFrom が revert する典型的な理由は次の 3 つ：
  1. **請求量 > プールの $SEED 残高**
  2. **請求量 > プールが RewardClaim に渡す allowance**
  3. **トークン側の仕様**（fee-on-transfer・Pause・ホワイトリストなど）

- サーバーでは **min(プール残高, allowance)** でキャップしているが、次のずれで本番だけ失敗しうる：

  | 要因 | 説明 |
  |------|------|
  | **API の 15 秒キャッシュ** | Claim リクエスト時に古い balance/allowance を使って署名し、その間に他で Claim や approve 変更があると、実行時には amount > 実残高 or 実 allowance になる。 |
  | **署名発行から実行までの遅延** | ユーザーが署名取得後にしばらく待ってから送信すると、その間にプール残高や allowance が減る。 |
  | **409 と game-state の不整合** | flushServerSync が 409 のあと GET→再 PUT で成功しても、その直後の requestClaim で読む game-state が別リクエスト・レプリカ遅延で古い可能性がある（claimable が過大になることは稀だが、データソースが PUT と GET でずれる可能性はある）。 |
  | **E2E と本番の環境の差** | E2E は多くの場合 **E2E_REWARD_CLAIM_ADDRESS を未設定** で回しており、**本番と同じ Claim 経路（実 RPC での eth_call / 送信）を一度も通していない**。 |

- したがって「今できていない」理由は、  
  **(A) 署名時点と実行時点でのオンチェーン状態のずれ（キャッシュ・時間差）** と、  
  **(B) E2E が本番と同じ Claim 経路を検証しておらず、そのずれをテストで検知できていない** の両方、と整理できる。

---

## 3. なぜ E2E では再現されないか

### 3.1 E2E の現在の動き

- **E2E_BASE_URL** だけ設定し、**E2E_REWARD_CLAIM_ADDRESS** を **設定しない** 場合：
  - フルフローでは Connect → ガチャ → 配置 → SAVE まで実行するが、
  - **assertClaimEnvReady** と **assertClaimSimulationSucceeds** は **スキップ** される（`if (!claimAddress || ...) return;`）。
  - Claim ボタンを押したあとの結果も「Claim successful / Nothing to claim / Claim failed」のいずれかが出ればよく、**「Claim failed ならテスト失敗」のチェックもスキップ**される（`if (process.env.E2E_REWARD_CLAIM_ADDRESS && msg && /Claim failed/i.test(msg))` のため）。

- その結果、**本番で起きている「シミュレーション revert → Claim failed」は、E2E で再現も検証もされていない**。E2E は「モックで Claim ボタンが押せて何かメッセージが出る」程度しか見ておらず、本番のオンチェーン条件（プール残高・allowance・実 RPC での eth_call）を通過していない。

### 3.2 まとめ

- **E2E で再現されない理由**は、  
  **E2E_REWARD_CLAIM_ADDRESS が未設定のまま E2E を回しているため、本番と同じ「API で署名取得 → 実 RPC で eth_call シミュレーション → 送信」の経路が一度も実行されず、本番で起きている revert が E2E で再現・検知されていない**、という一点に集約できる。

---

## 4. どうしたら E2E で再現し、解消できるか

### 4.1 E2E で本番と同じ Claim 経路を必ず通す

- **E2E_BASE_URL を設定してデプロイ先に対して E2E を回す場合は、E2E_REWARD_CLAIM_ADDRESS も必須とする。**
  - こうすると、その E2E 実行では必ず **assertClaimEnvReady**（signer 一致・プール残高 > 0・allowance > 0）と **assertClaimSimulationSucceeds**（API から署名取得 → 実 RPC で eth_call）が走る。
  - 本番と同じコントラクト・同じ RPC を使っていれば、**本番で revert する条件（プール不足・allowance 不足など）があれば E2E も失敗**し、E2E が「Claim を解消した」ことを示す gate になる。

- 運用方針：
  - **E2E_BASE_URL を設定する場合は、必ず E2E_REWARD_CLAIM_ADDRESS も設定して E2E を実行する**（本番デプロイ前の確認や CI でデプロイ先を叩く場合など）。
  - E2E_BASE_URL はあるが E2E_REWARD_CLAIM_ADDRESS がない場合は、**テストを失敗させる**（「Claim 検証をスキップしている」と明示する）。これにより「E2E は通ったが本番で Claim が失敗する」というギャップを防ぐ。

### 4.2 署名量とオンチェーン状態のずれを潰す

- **API（Claim 時はキャッシュを使わない）**  
  - 署名を発行する直前に、**キャッシュをバイパス**して `getPoolBalanceAndAllowanceWei()` を呼ぶ。  
  - これで「署名時点の min(残高, allowance)」が可能な限り最新になり、transferFrom の revert を減らす。

- **クライアント（送信前にオンチェーンと照合）**  
  - `executeClaim` で eth_call シミュレーションの**前**に、クライアント側で **getPoolBalanceAndAllowance()** を呼び、**signature.amountWei > min(balance, allowance)** なら送信せず、「プールまたは allowance が不足しています。しばらくしてから再試行してください」のように表示する。  
  - これで「署名は古いが実行時は不足」というケースを、送信前に弾ける。

### 4.3 解消の流れ

1. **E2E**: E2E_BASE_URL 設定時は E2E_REWARD_CLAIM_ADDRESS を必須にし、未設定ならテスト失敗とする。  
2. **API**: Claim ハンドラ内で balance/allowance 取得時にキャッシュバイパスする。  
3. **Client**: executeClaim 内で、シミュレーション前に amount とオンチェーンの min(balance, allowance) を比較し、超過時は送信しない。  
4. 本番と同一（または同一コントラクト・RPC）で E2E を回し、**E2E が通ったら「本番でも同じ Claim 経路が通る」とみなす**。

---

## 5. 関連ファイル

| 種類 | パス |
|------|------|
| Claim 実行・シミュレーション | `src/rewardClaim.ts` |
| Claim フロー（flushServerSync → requestClaim） | `src/domShell.ts` |
| Claim API・reserve・キャップ | `api/claim.js` |
| プール残高・allowance（API） | `api/_lib/poolBalance.js` |
| E2E フルフロー・assertClaimEnvReady・assertClaimSimulationSucceeds | `e2e/full-flow.spec.ts` |
| 引き継ぎ・経緯 | `docs/CLAIM_DEBUG_HANDOFF.md` |

---

更新: 責務・失敗原因・E2E で再現しない理由・再現と解消方針を整理。
