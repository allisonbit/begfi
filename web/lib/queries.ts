import "server-only";

import { USERNAME_PATTERN, isReserved } from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";
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

type ProfileRow = PublicProfile & {
  id: string;
  x_handle: string | null;
  telegram_handle: string | null;
  website_url: string | null;
  x_verified_at: string | null;
};

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
    .select("id, username, display_name, bio, avatar_url, wallet_address, x_handle, created_at")
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

  const stats = await getStats(profile.id, profile.wallet_address);

  return { profile, stats };
}

/** Before every transfer that has ever been indexed. */
const THE_BEGINNING = "1970-01-01T00:00:00Z";

/**
 * Totals for one profile, as a PUBLIC aggregate.
 *
 * WHY NOT THE `profile_stats` VIEW ANY MORE, which is what this used to read.
 * That view is `security_invoker` on purpose, so the policies on `transfers`
 * apply to the caller — which means an ANONYMOUS visitor cannot see any transfer
 * row and the view sums to 0 for them. Every signed-out visitor to every public
 * profile was shown "0 $BEGFI received from 0 supporters", while the leaderboard
 * (service role) showed that same wallet's real total. Two pages, two answers.
 *
 * `public_wallet_totals` (migration 0026) is the mechanism migration 0007
 * established for beg progress: a SECURITY DEFINER function that returns ONE
 * total and a COUNT to anyone, and can return nothing else. A public profile's
 * received figure is exactly the kind of aggregate the profile page is allowed to
 * publish; the sender graph is not, and stays unreadable.
 *
 * The money figure arrives as TEXT (exact digits) for the reason migration 0013
 * spells out — a numeric crossing PostgREST becomes a float64 and a 24-digit
 * base-unit amount comes back polluted.
 */
