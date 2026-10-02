require("@nomicfoundation/hardhat-toolbox");

/**
 * BegFi contracts. Robinhood Chain (mainnet): chain id 4663, native asset ETH.
 *
 * Mirrors bug-protocol's config, including the trick that makes local testing
 * worth anything here: the in-process network and `localhost` both run at
 * chainId 4663, the SAME as Robinhood Chain. The web app resolves contract
 * addresses from NEXT_PUBLIC_* env vars, so pointing those at a local node runs
 * the entire send flow in a browser with no application edits at all.
 *
 * Nothing here deploys to mainnet as part of this build. The `robinhood` network
 * exists so that a deploy is a deliberate, separate act, and the key is read
 * from the environment and never committed — unset means the account list is
 * empty and any mainnet deploy fails loudly rather than silently.
 */
const deployerKey = process.env.BEG_DEPLOYER_KEY;

module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Robinhood Chain is an Arbitrum Orbit L2; cancun is safe here.
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 4663,
    },
    localhost: {
      url: process.env.BEG_LOCAL_RPC_URL || "http://127.0.0.1:8545",
      chainId: 4663,
    },
    /**
     * Robinhood Chain TESTNET — chainId 46630, i.e. the mainnet id with a zero
     * appended. Free ETH from a faucet, real transactions, no real money.
     *
     * This is where `npm run deploy:testnet` goes, and it is the only way to
     * exercise the whole product honestly before mainnet: a real wallet, a real
     * send, a real indexer run. Nothing here can cost anyone anything.
     */
    robinhoodTestnet: {
      url: process.env.BEG_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts: deployerKey ? [deployerKey] : [],
    },
    robinhood: {
      url: process.env.BEG_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts: deployerKey ? [deployerKey] : [],
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
  },
};
