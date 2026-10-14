import "server-only";

import { EARN_ADMIN_WALLETS } from "@/lib/config";
import { TOKEN_DECIMALS } from "@/lib/erc20";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

/**
 * Post-to-earn: server reads and admin writes for the Earn page.
 *
 * ONE SOURCE OF TRUTH. The settings row is the whole rulebook — reward, daily
 * limit, pool, on/off — and every reader (page, submit route, claim route,
 * review console) asks it rather than holding its own copy. Amounts are $BEGFI
 * base units (18 decimals) in every column, matching `transfers`.
 *
 * The admin identity is server-side only: an admin route calls
 * `isAdminWallet` with the signed-in profile's wallet. A client holding this
 * module is impossible (server-only), which is the point.
 */

export type EarnSettings = {
  rewardPerPost: bigint;
  poolTotal: bigint;
  poolRemaining: bigint;
  dailyLimit: number;
  isActive: boolean;
};

export type EarnSubmission = {
  id: string;
  username: string;
  wallet_address: string;
  post_url: string;
  status: "pending" | "approved" | "rejected";
  reward_amount: string;
  created_at: string;
  reviewed_at: string | null;
  claimed_at: string | null;
  payout_tx: string | null;
};

type SettingsRow = {
  /*
   * NUMERICS ARE READ AS TEXT. PostgREST serializes numeric(78,0) as a JSON
   * number, and a JSON number has 53 bits of mantissa — a 26-digit base-unit
   * amount arrives polluted (1e25 returned 10000000000000000905969664 with
   * phantom decimals). `::text` keeps the exact digits; BigInt parses it.
   * The same cast applies to every big-integer column below.
   */
  reward_per_post: string;
  pool_total: string;
  pool_remaining: string;
  daily_limit: number;
  is_active: boolean;
  /** Optional because only writes set it; reads select the rulebook columns. */
  updated_at?: string;
};

type SubmissionRow = {
  id: string;
  username: string;
  wallet_address: string;
  post_url: string;
  status: string;
  reward_amount: string;
  created_at: string;
  reviewed_at: string | null;
  claimed_at: string | null;
  payout_tx: string | null;
};

function asSubmission(row: SubmissionRow): EarnSubmission & { status: EarnSubmission["status"] } {
  return { ...row, status: row.status as EarnSubmission["status"] };
}

export async function getEarnSettings(): Promise<EarnSettings | null> {
  if (!SUPABASE_CONFIGURED) return null;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("earn_settings")
    .select("reward_per_post::text, pool_total::text, pool_remaining::text, daily_limit, is_active")
    .maybeSingle<SettingsRow>();

  if (error || !data) return null;

  return {
    rewardPerPost: BigInt(data.reward_per_post),
    poolTotal: BigInt(data.pool_total),
    poolRemaining: BigInt(data.pool_remaining),
    dailyLimit: data.daily_limit,
    isActive: data.is_active,
  };
}

/** The live feed: pending and approved posts, newest first. Rejected excluded here and by policy. */
export async function getEarnFeed(limit = 30): Promise<{ items: EarnSubmission[]; dbFailed: boolean }> {
  if (!SUPABASE_CONFIGURED) return { items: [], dbFailed: true };
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("earn_submissions")
    .select("id, username, wallet_address, post_url, status, reward_amount::text, created_at, reviewed_at, claimed_at, payout_tx")
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return { items: [], dbFailed: true };
  return { items: data.map(asSubmission), dbFailed: false };
}

/** Public counters for the page: posts submitted and $BEGFI paid to date. */
export async function getEarnStats(): Promise<{ totalPosts: number; totalPaid: bigint; dbFailed: boolean }> {
  if (!SUPABASE_CONFIGURED) return { totalPosts: 0, totalPaid: 0n, dbFailed: true };
  const admin = createAdminClient();

  const { count, error: countError } = await admin
    .from("earn_submissions")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "approved"]);

  const { data: paid, error: paidError } = await admin
    .from("earn_submissions")
    .select("reward_amount::text")
    .eq("status", "approved")
    .limit(10_000);

  if (countError || paidError) return { totalPosts: count ?? 0, totalPaid: 0n, dbFailed: true };

  let totalPaid = 0n;
  for (const row of paid ?? []) totalPaid += BigInt(row.reward_amount);
  return { totalPosts: count ?? 0, totalPaid, dbFailed: false };
}

/** Everything this account submitted, including rejected rows only they can see. */
export async function getMySubmissions(userId: string, limit = 50): Promise<{ rows: EarnSubmission[]; dbFailed: boolean }> {
  if (!SUPABASE_CONFIGURED) return { rows: [], dbFailed: true };
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("earn_submissions")
    .select("id, username, wallet_address, post_url, status, reward_amount::text, created_at, reviewed_at, claimed_at, payout_tx")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return { rows: [], dbFailed: true };
  return { rows: data.map(asSubmission), dbFailed: false };
}

