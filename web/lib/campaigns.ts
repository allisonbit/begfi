import "server-only";

import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

import { robinhoodChain } from "@/lib/chains";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import { BEG_TOKEN_ADDRESS, DISTRIBUTOR_PRIVATE_KEY } from "@/lib/config";
import { readXPost, postCarriesEntry } from "@/lib/x-embed";

/**
 * PROJECT CAMPAIGNS — the data layer.
 *
 * THE ONE RULE THAT DECIDES MOST CHOICES HERE: a campaign's pool is a
 * LEDGER, not a balance. pool_remaining is never stored; it is
 * sum(deposits) − sum(sent payouts), computed from rows the indexer and the
 * sweep wrote after the chain confirmed them. There is no second number to
 * drift out of step, no mutation the owner can trick, and "never pay more
 * than the pool" is one subtraction against the truth.
 *
 * Money is per campaign, in THAT campaign's token, base units, numeric text
 * (the exact-digits discipline every other money read here follows).
 */

export type Campaign = {
  id: string;
  slug: string;
  ownerId: string;
  name: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  xUrl: string | null;
  websiteUrl: string | null;
  tokenName: string;
  tokenSymbol: string;
  tokenAddress: string;
  tokenDecimals: number;
  description: string | null;
  requiredEntry: string;
  instructions: string | null;
  dailyBudget: bigint;
  status: "draft" | "active" | "paused" | "ended";
  isVerified: boolean;
  createdAt: string;
};

export type CampaignSubmission = {
  id: string;
  campaign_id: string;
  username: string;
  wallet_address: string;
  post_url: string;
  status: "valid" | "rejected";
  verify_note: string | null;
  payout_tx: string | null;
  created_at: string;
};

type CampaignRow = {
  id: string;
  slug: string;
  owner_id: string;
  name: string;
  logo_url: string | null;
  banner_url: string | null;
  x_url: string | null;
  website_url: string | null;
  token_name: string;
  token_symbol: string;
  token_address: string;
  token_decimals: number;
  description: string | null;
  required_entry: string;
  instructions: string | null;
  daily_budget: string;
  status: string;
  is_verified: boolean;
  created_at: string;
  updated_at?: string;
};

function asCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    slug: row.slug,
    ownerId: row.owner_id,
    name: row.name,
    logoUrl: row.logo_url,
    bannerUrl: row.banner_url,
    xUrl: row.x_url,
    websiteUrl: row.website_url,
    tokenName: row.token_name,
    tokenSymbol: row.token_symbol,
    tokenAddress: row.token_address,
    tokenDecimals: row.token_decimals,
    description: row.description,
    requiredEntry: row.required_entry,
    instructions: row.instructions,
    dailyBudget: BigInt(row.daily_budget),
    status: row.status as Campaign["status"],
    isVerified: row.is_verified,
    createdAt: row.created_at,
  };
}

/** The sweep serves cycle `today`. Campaign pages compute countdowns off this. */
export function campaignPayoutSchedule(label?: string): { hourUtc: number; minuteUtc: number } {
  void label;
  return { hourUtc: 4, minuteUtc: 43 };
}

/* ------------------------------------------------------------------------- */
/* Reads                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * POOL MATH, FROM THE LEDGER: deposits in minus payouts out, per campaign.
 * Two aggregate reads feed every campaign card, so the grid and the page can
 * never disagree.
 */
async function poolTotals(campaignId: string | null): Promise<{ deposited: Map<string, bigint>; paid: Map<string, bigint> }> {
  const admin = createAdminClient();
  const deposited = new Map<string, bigint>();
  const paid = new Map<string, bigint>();

  const depositQuery = admin.from("campaign_deposits").select("campaign_id, amount::text").limit(10_000);
  const payoutQuery = admin
    .from("earn_payouts")
    .select("campaign_id, amount::text, status")
    .not("campaign_id", "is", null)
    .limit(10_000);

  const [deps, pays] = await Promise.all([depositQuery, payoutQuery]);
  for (const d of (deps.data ?? []) as { campaign_id: string; amount: string }[]) {
    deposited.set(d.campaign_id, (deposited.get(d.campaign_id) ?? 0n) + BigInt(d.amount));
  }
  for (const p of (pays.data ?? []) as { campaign_id: string; amount: string; status: string }[]) {
    if (p.status === "sent") {
      paid.set(p.campaign_id!, (paid.get(p.campaign_id!) ?? 0n) + BigInt(p.amount));
    }
  }
  if (campaignId) {
    const keepDeposited = new Map([[campaignId, deposited.get(campaignId) ?? 0n]]);
    const keepPaid = new Map([[campaignId, paid.get(campaignId) ?? 0n]]);
    return { deposited: keepDeposited, paid: keepPaid };
  }
  return { deposited, paid };
}

