import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

/**
 * The token page's chart, from the indexer's confirmed trades.
 *
 * A CANDLE IS A FACT, NOT A LINE. Each bucket is the first/last trade price in
 * a time slice plus its high/low, computed from `quote/token` per trade — the
 * same price definition the explore page's 24h change uses. Trades the
 * indexer has not confirmed do not exist here; a thin history renders as a
 * thin chart, never an invented one.
 *
 * WINDOWS: 24h in 30m buckets (48 points), 7d in 3h buckets (56 points),
 * 30d in 24h buckets (30 points). All bounded; the explore-grade 20k trade
 * cap bounds each read.
 */
export type Candle = {
  t: number; // bucket start, epoch ms
  o: number; // open, ETH per token
  h: number;
  l: number;
  c: number;
};

export type ChartWindow = "24h" | "7d" | "30d";

const WINDOWS: Record<ChartWindow, { ms: number; bucketMs: number }> = {
  "24h": { ms: 24 * 3600_000, bucketMs: 1800_000 },
  "7d": { ms: 7 * 24 * 3600_000, bucketMs: 3 * 3600_000 },
  "30d": { ms: 30 * 24 * 3600_000, bucketMs: 24 * 3600_000 },
};

export async function getChart(
  tokenAddress: string,
  window: ChartWindow,
): Promise<{ candles: Candle[]; quoteVolumeEth: number | null; trades: number; failed: boolean }> {
  if (!SUPABASE_CONFIGURED) return { candles: [], quoteVolumeEth: null, trades: 0, failed: true };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { candles: [], quoteVolumeEth: null, trades: 0, failed: true };
  }

  const { ms, bucketMs } = WINDOWS[window];
  const since = new Date(Date.now() - ms).toISOString();

  const { data, error } = await admin
    .from("trades")
    .select("quote_amount, token_amount, block_time")
    .eq("token_address", tokenAddress.toLowerCase())
    .gte("block_time", since)
    .order("block_time", { ascending: true })
    .limit(20_000);

  if (error || !data) return { candles: [], quoteVolumeEth: null, trades: 0, failed: true };

  let volumeWei = 0n;
  const buckets = new Map<number, { o: number | null; h: number; l: number; c: number; n: number }>();

  for (const row of data) {
    const at = new Date(row.block_time).getTime();
    if (Number.isNaN(at)) continue;
    const bucket = Math.floor(at / bucketMs) * bucketMs;

    const quote = BigInt(row.quote_amount);
    const tokens = BigInt(row.token_amount);
    let price: number | null = null;
    if (tokens > 0n) {
      // Double math is fine here: this is a display series, never a traded
      // number, and 18-decimal string division per candle would be slower
      // than the chart needs. The pool math keeps BigInt elsewhere.
      price = Number(quote) / Number(tokens);
    }
    volumeWei += quote;

    const b = buckets.get(bucket) ?? { o: null, h: 0, l: Infinity, c: 0, n: 0 };
    if (price !== null) {
      if (b.o === null) b.o = price;
      b.c = price;
      if (b.h < price) b.h = price;
      if (b.l > price) b.l = price;
      b.n += 1;
    }
    buckets.set(bucket, b);
  }

  const candles: Candle[] = [...buckets.entries()]
    .filter(([, b]) => b.o !== null && b.n > 1)
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => ({ t, o: b.o as number, h: b.h, l: b.l === Infinity ? (b.c as number) : b.l, c: b.c }));

  const quoteVolumeEth = Number(volumeWei) / 1e18;
  return { candles, quoteVolumeEth, trades: data.length, failed: false };
}
