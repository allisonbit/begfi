import { defineChain, type Address } from "viem";

/**
 * Robinhood Chain — the Arbitrum Orbit L2 that BegFi lives on.
 *
 * chainId 4663, native asset ETH, ~100ms blocks. Verified against Robinhood's
 * own docs; the explorer is Blockscout.
 *
 * One chain, and no testnet. The RPC is overridable because `npx hardhat node`
 * in this repo runs at the SAME chainId (4663) as mainnet — so pointing
 * NEXT_PUBLIC_RPC_URL at http://127.0.0.1:8545 runs the entire send flow against
 * a local chain with no code change and no separate network to keep in step.
 */
/**
 * `||`, NOT `??`, and that distinction is load-bearing. A .env file that writes
 * `NEXT_PUBLIC_RPC_URL=""` produces an empty STRING, and `??` only falls back on
 * null/undefined — so the chain ends up with an empty URL, viem builds no usable
 * transport, and wagmi's `usePublicClient()` resolves to undefined. RainbowKit
 * reads that client when it mounts its transaction store, dereferences it, and
 * the production build dies inside a package that has nothing to do with the env
 * file. Treating a blank value as unset is the only safe reading.
 */
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com";

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

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
