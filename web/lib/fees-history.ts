import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

/**
 * A creator's fee history, from the taxes the indexer recorded per trade.
 *
 * WHAT THIS IS. Every curve trade pays a creator tax, and the indexer (since
 * 0010) records the tax side of each event in `trades.tax_amount`. The
 * creator's fee history is therefore the sum of taxes on the tokens they
 * launched, bucketed per day, from confirmed trades only.
 *
 * WHAT THIS IS NOT. It is not the escrow balance: taxes accumulate but the
 * claimable figure the Fees tab shows comes only from `balanceOf` on the
 * escrow contract (read live with the connected wallet). The chart shows the
 * SHAPE of earnings over time; the escrow decides what can actually be
 * claimed. Where the two could disagree — a tax swept differently, a token
 * launched outside the recorded window — the escrow wins, and the chart copy
 * says exactly that.
 */
export type FeePoint = { day: string; wei: string };

export type FeeHistoryResult = {
  points: FeePoint[];
  /** Sum over the requested window. */
  totalWei: string;
  dbFailed: boolean;
};

const WINDOWS: Record<string, number> = { "7d": 7, "30d": 30, all: 365 };

export async function getFeeHistory(
  wallet: string,
  range: "7d" | "30d" | "all",
): Promise<FeeHistoryResult> {
  if (!SUPABASE_CONFIGURED) return { points: [], totalWei: "0", dbFailed: true };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { points: [], totalWei: "0", dbFailed: true };
  }

  const tokensResult = await admin
    .from("launches")
    .select("token_address")
    .eq("launcher_wallet", wallet.toLowerCase())
    .limit(500);

  const tokens = (tokensResult.data ?? []).map((r) => r.token_address as string);
  if (tokens.length === 0) return { points: [], totalWei: "0", dbFailed: false };

  const days = WINDOWS[range];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("trades")
    .select("tax_amount, block_time")
    .in("token_address", tokens)
    .gte("block_time", since)
    .order("block_time", { ascending: true })
    .limit(50_000);

  if (error || !data) return { points: [], totalWei: "0", dbFailed: true };

  // Bucket by day in UTC. A day with no trades simply has no point — the
  // client draws the gaps as gaps rather than a lying zero line.
  const byDay = new Map<string, bigint>();
  let total = 0n;

  for (const row of data) {
    const tax = BigInt(row.tax_amount ?? "0");
    if (tax === 0n) continue;
    const day = row.block_time.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0n) + tax);
    total += tax;
  }

  const points: FeePoint[] = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, wei]) => ({ day, wei: wei.toString() }));

  return { points, totalWei: total.toString(), dbFailed: false };
}
