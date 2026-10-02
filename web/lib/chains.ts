import { defineChain, type Address } from "viem";

/**
 * Robinhood Chain — the Arbitrum Orbit L2 that BegFi lives on.
 *
 * chainId 4663, native asset ETH, ~100ms blocks. Verified against Robinhood's
 * own docs; the explorer is Blockscout.
 *
 * The RPC is overridable on purpose. `npx hardhat node` in this repo runs at
 * the SAME chainId (4663) as mainnet, so pointing NEXT_PUBLIC_RPC_URL at
 * http://127.0.0.1:8545 runs the entire send flow locally with no code change —
 * which is the only way to exercise it before $BEG is deployed for real.
 */
export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com"],
    },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

/**
 * Robinhood only. This app has no multichain story: $BEG is a Robinhood Chain
 * token and a link that could resolve on another network would be a way to send
 * money to the wrong place.
 */
export const SUPPORTED_CHAINS = [robinhoodChain] as const;

export const DEFAULT_CHAIN_ID = robinhoodChain.id;

export const EXPLORER = "https://robinhoodchain.blockscout.com";

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (address: string) => `${EXPLORER}/address/${address}`;

/** Native ETH, as the zero address. Matches how the indexer is asked about gas. */
export const NATIVE = "0x0000000000000000000000000000000000000000" as const;

/**
 * Every stored address is lowercase. Postgres keeps `wallet_address` in a
 * lowercase check constraint and it is compared against indexed event topics,
 * so normalising at the edge means the value in the database, the value in a
 * URL and the value in a comparison are the same string.
 */
export const normaliseAddress = (value: string): string => value.toLowerCase();

export const isAddress = (value: string | undefined): value is Address =>
  Boolean(value && /^0x[0-9a-fA-F]{40}$/.test(value));

/** Truncated for display: first 6, last 4 (spec §7.2). */
export const shortAddress = (address: string): string =>
  address.length >= 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