export type CampaignStats = {
  poolRemaining: bigint;
  poolTotal: bigint; // sum of deposits (the "raised" figure, for the progress bar)
  totalPaid: bigint;
  participants: number; // distinct wallets with a valid submission, lifetime
  todaySubmissions: number; // valid submissions since UTC midnight
  daysLeft: number | null; // floor(poolRemaining / dailyBudget); null when no budget
};

export async function campaignStatsFor(campaign: Campaign, participants: number, todaySubmissions: number): Promise<CampaignStats> {
  const { deposited, paid } = await poolTotals(campaign.id);
  const poolRemaining = (deposited.get(campaign.id) ?? 0n) - (paid.get(campaign.id) ?? 0n);
  return {
    poolRemaining: poolRemaining < 0n ? 0n : poolRemaining,
    poolTotal: deposited.get(campaign.id) ?? 0n,
    totalPaid: paid.get(campaign.id) ?? 0n,
    participants,
    todaySubmissions,
    daysLeft: campaign.dailyBudget > 0n ? Number(poolRemaining / campaign.dailyBudget) : null,
  };
}

/** Active campaigns for the grid, plus the wrapped stats. */
export type CampaignCard = Campaign & { stats: CampaignStats };

export async function getActiveCampaigns(limit = 60): Promise<{ items: CampaignCard[]; dbFailed: boolean }> {
  if (!SUPABASE_CONFIGURED) return { items: [], dbFailed: true };
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { items: [], dbFailed: true };
  }

  const todayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").toISOString();
  const [campaignsRes, submissionsRes] = await Promise.all([
    admin.from("campaigns").select("*").in("status", ["active", "ended"]).order("created_at", { ascending: false }).limit(limit),
    admin.from("campaign_submissions").select("campaign_id, wallet_address, status, created_at").eq("status", "valid").limit(20_000),
  ]);
  if (campaignsRes.error || !campaignsRes.data) return { items: [], dbFailed: true };

  const lifeWallets = new Map<string, Set<string>>();
  const todayCounts = new Map<string, number>();
  for (const s of ((submissionsRes.data ?? []) as { campaign_id: string; wallet_address: string; status: string; created_at: string }[])) {
    if (s.status !== "valid") continue;
    const set = lifeWallets.get(s.campaign_id) ?? new Set<string>();
    set.add(s.wallet_address);
    lifeWallets.set(s.campaign_id, set);
    if (s.created_at >= todayStart) todayCounts.set(s.campaign_id, (todayCounts.get(s.campaign_id) ?? 0) + 1);
  }

  const campaigns = (campaignsRes.data as CampaignRow[]).map(asCampaign);
  const deps = await poolTotals(null);

  const items = campaigns.map((c) => {
    const participantsMsg = lifeWallets.get(c.id)?.size ?? 0;
    const paid = deps.paid.get(c.id) ?? 0n;
    const poolTotal = deps.deposited.get(c.id) ?? 0n;
    return {
      ...c,
      stats: {
        poolRemaining: poolTotal - paid < 0n ? 0n : poolTotal - paid,
        poolTotal,
        totalPaid: paid,
        participants: participantsMsg,
        todaySubmissions: todayCounts.get(c.id) ?? 0,
        daysLeft: c.dailyBudget > 0n ? Number((poolTotal - paid) / c.dailyBudget) : null,
      },
    };
  });

  // TRENDING: a campaign with people actually posting today outranks a stale
  // one, and ties fall back to newest. The count is real (from rows), not a
  // decay formula pretending to be data.
  items.sort((a, b) =>
    b.stats.todaySubmissions !== a.stats.todaySubmissions
      ? b.stats.todaySubmissions - a.stats.todaySubmissions
      : b.stats.participants !== a.stats.participants
        ? b.stats.participants - a.stats.participants
        : a.createdAt < b.createdAt
          ? -1
          : 1,
  );

  return { items, dbFailed: false };
}

