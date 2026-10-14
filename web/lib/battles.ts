import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

/**
 * Weekly Beg Battles — who $BEGFI genuinely reached this week, and how many
 * weeks in a row they've kept receipting.
 *
 * THE WEEK. Monday 00:00 UTC, full stop. `weekStart`/`weekBounds` are the one
 * definition of the boundary used by the ranking, the winner-freezing and the
 * countdown, so the three can never disagree about when a week ended.
 *
 * THE SOURCE. Confirmed transfers only, from begfi.transfers — the same rows
 * the payment page totals come from. A wallet that received money off-chain is
 * not a winner, because that money is not on the site.
 *
 * ANTI-WASH. A ranking that rewards the biggest SUM invites wash: A sends 10M
 * to B, B sends it back, both top the needle-bounce board. Two rules below
 * cheaply exclude most of that, at the cost the ranking can never claim
 * intentionality — only receipts:
 *
 *   1. Self-transfers don't count (from = to).
 *   2. A short list of operational wallets — BegFi's own distributor/payout
 *      and dev wallets — never counts as a SUPPORTER, in any metric: their
 *      sends are program activity (earn payouts), not support.
 *
 * What remains is receipts from distinct, non-program wallets, which is what
 * the three categories read: SUM RECEIVED, DISTINCT SUPPORTERS, and FIRST-TIME
 * SUPPORTERS (senders who touched this wallet for the first time this week) —
 * the third is the one wash finds hardest to fake, because it takes a NEW
 * wallet every week.
 */

/** Senders that are program activity, not support. Compared lowercase. */
export const EXCLUDED_SENDER_WALLETS = new Set<string>([
  // The distributor wallet that pays Earn/pool claims.
  "0x5400ab138b54703b90e916bcea7d667c61dd5dbf",
  // The dev/genesis fee wallet.
  "0x38e2f47d9b2eb233c035dcbc2d40857d9517933a",
]);

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

export type TransferRow = {
  to_address: string;
  from_address: string;
  amount: string;
};

/** Per-wallet aggregate of one week's qualifying receipts. */
export type WeekStats = {
  received: bigint;
  supporters: Set<string>;
};

/**
 * THE one aggregation rule. Takes raw confirmed transfers, returns the
 * per-recipient stats the categories read from, exclusions applied. Every
 * consumer of a weekly ranking (page, cron freeze) calls THIS, so no second
 * rulebook can appear later and quietly disagree.
 */
export function rankWeek(rows: TransferRow[]): Map<string, WeekStats> {
  const out = new Map<string, WeekStats>();
  for (const row of rows) {
    const to = row.to_address.toLowerCase();
    const from = row.from_address.toLowerCase();
    if (from === to || EXCLUDED_SENDER_WALLETS.has(from)) continue;
    let entry = out.get(to);
    if (!entry) {
      entry = { received: 0n, supporters: new Set() };
      out.set(to, entry);
    }
    entry.received += BigInt(row.amount);
    entry.supporters.add(from);
  }
  return out;
}

export type BattleRow = {
  username: string;
  wallet: string;
  received: bigint;
  /** Distinct qualifying senders this week. */
  supporters: number;
  /** Senders whose FIRST-ever send to this wallet was this week. */
  newSupporters: number;
  /** Consecutive weeks (this week inclusive) with ≥1 qualifying receipts. */
  streakWeeks: number;
};

export type BattleMetric = "received" | "supporters" | "new";

