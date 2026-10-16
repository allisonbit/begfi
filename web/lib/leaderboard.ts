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

/* ------------------------------------------------------------------------- */
/* Top Earners — automatic payouts, and only those                            */
/* ------------------------------------------------------------------------- */

/**
 * WHO EARNED — wallets ranked by CONFIRMED automatic payouts, from both the
 * BegFi pool ($BEGFI) and every campaign (its own token). Reads the payout
 * ledger the sweeps wrote; a wallet with a `sent` row got a real transfer,
 * which is the only thing this board must show.
 */
export type EarnerRow = {
  wallet_address: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  paid: string; // $BEGFI base units only campaign rows are EXCLUDED by their token
  payouts: number;
};

export async function getTopEarners(limit = 25): Promise<{ rows: EarnerRow[]; dbFailed: boolean }> {
  if (!SUPABASE_CONFIGURED) return { rows: [], dbFailed: true };
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { rows: [], dbFailed: true };
  }

  // Only the BEGFI pool payouts rank here: campaign payouts are denominated
  // in whatever token the campaign chose — summing them into one number
  // would be adding meters to kilograms. The campaign-specific boards carry
  // those tokens on their OWN pages with the right decimals and unit.
  const { data, error } = await admin
    .from("earn_payouts")
    .select("wallet_address, amount::text")
    .eq("status", "sent")
    .is("campaign_id", null)
    .limit(10_000);
  if (error || !data) return { rows: [], dbFailed: true };

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, username, display_name, avatar_url, wallet_address")
    .eq("is_hidden", false)
    .limit(2_000);
  const byWallet = new Map((profiles ?? []).map((p) => [p.wallet_address.toLowerCase(), p as { username: string | null; display_name: string | null; avatar_url: string | null; wallet_address: string }]));

  const totals = new Map<string, { paid: bigint; n: number }>();
  for (const row of data as { wallet_address: string; amount: string }[]) {
    const t = totals.get(row.wallet_address) ?? { paid: 0n, n: 0 };
    t.paid += BigInt(row.amount);
    t.n += 1;
    totals.set(row.wallet_address, t);
  }

  const rows: EarnerRow[] = [...totals.entries()]
    .map(([wallet_address, t]) => ({
      wallet_address,
      username: byWallet.get(wallet_address)?.username ?? null,
      display_name: byWallet.get(wallet_address)?.display_name ?? null,
      avatar_url: byWallet.get(wallet_address)?.avatar_url ?? null,
      paid: t.paid.toString(),
      payouts: t.n,
    }))
    .sort((a, b) => (BigInt(b.paid) > BigInt(a.paid) ? 1 : -1))
    .slice(0, limit);
  return { rows, dbFailed: false };
}

/* ------------------------------------------------------------------------- */
/* Top Supporters — who has GIVEN the most, to anyone but themselves          */
/* ------------------------------------------------------------------------- */

export type SupporterRow = {
  wallet_address: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  given: string;
  recipients: number;
};

/**
 * WHO SUPPORTED — ranked by total confirmed outflow to OTHER wallets. Self-
 * sends are excluded in memory (the same anti-wash purge `rankWeek` applies),
 * so buying your own leaderboard crown stays a matter of real generosity.
 */
export async function getTopSupporters(limit = 25): Promise<{ rows: SupporterRow[]; dbFailed: boolean }> {
  if (!SUPABASE_CONFIGURED) return { rows: [], dbFailed: true };
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { rows: [], dbFailed: true };
  }

  const { data, error } = await admin.from("transfers").select("from_address, to_address, amount").limit(50_000);
  if (error || !data) return { rows: [], dbFailed: true };

  const given = new Map<string, { amount: bigint; recipients: Set<string> }>();
  for (const t of data as { from_address: string; to_address: string; amount: string }[]) {
    if (t.from_address === t.to_address) continue; // self-sends wash nobody upwards
    const g = given.get(t.from_address) ?? { amount: 0n, recipients: new Set<string>() };
    g.amount += BigInt(t.amount);
    g.recipients.add(t.to_address);
    given.set(t.from_address, g);
  }

  const { data: profiles } = await admin
    .from("profiles")
    .select("username, display_name, avatar_url, wallet_address")
    .eq("is_hidden", false)
    .limit(2_000);
  const byWallet = new Map((profiles ?? []).map((p) => [p.wallet_address.toLowerCase(), p as { username: string | null; display_name: string | null; avatar_url: string | null }]));

  const rows: SupporterRow[] = [...given.entries()]
    .map(([wallet_address, g]) => ({
      wallet_address,
      username: byWallet.get(wallet_address)?.username ?? null,
      display_name: byWallet.get(wallet_address)?.display_name ?? null,
      avatar_url: byWallet.get(wallet_address)?.avatar_url ?? null,
      given: g.amount.toString(),
      recipients: g.recipients.size,
    }))
    .sort((a, b) => (BigInt(b.given) > BigInt(a.given) ? 1 : -1))
    .slice(0, limit);
  return { rows, dbFailed: false };
}