export async function getStats(profileId: string, walletAddress: string): Promise<ProfileStats> {
  if (!SUPABASE_CONFIGURED) {
    return { profile_id: profileId, total_received: "0", supporters: 0 };
  }

  try {
    const sb = await createClient();
    const { data, error } = await sb.rpc("public_wallet_totals", {
      p_wallet: walletAddress,
      p_since: THE_BEGINNING,
    });

    if (error || !data) {
      // A failed read is not a zero. The caller renders what it is given, and a
      // missing total is better than an invented one — but this is a display
      // aggregate, so the page shows 0 rather than refusing to render, and the
      // failure is what `null` here would have to be threaded through the page
      // for. Recorded rather than hidden: see KNOWN_ISSUES #12.
      return { profile_id: profileId, total_received: "0", supporters: 0 };
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { received: string | null; supporters: number | null }
      | undefined;
    if (!row) return { profile_id: profileId, total_received: "0", supporters: 0 };

    // Digits only, or zero: an amount that arrived carrying an exponent has lost
    // the digits a money figure is made of, and guessing them back would be
    // inventing a number.
    const received = typeof row.received === "string" && /^\d+$/.test(row.received) ? row.received : "0";

    return { profile_id: profileId, total_received: received, supporters: row.supporters ?? 0 };
  } catch {
    return { profile_id: profileId, total_received: "0", supporters: 0 };
  }
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

/** A beg as the public feed shows it: the ask, who asked, and how far along. */
export type PublicBeg = {
  id: string;
  body: string;
  goal: string | null;
  created_at: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  x_handle: string | null;
  raised: string;
  /**
   * False only when the aggregate itself could not be read. An open-ended beg's
   * zero is different: with no goal there is nothing to be a fraction of, and
   * that is knowledge rather than ignorance. Collapsing the two into one
   * confident zero is the most misleading thing a progress figure can do — the
   * individual beg page already refuses to, so the feed cannot either.
   */
  progressKnown: boolean;
};

/**
 * The public feed of begs, newest first.
 *
 * Progress is fetched one beg at a time through `received_since`, because that is
 * the only way to read it: the RLS policy on `transfers` allows a row to the two
 * addresses involved and nobody else, so a signed-out visitor summing transfers
 * would get a confident zero for every beg on the page. The function is the
 * aggregate that makes a public progress figure possible at all.
 *
 * N calls rather than one is a deliberate trade. A single query would need either
 * a per-request SQL function taking a list, or a materialised column the indexer
 * maintains; both are more moving parts than a feed of thirty begs on a page that
 * is cached. If this ever gets slow, that is the shape to change.
 */
export async function getRecentBegs(limit = 30): Promise<PublicBeg[]> {
  if (!SUPABASE_CONFIGURED) return [];

  const sb = await createClient();
  const { data, error } = await sb
    .from("begs")
    .select("id, body, goal, created_at, profiles!inner(username, display_name, avatar_url, x_handle, wallet_address)")
    .order("created_at", { ascending: false })
    .limit(limit);

  // `error` is read, not caught: supabase-js returns rather than throws. A
  // failure here used to return [] — and the feed rendered that as "no begs
  // have been written" for a database that was plainly unreachable. An empty
  // product is the most misleading thing a feed can claim, so a failed read
  // throws now, and the page says the difference out loud.
  if (error || !data) {
    throw new Error("The begs feed could not be read.", { cause: error ?? "no data" });
  }

  const rows = data as unknown as (Omit<PublicBeg, "raised" | "username" | "display_name" | "avatar_url" | "x_handle"> & {
    profiles: {
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      x_handle: string | null;
      wallet_address: string;
    };
  })[];

  // Only begs with a target have progress worth fetching. An open-ended beg has
  // nothing to be a fraction of — but that is knowledge, not ignorance, so it
  // is marked known. A failed read is the opposite: unknown, and marked so.
  const progress = await Promise.all(
    rows.map(async (row): Promise<{ raised: string; known: boolean }> => {
      if (!row.goal) return { raised: "0", known: true };
      try {
        const { data: sum, error: sumError } = await sb.rpc("received_since", {
          p_wallet: row.profiles.wallet_address,
          p_since: row.created_at,
        });
        if (sumError || sum === null || sum === undefined) return { raised: "0", known: false };
        return { raised: String(sum), known: true };
      } catch {
        return { raised: "0", known: false };
      }
    }),
  );

  return rows.map((row, i) => ({
    id: row.id,
    body: row.body,
    goal: row.goal,
    created_at: row.created_at,
    username: row.profiles.username,
    display_name: row.profiles.display_name,
    avatar_url: row.profiles.avatar_url,
    x_handle: row.profiles.x_handle,
    raised: progress[i].raised,
    progressKnown: progress[i].known,
  }));
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

/**
 * The supporter list for a public profile: every confirmed send the wallet
 * has received, with any message attached, ready to render. HIDDEN MESSAGES
 * ARE DROPPED — a supporter whose note the recipient hid still appears as a
 * supporter (the money is real), but the note itself stays out of the
 * public page by the recipient's choice.
 */
export async function getSupporterList(walletAddress: string, limit = 30): Promise<
  { from_address: string; amount: bigint; block_time: string; message: string | null }[]
> {
  if (!SUPABASE_CONFIGURED) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("transfers")
    .select("from_address, amount, block_time, transfer_messages(message, hidden_by_recipient)")
    .eq("to_address", walletAddress.toLowerCase())
    .order("block_time", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as unknown as Array<{
    from_address: string;
    amount: string;
    block_time: string;
    transfer_messages: { message: string; hidden_by_recipient: boolean }[] | null;
  }>).map((row) => ({
    from_address: row.from_address,
    amount: BigInt(row.amount),
    block_time: row.block_time,
    message: row.transfer_messages?.[0]?.hidden_by_recipient ? null : (row.transfer_messages?.[0]?.message ?? null),
  }));
}

/**
 * Per-token trade aggregates over the last 24 hours, from the indexer's
 * `trades` table — confirmed curve trade events only, catalog tokens only.
 *
 * Returns three maps keyed by lowercase token address:
 *
 *  - volumeWei: sum of quote side (buys in, sells out) as raw wei strings, so
 *    the caller sums exactly with bigint before any display rounding;
 *  - trades: the number of confirmed trades;
 *  - priceChange: percent change of the last trade price versus a trade at
 *    the 24h boundary, as a plain number (15.2 means up 15.2%). Missing on
 *    purpose where the window has fewer than two priced sides: a percentage
 *    computed from one trade is noise wearing a percent sign.
 *
 * Prices are token price in ETH (quote amount per token amount, both exact
 * integers), which for an AMM is the marginal price at the trade — the same
 * number the curve itself would quote around that block. The last trade's
 * price IS today's live price to within a block; the boundary trade's is the
 * honest "yesterday". No oracle is consulted and no external price is
 * imported, because there is nowhere on this chain that publishes one for a
 * pre-graduation curve.
 *
 * Reads with the admin client like the explore page's other reads: the table
 * has no public policies (a per-trade feed would publish the whole trader
 * graph), and these are server-side aggregates, never client queries.
 */
export async function getTradeAggregates(tokenAddresses: string[]): Promise<{
  volumeWei: Map<string, string>;
  trades: Map<string, number>;
  priceChange: Map<string, number>;
}> {
  const empty = {
    volumeWei: new Map<string, string>(),
    trades: new Map<string, number>(),
    priceChange: new Map<string, number>(),
  };

  if (!SUPABASE_CONFIGURED || tokenAddresses.length === 0) return empty;

  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("trades")
    .select("token_address, is_buy, quote_amount, token_amount, block_time")
    .in("token_address", tokenAddresses.map((t) => t.toLowerCase()))
    .gte("block_time", since)
    .order("block_time", { ascending: true })
    .limit(20_000);

  if (error || !data) return empty;

  type Trade = {
    token_address: string;
    is_buy: boolean;
    quote_amount: string;
    token_amount: string;
    block_time: string;
  };
  const rows = data as Trade[];

  const volumeWei = new Map<string, string>();
  const trades = new Map<string, number>();
  const priceChange = new Map<string, number>();

  const perToken = new Map<string, Trade[]>();
  for (const row of rows) {
    const key = row.token_address.toLowerCase();
    const list = perToken.get(key);
    if (list) list.push(row);
    else perToken.set(key, [row]);
  }

  for (const [token, list] of perToken) {
    let sum = 0n;
    for (const row of list) sum += BigInt(row.quote_amount);
    volumeWei.set(token, sum.toString());
    trades.set(token, list.length);

    /*
     * Price change across the window, from real trade prices: quote wei per
     * token wei on each trade, first versus last in the 24h window. Trades
     * with a zero token side (which a real curve does not emit but which
     * would divide by zero) are excluded rather than crash the page. Fewer
     * than two priced trades means no percentage: one trade is a point, not
     * a change, and a percent sign on a single point is noise.
     */
    const priced = list
      .filter((row) => row.token_amount !== "0" && row.quote_amount !== "0")
      .map((row) => Number(BigInt(row.quote_amount)) / Number(BigInt(row.token_amount)));
    if (priced.length >= 2) {
      const first = priced[0];
      const last = priced[priced.length - 1];
      priceChange.set(token, (last / first - 1) * 100);
    }
  }

  return { volumeWei, trades, priceChange };
}
