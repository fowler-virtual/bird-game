/** @type import('hardhat/config').HardhatUserConfig */
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { SEPOLIA_RPC_URL, SEPOLIA_DEPLOYER_KEY } = process.env;

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  paths: {
    sources: "./contracts",
    artifacts: "./artifacts",
    cache: "./cache",
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    // テストネット用（GitHub に公開したフロントから使う想定）
    sepolia: {
      url: SEPOLIA_RPC_URL || "",
      accounts: SEPOLIA_DEPLOYER_KEY ? [SEPOLIA_DEPLOYER_KEY] : [],
    },
  },
};
