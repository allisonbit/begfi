import "server-only";

import { createPublicClient, http, parseAbiItem, type Address } from "viem";

import { robinhoodChain } from "@/lib/chains";
import { TOKEN_CA, TOKEN_CHAIN, TOKEN_CONFIGURED } from "@/lib/config";

/**
 * Live stats for the relaunched $BEGFI, keyed off the one TOKEN_CA constant
 * in lib/config.ts.
 *
 * THE SOURCES, all keyless and public:
 *
 *  - DexScreener's token-pairs API (`token-pairs/v1/{chain}/{ca}`) answers
 *    price, 24h change, 24h volume, liquidity and market cap. It indexes
 *    Robinhood Chain under the chain slug `robinhood`, NOT the chain id
 *    4663 — the numeric slug returns an empty array. This one feed also
 *    yields the ETH price the fee card needs: the pair's quote side is
 *    WETH, so quoteUsd = priceUsd / priceNative.
 *  - Blockscout (the chain's own explorer) is the holders source: its
 *    token endpoint carries `holders_count`, which neither market API
 *    exposes. GeckoTerminal stays as the fallback for when the explorer
 *    is down.
 *  - FEES COME FROM THE CHAIN, never from a stored or derived value. The
 *    verified token source has no transfer tax; the 1% is the launch
 *    pool's swap fee, split 75/25 by the runitup launch contracts. The
 *    FeeSplitter emits FeesDistributed(token, feeToken, creatorAmount,
 *    platformAmount) on every fee split, so summing those events for our
 *    token IS the cumulative collected fee, counted live.
 *
 * THE CACHE. 30 seconds on the market feed, 60 on Blockscout, a 30-second
 * in-process memo on the log scan (the RPC transport is not Next-cached).
 * The home page polls itself about every 45 seconds, so every upstream is
 * hit at most a few times a minute, never per-viewer.
 *
 * THE HONESTY RULE. Every value can be null and the caller must render
 * "Unavailable" for a null — never a zero, never a fabrication. A stat
 * that failed to fetch is one stat dark, not a page that lies.
 */

export type TokenStats = {
  /** Token name and symbol, exactly as the feed reports them. */
  name: string | null;
  symbol: string | null;
  priceUsd: number | null;
  change24hPct: number | null;
  mcapUsd: number | null;
  /** Fees collected through the launch contracts, in USD. */
  feesUsd: number | null;
  /** The same fees in the fee token's own units (WETH), for the card's sub-line. */
  feesFeeTokenLabel: string | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  holders: number | null;
};

type DexPair = {
  baseToken?: { name?: string; symbol?: string };
  priceUsd?: string;
  /** Base token per quote token (BEGFI per WETH). */
  priceNative?: string;
  priceChange?: { h24?: number };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
};

const num = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/* ------------------------------------------------------------------ */
/* The on-chain fee ledger                                             */
/* ------------------------------------------------------------------ */

/**
 * The runitup launch contracts on Robinhood Chain (verified sources on the
 * Blockscout explorer): LiquidityLocker collects the pool's swap fees and
 * forwards them to FeeSplitter, whose FeesDistributed event is the
 * cumulative ledger for a token's collected fee.
 */
const FEE_SPLITTER = "0x4190e137CAEaA9bA93fE17aa5567Cb6c8E7b3D27" as const;

const FEES_DISTRIBUTED_EVENT = parseAbiItem(
  "event FeesDistributed(address indexed token, address indexed feeToken, uint256 creatorAmount, uint256 platformAmount)",
);

/**
 * The fee ledger, in three honest states: a real total, a real zero (the
 * chain answered and has no events saying anything was collected yet), or
 * an unreachable read. "Unavailable" is for the third only — zero fees is a
 * fact, and the facts page prints it.
 */
type FeeLedger =
  | { state: "ok"; raw: bigint; feeToken: string }
  | { state: "empty"; raw: bigint; feeToken: null }
  | { state: "error" };

const client = createPublicClient({ chain: robinhoodChain, transport: http() });

/*
 * In-process memo, 30s TTL: getLogs is a real RPC call and the transport
 * rides the public endpoint, so every render must not re-scan the logs.
 */
let feesMemo: { at: number; value: FeeLedger } | null = null;
const FEES_TTL_MS = 30_000;

async function fetchFees(): Promise<FeeLedger> {
  const now = Date.now();
  if (feesMemo && now - feesMemo.at < FEES_TTL_MS) return feesMemo.value;

  let value: FeeLedger;
  try {
    const logs = await client.getLogs({
      address: FEE_SPLITTER,
      event: FEES_DISTRIBUTED_EVENT,
      args: { token: TOKEN_CA as Address },
    });

    // One fee token at a time (in practice WETH). Amounts sum exactly in
    // BigInt, so the raw integer is never polluted by a float.
    const byToken = new Map<string, bigint>();
    for (const log of logs) {
      const feeToken = log.args.feeToken;
      const total = (log.args.creatorAmount ?? 0n) + (log.args.platformAmount ?? 0n);
      if (!feeToken || total === 0n) continue;
      byToken.set(feeToken.toLowerCase(), (byToken.get(feeToken.toLowerCase()) ?? 0n) + total);
    }
    if (byToken.size === 1) {
      const [feeToken, raw] = [...byToken.entries()][0];
      value = { state: "ok", raw, feeToken };
    } else if (byToken.size === 0) {
      // Zero events IS the answer: the chain read fine and nothing has been
      // collected yet. "0", not "unavailable".
      value = { state: "empty", raw: 0n, feeToken: null };
    } else {
      // More than one fee token would need an FX step this card does not
      // have — an empty state stays more honest than a guessed conversion.
      value = { state: "error" };
    }
  } catch {
    value = { state: "error" };
  }
  feesMemo = { at: now, value };
  return value;
}