export async function getCampaignBySlug(slug: string): Promise<Campaign | null> {
  if (!SUPABASE_CONFIGURED) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("campaigns").select("*").eq("slug", slug.toLowerCase()).maybeSingle<CampaignRow>();
  return data ? asCampaign(data) : null;
}

export async function campaignExists(id: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("campaigns").select("id").eq("id", id).maybeSingle();
  return Boolean(data);
}

/** A campaign's valid-submission feed + per-cycle leaderboard. */
export type CampaignLeaderRow = { wallet_address: string; username: string; count: number; paid: bigint; streak: number };

export type CampaignDetail = {
  campaign: Campaign;
  stats: CampaignStats;
  feed: CampaignSubmission[];
  leaders: CampaignLeaderRow[];
  recentPayouts: {
    wallet_address: string;
    username: string | null;
    amount: string;
    cycle_date: string;
    tx_hash: string | null;
    created_at: string;
  }[];
};

export async function getCampaignDetail(campaign: Campaign, detailLimit = 30): Promise<CampaignDetail | null> {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  const [subsRes, paysRes] = await Promise.all([
    admin
      .from("campaign_submissions")
      .select("id, campaign_id, username, wallet_address, post_url, status, verify_note, payout_tx, created_at")
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: false })
      .limit(2_000),
    admin
      .from("earn_payouts")
      .select("wallet_address, username, amount::text, cycle_date, status, tx_hash, created_at")
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: false })
      .limit(1_000),
  ]);
  if (!subsRes.data && subsRes.error) return null;

  const subs = (subsRes.data ?? []) as CampaignSubmission[] & { reward?: never }[];
  const valid = subs.filter((s) => s.status === "valid");
  const feed = valid.slice(0, detailLimit);

  // THE CAMPAIGN LEADERBOARD: posts per wallet, paid per wallet, and the
  // streak — CONSECUTIVE UTC days with at least one valid post. Streaks are
  // computed from the row's own date keys, so they are re-derivable facts
  // (they never depend on which sweeps ran or when).
  const byWallet = new Map<string, { username: string; dates: Set<string>; paid: bigint }>();
  for (const s of valid) {
    const w = byWallet.get(s.wallet_address) ?? { username: s.username, dates: new Set<string>(), paid: 0n };
    w.dates.add(new Date(s.created_at).toISOString().slice(0, 10));
    byWallet.set(s.wallet_address, w);
  }
  for (const p of (paysRes.data ?? []) as { wallet_address: string; amount: string; status: string }[]) {
    const w = byWallet.get(p.wallet_address);
    if (w && p.status === "sent") w.paid += BigInt(p.amount);
  }

  const leaders: CampaignLeaderRow[] = [...byWallet.entries()]
    .map(([wallet_address, w]) => {
      const dates = [...w.dates].sort();
      let streak = 0;
      if (dates.length > 0) {
        const day = new Date(dates[dates.length - 1] + "T00:00:00Z");
        const todayKey = new Date().toISOString().slice(0, 10);
        // A streak survives until the NEXT day's budget lands: today-or-the-keys-tail is the anchor.
        if (dates[dates.length - 1] === todayKey || dates[dates.length - 1] === new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)) {
          streak = 1;
          for (let i = dates.length - 1; i > 0; i--) {
            const cur = new Date(dates[i] + "T00:00:00Z").getTime();
            const prev = new Date(dates[i - 1] + "T00:00:00Z").getTime();
            if (cur - prev === 86_400_000) streak += 1;
            else break;
          }
        }
        void day;
      }
      return { wallet_address, username: w.username, count: w.dates.size, paid: w.paid, streak };
    })
    .sort((a, b) => (b.paid > a.paid ? 1 : b.paid < a.paid ? -1 : b.count - a.count))
    .slice(0, 10);

  const stats = {
    poolRemaining: 0n,
    poolTotal: 0n,
    totalPaid: 0n,
    participants: byWallet.size,
    todaySubmissions: valid.filter((s) => s.created_at >= new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").toISOString()).length,
    daysLeft: campaign.dailyBudget > 0n ? 0 : null,
  };
  const { deposited, paid } = await poolTotals(campaign.id);
  stats.poolRemaining = (deposited.get(campaign.id) ?? 0n) - (paid.get(campaign.id) ?? 0n);
  if (stats.poolRemaining < 0n) stats.poolRemaining = 0n;
  stats.poolTotal = deposited.get(campaign.id) ?? 0n;
  stats.totalPaid = paid.get(campaign.id) ?? 0n;
  stats.daysLeft = campaign.dailyBudget > 0n ? Number(stats.poolRemaining / campaign.dailyBudget) : null;

  const recentPayouts = ((paysRes.data ?? []) as { wallet_address: string; username: string; amount: string; cycle_date: string; status: string; tx_hash: string; created_at: string }[])
    .filter((p) => p.status === "sent")
    .map((p) => ({ wallet_address: p.wallet_address, username: p.username, amount: p.amount, cycle_date: p.cycle_date, tx_hash: p.tx_hash, created_at: p.created_at }));

  void detailLimit;
  return { campaign, stats, feed, leaders, recentPayouts };
}

