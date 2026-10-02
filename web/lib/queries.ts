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

  const { data: profile } = await sb
    .from("profiles")
    .select("id, username, display_name, bio, avatar_url, wallet_address, created_at")
    .eq("username", username)
    .maybeSingle<ProfileRow>();

  if (!profile) return null;

  const { data: stats } = await sb
    .from("profile_stats")
    .select("profile_id, total_received, supporters")
    .eq("profile_id", profile.id)
    .maybeSingle<ProfileStats>();

  return {
    profile,
    // An account that has received nothing has no row in the view yet, and the
    // honest reading of that is zero — not a missing total.
    stats: stats ?? { profile_id: profile.id, total_received: "0", supporters: 0 },
  };
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
