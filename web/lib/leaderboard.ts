import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

/**
 * The public leaderboard's single read.
 *
 * WHAT EARNS RANKS. Every $BEGFI a profile has received — a beg, an earn
 * payout from the daily pool, anything — is a confirmed `Transfer` the
 * indexer has recorded, and `profile_stats` sums exactly that per profile
 * with its distinct-sender count. So the board is one ordering of the view
 * the profile pages already serve; no new aggregation exists to disagree
 * with the totals users see on the profiles themselves.
 *
 * WHO RANKS. Only real, visible profiles: a username someone claimed and
 * chose not to hide. A wallet nobody owns is nobody's ranking.
 */
export type LeaderRow = {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  wallet_address: string;
  total_received: string;
  supporters: number;
  /** Distinct senders inside the window; null for all-time (view carries it). */
  windowSupporters: number | null;
};

export type LeaderWindow = "all" | "week";

export async function getLeaderboard(
  limit = 25,
  window: LeaderWindow = "all",
): Promise<{ rows: LeaderRow[]; dbFailed: boolean }> {
  if (!SUPABASE_CONFIGURED) return { rows: [], dbFailed: true };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { rows: [], dbFailed: true };
  }

  /*
   * ALL-TIME reads the aggregate view — exact, precomputed.
   * WEEKLY sums confirmed transfers since the window start, per profile.
   * The units and the honesty rule are identical, only the slice differs:
   * a week row can climb all-time later, and a row that is all-time-only
   * (a past whale, quiet this week) still shows its lifetime rank.
   */
  const data = await (async () => {
    if (window === "all") {
      const { data, error } = await admin
        .from("profile_stats")
        .select("profile_id, total_received, supporters, profiles!inner(username, display_name, avatar_url, wallet_address, is_hidden)")
        .eq("profiles.is_hidden", false)
        .gt("total_received", "0")
        .order("total_received", { ascending: false })
        .limit(limit);
      if (error || !data) return null;
      return data.map((d) => ({
        total_received: d.total_received as string,
        supporters: d.supporters as number,
        windowSupporters: null as number | null,
        profiles: d.profiles,
      }));
    }

    const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const { data: transfers, error } = await admin
      .from("transfers")
      .select("to_address, amount, from_address")
      .gte("block_time", since)
      .limit(20_000);
    if (error || !transfers) return null;

    const { data: profiles } = await admin
      .from("profiles")
      .select("id, username, display_name, avatar_url, wallet_address")
      .eq("is_hidden", false)
      .limit(500);
    if (!profiles) return null;

    const amounts = new Map<string, bigint>();
    const senders = new Map<string, Set<string>>();
    for (const t of transfers) {
      const to = t.to_address.toLowerCase();
      amounts.set(to, (amounts.get(to) ?? 0n) + BigInt(t.amount));
      const s = senders.get(to) ?? new Set<string>();
      s.add(t.from_address.toLowerCase());
      senders.set(to, s);
    }

    return profiles
      .filter((p) => (amounts.get(p.wallet_address.toLowerCase()) ?? 0n) > 0n)
      .map((p) => ({
        total_received: (amounts.get(p.wallet_address.toLowerCase()) ?? 0n).toString(),
        supporters: senders.get(p.wallet_address.toLowerCase())?.size ?? 0,
        windowSupporters: senders.get(p.wallet_address.toLowerCase())?.size ?? 0,
        profiles: p,
      }))
      .sort((a, b) => (BigInt(a.total_received) > BigInt(b.total_received) ? -1 : 1))
      .slice(0, limit);
  })();

  if (!data) return { rows: [], dbFailed: true };

  /*
   * The embedded profiles come back as an ARRAY (PostgREST does that when the
   * relationship could be one-to-many; here it is exactly one per row because
   * profile_id is unique). Taking [0] after the array check keeps the type
   * honest without pretending the shape to be something it is not.
   */
  return {
    rows: data.flatMap((d) => {
      const p = (Array.isArray(d.profiles) ? d.profiles[0] : d.profiles) as
        | { username: string; display_name: string | null; avatar_url: string | null; wallet_address: string }
        | undefined;
      if (!p) return [];
      return [{
        username: p.username,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        wallet_address: p.wallet_address,
        total_received: d.total_received,
        supporters: d.supporters,
        windowSupporters: d.windowSupporters,
      }];
    }),
    dbFailed: false,
  };
}