/** The metric a battle card or query string names; falls back to received. */
export function battleMetric(value: string | undefined): BattleMetric {
  return value === "sup" ? "supporters" : value === "new" ? "new" : "received";
}

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
    .select("to_address, from_address, amount")
    .gte("block_time", sinceTs)
    .lt("block_time", untilTs)
    .limit(20_000);

  if (error || !data) return { rows: [], dbFailed: true };

  const ranked = rankWeek((data as TransferRow[]) ?? []);
  if (ranked.size === 0) return { rows: [], dbFailed: false };

  const sorted = [...ranked.entries()]
    .sort((a, b) => (a[1].received > b[1].received ? -1 : a[1].received < b[1].received ? 1 : 0))
    .slice(0, limit);

  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("username, wallet_address, is_hidden")
    .in("wallet_address", sorted.map(([w]) => w))
    .eq("is_hidden", false);

  if (profilesError || !profiles) return { rows: [], dbFailed: true };

  const usernameByWallet = new Map(
    (profiles as { username: string; wallet_address: string }[]).map((p) => [p.wallet_address.toLowerCase(), p.username]),
  );

  const rankedWallets = sorted
    .filter(([w]) => usernameByWallet.has(w))
    .map(([wallet, stats]) => ({ wallet, stats }));
  if (rankedWallets.length === 0) return { rows: [], dbFailed: false };

  // WHO HAS BEEN SUPPORTED BEFORE: these two metrics only mean something
  // against history. One bounded query covers both — first-time supporters
  // need everything before this week, streaks need the last 12.
  const HISTORY_WEEKS = 12;
  const streakFloor = new Date(sinceTs);
  streakFloor.setUTCDate(streakFloor.getUTCDate() - 7 * HISTORY_WEEKS); // history bounds, exclusive of week -12

  const {
    data: history,
    error: historyError,
  } = await admin
    .from("transfers")
    .select("to_address, from_address, block_time")
    .in("to_address", rankedWallets.map((r) => r.wallet))
    .gte("block_time", streakFloor.toISOString())
    .lt("block_time", untilTs)
    .limit(60_000);

  if (historyError) {
    // A broken history read kills ONLY the refined metrics, never the week
    // the current rows still prove: categories fall back to crude counts,
    // and the page says so instead of making a zero look like a streak.
    const rows: BattleRow[] = rankedWallets.map(({ wallet, stats }) => ({
      username: usernameByWallet.get(wallet)!,
      wallet,
      received: stats.received,
      supporters: stats.supporters.size,
      newSupporters: -1,
      streakWeeks: -1,
    }));
    return { rows, dbFailed: false, historyFailed: true } as { rows: BattleRow[]; dbFailed: boolean; historyFailed?: boolean };
  }

  type HistRow = { to_address: string; from_address: string; block_time: string };
  const historyRows = (history ?? []) as HistRow[];

  // Recipient → senders BEFORE this week (first-time metric).
  const priorSenders = new Map<string, Set<string>>();
  // Recipient → week indices with a qualifying receipt (0 = this week).
  const weekReceipts = new Map<string, Set<number>>();
  const thisWeekMs = new Date(sinceTs).getTime();
  for (const row of historyRows) {
    const to = row.to_address.toLowerCase();
    const from = row.from_address.toLowerCase();
    if (from === to || EXCLUDED_SENDER_WALLETS.has(from)) continue;
    const when = new Date(row.block_time).getTime();
    if (when < thisWeekMs) {
      const set = priorSenders.get(to) ?? new Set<string>();
      set.add(from);
      priorSenders.set(to, set);
      continue;
    }
    const weekIndex = Math.min(HISTORY_WEEKS - 1, Math.floor((when - thisWeekMs) / (7 * 86_400_000)));
    const set = weekReceipts.get(to) ?? new Set<number>();
    set.add(weekIndex);
    weekReceipts.set(to, set);
  }

  const rows: BattleRow[] = rankedWallets.map(({ wallet, stats }) => {
    const prior = priorSenders.get(wallet) ?? new Set<string>();
    const newSupporters = [...stats.supporters].filter((f) => !prior.has(f)).length;
    let streakWeeks = 0;
    const weeks = weekReceipts.get(wallet) ?? new Set<number>();
    // Weeks count down from THIS week (index 0); capped by the history window.
    for (let i = 0; i < HISTORY_WEEKS; i++) {
      if (weeks.has(i)) streakWeeks = i + 1;
      else break;
    }
    return {
      username: usernameByWallet.get(wallet)!,
      wallet,
      received: stats.received,
      supporters: stats.supporters.size,
      newSupporters,
      streakWeeks,
    };
  });

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
