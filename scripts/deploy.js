#!/usr/bin/env node
/**
 * Deploy BegFi's contracts.
 *
 *   npm run deploy:local      an in-process/test node — free, safe
 *   npm run deploy:mainnet    Robinhood Chain mainnet (4663) — REAL MONEY
 *
 * What it deploys:
 *   - BegSplitterFactory, always. It deploys the splitter implementation once and
 *     hands out a clone per launch.
 *   - TestToken, ONLY against a local node. It is a stand-in for $BEG so the send
 *     flow can be exercised; it has an open mint and must never exist on a chain
 *     where it could be mistaken for the real thing. On mainnet this script
 *     refuses to deploy it, and $BEG is launched through Pons instead (spec §9.1).
 *
 * HOW TO TEST WITHOUT SPENDING ANYTHING. `npx hardhat node` runs at chainId 4663
 * — the SAME id as mainnet — so a local run exercises the identical code path
 * with the identical addresses. Set NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 and
 * NEXT_PUBLIC_BEG_TOKEN_ADDRESS to the TestToken address below and the whole
 * product runs in a browser for free.
 *
 * The deployer key comes from BEG_DEPLOYER_KEY. It is never logged, never
 * written, and never defaulted — with no key the account list is empty and the
 * run fails loudly before broadcasting anything.
 */
const hre = require("hardhat");

const CHAIN_NAMES = {
  4663: "Robinhood Chain MAINNET",
  31337: "local node",
};

async function main() {
  const network = hre.network.name;
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  const [deployer] = await hre.ethers.getSigners();

  const label = CHAIN_NAMES[Number(chainId)] ?? `unknown chain ${chainId}`;
  const isMainnet = Number(chainId) === 4663;

  console.log(`network   ${network}  (${label})`);
  console.log(`deployer  ${deployer ? deployer.address : "NO ACCOUNT — set BEG_DEPLOYER_KEY"}`);

  if (!deployer) {
    throw new Error("No deployer account. Set BEG_DEPLOYER_KEY in the shell that runs this.");
  }

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`balance   ${hre.ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    throw new Error(
      isMainnet
        ? "The deployer has no ETH on mainnet. Fund it before deploying — this costs real money."
        : "The deployer has no ETH on the local chain.",
    );
  }

  if (isMainnet) {
    console.log("");
    console.log("  *** MAINNET ***  This spends real ETH and writes a public contract.");
    console.log("  The splitter is NOT audited. Spec §13 makes that a hard gate before");
    console.log("  it can hold anyone's fees. Read the top of BegSplitter.sol first.");
    console.log("");
  }

  const Factory = await hre.ethers.getContractFactory("BegSplitterFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  const implementation = await factory.implementation();

  console.log("");
  console.log(`BegSplitterFactory   ${factoryAddress}`);
  console.log(`  implementation     ${implementation}`);
  console.log(`  deploy tx          ${factory.deploymentTransaction().hash}`);

  let tokenAddress = null;

  if (!isMainnet) {
    const Token = await hre.ethers.getContractFactory("TestToken");
    const token = await Token.deploy();
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();

    console.log("");
    console.log(`TestToken            ${tokenAddress}   (stand-in for $BEG, never for mainnet)`);
    console.log(`  supply             ${hre.ethers.formatEther(await token.totalSupply())} tBEG`);
    console.log(`  deploy tx          ${token.deploymentTransaction().hash}`);
  } else {
    console.log("");
    console.log("TestToken NOT deployed: $BEG is a Pons launch (spec §9.1), not our contract.");
  }

  console.log("");
  console.log("Put these in web/.env.local:");
  console.log(`  NEXT_PUBLIC_BEG_TOKEN_ADDRESS="${tokenAddress ?? ""}"`);
  if (!isMainnet) {
    console.log(`  NEXT_PUBLIC_RPC_URL="${hre.network.config.url}"`);
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
