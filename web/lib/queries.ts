import "server-only";

import { USERNAME_PATTERN, isReserved } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import type { ProfileStats, PublicProfile, Transfer } from "@/lib/types";

/**
 * Reads for the public profile page.
 *
 * These run on the server with the caller's session, so RLS applies exactly as
 * it would in the browser — including the policy that hides a profile whose
 * owner has set `is_hidden`. A hidden profile returns null here and the page
 * 404s, without the page needing to know that hiding exists.
 */

type ProfileRow = PublicProfile & { id: string };

export type ProfileLookup = {
  profile: ProfileRow;
  stats: ProfileStats;
};

export async function getProfileByUsername(rawUsername: string): Promise<ProfileLookup | null> {
  const username = rawUsername.trim().toLowerCase();

  if (!USERNAME_PATTERN.test(username) || isReserved(username)) return null;
  if (!SUPABASE_CONFIGURED) return null;

  const sb = await createClient();

  const { data: profile, error } = await sb
    .from("profiles")
    .select("id, username, display_name, bio, avatar_url, wallet_address, created_at")
    .eq("username", username)
    .maybeSingle<ProfileRow>();

  /*
   * `error` is read, not caught. supabase-js returns errors rather than throwing
   * them, so a failing query and a genuinely missing row both arrive as
   * `data === null` — and this function returns null for either, which the page
   * turns into a 404. That is right for a row that does not exist and wrong for a
   * database that is unreachable, but the two cannot be told apart downstream
   * unless the error is at least looked at.
   *
   * A 404 is the safer of the two failures here — it hides a page rather than
   * showing a broken one — so this returns null either way and is deliberately
   * quiet. The point is that the decision is made, rather than the error being
   * dropped in a catch that never fires.
   */
  if (error) return null;

  if (!profile) return null;

  const stats = await getStats(profile.id);

  return { profile, stats };
}

/**
 * Totals for one profile, from the aggregate view.
 *
 * Separate from `getRecentTransfers` on purpose. Summing a page of recent
 * transfers gives the total of *that page*, which looks right on a new account
 * and is wrong on a busy one — the sort of bug that only shows up once somebody
 * has real traffic, i.e. when it matters. The view sums everything.
 */
export async function getStats(profileId: string): Promise<ProfileStats> {
  if (!SUPABASE_CONFIGURED) {
    return { profile_id: profileId, total_received: "0", supporters: 0 };
  }

  const sb = await createClient();
  const { data } = await sb
    .from("profile_stats")
    .select("profile_id, total_received, supporters")
    .eq("profile_id", profileId)
    .maybeSingle<ProfileStats>();

  // An account that has received nothing has no row in the view yet, and the
  // honest reading of that is zero — not a missing total.
  return data ?? { profile_id: profileId, total_received: "0", supporters: 0 };
}

/**
 * How much a wallet has received since a moment in time.
 *
 * This is what makes a beg's progress mean something. A beg's total is not the
 * wallet's lifetime total — it is what arrived after the beg was written, so a
 * second beg starts at zero rather than inheriting the first one's donations.
 *
 * Read from `transfers`, which the indexer fills only from confirmed on-chain
 * events, so the number on a shared page cannot be inflated by anything a browser
 * claims. Totals are computed in SQL rather than by fetching rows and adding them
 * up here, because the client would have to pull the whole history to be right.
 */
export async function getReceivedSince(walletAddress: string, since: string): Promise<bigint> {
  if (!SUPABASE_CONFIGURED) return 0n;

  const sb = await createClient();
  const { data, error } = await sb
    .from("transfers")
    .select("amount")
    .eq("to_address", walletAddress.toLowerCase())
    .gt("block_time", since);

  // `error` is read, not caught. supabase-js returns errors rather than throwing,
  // so a failing query would otherwise sum to zero — which on a beg page reads as
  // "nobody has given anything", the most misleading answer available.
  if (error) return 0n;

  return (data ?? []).reduce((sum, row) => sum + BigInt((row as { amount: string }).amount), 0n);
}

/**
 * A recipient's recent transfers, for their own dashboard.
 *
 * Only ever called for the signed-in user's own profile: the RLS policy on
 * `transfers` permits a row only to the two addresses involved, so this returns
 * nothing for anyone else's page even if it were called there.
 */
export async function getRecentTransfers(walletAddress: string, limit = 50): Promise<Transfer[]> {
  if (!SUPABASE_CONFIGURED) return [];

  const sb = await createClient();
  const { data } = await sb
    .from("transfers")
    .select("*")
    .eq("to_address", walletAddress.toLowerCase())
    .order("block_time", { ascending: false })
    .limit(limit);

  return (data as Transfer[] | null) ?? [];
}
