import { defineChain, type Address } from "viem";

/**
 * Robinhood Chain — the Arbitrum Orbit L2 that BegFi lives on, and its testnet.
 *
 * Both are defined, and `NEXT_PUBLIC_CHAIN` picks which one the app runs against.
 * That switch exists so the whole product can be exercised honestly before any
 * real money is involved: same wallets, same contracts, same code path, free gas.
 *
 *   NEXT_PUBLIC_CHAIN=testnet   -> chainId 46630, testnet RPC and explorer
 *   unset                       -> chainId 4663, mainnet (the default, deliberately)
 *
 * The default is mainnet because a misconfigured production deploy that silently
 * pointed at a testnet would be worse than one that points at mainnet: on the
 * testnet everything appears to work while nothing is real, and someone would
 * send coins that do not exist.
 */
const USE_TESTNET = process.env.NEXT_PUBLIC_CHAIN?.trim().toLowerCase() === "testnet";

/**
 * `||`, NOT `??`, and that distinction is load-bearing. A .env file that writes
 * `NEXT_PUBLIC_RPC_URL=""` produces an empty STRING, and `??` only falls back on
 * null/undefined — so the chain ends up with an empty URL, viem builds no usable
 * transport, and wagmi's `usePublicClient()` resolves to undefined. RainbowKit
 * reads that client when it mounts its transaction store, dereferences it, and
 * the production build dies inside a package that has nothing to do with the env
 * file. Treating a blank value as unset is the only safe reading.
 */
const MAINNET_RPC =
  process.env.NEXT_PUBLIC_RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com";

const TESTNET_RPC =
  process.env.NEXT_PUBLIC_TESTNET_RPC_URL?.trim() || "https://rpc.testnet.chain.robinhood.com";

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [MAINNET_RPC] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [TESTNET_RPC] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  testnet: true,
});

/** The chain this build runs against. */
export const robinhoodChain = USE_TESTNET ? robinhoodTestnet : robinhoodMainnet;

export const IS_TESTNET = USE_TESTNET;

/**
 * One chain only. $BEG is a single-chain token, and a link that could resolve on
 * two networks is a way to send money to the wrong place.
 */
export const SUPPORTED_CHAINS = [robinhoodChain] as const;

export const DEFAULT_CHAIN_ID = robinhoodChain.id;

export const EXPLORER = robinhoodChain.blockExplorers.default.url;

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (address: string) => `${EXPLORER}/address/${address}`;

/** Native ETH, as the zero address. */
export const NATIVE = "0x0000000000000000000000000000000000000000" as const;

/**
 * Every stored address is lowercase. Postgres keeps `wallet_address` in a
 * lowercase check constraint and it is compared against indexed event topics, so
 * normalising at the edge means the value in the database, the value in a URL
 * and the value in a comparison are the same string.
 */
export const normaliseAddress = (value: string): string => value.toLowerCase();

export const isAddress = (value: string | undefined): value is Address =>
  Boolean(value && /^0x[0-9a-fA-F]{40}$/.test(value));

/** Truncated for display: first 6, last 4 (spec §7.2). */
export const shortAddress = (address: string): string =>
  address.length >= 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
