import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import { EXCLUDED_SENDER_WALLETS, weekStart } from "@/lib/battles";
import { TOKEN_CA, TOKEN_CONFIGURED } from "@/lib/config";
import { formatAmount } from "@/lib/erc20";

/**
 * The public boards' single read layer.
 *
 * ONE WINDOW DEFINITION, ONE RULE PER BOARD. A leaderboard is a claim about
 * money, so every number here comes from a confirmed row: a `sent` payout in
 * the ledger the sweeps wrote, or a confirmed transfer the indexer recorded.
 * Nothing is estimated, nothing is summed across tokens (adding one campaign's
 * token to another's is adding metres to kilograms), and a failed read is
 * returned as `failed: true` rather than as an empty board — an empty board is
 * a statement about the world, and a database that did not answer has not made
 * one.
 *
 * THE THREE WINDOWS. `day` is the rolling last 24 hours, `week` starts Monday
 * 00:00 UTC (the same boundary the Beg Battle freezes on, imported rather than
 * re-derived so the two cannot drift), `all` has no lower bound.
 *
 * WHY "BEGGED" EXCLUDES SOME SENDERS. An earn payout arrives as a transfer to
 * the earner's wallet, so summing every transfer into a profile would rank the
 * biggest earner as the biggest beggar and make two tabs show one fact. The
 * payout wallets and the fee wallet in `EXCLUDED_SENDER_WALLETS` are program
 * activity, not support, and every received/supporters number here excludes
 * them. The same list already governs the weekly battle.
 */

export type LeaderWindow = "day" | "week" | "all";

export const LEADER_WINDOWS: { key: LeaderWindow; label: string }[] = [
  { key: "day", label: "Last 24h" },
  { key: "week", label: "This week" },
  { key: "all", label: "All time" },
];

/** ISO instant the window starts at, or null for all-time. */
export function windowSince(window: LeaderWindow): string | null {
  if (window === "all") return null;
  if (window === "week") return new Date(`${weekStart()}T00:00:00Z`).toISOString();
  return new Date(Date.now() - 24 * 3600_000).toISOString();
}

export function parseWindow(value: string | undefined): LeaderWindow {
  return value === "day" || value === "week" ? value : "all";
}

type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  wallet_address: string;
};