export type MyEarnings = {
  earned: bigint;
  pending: bigint;
  claimable: bigint;
};

/**
 * The account's money view, from its own rows, exactly like the pool math:
 * earned = approved total, pending = asked but not yet reviewed, claimable =
 * approved rows not yet claimed. Nothing is decoded from a status the user
 * cannot verify on-chain — a claimed row carries the payout hash.
 */
export function earningsFromSubmissions(rows: EarnSubmission[]): MyEarnings {
  let earned = 0n;
  let pending = 0n;
  let claimable = 0n;
  for (const row of rows) {
    const amount = BigInt(row.reward_amount);
    if (row.status === "approved") {
      earned += amount;
      if (row.claimed_at === null) claimable += amount;
    } else if (row.status === "pending") {
      pending += amount;
    }
  }
  return { earned, pending, claimable };
}

/**
 * Has THIS WALLET ever claimed? ONE READ, ONE ANSWER.
 *
 * The wallet-once rule's home: eligibility is decided only by the wallet
 * address, lowercased before it is compared, exactly as it is stored. A
 * wallet with a record has claimed; a wallet without one is always allowed —
 * no “come back tomorrow” exists anywhere in this rulebook.
 *
 * PUBLIC TABLE, READ DIRECTLY: RLS exposes earn_claims read-only, but the
 * server read here is the one the API trusts; the direct table read is for
 * the page's own badge.
 */
export async function hasWalletClaimed(wallet: string): Promise<boolean> {
  if (!SUPABASE_CONFIGURED) return false;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("earn_claims")
    .select("id")
    .eq("wallet_address", wallet.toLowerCase())
    .maybeSingle<{ id: string }>();

  // A read error is treated as CLAIMABLE — false — because a wallet that
  // has genuinely never claimed must never be blocked by a flaky read. The
  // insert-side UNIQUE constraint is what actually stops a double claim.
  if (error) return false;
  return data !== null;
}

/**
 * Whether an X/Twitter post link is submittable. Strict on purpose: a typo
 * that turns another site's URL into a submission is worse than one that is
 * rejected. Accepts x.com and twitter.com status URLs with or without query
 * strings; rejects everything else before it touches the database.
 */
