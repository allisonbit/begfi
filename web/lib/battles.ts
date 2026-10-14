import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

/**
 * Weekly Beg Battles — who got the most $BEGFI this week, and who wore the
 * crown last week.
 *
 * THE WEEK. Monday 00:00 UTC, full stop. `weekBounds` is the single
 * definition of the boundary used by the ranking, the winner-freezing and the
 * countdown, so the three can never disagree about when a week started.
 *
 * THE SOURCE. Confirmed transfers only, from begfi.transfers — the same rows
 * the payment page totals come from. A wallet that received money off-chain
 * is not a winner, because that money is not on the site.
 */

/** The Monday 00:00 UTC on or immediately before `now`. ISO date string. */
export function weekStart(now = new Date()): string {
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = utc.getUTCDay(); // 0 = Sunday
  const back = (day + 6) % 7; // days since Monday
  utc.setUTCDate(utc.getUTCDate() - back);
  return utc.toISOString().slice(0, 10);
}

/** [weekStart, nextWeekStart) for the week containing `now`. ISO strings. */
export function weekBounds(now = new Date()): [string, string] {
  const start = weekStart(now);
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return [start, d.toISOString().slice(0, 10)];
}

export type BattleRow = {
  username: string;
  wallet: string;
  received: bigint;
  /** True for last week's winner who still ranks, so the UI can crown again. */
  isReigning?: boolean;
};

/**
 * THIS WEEK's ranking, live, from confirmed transfers since Monday 00:00 UTC.
 * A database problem returns dbFailed rather than an empty-looking ranking:
 * "nobody won anything" and "the read broke" are not the same claim.
 */
export async function getWeeklyLeaders(limit = 10): Promise<{ rows: BattleRow[]; dbFailed: boolean }> {
  if (!SUPABASE_CONFIGURED) return { rows: [], dbFailed: true };
  const admin = createAdminClient();

  const [since, until] = weekBounds();
  const sinceTs = `${since}T00:00:00Z`;
  const untilTs = `${until}T00:00:00Z`;

  const { data, error } = await admin
    .from("transfers")
    .select("to_address, amount")
    .gte("block_time", sinceTs)
    .lt("block_time", untilTs)
    .limit(10_000);

  if (error || !data) return { rows: [], dbFailed: true };

  const byWallet = new Map<string, bigint>();
  for (const row of data as { to_address: string; amount: string }[]) {
    const wallet = row.to_address.toLowerCase();
    byWallet.set(wallet, (byWallet.get(wallet) ?? 0n) + BigInt(row.amount));
  }

  if (byWallet.size === 0) return { rows: [], dbFailed: false };

  const wallets = [...byWallet.entries()]
    .sort((a, b) => (a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0))
    .slice(0, limit);

  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("username, wallet_address, is_hidden")
    .in("wallet_address", wallets.map(([w]) => w))
    .eq("is_hidden", false);

  if (profilesError || !profiles) return { rows: [], dbFailed: true };

  const usernameByWallet = new Map(
    (profiles as { username: string; wallet_address: string }[]).map((p) => [p.wallet_address.toLowerCase(), p.username]),
  );

  const rows: BattleRow[] = wallets
    .filter(([w]) => usernameByWallet.has(w))
    .map(([wallet, received]) => ({
      username: usernameByWallet.get(wallet)!,
      wallet,
      received,
    }));

  return { rows, dbFailed: false };
}

export type Winner = { username: string; wallet: string; received: string };

/**
 * LAST WEEK's Top-3, frozen by the indexer cron. Empty means the week ended
 * with nobody receiving anything — displayed as such, never papered over.
 */
export async function getLastWeekWinners(now = new Date()): Promise<Winner[]> {
  if (!SUPABASE_CONFIGURED) return [];
  const admin = createAdminClient();

  const [thisWeekStart] = weekBounds(now);
  const d = new Date(`${thisWeekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  const lastWeek = d.toISOString().slice(0, 10);

  const { data } = await admin
    .from("battle_winners")
    .select("winners")
    .eq("week_start", lastWeek)
    .maybeSingle<{ winners: Winner[] }>();

  return (data?.winners as Winner[] | undefined) ?? [];
}

/** Is this wallet one of last week's winners? (For the profile badge.) */
export async function isTopBeggar(wallet: string, now = new Date()): Promise<Winner | null> {
  if (!SUPABASE_CONFIGURED) return null;
  const admin = createAdminClient();

  const [thisWeekStart] = weekBounds(now);
  const d = new Date(`${thisWeekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  const lastWeek = d.toISOString().slice(0, 10);

  const { data } = await admin
    .from("battle_winners")
    .select("winners")
    .eq("week_start", lastWeek)
    .maybeSingle<{ winners: Winner[] }>();

  const list = (data?.winners as Winner[] | undefined) ?? [];
  const lower = wallet.toLowerCase();
  return list.find((w) => w.wallet.toLowerCase() === lower) ?? null;
}
