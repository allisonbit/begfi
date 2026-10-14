import { TOKEN_CA, TOKEN_CHAIN, TOKEN_CONFIGURED } from "@/lib/config";

/**
 * Live stats for the relaunched token, keyed off the one TOKEN_CA constant.
 *
 * THE SOURCE. DexScreener's public, keyless pair API
 * (`token-pairs/v1/{chain}/{ca}`) — the lightest feed that answers price, 24h
 * change, 24h volume, liquidity and market cap for a contract address, and it
 * indexes Robinhood Chain under the `robinhood` chainId. Holders come best-
 * effort from GeckoTerminal's token-info endpoint.
 *
 * THE CACHE. 60 seconds, shared across every render of the home page, like the
 * other market reads on this site. A stats strip is a read, not a tick.
 *
 * THE HONESTY RULE. Every value can be null — the CA not being set, the pair
 * not existing yet, the feed being down — and the caller must render the
 * empty state for a null, never a zero, never a fabrication. Until TOKEN_CA
 * points at the real contract the home page shows its "coming soon" cards and
 * nothing here is even fetched.
 *
 * FEES. Neither public market API exposes a token's cumulative tax revenue,
 * so `feesUsd` stays null from this layer: the honest state is "no fee figure"
 * ("coming soon" on the page), not a number invented from price and volume.
 * When the relaunched contract is known, this is where its tax ledger gets
 * wired in — one function, one card.
 */

export type TokenStats = {
  /** Token name and symbol, exactly as the pair reports them. */
  name: string | null;
  symbol: string | null;
  priceUsd: number | null;
  change24hPct: number | null;
  mcapUsd: number | null;
  /** Always null for now; see the FEES note above. */
  feesUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  holders: number | null;
};

type DexPair = {
  baseToken?: { name?: string; symbol?: string };
  priceUsd?: string;
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

/** The pair to show: the deepest pool, which is the market people actually see. */
function bestPair(pairs: DexPair[]): DexPair | null {
  let best: DexPair | null = null;
  let bestLiquidity = -1;
  for (const pair of pairs) {
    const liq = num(pair.liquidity?.usd) ?? 0;
    if (liq > bestLiquidity) {
      best = pair;
      bestLiquidity = liq;
    }
  }
  return best;
}

async function fetchHolders(): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/${TOKEN_CHAIN}/tokens/${TOKEN_CA}/info`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { attributes?: { holders?: { count?: number } } };
    } | null;
    const count = body?.data?.attributes?.holders?.count;
    return typeof count === "number" && Number.isFinite(count) && count > 0 ? count : null;
  } catch {
    return null;
  }
}

export async function getTokenStats(): Promise<TokenStats | null> {
  if (!TOKEN_CONFIGURED) return null;

  try {
    const res = await fetch(
      `https://api.dexscreener.com/token-pairs/v1/${TOKEN_CHAIN}/${TOKEN_CA}`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return null;
    const pairs = (await res.json()) as DexPair[] | null;
    if (!Array.isArray(pairs) || pairs.length === 0) return null;

    const pair = bestPair(pairs);
    if (!pair) return null;

    const priceUsd = num(pair.priceUsd);
    const change = typeof pair.priceChange?.h24 === "number" ? pair.priceChange.h24 : null;
    const holders = await fetchHolders();

    return {
      name: pair.baseToken?.name?.trim() || null,
      symbol: pair.baseToken?.symbol?.trim() || null,
      priceUsd,
      change24hPct: change,
      mcapUsd: num(pair.marketCap) ?? num(pair.fdv),
      feesUsd: null,
      volume24hUsd: num(pair.volume?.h24),
      liquidityUsd: num(pair.liquidity?.usd),
      holders,
    };
  } catch {
    return null;
  }
}