function adminOrNull() {
  if (!SUPABASE_CONFIGURED) return null;
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

/** Every visible profile, keyed by lowercased wallet. Bounded; see note below. */
async function profilesByWallet(admin: ReturnType<typeof createAdminClient>): Promise<Map<string, Profile>> {
  /*
   * The bound is honest about what this is: a lookup table for naming a row
   * that already exists, not a query filter. A profile missing from it still
   * ranks — it prints as a short address, which is the truth — so the cap can
   * never change a total, only a label.
   */
  const { data } = await admin
    .from("profiles")
    .select("id, username, display_name, avatar_url, wallet_address")
    .eq("is_hidden", false)
    .limit(5_000);
  return new Map(
    ((data ?? []) as Profile[]).map((p) => [p.wallet_address.toLowerCase(), p]),
  );
}

/* ------------------------------------------------------------------------- */
/* Top Earners — confirmed automatic payouts from BegFi's own pool            */
/* ------------------------------------------------------------------------- */

export type EarnerRow = {
  wallet_address: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  paid: string;
  payouts: number;
};

/**
 * Only $BEGFI pool payouts rank here. Campaign payouts are denominated in the
 * campaign's own token, and their board is the campaigns tab, where each total
 * is shown with the unit it was actually paid in.
 */
export async function getTopEarners(
  limit = 25,
  window: LeaderWindow = "all",
): Promise<{ rows: EarnerRow[]; dbFailed: boolean }> {
  const admin = adminOrNull();
  if (!admin) return { rows: [], dbFailed: true };

  const since = windowSince(window);
  let query = admin
    .from("earn_payouts")
    .select("wallet_address, amount::text, created_at")
    .eq("status", "sent")
    .is("campaign_id", null)
    .limit(20_000);
  if (since) query = query.gte("created_at", since);

  const { data, error } = await query;
  if (error || !data) return { rows: [], dbFailed: true };

  const profiles = await profilesByWallet(admin);
  const totals = new Map<string, { paid: bigint; n: number }>();
  for (const row of data as { wallet_address: string; amount: string }[]) {
    const wallet = row.wallet_address.toLowerCase();
    const t = totals.get(wallet) ?? { paid: 0n, n: 0 };
    t.paid += BigInt(row.amount);
    t.n += 1;
    totals.set(wallet, t);
  }

  const rows: EarnerRow[] = [...totals.entries()]
    .map(([wallet_address, t]) => {
      const p = profiles.get(wallet_address);
      return {
        wallet_address,
        username: p?.username ?? null,
        display_name: p?.display_name ?? null,
        avatar_url: p?.avatar_url ?? null,
        paid: t.paid.toString(),
        payouts: t.n,
      };
    })
    .sort((a, b) =>
      BigInt(b.paid) === BigInt(a.paid) ? b.payouts - a.payouts : BigInt(b.paid) > BigInt(a.paid) ? 1 : -1,
    )
    .slice(0, limit);
  return { rows, dbFailed: false };
}

/* ------------------------------------------------------------------------- */
/* Top Begged — confirmed support received, program payouts excluded          */
/* ------------------------------------------------------------------------- */

export type BeggedRow = {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  wallet_address: string;
  received: string;
  supporters: number;
};

type TransferRow = {
  to_address: string;
  from_address: string;
  amount: string;
  block_time: string;
};

/**
 * Computed from confirmed transfers rather than `profile_stats`, because the
 * view cannot exclude the payout wallets and this board must. The read is
 * bounded — the same 50k-row ceiling the supporters board always used — and
 * the aggregation is exact base-unit arithmetic, never a float.
 */
export async function getTopBegged(
  limit = 25,
  window: LeaderWindow = "all",
): Promise<{ rows: BeggedRow[]; dbFailed: boolean }> {
  const admin = adminOrNull();
  if (!admin) return { rows: [], dbFailed: true };

  const since = windowSince(window);
  let query = admin
    .from("transfers")
    .select("to_address, from_address, amount, block_time")
    .limit(50_000);
  if (since) query = query.gte("block_time", since);

  const { data, error } = await query;
  if (error || !data) return { rows: [], dbFailed: true };

  const profiles = await profilesByWallet(admin);
  const totals = new Map<string, { received: bigint; supporters: Set<string> }>();
  for (const row of data as TransferRow[]) {
    const to = row.to_address.toLowerCase();
    const from = row.from_address.toLowerCase();
    if (from === to || EXCLUDED_SENDER_WALLETS.has(from)) continue;
    const entry = totals.get(to) ?? { received: 0n, supporters: new Set<string>() };
    entry.received += BigInt(row.amount);
    entry.supporters.add(from);
    totals.set(to, entry);
  }

  const rows: BeggedRow[] = [...totals.entries()]
    .flatMap(([wallet_address, t]) => {
      const p = profiles.get(wallet_address);
      // A ranking of wallets nobody owns is not a ranking of beggars.
      if (!p?.username) return [];
      return [
        {
          username: p.username,
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          wallet_address,
          received: t.received.toString(),
          supporters: t.supporters.size,
        },
      ];
    })
    .sort((a, b) => (BigInt(b.received) > BigInt(a.received) ? 1 : -1))
    .slice(0, limit);
  return { rows, dbFailed: false };
}

/* ------------------------------------------------------------------------- */
/* Top Supporters — confirmed outflow to somebody else                        */
/* ------------------------------------------------------------------------- */

export type SupporterRow = {
  wallet_address: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  given: string;
  recipients: number;
};

export async function getTopSupporters(
  limit = 25,
  window: LeaderWindow = "all",
): Promise<{ rows: SupporterRow[]; dbFailed: boolean }> {
  const admin = adminOrNull();
  if (!admin) return { rows: [], dbFailed: true };

  const since = windowSince(window);
  let query = admin
    .from("transfers")
    .select("from_address, to_address, amount, block_time")
    .limit(50_000);
  if (since) query = query.gte("block_time", since);

  const { data, error } = await query;
  if (error || !data) return { rows: [], dbFailed: true };

  const profiles = await profilesByWallet(admin);
  const given = new Map<string, { amount: bigint; recipients: Set<string> }>();
  for (const t of data as TransferRow[]) {
    const from = t.from_address.toLowerCase();
    const to = t.to_address.toLowerCase();
    // Self-sends wash nobody upwards, and a payout wallet paying earners is
    // program activity rather than generosity.
    if (from === to || EXCLUDED_SENDER_WALLETS.has(from)) continue;
    const g = given.get(from) ?? { amount: 0n, recipients: new Set<string>() };
    g.amount += BigInt(t.amount);
    g.recipients.add(to);
    given.set(from, g);
  }

  const rows: SupporterRow[] = [...given.entries()]
    .map(([wallet_address, g]) => {
      const p = profiles.get(wallet_address);
      return {
        wallet_address,
        username: p?.username ?? null,
        display_name: p?.display_name ?? null,
        avatar_url: p?.avatar_url ?? null,
        given: g.amount.toString(),
        recipients: g.recipients.size,
      };
    })
    .sort((a, b) => (BigInt(b.given) > BigInt(a.given) ? 1 : -1))
    .slice(0, limit);
  return { rows, dbFailed: false };
}

/* ------------------------------------------------------------------------- */
/* Top Givers — who funds the pools other people take from                    */
/* ------------------------------------------------------------------------- */

export type GiverRow = {
  wallet_address: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  pools: number;
  campaigns: number;
  drops: number;
};

/**
 * RANKED BY POOLS FUNDED, NOT BY A SUM. Campaign deposits and drop deposits can
 * be in different tokens, so their amounts have no common unit; adding them
 * would be adding metres to kilograms. The number of distinct pools a wallet
 * put money into is comparable, and it is the thing the plan's "Top Givers" is
 * actually asking about.
 *
 * Draft campaigns are excluded: a test deposit into a campaign nobody can open
 * is not public generosity, and it is not allowed to top a public board.
 */
export async function getTopGivers(
  limit = 25,
  window: LeaderWindow = "all",
): Promise<{ rows: GiverRow[]; dbFailed: boolean }> {
  const admin = adminOrNull();
  if (!admin) return { rows: [], dbFailed: true };

  const since = windowSince(window);

  const campaignQuery = admin.from("campaign_deposits").select("depositor, campaign_id, created_at").limit(20_000);
  const dropQuery = admin.from("drop_deposits").select("depositor, drop_id, created_at").limit(20_000);

  const [campaignDeposits, dropDeposits, campaigns] = await Promise.all([
    since ? campaignQuery.gte("created_at", since) : campaignQuery,
    since ? dropQuery.gte("created_at", since) : dropQuery,
    admin.from("campaigns").select("id, status").limit(5_000),
  ]);
  if (campaignDeposits.error || dropDeposits.error || campaigns.error) {
    return { rows: [], dbFailed: true };
  }

  const publicCampaigns = new Set(
    ((campaigns.data ?? []) as { id: string; status: string }[])
      .filter((c) => c.status !== "draft")
      .map((c) => c.id),
  );

  const funded = new Map<string, { campaigns: Set<string>; drops: Set<string> }>();
  const bump = (wallet: string, kind: "campaigns" | "drops", id: string) => {
    const entry = funded.get(wallet) ?? { campaigns: new Set<string>(), drops: new Set<string>() };
    entry[kind].add(id);
    funded.set(wallet, entry);
  };
  for (const row of (campaignDeposits.data ?? []) as { depositor: string; campaign_id: string }[]) {
    if (!publicCampaigns.has(row.campaign_id)) continue;
    bump(row.depositor.toLowerCase(), "campaigns", row.campaign_id);
  }
  for (const row of (dropDeposits.data ?? []) as { depositor: string; drop_id: string }[]) {
    bump(row.depositor.toLowerCase(), "drops", row.drop_id);
  }

  const profiles = await profilesByWallet(admin);
  const rows: GiverRow[] = [...funded.entries()]
    .map(([wallet_address, f]) => {
      const p = profiles.get(wallet_address);
      return {
        wallet_address,
        username: p?.username ?? null,
        display_name: p?.display_name ?? null,
        avatar_url: p?.avatar_url ?? null,
        pools: f.campaigns.size + f.drops.size,
        campaigns: f.campaigns.size,
        drops: f.drops.size,
      };
    })
    .sort((a, b) => b.pools - a.pools || b.campaigns - a.campaigns)
    .slice(0, limit);
  return { rows, dbFailed: false };
}

/* ------------------------------------------------------------------------- */
/* Most Active — things a person did, counted per profile                     */
/* ------------------------------------------------------------------------- */

export type ActiveRow = {
  profile_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  begs: number;
  pay_links: number;
  campaign_posts: number;
  drop_claims: number;
  total: number;
};

/**
 * FOUR KINDS OF ACTION, because "active" without a definition is a vibe.
 * Posting a beg, creating a pay link, entering a campaign and claiming a drop
 * are all public acts that leave a row; money moving is deliberately NOT one,
 * because that is what the earners and supporters boards already measure.
 */
export async function getMostActive(
  limit = 25,
  window: LeaderWindow = "all",
): Promise<{ rows: ActiveRow[]; dbFailed: boolean }> {
  const admin = adminOrNull();
  if (!admin) return { rows: [], dbFailed: true };

  const since = windowSince(window);
  const withWindow = <T extends { gte: (column: string, value: string) => T }>(q: T): T =>
    since ? q.gte("created_at", since) : q;

  const [begs, links, posts, claims] = await Promise.all([
    withWindow(admin.from("begs").select("profile_id").limit(20_000)),
    withWindow(admin.from("pay_links").select("owner_id").limit(20_000)),
    withWindow(admin.from("campaign_submissions").select("user_id").limit(20_000)),
    withWindow(admin.from("drop_claims").select("user_id").limit(20_000)),
  ]);

  if (begs.error || links.error || posts.error || claims.error) {
    return { rows: [], dbFailed: true };
  }

  const counts = new Map<string, { begs: number; pay_links: number; campaign_posts: number; drop_claims: number }>();
  const bump = (id: string, key: "begs" | "pay_links" | "campaign_posts" | "drop_claims") => {
    const c = counts.get(id) ?? { begs: 0, pay_links: 0, campaign_posts: 0, drop_claims: 0 };
    c[key] += 1;
    counts.set(id, c);
  };
  for (const r of (begs.data ?? []) as { profile_id: string }[]) bump(r.profile_id, "begs");
  for (const r of (links.data ?? []) as { owner_id: string }[]) bump(r.owner_id, "pay_links");
  for (const r of (posts.data ?? []) as { user_id: string }[]) bump(r.user_id, "campaign_posts");
  for (const r of (claims.data ?? []) as { user_id: string }[]) bump(r.user_id, "drop_claims");

  const top = [...counts.entries()]
    .map(([profile_id, c]) => ({ profile_id, ...c, total: c.begs + c.pay_links + c.campaign_posts + c.drop_claims }))
    .sort((a, b) => b.total - a.total || b.begs - a.begs)
    .slice(0, limit);
  if (top.length === 0) return { rows: [], dbFailed: false };

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", top.map((t) => t.profile_id));
  const byId = new Map(
    ((profiles ?? []) as Omit<Profile, "wallet_address">[]).map((p) => [p.id, p]),
  );

  const rows: ActiveRow[] = top.flatMap((t) => {
    const p = byId.get(t.profile_id);
    if (!p?.username) return [];
    return [{
      profile_id: t.profile_id,
      username: p.username,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
      begs: t.begs,
      pay_links: t.pay_links,
      campaign_posts: t.campaign_posts,
      drop_claims: t.drop_claims,
      total: t.total,
    }];
  });
  return { rows, dbFailed: false };
}

/* ------------------------------------------------------------------------- */
/* Top Campaigns — ranked by people paid, totals kept in their own token      */
/* ------------------------------------------------------------------------- */

export type CampaignLeaderRow = {
  id: string;
  slug: string;
  name: string;
  token_symbol: string;
  token_decimals: number;
  logo_url: string | null;
  payouts: number;
  earners: number;
  paid: string;
};

/**
 * Ranked by DISTINCT PEOPLE PAID, not by a sum. Two campaigns can pay in two
 * different tokens, so their totals are not comparable; the number of people a
 * campaign actually paid is. Each row still shows its own total, in its own
 * unit, because that is a fact about that campaign alone.
 */
export async function getTopCampaigns(
  limit = 25,
  window: LeaderWindow = "all",
): Promise<{ rows: CampaignLeaderRow[]; dbFailed: boolean }> {
  const admin = adminOrNull();
  if (!admin) return { rows: [], dbFailed: true };

  const since = windowSince(window);
  let query = admin
    .from("earn_payouts")
    .select("campaign_id, wallet_address, amount::text, created_at")
    .eq("status", "sent")
    .not("campaign_id", "is", null)
    .limit(50_000);
  if (since) query = query.gte("created_at", since);

  const { data, error } = await query;
  if (error || !data) return { rows: [], dbFailed: true };

  const grouped = new Map<string, { paid: bigint; wallets: Set<string>; payouts: number }>();
  for (const row of data as { campaign_id: string; wallet_address: string; amount: string }[]) {
    const g = grouped.get(row.campaign_id) ?? { paid: 0n, wallets: new Set<string>(), payouts: 0 };
    g.paid += BigInt(row.amount);
    g.wallets.add(row.wallet_address.toLowerCase());
    g.payouts += 1;
    grouped.set(row.campaign_id, g);
  }

  /*
   * No slice before the draft filter: a draft hidden after the cut would
   * silently shrink the board even though a public campaign sat just behind
   * it. The full payout-bearing set is small, so it is all fetched, filtered,
   * and only then cut to `limit`.
   */
  const top = [...grouped.entries()]
    .map(([id, g]) => ({ id, ...g }))
    .sort((a, b) => b.wallets.size - a.wallets.size || b.payouts - a.payouts);
  if (top.length === 0) return { rows: [], dbFailed: false };

  const { data: campaigns } = await admin
    .from("campaigns")
    .select("id, slug, name, token_symbol, token_decimals, logo_url, status")
    .in("id", top.map((t) => t.id));
  const byId = new Map(
    ((campaigns ?? []) as {
      id: string;
      slug: string;
      name: string;
      token_symbol: string;
      token_decimals: number;
      logo_url: string | null;
      status: string;
    }[])
      /*
       * A DRAFT CAMPAIGN IS NOT PUBLIC, so its test payouts are not a public
       * ranking. The row stays in the ledger (money facts are append-only),
       * but it cannot appear on a board that names a campaign nobody can visit.
       */
      .filter((c) => c.status !== "draft")
      .map((c) => [c.id, c]),
  );

  const rows: CampaignLeaderRow[] = top.flatMap((t) => {
    const c = byId.get(t.id);
    if (!c) return [];
    return [{
      id: c.id,
      slug: c.slug,
      name: c.name,
      token_symbol: c.token_symbol,
      token_decimals: c.token_decimals,
      logo_url: c.logo_url,
      payouts: t.payouts,
      earners: t.wallets.size,
      paid: t.paid.toString(),
    }];
  });
  return { rows: rows.slice(0, limit), dbFailed: false };
}

/* ------------------------------------------------------------------------- */
/* Holders — read from the chain's explorer, named from our profiles          */
/* ------------------------------------------------------------------------- */

export type HolderRow = {
  address: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  balance: string;
};

/** What the market feed knows when the explorer's named list is unavailable. */
export type HolderSummary = {
  count: number;
  top10Pct: string | null;
  restPct: string | null;
  asOf: string | null;
};

type BlockscoutHolders = {
  items?: {
    address?: { hash?: string; name?: string | null; is_contract?: boolean };
    value?: string;
  }[];
};

type GeckoTokenInfo = {
  data?: {
    attributes?: {
      holders?: {
        count?: number;
        last_updated?: string;
        distribution_percentage?: { top_10?: string; rest?: string };
      };
    };
  };
};

/**
 * THE ONE BOARD THAT IS NOT READ FROM OUR DATABASE. A holder balance is a fact
 * about the token contract, and this site's `transfers` table is an index that
 * starts from the first block it scanned — deriving balances from it would
 * publish a number that is wrong for anyone who bought before that block. The
 * explorer already computes the real thing, keyed off the pinned CA.
 *
 * A failure is `failed: true`, never an empty list: "the explorer did not
 * answer" and "nobody holds this token" are different claims.
 */
export async function getTopHolders(limit = 25): Promise<{
  rows: HolderRow[];
  dbFailed: boolean;
  summary: HolderSummary | null;
}> {
  if (!TOKEN_CONFIGURED) return { rows: [], dbFailed: true, summary: null };

  /*
   * TWO SOURCES, for two different questions. The explorer names the largest
   * accounts; the market feed says how many holders there are and how
   * concentrated the top ten are. The explorer is behind a bot challenge that
   * answers some networks and not others, so the concentration card is the
   * fallback that keeps this tab a real board instead of an apology. Neither
   * source is allowed to become an invented list.
   */
  const [explorer, feed] = await Promise.all([
    (async (): Promise<BlockscoutHolders | null> => {
      try {
        const res = await fetch(
          `https://robinhoodchain.blockscout.com/api/v2/tokens/${TOKEN_CA}/holders`,
          { next: { revalidate: 300 } },
        );
        return res.ok ? ((await res.json().catch(() => null)) as BlockscoutHolders | null) : null;
      } catch {
        return null;
      }
    })(),
    (async (): Promise<HolderSummary | null> => {
      try {
        const res = await fetch(
          `https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/${TOKEN_CA}/info`,
          { next: { revalidate: 300 } },
        );
        if (!res.ok) return null;
        const body = (await res.json().catch(() => null)) as GeckoTokenInfo | null;
        const holders = body?.data?.attributes?.holders;
        if (typeof holders?.count !== "number" || !Number.isFinite(holders.count)) return null;
        return {
          count: holders.count,
          top10Pct: holders.distribution_percentage?.top_10 ?? null,
          restPct: holders.distribution_percentage?.rest ?? null,
          asOf: holders.last_updated ?? null,
        };
      } catch {
        return null;
      }
    })(),
  ]);

  const items = (explorer?.items ?? [])
    .filter((item): item is { address: { hash: string }; value: string } =>
      Boolean(item.address?.hash && item.value && /^\d+$/.test(item.value)),
    )
    .sort((a, b) => (BigInt(b.value) > BigInt(a.value) ? 1 : -1))
    .slice(0, limit);
  if (items.length === 0) return { rows: [], dbFailed: !feed, summary: feed };

  const admin = adminOrNull();
  const profiles = admin ? await profilesByWallet(admin) : new Map<string, Profile>();

  const rows: HolderRow[] = items.map((item) => {
    const address = item.address.hash.toLowerCase();
    const p = profiles.get(address);
    return {
      address,
      username: p?.username ?? null,
      display_name: p?.display_name ?? null,
      avatar_url: p?.avatar_url ?? null,
      balance: item.value,
    };
  });
  return { rows, dbFailed: false, summary: feed };
}

/* ------------------------------------------------------------------------- */
/* Site Activity — the live feed, merged from real rows                       */
/* ------------------------------------------------------------------------- */

export type SiteActivityItem = {
  kind: "payout" | "beg" | "campaign_payout" | "drop_payout" | "drop" | "campaign";
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
  const admin = adminOrNull();
  if (!admin) return { items: [], dbFailed: true };

  const [payouts, begs, drops, campaigns] = await Promise.all([
    admin
      .from("earn_payouts")
      .select(
        "wallet_address, username, amount::text, campaign_id, drop_id, status, tx_hash, created_at, campaigns(slug, name, token_symbol, status), drops(name)",
      )
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(limit),
    admin
      .from("transfers")
      .select("from_address, to_address, amount, tx_hash, block_time")
      .order("block_time", { ascending: false })
      .limit(limit),
    admin.from("drops").select("id, name, created_at").order("created_at", { ascending: false }).limit(limit),
    admin
      .from("campaigns")
      .select("slug, name, token_symbol, created_at, status")
      .neq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  const items: SiteActivityItem[] = [];
  for (const p of (payouts?.data ?? []) as unknown as {
    wallet_address: string;
    username: string | null;
    amount: string;
    campaign_id: string | null;
    drop_id: string | null;
    tx_hash: string | null;
    created_at: string;
    campaigns: { slug: string; name: string; token_symbol: string; status: string }[] | null;
    drops: { name: string }[] | null;
  }[]) {
    // The embedded rows come back as ARRAYS (PostgREST does that for to-one
    // joins it cannot prove unique); take [0] honestly.
    const campaignInfo = p.campaigns?.[0];
    const dropInfo = p.drops?.[0];
    const who = p.username ?? p.wallet_address.slice(0, 8);
    // A draft campaign's test payouts are not a public event; skip them
    // entirely rather than naming a campaign nobody can open.
    if (campaignInfo?.status === "draft") continue;
    if (p.campaign_id && campaignInfo) {
      items.push({
        kind: "campaign_payout",
        text: `@${who} earned ${formatCounter(BigInt(p.amount))} ${campaignInfo.token_symbol} in ${campaignInfo.name}`,
        at: p.created_at,
        tx: p.tx_hash,
        href: `/earn/${campaignInfo.slug}`,
      });
    } else if (p.drop_id && dropInfo) {
      // A DROP PRIZE IS NOT BEGFI-POOL EARNINGS. The shared ledger means a
      // row with only a drop_id used to render as "earned from the BegFi
      // pool", which named the wrong product for real money.
      items.push({
        kind: "drop_payout",
        text: `@${who} won ${formatCounter(BigInt(p.amount))} $BEGFI in ${dropInfo.name}`,
        at: p.created_at,
        tx: p.tx_hash,
        href: `/drop/${p.drop_id}`,
      });
    } else if (!p.campaign_id && !p.drop_id) {
      items.push({
        kind: "payout",
        text: `@${who} earned ${formatCounter(BigInt(p.amount))} $BEGFI from the BegFi pool`,
        at: p.created_at,
        tx: p.tx_hash,
        href: "/earn",
      });
    }
  }
  for (const t of (begs?.data ?? []) as {
    from_address: string;
    to_address: string;
    amount: string;
    tx_hash: string | null;
    block_time: string;
  }[]) {
    if (t.from_address === t.to_address) continue;
    items.push({
      kind: "beg",
      text: `${formatCounter(BigInt(t.amount))} $BEGFI moved 0x…${t.from_address.slice(-4)} → 0x…${t.to_address.slice(-4)}`,
      at: t.block_time,
      tx: t.tx_hash,
      href: null,
    });
  }
  for (const d of (drops?.data ?? []) as { id: string; name: string; created_at: string }[]) {
    items.push({
      kind: "drop",
      text: `New drop: ${d.name}`,
      at: d.created_at,
      tx: null,
      href: `/drop/${d.id}`,
    });
  }
  for (const c of (campaigns?.data ?? []) as {
    slug: string;
    name: string;
    token_symbol: string;
    created_at: string;
  }[]) {
    items.push({
      kind: "campaign",
      text: `New campaign: ${c.name} (${c.token_symbol})`,
      at: c.created_at,
      tx: null,
      href: `/earn/${c.slug}`,
    });
  }

  items.sort((a, b) => (a.at > b.at ? -1 : 1));
  return {
    items: items.slice(0, limit),
    dbFailed: Boolean(payouts.error && begs.error && drops.error && campaigns.error),
  };
}

function formatCounter(value: bigint): string {
  /*
   * NOT `Number(value) / 1e18`. That printed 100 wei as "1e-16", which reads
   * as a scientific notation bug in a money feed and is the sort of number a
   * person screenshots. `formatAmount` keeps the exact base-unit digits.
   */
  return formatAmount(value);
}