/** Decimals of the fee token, read on-chain, memoized with the ledger above. */
let decimalsMemo: { at: number; token: string; decimals: number } | null = null;
async function feeTokenDecimals(token: string): Promise<number | null> {
  const now = Date.now();
  if (decimalsMemo && now - decimalsMemo.at < FEES_TTL_MS && decimalsMemo.token === token.toLowerCase()) {
    return decimalsMemo.decimals;
  }
  let decimals: number | null = null;
  try {
    const result = await client.readContract({
      abi: [
        {
          name: "decimals",
          type: "function",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "uint8" }],
        },
      ] as const,
      address: token as Address,
      functionName: "decimals",
    });
    decimals = typeof result === "number" ? result : null;
  } catch {
    decimals = null;
  }
  decimalsMemo = { at: now, token: token.toLowerCase(), decimals: decimals ?? 18 };
  return decimals;
}

/* ------------------------------------------------------------------ */
/* Holders                                                             */
/* ------------------------------------------------------------------ */

/** Blockscout first (holders_count), GeckoTerminal as the fallback. */
async function fetchHolders(): Promise<number | null> {
  try {
    const res = await fetch(
      `https://robinhoodchain.blockscout.com/api/v2/tokens/${TOKEN_CA}`,
      { next: { revalidate: 60 } },
    );
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { holders_count?: string | number } | null;
      const n = parseInt(String(body?.holders_count ?? ""), 10);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  } catch {
    /* fall through to the fallback */
  }
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/${TOKEN_CHAIN}/tokens/${TOKEN_CA}/info`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { attributes?: { holders?: { count?: number } } } | null;
    };
    const count = body?.data?.attributes?.holders?.count;
    return typeof count === "number" && Number.isFinite(count) && count > 0 ? count : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* The snapshot                                                        */
/* ------------------------------------------------------------------ */

export async function getTokenStats(): Promise<TokenStats | null> {
  if (!TOKEN_CONFIGURED) return null;

  let pair: DexPair | null = null;
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/${TOKEN_CHAIN}/${TOKEN_CA}`, {
      next: { revalidate: 30 },
    });
    if (res.ok) {
      const pairs = (await res.json()) as DexPair[] | null;
      if (Array.isArray(pairs)) {
        // The deepest pool is the market people actually see.
        let best: DexPair | null = null;
        let bestLiquidity = -1;
        for (const candidate of pairs) {
          const liq = num(candidate.liquidity?.usd) ?? 0;
          if (liq > bestLiquidity) {
            best = candidate;
            bestLiquidity = liq;
          }
        }
        pair = best;
      }
    }
  } catch {
    pair = null;
  }

  // The market feed is the min: without it there is no price, and without a
  // price there is no honest USD figure for the fees either.
  if (!pair) return null;

  const priceUsd = num(pair.priceUsd);
  const priceNative = num(pair.priceNative);
  const quoteUsd = priceUsd !== null && priceNative !== null && priceNative > 0 ? priceUsd / priceNative : null;

  const [ledger, holders] = await Promise.all([fetchFees(), fetchHolders()]);

  let feesUsd: number | null = null;
  let feesFeeTokenLabel: string | null = null;
  if (ledger?.state === "empty") {
    feesUsd = 0;
    feesFeeTokenLabel = "0";
  } else if (ledger?.state === "ok") {
    const decimals = await feeTokenDecimals(ledger.feeToken);
    if (decimals !== null) {
      // BigInt arithmetic all the way to the display: a fee total big enough
      // for a float to pollute (log a phantom mantissa digit) is precisely
      // the sum this card means, so it never travels through Number.
      const whole = ledger.raw / 10n ** BigInt(decimals);
      const frac = (ledger.raw % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").slice(0, 4);
      feesFeeTokenLabel = `${whole}.${frac}`.replace(/\s*$/, "");
      if (quoteUsd !== null) {
        // The raw total is covered by a double here (≈9007 WETH at 18
        // decimals) — display precision is 15 significant digits, far past
        // what a stats card prints.
        feesUsd = (Number(ledger.raw) / 10 ** decimals) * quoteUsd;
      }
    }
  }

  return {
    name: pair.baseToken?.name?.trim() || null,
    symbol: pair.baseToken?.symbol?.trim() || null,
    priceUsd,
    change24hPct: typeof pair.priceChange?.h24 === "number" ? pair.priceChange.h24 : null,
    mcapUsd: num(pair.marketCap) ?? num(pair.fdv),
    feesUsd,
    feesFeeTokenLabel,
    volume24hUsd: num(pair.volume?.h24),
    liquidityUsd: num(pair.liquidity?.usd),
    holders,
  };
}

/**
 * "Is the token actually trading" — the cheap cached check the footer's
 * ", $BEGFI is live" claim is gated on. True only when the market feed
 * answers for this CA with at least one pair, so the claim inside the
 * footer is a statement the feed can retract.
 */
export async function isTokenLive(): Promise<boolean> {
  if (!TOKEN_CONFIGURED) return false;
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/${TOKEN_CHAIN}/${TOKEN_CA}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return false;
    const pairs = (await res.json()) as DexPair[] | null;
    return Array.isArray(pairs) && pairs.length > 0;
  } catch {
    return false;
  }
}
