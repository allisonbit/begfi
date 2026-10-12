import "server-only";

import { createClient } from "@/lib/supabase/server";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

/**
 * Watchlist reads and writes, through the CALLER'S OWN session so the RLS
 * policy (`watchlist_own`) decides what rows exist for them — the same shape
 * as begs. There is no admin bypass here: a watchlist is personal, and reading
 * someone else's watchlist from the server "for convenience" would be the
 * exact privacy leak the policy forbids.
 */
export type WatchlistRow = {
  token_address: string;
  alert_on_move: boolean;
  alert_on_graduation: boolean;
  created_at: string;
};

export async function getWatchlist(): Promise<WatchlistRow[]> {
  if (!SUPABASE_CONFIGURED) return [];
  const sb = await createClient();

  const { data } = await sb
    .from("watchlist")
    .select("token_address, alert_on_move, alert_on_graduation, created_at")
    .order("created_at", { ascending: false });

  return (data as WatchlistRow[] | null) ?? [];
}

/** Whether a token is watched by the signed-in user (for the star states). */
export async function isWatched(tokenAddress: string): Promise<boolean> {
  if (!SUPABASE_CONFIGURED) return false;
  const sb = await createClient();

  const { data } = await sb
    .from("watchlist")
    .select("token_address")
    .eq("token_address", tokenAddress.toLowerCase())
    .maybeSingle();

  return data !== null;
}
