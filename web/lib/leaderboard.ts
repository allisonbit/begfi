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
};

export async function getLeaderboard(limit = 25): Promise<{ rows: LeaderRow[]; dbFailed: boolean }> {
  if (!SUPABASE_CONFIGURED) return { rows: [], dbFailed: true };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { rows: [], dbFailed: true };
  }

  const { data, error } = await admin
    .from("profile_stats")
    .select("profile_id, total_received, supporters, profiles!inner(username, display_name, avatar_url, wallet_address, is_hidden)")
    .eq("profiles.is_hidden", false)
    .gt("total_received", "0")
    .order("total_received", { ascending: false })
    .limit(limit);

  if (error || !data) return { rows: [], dbFailed: true };

  /*
   * The embedded profiles come back as an ARRAY (PostgREST does that when the
   * relationship could be one-to-many; here it is exactly one per row because
   * profile_id is unique). Taking [0] after the array check keeps the type
   * honest without pretending the shape to be something it is not.
   */
  return {
    rows: data.flatMap((d) => {
      const p = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
      if (!p) return [];
      return [{
        username: p.username,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        wallet_address: p.wallet_address,
        total_received: d.total_received,
        supporters: d.supporters,
      }];
    }),
    dbFailed: false,
  };
}
