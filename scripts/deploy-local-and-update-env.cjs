/**
 * サービス再起動後用: SeedToken と NetworkState を localhost にデプロイし、.env を更新する。
 * 使い方: 先に npm run chain でノードを起動しておき、別ターミナルで
 *   npm run deploy:local
 * を実行。完了後は Vite を再起動（npm run dev）するとフロントが新しいアドレスを読む。
 */
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");

function run(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: ROOT,
    encoding: "utf8",
    ...opts,
  });
}

function updateEnv(updates) {
  let content = "";
  try {
    content = fs.readFileSync(ENV_PATH, "utf8");
  } catch (e) {
    console.error(".env を読めません:", e.message);
    process.exitCode = 1;
    return;
  }
  const keys = new Set(Object.keys(updates));
  const lines = content.split(/\r?\n/);
  const out = [];
  let replaced = new Set();
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && keys.has(m[1])) {
      out.push(`${m[1]}=${updates[m[1]]}`);
      replaced.add(m[1]);
    } else {
      out.push(line);
    }
  }
  for (const k of keys) {
    if (!replaced.has(k)) out.push(`${k}=${updates[k]}`);
  }
  fs.writeFileSync(ENV_PATH, out.join("\n") + "\n", "utf8");
  console.log(".env を更新しました。");
}

async function main() {
  console.log("1/2 SeedToken をデプロイ中...");
  let seedOut;
  try {
    seedOut = run("npx hardhat run scripts/deploy-seed.cjs --network localhost");
  } catch (e) {
    console.error("SeedToken デプロイ失敗。chain (npm run chain) が起動しているか確認してください。");
    console.error(e.stdout || e.message);
    process.exitCode = 1;
    return;
  }
  const seedMatch = seedOut.match(/SeedToken deployed to:\s*(0x[a-fA-F0-9]{40})/);
  if (!seedMatch) {
    console.error("SeedToken のアドレスを取得できませんでした。");
    process.exitCode = 1;
    return;
  }
  const seedAddress = seedMatch[1];
  console.log("SeedToken:", seedAddress);

  console.log("2/2 NetworkState をデプロイ中...");
  let networkOut;
  try {
    networkOut = run("npx hardhat run scripts/deploy-network-state.cjs --network localhost");
  } catch (e) {
    console.error("NetworkState デプロイ失敗。");
    console.error(e.stdout || e.message);
    process.exitCode = 1;
    return;
  }
  const networkMatch = networkOut.match(/NetworkState deployed to:\s*(0x[a-fA-F0-9]{40})/);
  if (!networkMatch) {
    console.error("NetworkState のアドレスを取得できませんでした。");
    process.exitCode = 1;
    return;
  }
  const networkAddress = networkMatch[1];
  console.log("NetworkState:", networkAddress);

  updateEnv({
    VITE_SEED_TOKEN_ADDRESS: seedAddress,
    SEED_TOKEN_ADDRESS: seedAddress,
    NETWORK_STATE_ADDRESS: networkAddress,
    VITE_NETWORK_STATE_ADDRESS: networkAddress,
  });

  console.log("\n完了。Vite を再起動（npm run dev を止めてから再度起動）すると反映されます。");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