/* ------------------------------------------------------------------------- */
/* Submit: verify with the NORMAL mechanism, then store                        */
/* ------------------------------------------------------------------------- */

const POST_URL_RE = /^https?:\/\/(www\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+/i;

export type SubmitResult =
  | { ok: true }
  | { error: string; status: number }
  | { transient: string };

export async function submitCampaignPost(input: {
  userId: string;
  username: string;
  walletAddress: string;
  slug: string;
  postUrl: string;
}): Promise<SubmitResult> {
  if (!SUPABASE_CONFIGURED) return { error: "Not set up yet.", status: 503 };
  const admin = createAdminClient();
  const postUrl = input.postUrl.trim();
  if (!POST_URL_RE.test(postUrl)) return { error: "Paste the full link to your post on X.", status: 400 };

  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, status, required_entry")
    .eq("slug", input.slug.toLowerCase())
    .maybeSingle<{ id: string; status: string; required_entry: string }>();
  if (!campaign) return { error: "That campaign doesn't exist.", status: 404 };
  if (campaign.status !== "active") return { error: "That campaign is not running right now.", status: 409 };

  const post = await readXPost(postUrl);
  // A TRANSIENT read failure must NOT burn the wallet's daily slot: the row is
  // not written, and the caller is told to retry, not failed forever.
  if (!post) return { transient: "Could not read that post from X just now — try again in a moment." };

  const carries = postCarriesEntry(post.text, campaign.required_entry);
  // Store the verdict either way (the audit trail matters), the daily-slot
  // uniqueness does the rest. A rejected row shows the poster exactly why.
  let note: string | null = null;
  if (!carries) note = `Post does not contain the required "${campaign.required_entry}"`;

  const { error } = await admin.from("campaign_submissions").insert({
    campaign_id: campaign.id,
    user_id: input.userId,
    username: input.username,
    wallet_address: input.walletAddress.toLowerCase(),
    post_url: postUrl,
    status: carries ? "valid" : "rejected",
    verify_note: note,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "This wallet already posted for this campaign today — come back tomorrow.", status: 409 };
    }
    return { error: "Could not store the submission. Try again.", status: 500 };
  }
  return { ok: true };
}

/**
 * Has THIS wallet already posted for THIS campaign today (UTC)? An exact
 * database read, not a scan of a display list — the submit box is gated by
 * the same answer the unique index will enforce.
 */
export async function hasPostedToday(campaignId: string, walletAddress: string): Promise<boolean> {
  const admin = createAdminClient();
  const todayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").toISOString();
  const { data } = await admin
    .from("campaign_submissions")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("wallet_address", walletAddress.toLowerCase())
    .gte("created_at", todayStart)
    .limit(1);
  return Boolean(data && data.length > 0);
}

/* ------------------------------------------------------------------------- */
/* Owner CRUD                                                                 */
/* ------------------------------------------------------------------------- */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
const ADDR_RE = /^0x[0-9a-f]{40}$/;
const URL_RE = /^https?:\/\/\S+$/i;

