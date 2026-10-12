import "server-only";

import { createPublicClient, http } from "viem";
import { robinhoodChain } from "@/lib/chains";
import { ponsCurveAbi } from "@/lib/curve";
import { PONS_FACTORY, ponsFactoryAbi } from "@/lib/pons";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

/**
 * Watchlist rows enriched with the same live numbers the Explore cards show:
 * name/ticker from the catalog (which /api/launch proved on-chain), 24h price
 * change from the indexer's confirmed trades, graduation from the factory.
 *
 * The admin client is right here even though the watchlist itself is private:
 * the ROWS are private (the list reaches this function already filtered by
 * profile), but the token numbers attached to them are public facts a public
 * page already shows.
 */
export type WatchRow = {
  token_address: string;
  name: string;
  ticker: string;
  priceChange24h: number | null;
  alert_on_move: boolean;
  alert_on_graduation: boolean;
};

export async function getWatchlistRows(
  walletToTokens: { tokenAddress: string; alertOnMove: boolean; alertOnGraduation: boolean }[],
): Promise<WatchRow[]> {
  if (!SUPABASE_CONFIGURED || walletToTokens.length === 0) return [];
  const admin = createAdminClient();

  const addresses = walletToTokens.map((w) => w.tokenAddress.toLowerCase());

  const { data: catalogs } = await admin
    .from("launches")
    .select("token_address, name, ticker")
    .in("token_address", addresses)
    .limit(200);

  const byToken = new Map((catalogs ?? []).map((c) => [c.token_address as string, c]));

  const client = createPublicClient({ chain: robinhoodChain, transport: http() });
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: dayTrades } = await admin
    .from("trades")
    .select("token_address, quote_amount, token_amount, block_time")
    .in("token_address", addresses)
    .gte("block_time", dayAgo)
    .order("block_time", { ascending: true })
    .limit(20_000);

  const changeBy = new Map<string, number>();
  const byTokenTrades = new Map<string, { quote_amount: string; token_amount: string }[]>();
  for (const t of dayTrades ?? []) {
    const key = t.token_address.toLowerCase();
    const list = byTokenTrades.get(key) ?? [];
    list.push(t);
    byTokenTrades.set(key, list);
  }
  for (const [token, list] of byTokenTrades) {
    const priced = list
      .filter((t) => t.token_amount !== "0" && t.quote_amount !== "0")
      .map((t) => Number(BigInt(t.quote_amount)) / Number(BigInt(t.token_amount)));
    if (priced.length >= 2) {
      changeBy.set(token, (priced[priced.length - 1] / priced[0] - 1) * 100);
    }
  }

  const rows: WatchRow[] = [];
  for (const w of walletToTokens) {
    const cat = byToken.get(w.tokenAddress.toLowerCase());
    if (!cat) continue; // a watched address that is not in the catalog is skipped, not guessed
    rows.push({
      token_address: w.tokenAddress.toLowerCase(),
      name: cat.name,
      ticker: cat.ticker,
      priceChange24h: changeBy.get(w.tokenAddress.toLowerCase()) ?? null,
      alert_on_move: w.alertOnMove,
      alert_on_graduation: w.alertOnGraduation,
    });
  }
  return rows;
}

// Re-exported so the dashboard page can call the chain directly where needed.
export { ponsCurveAbi, PONS_FACTORY, ponsFactoryAbi };
