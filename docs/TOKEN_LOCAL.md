# ローカルで $SEED トークンを試す

**クイック手順**: `npm install` → `npm run compile` → 別ターミナルで `npm run chain` → もう一つのターミナルで `npm run deploy:seed` → MetaMask にローカルネットワークとトークンアドレスを追加。

---

## 1. 依存関係のインストール

```bash
npm install
```

## 2. コントラクトのコンパイル

```bash
npm run compile
```

## 3. ローカルチェーンの起動

**別ターミナル**で以下を実行し、起動したままにします。

```bash
npm run chain
```

- ローカルノードが `http://127.0.0.1:8545` で起動します。
- デフォルトで 20 個のアカウントが用意され、それぞれにテスト用 ETH が入っています。

## 4. $SEED のデプロイとミント

**もう一つのターミナル**で:

```bash
npm run deploy:seed
```

- `SeedToken` がデプロイされ、デプロイ元アドレスに 1,000,000 $SEED がミントされます。
- コンソールに `SEED_TOKEN_ADDRESS=0x...` が表示されるので、このアドレスを控えておきます。
- ゲーム内で $SEED 残高を表示するには、プロジェクト直下に `.env` を作成し、`VITE_SEED_TOKEN_ADDRESS=0x...`（デプロイ時に表示されたアドレス）を書いておきます。`.env.example` をコピーして編集してください。
- ガチャ・Loft 支払いでチェーン送金するには、`VITE_SEED_TREASURY_ADDRESS=0x...`（$SEED を受け取るアドレス。ローカルでは Hardhat の Account #0 など）も設定します。

## 5. MetaMask をローカルに接続

1. MetaMask で「ネットワークを追加」→「ネットワークを手動で追加」を開く。
2. 以下を入力:
   - **ネットワーク名**: Localhost 31337
   - **RPC URL**: `http://127.0.0.1:8545`
   - **チェーンID**: `31337`
   - **通貨記号**: ETH
3. 保存する。

4. （任意）Hardhat のアカウントを使う場合:
   - `npm run chain` を実行したターミナルに、Account #0 の秘密鍵が表示されています。
   - MetaMask で「アカウントのインポート」→ その秘密鍵を貼り付けると、デプロイした $SEED が表示されます。

5. トークン表示:
   - MetaMask の「トークンをインポート」で、`SEED_TOKEN_ADDRESS` で表示されたコントラクトアドレスを入力する。
   - シンボルは SEED、小数点は 18 です。

## 6. ゲーム側での利用（次のステップ）

- フロントで「ウォレット接続後、`SEED_TOKEN_ADDRESS` の `balanceOf(ユーザーアドレス)` を読んで表示」する処理を追加すると、ローカルで持っている $SEED がゲーム内残高として表示されます。
- ガチャや Loft アップグレードの支払いは、`transfer` や `approve` + `transferFrom` で実装できます。
- Claim は、コントラクトの `mint(ユーザー, 量)` をゲーム用のオーナーアドレスから呼ぶ形で実装できます（本番ではバックエンドや専用の Claim コントラクトに任せる想定）。

## 7. Claim をローカルで動かす（ガス代はユーザー負担）

Claim は **RewardClaim コントラクト**経由で行います。API は署名だけを返し、ユーザーがブラウザから `claim(amount, nonce, v, r, s)` を送るため、**ガス代はユーザー負担**です。

**重要（デプロイ順）**  
チェーンを起動したら、**必ず次の順で一度だけ**実行してください。順序を間違えると Claim や残高が動きません。  
`1. deploy:seed` → `2. deploy-reward-claim` → `3. approve-claim` → `4. fund-pool`

1. **依存の追加**（未インストールの場合）  
   ```bash
   npm install
   ```

2. **.env に Claim 用の変数を追加**（`.env.example` を参照）  
   - **報酬プール＝Account #2**。`REWARD_POOL_PRIVATE_KEY` に Account #2 の秘密鍵を設定（`npm run accounts` で表示）。
   - **Claim 署名者も Account #2 でよい**。`CLAIM_SIGNER_PRIVATE_KEY` に同じ Account #2 の秘密鍵を設定。
   - `OWNER_PRIVATE_KEY` … SeedToken の owner（Account #0）の秘密鍵。`npm run fund-pool` でプールへ mint するのに使用。
   - `RPC_URL` … `http://127.0.0.1:8545`
   - `SEED_TOKEN_ADDRESS` … SeedToken のアドレス（`VITE_SEED_TOKEN_ADDRESS` と同じでよい）
   - `VITE_CLAIM_API_URL` … `http://localhost:3001`
   - `VITE_REWARD_CLAIM_ADDRESS` … 後述の「RewardClaim デプロイ」で表示されるアドレスを設定。

3. **SeedToken のデプロイ**（まだなら先に実行）  
   ```bash
   npm run deploy:seed
   ```  
   表示された `SeedToken deployed to: 0x...` を .env の `SEED_TOKEN_ADDRESS` / `VITE_SEED_TOKEN_ADDRESS` に設定。

4. **RewardClaim のデプロイ**（SeedToken の直後に必ず実行）  
   ```bash
   npm run deploy-reward-claim
   ```  
   表示される `RewardClaim deployed to: 0x...` を .env の `REWARD_CLAIM_ADDRESS` / `VITE_REWARD_CLAIM_ADDRESS` に追加（SeedToken のアドレスと混同しないこと）。

5. **報酬プールから RewardClaim への approve**  
   ```bash
   npm run approve-claim
   ```  
   .env に `REWARD_CLAIM_ADDRESS` を設定済みであること。

6. **報酬プールへの入金**  
   ```bash
   npm run fund-pool
   ```  
   Account #2（プール）に $SEED を mint します。Claim 時はこのプールから `transferFrom` でユーザーへ送金されます。

7. **Claim API を起動**（別ターミナルで）  
   ```bash
   npm run server
   ```  
   `Claim API listening on http://localhost:3001` と出れば OK。

8. **ゲームの起動**  
   ```bash
   npm run dev
   ```  
   ウォレット接続後、SEED を貯めて Claim を押すと、MetaMask で `claim(...)` トランザクションの承認が求められます。承認するとプールから $SEED が受け取れます（ガス代はユーザー負担）。