/* ------------------------------------------------------------------------- */
/* Site Activity — the live feed, merged from real rows                        */
/* ------------------------------------------------------------------------- */

export type SiteActivityItem = {
  kind: "payout" | "beg" | "campaign_payout";
  text: string;
  at: string;
  tx: string | null;
  href: string | null;
};

/**
 * THE ACTIVITY FEED, from three real sources, newest first: confirmed
 * $BEGFI payouts (BegFi's pool), campaign payouts, and $BEGFI transfers
 * between wallets (begs). Nothing invented, nothing cached.
 */
export async function getSiteActivity(limit = 24): Promise<{ items: SiteActivityItem[]; dbFailed: boolean }> {
  if (!SUPABASE_CONFIGURED) return { items: [], dbFailed: true };
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { items: [], dbFailed: true };
  }

  const [payouts, begs] = await Promise.all([
    admin
      .from("earn_payouts")
      .select("wallet_address, username, amount::text, campaign_id, status, tx_hash, created_at, campaigns(slug, name, token_symbol)")
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(limit),
    admin.from("transfers").select("from_address, to_address, amount, tx_hash, block_time").order("block_time", { ascending: false }).limit(limit),
  ]);
  if (!payouts && begs) return { items: [], dbFailed: true };

  const items: SiteActivityItem[] = [];
  for (const p of (payouts?.data ?? []) as unknown as {
    wallet_address: string;
    username: string | null;
    amount: string;
    campaign_id: string | null;
    tx_hash: string | null;
    created_at: string;
    campaigns: { slug: string; name: string; token_symbol: string }[];
  }[]) {
    // The embedded `campaigns` comes back as an ARRAY (PostgREST does that
    // for to-one joins it cannot prove unique); take [0] honestly.
    const campaignInfo = p.campaigns?.[0];
    if (p.campaign_id && campaignInfo) {
      items.push({
        kind: "campaign_payout",
        text: `@${p.username ?? p.wallet_address.slice(0, 8)} earned ${formatCounter(BigInt(p.amount))} ${campaignInfo.token_symbol} in ${campaignInfo.name}`,
        at: p.created_at,
        tx: p.tx_hash,
        href: `/earn/${campaignInfo.slug}`,
      });
    } else if (!p.campaign_id) {
      items.push({
        kind: "payout",
        text: `@${p.username ?? p.wallet_address.slice(0, 8)} earned ${formatCounter(BigInt(p.amount))} $BEGFI from the BegFi pool`,
        at: p.created_at,
        tx: p.tx_hash,
        href: "/earn",
      });
    }
  }
  for (const t of (begs?.data ?? []) as { from_address: string; to_address: string; amount: string; tx_hash: string | null; block_time: string }[]) {
    if (t.from_address === t.to_address) continue;
    items.push({
      kind: "beg",
      text: `${formatCounter(BigInt(t.amount))} $BEGFI moved 0x…${t.from_address.slice(-4)} → 0x…${t.to_address.slice(-4)}`,
      at: t.block_time,
      tx: t.tx_hash,
      href: null,
    });
  }

  items.sort((a, b) => (a.at > b.at ? -1 : 1));
  return { items: items.slice(0, limit), dbFailed: false };
}

function formatCounter(value: bigint): string {
  const whole = value / 10n ** 18n;
  if (whole >= 1n) return whole.toLocaleString("en-GB");
  return `${value < 10n ** 17n ? "" : ""}${Number(value) / 1e18}`;
}

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
      /*
       * WHY THE ORDERING USES `total_received_units` AND THE DISPLAY DOES NOT.
       *
       * `total_received` is TEXT (migration 0026) so the digits survive
       * PostgREST — a `numeric` comes back as a float64 and a 24-digit base-unit
       * total loses its last digits on the way out. But text sorts
       * lexicographically, where "9" beats "10000": ranking on it would produce
       * a leaderboard that is simply wrong. `total_received_units` is the same
       * number as `numeric`, ordered inside Postgres where it is exact.
       */
      const { data, error } = await admin
        .from("profile_stats")
        .select("profile_id, total_received, supporters, profiles!inner(username, display_name, avatar_url, wallet_address, is_hidden)")
        .eq("profiles.is_hidden", false)
        .gt("total_received_units", "0")
        .order("total_received_units", { ascending: false })
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