export function isPostUrl(value: string): boolean {
  return /^https?:\/\/(www\.)?(x\.com|twitter\.com)\/[^\s/?#]+\/status\/\d+([?&#]\S*)?$/i.test(value.trim());
}

/** The reward in display units, for badges and copy ("5,000 $BEGFI"). */
export function rewardDisplay(rewardPerPost: bigint): string {
  return (rewardPerPost / 10n ** BigInt(TOKEN_DECIMALS)).toLocaleString("en-GB");
}

export function isAdminWallet(wallet: string): boolean {
  return EARN_ADMIN_WALLETS.has(wallet.toLowerCase());
}

/* ------------------------------------------------------------------ */
/* Admin writes. Every function here runs from an API route that has   */
/* ALREADY verified the caller's wallet against EARN_ADMIN_WALLETS.    */
/* ------------------------------------------------------------------ */

export type ReviewError =
  | "not-found"
  | "state"
  | "pool"
  | "db"
  | "ok";

/**
 * Approve or reject. Approval also moves the money bookkeeping: the pool
 * decreases by the reward at the moment it is approved, never later, and a
 * pool that cannot cover the reward rejects the approval instead of going
 * negative. One call, one decision.
 */
export async function reviewSubmission(id: string, action: "approve" | "reject"): Promise<ReviewError> {
  if (!SUPABASE_CONFIGURED) return "db";
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("earn_submissions")
    .select("id, status, reward_amount::text")
    .eq("id", id)
    .maybeSingle<{ id: string; status: string; reward_amount: string }>();

  if (!row) return "not-found";
  if (row.status !== "pending") return "state";

  if (action === "approve") {
    const settings = await getEarnSettings();
    if (!settings) return "db";
    if (settings.poolRemaining < BigInt(row.reward_amount)) return "pool";

    const { error } = await admin
      .from("earn_submissions")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return "db";

    await admin
      .from("earn_settings")
      .update({
        pool_remaining: (settings.poolRemaining - BigInt(row.reward_amount)).toString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);

    return "ok";
  }

  const { error } = await admin
    .from("earn_submissions")
    .update({ status: "rejected", reviewed_at: new Date().toISOString() })
    .eq("id", id);
  return error ? "db" : "ok";
}

export type SettingsPatch = {
  rewardPerPostDisplay?: number;
  dailyLimit?: number;
  poolTotalDisplay?: number;
  poolTopUpDisplay?: number;
  isActive?: boolean;
};const UNIT = 10n ** 18n;
const displayUnits = (n: number): bigint | null => {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  // Display inputs are integers ("5000"). Fractional $BEGFI in a batch reward
  // rule adds nothing and invites float dust into the pool math.
  return BigInt(n) * UNIT;
};

export async function updateEarnSettings(patch: SettingsPatch): Promise<{ ok: boolean; error?: string }> {
  if (!SUPABASE_CONFIGURED) return { ok: false, error: "db" };
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("earn_settings")
    .select("reward_per_post::text, pool_total::text, pool_remaining::text, daily_limit, is_active")
    .maybeSingle<SettingsRow>();
  if (!row) return { ok: false, error: "db" };

  const next: Partial<SettingsRow> = { updated_at: new Date().toISOString() };
  const poolTotal = BigInt(row.pool_total);
  let poolRemaining = BigInt(row.pool_remaining);

  if (patch.dailyLimit !== undefined) {
    if (!Number.isInteger(patch.dailyLimit) || patch.dailyLimit < 1 || patch.dailyLimit > 20) {
      return { ok: false, error: "daily limit is 1-20" };
    }
    next.daily_limit = patch.dailyLimit;
  }

  if (patch.rewardPerPostDisplay !== undefined) {
    const reward = displayUnits(patch.rewardPerPostDisplay);
    if (reward === null) return { ok: false, error: "reward must be a whole number of $BEGFI" };
    next.reward_per_post = reward.toString();
  }

  if (patch.poolTotalDisplay !== undefined) {
    const total = displayUnits(patch.poolTotalDisplay);
    if (total === null) return { ok: false, error: "pool total must be a whole number of $BEGFI" };
    if (total < poolRemaining) {
      // Shrinking the pool cannot eat money the bookkeeping already reserved.
      return { ok: false, error: "pool total is below what is already unclaimed" };
    }
    next.pool_total = total.toString();
  }

  if (patch.poolTopUpDisplay !== undefined) {
    const add = displayUnits(patch.poolTopUpDisplay);
    if (add === null) return { ok: false, error: "top-up must be a whole number of $BEGFI" };
    poolRemaining += add;
    next.pool_remaining = poolRemaining.toString();
  }

  // A top-up together with a smaller total: the total carries the floor.
  if (next.pool_total !== undefined && poolRemaining > BigInt(next.pool_total)) {
    next.pool_remaining = next.pool_total;
  }

  if (patch.isActive !== undefined) {
    if (typeof patch.isActive !== "boolean") return { ok: false, error: "is_active must be a boolean" };
    next.is_active = patch.isActive;
  }

  const { error } = await admin.from("earn_settings").update(next).eq("id", true);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * The payout ledger, for the admin audit panel: every submission that has
 * ever been claimable, newest first. A row is 'paid' when payout_tx is set
 * (clickable to the explorer), 'sending' when claimed_at is set but no tx
 * has landed yet, and 'waiting' when the payout has not started — the three
 * states of the claim path, visible instead of guessed.
 */
export async function getPayoutLedger(limit = 100): Promise<EarnSubmission[]> {
  if (!SUPABASE_CONFIGURED) return [];
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("earn_submissions")
    .select("id, username, wallet_address, post_url, status, reward_amount::text, created_at, reviewed_at, claimed_at, payout_tx")
    .in("status", ["approved", "rejected"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map(asSubmission);
}

/**
 * The pending queue for the review console (legacy label kept for the
 * settings view): pending rows now only exist while the automatic payout
 * path is offline.
 */
export async function listPendingSubmissions(limit = 100): Promise<EarnSubmission[]> {
  if (!SUPABASE_CONFIGURED) return [];
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("earn_submissions")
    .select("id, username, wallet_address, post_url, status, reward_amount::text, created_at, reviewed_at, claimed_at, payout_tx")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error || !data) return [];
  return data.map(asSubmission);
}

/**
 * Approved rows not yet claimed for one user, plus their sum: the payout
 * batch, and the retry path a failed transfer re-reads.
 */
export async function getApprovedUnclaimed(userId: string): Promise<{ ids: string[]; total: bigint }> {
  if (!SUPABASE_CONFIGURED) return { ids: [], total: 0n };
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("earn_submissions")
    .select("id, reward_amount, claimed_at")
    .eq("user_id", userId)
    .eq("status", "approved")
    .is("claimed_at", null)
    .limit(100);

  if (error || !data) return { ids: [], total: 0n };

  const ids: string[] = [];
  let total = 0n;
  for (const row of data) {
    ids.push(row.id);
    total += BigInt(row.reward_amount);
  }
  return { ids, total };
}

/** Stage a claim: set claimed_at. The payout follows; the tx lands after. */
export async function stageClaim(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return false;
  const admin = createAdminClient();

  const { error } = await admin
    .from("earn_submissions")
    .update({ claimed_at: new Date().toISOString() })
    .in("id", ids)
    .is("claimed_at", null);

  return !error;
}

/** Record the payout hash once the transfer went through. */
export async function recordPayout(ids: string[], txHash: string): Promise<boolean> {
  if (ids.length === 0 || !txHash) return false;
  const admin = createAdminClient();

  const { error } = await admin
    .from("earn_submissions")
    .update({ payout_tx: txHash })
    .in("id", ids)
    .is("payout_tx", null);

  return !error;
}