export const CampaignDraft = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG_RE, "Slug: 2-39 lowercase letters, numbers or dashes."),
  logoUrl: z.string().trim().regex(URL_RE).max(400).optional().or(z.literal("")),
  bannerUrl: z.string().trim().regex(URL_RE).max(400).optional().or(z.literal("")),
  xUrl: z.string().trim().regex(URL_RE).max(300).optional().or(z.literal("")),
  websiteUrl: z.string().trim().regex(URL_RE).max(300).optional().or(z.literal("")),
  tokenName: z.string().trim().min(1).max(40),
  tokenSymbol: z.string().trim().min(1).max(10).toUpperCase(),
  tokenAddress: z.string().trim().toLowerCase().regex(ADDR_RE, "A valid token contract address."),
  description: z.string().trim().max(600).optional().or(z.literal("")),
  requiredEntry: z.string().trim().min(1).max(40),
  instructions: z.string().trim().max(600).optional().or(z.literal("")),
  dailyBudgetDisplay: z.coerce.number().int().positive(),
  status: z.enum(["draft", "active", "paused", "ended"]).optional(),
});

export type CampaignDraftInput = z.infer<typeof CampaignDraft>;

/** The token's own decimals decide display math — read them from the contract. */
async function readTokenDecimals(tokenAddress: string): Promise<number> {
  const client = createPublicClient({ chain: robinhoodChain, transport: http() });
  try {
    const d = (await client.readContract({
      address: tokenAddress as `0x${string}`,
      abi: [{ type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" }],
      functionName: "decimals",
    })) as unknown as number;
    return Number.isFinite(d) ? d : 18;
  } catch {
    return 18;
  }
}

export type CreateResult = { ok: true; slug?: string } | { error: string; status: number };

export async function createCampaign(ownerId: string, input: CampaignDraftInput): Promise<CreateResult> {
  if (!SUPABASE_CONFIGURED) return { error: "Not set up yet.", status: 503 };
  const admin = createAdminClient();

  if (/^(earn|battles?)$/.test(input.slug)) {
    return { error: "That slug is reserved.", status: 400 };
  }

  const { data: clash } = await admin.from("campaigns").select("id").eq("slug", input.slug).maybeSingle();
  if (clash) return { error: "That campaign slug is taken.", status: 409 };

  // ---------------------------------------------------------------------
  // THE DEPOSIT-TOKEN GUARDS.
  //
  // Every pool is funded to ONE shared distributor wallet, so deposits are
  // attributed per token (`creditCampaignDeposits`). Two active campaigns on
  // the same token therefore cannot be told apart: one pool gets credited for
  // both and the other silently starves. Migration 0025 makes that impossible
  // with a partial unique index — this check exists because an index answers
  // with a Postgres error string, and the project owner deserves the reason.
  // The index stays behind it as the race-proof backstop.
  //
  // $BEGFI ITSELF is refused for the same reason, sharply: BegFi tops up its
  // own reward pool to that identical address, so a campaign paying in $BEGFI
  // is indistinguishable from the site funding itself — and the money would
  // be counted into both pools (KNOWN_ISSUES.md #2). A dedicated deposit
  // address per pool is the real fix (Phase 1); this makes the collision
  // unreachable until then.
  // ---------------------------------------------------------------------
  const token = input.tokenAddress.toLowerCase();
  if (BEG_TOKEN_ADDRESS && token === BEG_TOKEN_ADDRESS.toLowerCase()) {
    return {
      error:
        "$BEGFI can't be a campaign's payout token — the site's own reward pool is funded to the same wallet, so a top-up would be impossible to tell apart from your pool's. Use your project's own token.",
      status: 400,
    };
  }

  const { data: sameToken } = await admin
    .from("campaigns")
    .select("slug")
    .eq("status", "active")
    .eq("token_address", token)
    .limit(1)
    .maybeSingle<{ slug: string }>();
  if (sameToken) {
    return {
      error: `Another campaign already pays in this token (/earn/${sameToken.slug}). Two pools on one token share the same deposit address and can't be told apart — use a different token, or ask us for a dedicated deposit address.`,
      status: 409,
    };
  }

  const decimals = await readTokenDecimals(input.tokenAddress);
  const unit = 10n ** BigInt(decimals);
  const budget = BigInt(input.dailyBudgetDisplay) * unit;

  // THE LOCKED FIELDS belong to the server, never the caller: owner_id from
  // the session, decimals from the chain. is_verified is never owner-settable.
  const { error } = await admin.from("campaigns").insert({
    slug: input.slug,
    owner_id: ownerId,
    name: input.name,
    logo_url: input.logoUrl || null,
    banner_url: input.bannerUrl || null,
    x_url: input.xUrl || null,
    website_url: input.websiteUrl || null,
    token_name: input.tokenName,
    token_symbol: input.tokenSymbol,
    token_address: input.tokenAddress,
    token_decimals: decimals,
    description: input.description || null,
    required_entry: input.requiredEntry,
    instructions: input.instructions || null,
    daily_budget: budget.toString(),
    status: "active",
  });
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

export type UpdateResult = { ok: true } | { error: string; status: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function updateCampaign(ownerId: string, input: CampaignDraftInput & { id: string }): Promise<UpdateResult> {
  if (!UUID_RE.test(input.id)) return { error: "Bad campaign id.", status: 400 };
  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, owner_id, token_decimals")
    .eq("id", input.id)
    .maybeSingle<{ id: string; owner_id: string; token_decimals: number }>();
  if (!campaign) return { error: "Campaign not found.", status: 404 };
  if (campaign.owner_id !== ownerId) return { error: "Not your campaign.", status: 403 };

  const { data: clash } = await admin.from("campaigns").select("id").eq("slug", input.slug).neq("id", input.id).maybeSingle();
  if (clash) return { error: "That campaign slug is taken.", status: 409 };

  const decimals = campaign.token_decimals;
  const unit = 10n ** BigInt(decimals);
  const budget = BigInt(input.dailyBudgetDisplay) * unit;

  const { error } = await admin
    .from("campaigns")
    .update({
      name: input.name,
      slug: input.slug,
      logo_url: input.logoUrl || null,
      banner_url: input.bannerUrl || null,
      x_url: input.xUrl || null,
      website_url: input.websiteUrl || null,
      token_name: input.tokenName,
      token_symbol: input.tokenSymbol,
      description: input.description || null,
      required_entry: input.requiredEntry,
      instructions: input.instructions || null,
      daily_budget: budget.toString(),
      status: input.status ?? "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

/** The verified badge: an admin wallet grants it, an owner can never. */
export async function setCampaignVerified(id: string, verified: boolean): Promise<UpdateResult> {
  const admin = createAdminClient();
  const { error } = await admin.from("campaigns").update({ is_verified: verified, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { error: error.message, status: 500 } : { ok: true };
}

/* ------------------------------------------------------------------------- */
/* Owner dashboard reads                                                      */
/* ------------------------------------------------------------------------- */

export type OwnerCampaignView = {
  campaign: Campaign;
  poolRemaining: bigint;
  poolTotal: bigint;
  totalPaid: bigint;
  participants: number;
  submissions: CampaignSubmission[];
  topPosters: CampaignLeaderRow[];
  payouts: { wallet_address: string; username: string | null; amount: string; cycle_date: string; status: string; tx_hash: string | null; created_at: string }[];
};

/** Every campaign for the admin console, newest first (bounded). */
export async function getAllCampaigns(limit = 30): Promise<{ campaign: Campaign; poolRemaining: bigint; participants: number; submissions: number }[]> {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return [];
  }
  const [{ data: all }, { data: valid }] = await Promise.all([
    admin.from("campaigns").select("*").order("created_at", { ascending: false }).limit(limit),
    admin.from("campaign_submissions").select("campaign_id, wallet_address").eq("status", "valid").limit(20_000),
  ]);
  const counts = new Map<string, number>();
  const wallets = new Map<string, Set<string>>();
  for (const s of ((valid ?? []) as { campaign_id: string; wallet_address: string }[])) {
    counts.set(s.campaign_id, (counts.get(s.campaign_id) ?? 0) + 1);
    const set = wallets.get(s.campaign_id) ?? new Set<string>();
    set.add(s.wallet_address);
    wallets.set(s.campaign_id, set);
  }
  const deps = await poolTotals(null);
  return ((all ?? []) as CampaignRow[]).map((row) => {
    const c = asCampaign(row);
    return {
      campaign: c,
      poolRemaining: (deps.deposited.get(c.id) ?? 0n) - (deps.paid.get(c.id) ?? 0n),
      participants: wallets.get(c.id)?.size ?? 0,
      submissions: counts.get(c.id) ?? 0,
    };
  });
}

export async function getOwnerCampaigns(ownerId: string): Promise<OwnerCampaignView[]> {
  if (!SUPABASE_CONFIGURED) return [];
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return [];
  }

  const { data: owned } = await admin.from("campaigns").select("*").eq("owner_id", ownerId).order("created_at", { ascending: false });
  const campaigns = ((owned ?? []) as CampaignRow[]).map(asCampaign);
  if (campaigns.length === 0) return [];

  const deps = await poolTotals(null);
  const views: OwnerCampaignView[] = [];

  for (const c of campaigns) {
    const [subsRes, paysRes] = await Promise.all([
      admin
        .from("campaign_submissions")
        .select("id, campaign_id, username, wallet_address, post_url, status, verify_note, payout_tx, created_at")
        .eq("campaign_id", c.id)
        .order("created_at", { ascending: false })
        .limit(500),
      admin
        .from("earn_payouts")
        .select("wallet_address, username, amount::text, cycle_date, status, tx_hash, created_at")
        .eq("campaign_id", c.id)
        .order("created_at", { ascending: false })
        .limit(300),
    ]);
    const subs = (subsRes.data ?? []) as CampaignSubmission[];
    const valid = subs.filter((s) => s.status === "valid");

    const byWallet = new Map<string, { username: string; count: number }>();
    for (const s of valid) {
      const w = byWallet.get(s.wallet_address) ?? { username: s.username, count: 0 };
      w.count += 1;
      byWallet.set(s.wallet_address, w);
    }

    views.push({
      campaign: c,
      poolRemaining: (deps.deposited.get(c.id) ?? 0n) - (deps.paid.get(c.id) ?? 0n),
      poolTotal: deps.deposited.get(c.id) ?? 0n,
      totalPaid: deps.paid.get(c.id) ?? 0n,
      participants: byWallet.size,
      submissions: subs.slice(0, 50),
      topPosters: [...byWallet.entries()]
        .map(([wallet_address, w]) => ({ wallet_address, username: w.username, count: w.count, paid: 0n, streak: 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      payouts: ((paysRes.data ?? []) as { wallet_address: string; username: string | null; amount: string; cycle_date: string; status: string; tx_hash: string; created_at: string }[]).slice(0, 25),
    });
  }
  return views;
}

/** The "recently paid" ticker: campaign payouts across all campaigns, newest first. */
export async function getRecentCampaignPayoutTicker(limit = 12): Promise<
  { campaignName: string; slug: string; tokenSymbol: string; wallet_address: string; username: string | null; amountBase: string; decimals: number; tx_hash: string | null; created_at: string }[]
> {
  if (!SUPABASE_CONFIGURED) return [];
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return [];
  }

  const { data, error } = await admin
    .from("earn_payouts")
    .select("campaign_id, wallet_address, username, amount::text, tx_hash, created_at, campaigns!inner(name, slug, token_symbol), token_address")
    .not("campaign_id", "is", null)
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(limit * 4);

  if (error || !data) return [];
  const seen = new Set<string>();
  const out: {
    campaignName: string;
    slug: string;
    tokenSymbol: string;
    wallet_address: string;
    username: string | null;
    amountBase: string;
    decimals: number;
    tx_hash: string | null;
    created_at: string;
  }[] = [];
  for (const row of data as unknown as {
    campaign_id: string;
    wallet_address: string;
    username: string | null;
    amount: string;
    tx_hash: string | null;
    created_at: string;
    campaigns: { name: string; slug: string; token_symbol: string }[];
    token_address: string;
  }[]) {
    // The embedded `campaigns` comes back as an ARRAY (PostgREST does that for
    // to-one joins it cannot prove unique); take [0] honestly.
    const campaignInfo = row.campaigns?.[0];
    if (!campaignInfo) continue;
    const key = `${row.campaign_id}-${row.wallet_address}`;
    if (seen.has(key)) continue; // 1 wallet per campaign per cycle is guaranteed; dedupe any multi-cycle chatter
    seen.add(key);
    out.push({
      campaignName: campaignInfo.name,
      slug: campaignInfo.slug,
      tokenSymbol: campaignInfo.token_symbol,
      wallet_address: row.wallet_address,
      username: row.username,
      amountBase: row.amount,
      decimals: 18,
      tx_hash: row.tx_hash,
      created_at: row.created_at,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Where the money arrives: the distributor wallet is the ONE address every campaign tops up. */
export function distributorAddressPublic(): string | null {
  return /^0x[0-9a-fA-F]{64}$/.test(DISTRIBUTOR_PRIVATE_KEY)
    ? privateKeyToAccount(DISTRIBUTOR_PRIVATE_KEY as `0x${string}`).address.toLowerCase()
    : null;
}
