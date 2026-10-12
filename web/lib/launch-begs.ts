import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import type { Launch } from "@/lib/types";

/**
 * A "beg to launch": a launch someone is asking support toward, before it
 * exists.
 *
 * WHY THIS TABLE RATHER THAN A NEW "CAMPAIGN". A beg-to-launch is a beg with a
 * target and launch-specific copy. Everything that already exists does the
 * work: begs rows carry the ask and the goal, transfers confirm what really
 * arrived, and `launches` records what the money went on to do. This table
 * only adds the join a launch-beg needs that a normal beg does not: the
 * intended token name/ticker so the ask can say what supporters are funding,
 * and "funded_at" to record the moment the creator confirmed the launch
 * happened (entered by the creator with the tx hash of the real launch, which
 * /api/launch then verifies as usual).
 */

/**
 * One beg-to-launch per profile at a time. The unique index below is on
 * (profile_id) where active, which turns "open a new one" into "close the old
 * one first" without a transaction race.
 */

export type LaunchBeg = {
  id: string;
  profile_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  wallet_address: string;
  token_name: string;
  token_ticker: string;
  one_liner: string;
  goal: string;
  created_at: string;
  funded_at: string | null;
  funded_tx: string | null;
};

export type LaunchBegSupporter = {
  from_address: string;
  amount: string;
  block_time: string;
  tx_hash: string;
};

export async function getActiveLaunchBegForProfile(profileId: string): Promise<LaunchBeg | null> {
  if (!SUPABASE_CONFIGURED) return null;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("launch_begs")
    .select(
      "id, profile_id, token_name, token_ticker, one_liner, goal, created_at, funded_at, funded_tx, profiles!inner(username, display_name, avatar_url, wallet_address)",
    )
    .eq("profile_id", profileId)
    .is("funded_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      profile_id: string;
      token_name: string;
      token_ticker: string;
      one_liner: string;
      goal: string;
      created_at: string;
      funded_at: string | null;
      funded_tx: string | null;
    }>();

  if (error || !data) return null;

  const profiles = await admin
    .from("profiles")
    .select("username, display_name, avatar_url, wallet_address")
    .eq("id", data.profile_id)
    .maybeSingle<{ username: string; display_name: string | null; avatar_url: string | null; wallet_address: string }>();

  if (!profiles.data) return null;

  return {
    id: data.id,
    profile_id: data.profile_id,
    username: profiles.data.username,
    display_name: profiles.data.display_name,
    avatar_url: profiles.data.avatar_url,
    wallet_address: profiles.data.wallet_address,
    token_name: data.token_name,
    token_ticker: data.token_ticker,
    one_liner: data.one_liner,
    goal: data.goal,
    created_at: data.created_at,
    funded_at: data.funded_at,
    funded_tx: data.funded_tx,
  };
}

/**
 * The active launch begs for the /begs-to-launch index. Closed (funded) rows
 * appear on the creator's page with what they went on to launch; the index is
 * open asks only.
 */
export async function getActiveLaunchBegs(limit = 24): Promise<{ items: LaunchBeg[]; dbFailed: boolean }> {
  if (!SUPABASE_CONFIGURED) return { items: [], dbFailed: true };
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("launch_begs")
    .select(
      "id, profile_id, token_name, token_ticker, one_liner, goal, created_at, funded_at, funded_tx, profiles!inner(username, display_name, avatar_url, wallet_address, is_hidden)",
    )
    .is("funded_at", null)
    .eq("profiles.is_hidden", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return { items: [], dbFailed: true };

  return {
    items: (data as Array<(typeof data)[number] & { profiles: { username: string; display_name: string | null; avatar_url: string | null; wallet_address: string } }>).map((d) => ({
      id: d.id,
      profile_id: d.profile_id,
      username: d.profiles.username,
      display_name: d.profiles.display_name,
      avatar_url: d.profiles.avatar_url,
      wallet_address: d.profiles.wallet_address,
      token_name: d.token_name,
      token_ticker: d.token_ticker,
      one_liner: d.one_liner,
      goal: d.goal,
      created_at: d.created_at,
      funded_at: d.funded_at,
      funded_tx: d.funded_tx,
    })),
    dbFailed: false,
  };
}

/**
 * Everything one creator has ever begged towards launching, including the
 * ones they confirmed — for the profile page's token section, so a visitor can
 * see "asked for X, then launched X" as the chain shows it.
 */
export async function getLaunchBegsHistory(profileId: string): Promise<LaunchBeg[]> {
  if (!SUPABASE_CONFIGURED) return [];
  const admin = createAdminClient();

  const { data } = await admin
    .from("launch_begs")
    .select(
      "id, profile_id, token_name, token_ticker, one_liner, goal, created_at, funded_at, funded_tx, profiles!inner(username, display_name, avatar_url, wallet_address)",
    )
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(12);

  if (!data) return [];

  return (data as Array<(typeof data)[number] & { profiles: { username: string; display_name: string | null; avatar_url: string | null; wallet_address: string } }>).map((d) => ({
    id: d.id,
    profile_id: d.profile_id,
    username: d.profiles.username,
    display_name: d.profiles.display_name,
    avatar_url: d.profiles.avatar_url,
    wallet_address: d.profiles.wallet_address,
    token_name: d.token_name,
    token_ticker: d.token_ticker,
    one_liner: d.one_liner,
    goal: d.goal,
    created_at: d.created_at,
    funded_at: d.funded_at,
    funded_tx: d.funded_tx,
  }));
}

/**
 * Supporters of one launch beg: the transfers to the creator's wallet that
 * arrived after the beg was opened, newest first. Same rule as beg progress:
 * a transfer counts if the indexer confirmed it on the chain, and the beg's
 * own opening time is the boundary — money sent before the ask existed is not
 * counted toward it.
 */
export async function getLaunchBegSupporters(
  wallet: string,
  since: string,
  limit = 50,
): Promise<LaunchBegSupporter[]> {
  if (!SUPABASE_CONFIGURED) return [];
  const admin = createAdminClient();

  const { data } = await admin
    .from("transfers")
    .select("from_address, amount, block_time, tx_hash")
    .eq("to_address", wallet.toLowerCase())
    .gt("block_time", since)
    .order("block_time", { ascending: false })
    .limit(limit);

  return (data as LaunchBegSupporter[] | null) ?? [];
}

/**
 * Total raised for one beg: sum of confirmed transfers to the creator's wallet
 * since the beg opened. Computed here rather than in SQL only because the
 * supporters list is read anyway and this keeps one round trip.
 */
export function sumSupporters(rows: LaunchBegSupporter[]): bigint {
  let total = 0n;
  for (const row of rows) total += BigInt(row.amount);
  return total;
}

/**
 * The launch a funded beg went on to produce, when its creator linked one.
 * A funded beg that has not yet launched shows nothing here — that is a true
 * state, not an error.
 */
export async function getLaunchForBeg(launchBegId: string): Promise<Launch | null> {
  if (!SUPABASE_CONFIGURED) return null;
  const admin = createAdminClient();

  const { data } = await admin
    .from("launches")
    .select("*")
    .eq("from_launch_beg", launchBegId)
    .maybeSingle<Launch>();

  return (data as Launch | null) ?? null;
}
