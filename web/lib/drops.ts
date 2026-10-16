import "server-only";

import { z } from "zod";

import { readTokenDecimals } from "@/lib/campaigns";
import { BEG_TOKEN_ADDRESS } from "@/lib/config";
import { parseAmount } from "@/lib/erc20";
import { payoutWalletReady } from "@/lib/payout-controls";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import type { Profile } from "@/lib/types";

/**
 * DROPS — reads, the owner's controls, and the claim path.
 *
 * WHAT A DROP IS. One token, one fixed prize, a cap on claimants. The first N
 * people to claim each get `amount_per_claim` in their own wallet, sent by the
 * SAME distributor wallet (and key, and ledger) that BegFi's own pool and every
 * campaign pay from. lib/drop-distributor.ts is the sending half; this file is
 * everything a screen or a route needs to READ, plus the two writes a person
 * makes: create a drop, and claim one.
 *
 * THE POOL IS DERIVED, ALWAYS. `drop_deposits` (chain facts) minus confirmed
 * `earn_payouts` (chain facts) minus claims already ACCEPTED but not yet sent.
 * That third term is the one that is easy to forget and expensive to forget:
 * without it, ten claims arriving in the same second each see the same
 * available pool and are each told yes, and the pot runs out after the promises
 * were made. `available` below is what the claim path gates on for that reason.
 *
 * A FAILED READ IS NEVER A ZERO. Every figure a page renders comes back as
 * `null` when its read failed, so a page can say "figures unavailable" instead
 * of showing an empty pot that is not empty. The money pages are the last place
 * a plausible-looking zero belongs.
 */

export type DropStatus = "open" | "paused" | "ended";

export type Drop = {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  tokenName: string;
  tokenSymbol: string;
  tokenAddress: string;
  tokenDecimals: number;
  amountPerClaim: bigint;
  maxClaims: number;
  status: DropStatus;
  closesAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The pot's arithmetic, in the token's base units. */
export type DropPool = {
  /** Every credited deposit for this drop. */
  deposited: bigint;
  /** Every CONFIRMED payout. */
  paid: bigint;
  /** Claims accepted whose transfer has not confirmed yet. */
  promised: bigint;
  /** deposited − paid: what is still in the wallet for this drop. */
  remaining: bigint;
  /** remaining − promised: what a NEW claim may still draw on. */
  available: bigint;
};

export type DropStats = {
  pool: DropPool | null;
  claimCount: number | null;
  paidCount: number | null;
  /** How many more prizes the cap AND the pool still allow. */
  prizesLeft: number | null;
  /** Open, in its window, and with prizes left — i.e. claimable right now. */
  isClaimable: boolean;
};

export type DropClaim = {
  id: string;
  username: string;
  walletAddress: string;
  amount: bigint;
  xHandle: string | null;
  payoutTx: string | null;
  createdAt: string;
};

export type DropFunding = {
  id: string;
  funderWallet: string;
  expectedAmount: bigint;
  status: "pending" | "matched" | "expired";
  expiresAt: string;
  createdAt: string;
  txHash: string | null;
  matchedAmount: bigint | null;
};

export type OwnerDrop = {
  drop: Drop;
  stats: DropStats;
  claims: DropClaim[];
  fundings: DropFunding[];
  depositCount: number | null;
};

/** A drop card for the public list, with the same honest-null figures. */
export type DropCard = { drop: Drop; stats: DropStats };

type DropRow = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  token_name: string;
  token_symbol: string;
  token_address: string;
  token_decimals: number;
  amount_per_claim: string;
  max_claims: number;
  status: DropStatus;
  closes_at: string | null;
  created_at: string;
  updated_at: string;
};

const DROP_COLUMNS =
  "id, owner_id, name, description, token_name, token_symbol, token_address, token_decimals, amount_per_claim::text, max_claims, status, closes_at, created_at, updated_at";

/** The read cap every pool sum uses, matching the sweeps' own bound. */
const ROW_CAP = 10_000;
/** A page never needs more requests/claims than this at once. */
const HISTORY_LIMIT = 20;

function asDrop(row: DropRow): Drop {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    tokenName: row.token_name,
    tokenSymbol: row.token_symbol,
    tokenAddress: row.token_address,
    tokenDecimals: row.token_decimals,
    amountPerClaim: BigInt(row.amount_per_claim),
    maxClaims: row.max_claims,
    status: row.status,
    closesAt: row.closes_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Whether the drop accepts NEW claims at this instant. Payouts are separate. */
export function dropIsOpen(drop: Drop, now: number = Date.now()): boolean {
  if (drop.status !== "open") return false;
  if (drop.closesAt && now >= new Date(drop.closesAt).getTime()) return false;
  return true;
}

/* ------------------------------------------------------------------------- */
/* Reads                                                                      */
/* ------------------------------------------------------------------------- */

export async function getDropById(id: string): Promise<Drop | null> {
  if (!SUPABASE_CONFIGURED) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("drops")
      .select(DROP_COLUMNS)
      .eq("id", id)
      .maybeSingle<DropRow>();
    if (error || !data) return null;
    return asDrop(data);
  } catch {
    return null;
  }
}

/**
 * The pot's arithmetic.
 *
 * Read with the SERVICE ROLE, and that is deliberate: "how much of this pot is
 * already promised" spans claims that are not public yet (a claim in flight is
 * not on the winners list until its transfer confirms). A page may still show
 * the total — a total is not a per-row disclosure — and the alternative is a
 * claim gate that cannot see the promises it is supposed to respect.
 *
 * Returns null when any read fails: an unknown pot is not an empty one.
 */
export async function getDropStats(drop: Drop): Promise<DropStats> {
  const unreadable: DropStats = {
    pool: null,
    claimCount: null,
    paidCount: null,
    prizesLeft: null,
    isClaimable: false,
  };
  if (!SUPABASE_CONFIGURED) return unreadable;

  try {
    const admin = createAdminClient();
    const pot = await readDropPot(admin, drop.id);
    if (!pot) return unreadable;

    // Two independent caps, whichever binds first: the number of prizes the
    // owner allowed, and the money that is actually there to pay them.
    const byCap = Math.max(0, drop.maxClaims - pot.claimCount);
    const byMoney = Number(pot.pool.available / drop.amountPerClaim);
    const prizesLeft = Math.min(byCap, byMoney);

    return {
      pool: pot.pool,
      claimCount: pot.claimCount,
      paidCount: pot.paidCount,
      prizesLeft,
      isClaimable: dropIsOpen(drop) && prizesLeft > 0,
    };
  } catch {
    return unreadable;
  }
}

export type DropPotRead = {
  pool: DropPool;
  claimCount: number;
  paidCount: number;
};

/**
 * THE POT'S ARITHMETIC, IN ONE PLACE.
 *
 * The page, the claim gate and the payout sweep all read THIS function, so no
 * two of them can disagree about what is in the pot or what is already promised
 * — the failure mode that matters, because the claim gate's whole job is to
 * refuse the claim that the sweep could not pay.
 *
 * MONEY THAT LEFT IS COUNTED AS GONE. `paid` is the settled ledger rows PLUS
 * any claim carrying a payout hash that no ledger row accounts for. That second
 * term is small and load-bearing: a crash between the transfer's two bookkeeping
 * writes (the claim's `payout_tx`, then the ledger row) leaves exactly that
 * state, and without it the pot would report more money than the wallet holds
 * and the next claimer would be promised a prize that no longer exists.
 *
 * Returns null when any read failed: an unreadable pot is not an empty one, and
 * the callers turn it into "try again" rather than into a zero.
 */
export async function readDropPot(admin: AdminClient, dropId: string): Promise<DropPotRead | null> {
  const [depRes, payRes, claimRes] = await Promise.all([
    admin.from("drop_deposits").select("amount::text").eq("drop_id", dropId).limit(ROW_CAP),
    admin
      .from("earn_payouts")
      .select("amount::text, submission_ids")
      .eq("drop_id", dropId)
      .eq("status", "sent")
      .limit(ROW_CAP),
    admin.from("drop_claims").select("id, payout_tx, amount::text").eq("drop_id", dropId).limit(ROW_CAP),
  ]);
  if (depRes.error || payRes.error || claimRes.error) return null;

  let deposited = 0n;
  let paid = 0n;
  const settledClaimIds = new Set<string>();
  for (const d of (depRes.data ?? []) as { amount: string }[]) deposited += BigInt(d.amount);
  for (const p of (payRes.data ?? []) as { amount: string; submission_ids: string[] | null }[]) {
    paid += BigInt(p.amount);
    for (const id of p.submission_ids ?? []) settledClaimIds.add(id);
  }

  let promised = 0n;
  let claimCount = 0;
  let paidCount = 0;
  for (const c of (claimRes.data ?? []) as { id: string; payout_tx: string | null; amount: string }[]) {
    claimCount += 1;
    if (c.payout_tx) {
      paidCount += 1;
      if (!settledClaimIds.has(c.id)) paid += BigInt(c.amount);
    } else {
      promised += BigInt(c.amount);
    }
  }

  const remaining = deposited > paid ? deposited - paid : 0n;
  const available = remaining > promised ? remaining - promised : 0n;
  return { pool: { deposited, paid, promised, remaining, available }, claimCount, paidCount };
}

/** The paid claims — the winners list, oldest first. */
export async function getDropWinners(dropId: string, limit = 50): Promise<DropClaim[]> {
  if (!SUPABASE_CONFIGURED) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("drop_claims")
      .select("id, username, wallet_address, amount::text, x_handle, payout_tx, created_at")
      .eq("drop_id", dropId)
      .not("payout_tx", "is", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) return [];
    return ((data ?? []) as {
      id: string;
      username: string;
      wallet_address: string;
      amount: string;
      x_handle: string | null;
      payout_tx: string;
      created_at: string;
    }[]).map((row) => ({
      id: row.id,
      username: row.username,
      walletAddress: row.wallet_address,
      amount: BigInt(row.amount),
      xHandle: row.x_handle,
      payoutTx: row.payout_tx,
      createdAt: row.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * The caller's own claim on this drop, if they have one.
 *
 * Read with the SESSION client on purpose: the `drop_claims` policy shows a row
 * to its own owner even before its payout confirms, so the page can tell
 * "you claimed, your prize is on its way" from "you can still claim" — the two
 * states a claim button has to tell apart and cannot guess.
 */
export async function getMyDropClaim(
  dropId: string,
  walletAddress: string,
): Promise<{ id: string; amount: bigint; payoutTx: string | null } | null> {
  if (!SUPABASE_CONFIGURED) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("drop_claims")
      .select("id, amount::text, payout_tx")
      .eq("drop_id", dropId)
      .eq("wallet_address", walletAddress.toLowerCase())
      .maybeSingle<{ id: string; amount: string; payout_tx: string | null }>();
    if (error || !data) return null;
    return { id: data.id, amount: BigInt(data.amount), payoutTx: data.payout_tx };
  } catch {
    return null;
  }
}

/**
 * The live drops, newest first, with their figures.
 *
 * THE ENRICHMENT IS CAPPED AND SAID OUT LOUD. Each card's pot costs three reads
 * (deposits, payouts, claims), so this settles the LIST_LIMIT newest drops and
 * leaves the rest as headline rows — the same trade the pay-links dashboard
 * makes, for the same reason: opening a list must not become fifty queries.
 */
export async function getOpenDrops(
  limit = 24,
  listLimit = 12,
): Promise<{ items: DropCard[]; dbFailed: boolean }> {
  if (!SUPABASE_CONFIGURED) return { items: [], dbFailed: false };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("drops")
      .select(DROP_COLUMNS)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return { items: [], dbFailed: true };

    const drops = ((data ?? []) as DropRow[]).map(asDrop);
    const items = await Promise.all(
      drops.map(async (drop, index) => ({
        drop,
        stats:
          index < listLimit
            ? await getDropStats(drop)
            : { pool: null, claimCount: null, paidCount: null, prizesLeft: null, isClaimable: dropIsOpen(drop) },
      })),
    );
    return { items, dbFailed: false };
  } catch {
    return { items: [], dbFailed: true };
  }
}

/** Everything the owner's dashboard needs, for every drop they run. */
export async function getOwnerDrops(ownerId: string): Promise<OwnerDrop[]> {
  if (!SUPABASE_CONFIGURED) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("drops")
      .select(DROP_COLUMNS)
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error || !data) return [];

    const admin = createAdminClient();
    return Promise.all(
      ((data ?? []) as DropRow[]).map(async (row) => {
        const drop = asDrop(row);
        const [stats, claims, fundings, deposits] = await Promise.all([
          getDropStats(drop),
          getRecentClaims(drop.id),
          getRecentFundings(admin, drop.id),
          admin.from("drop_deposits").select("id").eq("drop_id", drop.id).limit(ROW_CAP),
        ]);
        return {
          drop,
          stats,
          claims,
          fundings,
          depositCount: deposits.error ? null : (deposits.data ?? []).length,
        };
      }),
    );
  } catch {
    return [];
  }
}

/**
 * The owner sees promises as well as payments — every claim, paid or not. The
 * public list does not (see getDropWinners), which is the whole difference
 * between "who won" and "how is my pot doing".
 */
async function getRecentClaims(dropId: string): Promise<DropClaim[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("drop_claims")
      .select("id, username, wallet_address, amount::text, x_handle, payout_tx, created_at")
      .eq("drop_id", dropId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) return [];
    return ((data ?? []) as {
      id: string;
      username: string;
      wallet_address: string;
      amount: string;
      x_handle: string | null;
      payout_tx: string | null;
      created_at: string;
    }[]).map((row) => ({
      id: row.id,
      username: row.username,
      walletAddress: row.wallet_address,
      amount: BigInt(row.amount),
      xHandle: row.x_handle,
      payoutTx: row.payout_tx,
      createdAt: row.created_at,
    }));
  } catch {
    return [];
  }
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function getRecentFundings(admin: AdminClient, dropId: string): Promise<DropFunding[]> {
  const { data, error } = await admin
    .from("drop_fundings")
    .select("id, funder_wallet, expected_amount::text, status, expires_at, created_at, tx_hash, matched_amount::text")
    .eq("drop_id", dropId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) return [];
  return ((data ?? []) as {
    id: string;
    funder_wallet: string;
    expected_amount: string;
    status: "pending" | "matched" | "expired";
    expires_at: string;
    created_at: string;
    tx_hash: string | null;
    matched_amount: string | null;
  }[]).map((row) => ({
    id: row.id,
    funderWallet: row.funder_wallet,
    expectedAmount: BigInt(row.expected_amount),
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    txHash: row.tx_hash,
    matchedAmount: row.matched_amount ? BigInt(row.matched_amount) : null,
  }));
}

/**
 * The caller's own open funding intents, for the drop page and the dashboard.
 *
 * Read with the SESSION client on purpose: the `drop_fundings` policy shows a
 * row to the funder and to the drop's owner, and this returns what that policy
 * allows rather than what a service role would hand over.
 */
export async function getMyFundings(dropId: string, funderWallet: string): Promise<DropFunding[]> {
  if (!SUPABASE_CONFIGURED) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("drop_fundings")
      .select("id, funder_wallet, expected_amount::text, status, expires_at, created_at, tx_hash, matched_amount::text")
      .eq("drop_id", dropId)
      .eq("funder_wallet", funderWallet.toLowerCase())
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) return [];
    return ((data ?? []) as {
      id: string;
      funder_wallet: string;
      expected_amount: string;
      status: "pending" | "matched" | "expired";
      expires_at: string;
      created_at: string;
      tx_hash: string | null;
      matched_amount: string | null;
    }[]).map((row) => ({
      id: row.id,
      funderWallet: row.funder_wallet,
      expectedAmount: BigInt(row.expected_amount),
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      txHash: row.tx_hash,
      matchedAmount: row.matched_amount ? BigInt(row.matched_amount) : null,
    }));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------------- */
/* Owner writes                                                               */
/* ------------------------------------------------------------------------- */

const ADDR_RE = /^0x[0-9a-f]{40}$/;
const CREATE_LIMIT = 20;

export const DropDraft = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(280).optional().or(z.literal("")),
  tokenName: z.string().trim().min(1).max(40),
  tokenSymbol: z.string().trim().min(1).max(12).toUpperCase(),
  tokenAddress: z.string().trim().toLowerCase().regex(ADDR_RE, "A valid token contract address."),
  /** Human units ("500", "0.5"), converted with the CONTRACT's decimals. */
  amountPerClaimDisplay: z.string().trim().min(1).max(40),
  maxClaims: z.coerce.number().int().min(1).max(100_000),
  /** Optional ISO deadline; the form's datetime-local value. */
  closesAt: z.string().trim().optional().or(z.literal("")),
});

export type DropDraftInput = z.infer<typeof DropDraft>;
export type DropWriteResult = { ok: true; id?: string } | { error: string; status: number };

/**
 * Create a drop.
 *
 * The three fields that decide who can take the pot are read from somewhere the
 * caller cannot lie about: `owner_id` from the session, `token_decimals` from
 * the CONTRACT, and the token's exclusivity from the database (the `pool_tokens`
 * lease, claimed by a trigger). The prize is the one number the owner chooses,
 * and it is converted against the contract's decimals rather than assumed to be
 * 18 — a 6-decimal token read as 18 would advertise a prize a trillionth of the
 * real one and then pay it.
 */
export async function createDrop(ownerId: string, input: DropDraftInput): Promise<DropWriteResult> {
  if (!SUPABASE_CONFIGURED) return { error: "Not set up yet.", status: 503 };

  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "Not set up yet.", status: 503 };
  }

  const { count } = await admin
    .from("drops")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .neq("status", "ended");
  if ((count ?? 0) >= CREATE_LIMIT) {
    return {
      error: `You already have ${CREATE_LIMIT} live drops. End one before starting another.`,
      status: 409,
    };
  }

  const token = input.tokenAddress.toLowerCase();

  /*
   * $BEGFI IS REFUSED, exactly as campaigns refuse it — and for the same
   * reason. Every pool is funded to ONE shared distributor wallet, so a deposit
   * is attributed per token. BegFi tops its own reward pool up to that same
   * address, so a drop paying in $BEGFI could not tell the site's top-up from
   * the owner's, and the money would be counted into both pools
   * (KNOWN_ISSUES.md #2; the real fix is one deposit address per pool).
   */
  if (BEG_TOKEN_ADDRESS && token === BEG_TOKEN_ADDRESS.toLowerCase()) {
    return {
      error:
        "$BEGFI can't be a drop's prize token — the site's own reward pool is funded to the same wallet, so your deposit couldn't be told apart from it. Use another token.",
      status: 400,
    };
  }

  // The friendly version of the lease guard. The trigger is the race-proof one;
  // this exists so the owner is told WHY in a sentence instead of reading a
  // Postgres exception.
  const { data: holder } = await admin
    .from("pool_tokens")
    .select("kind, pool_id")
    .eq("token_address", token)
    .maybeSingle<{ kind: string; pool_id: string }>();
  if (holder) {
    return {
      error: `That token already funds a live ${holder.kind}. One token can only back one pool at a time, because every pool is funded to the same deposit address — end that ${holder.kind}, or use a different token.`,
      status: 409,
    };
  }

  // A PRIZE IS NOT SCALED BY A GUESS. Campaigns fall back to the ERC-20 default
  // when this read fails; a drop refuses instead, because the number here is
  // what every claimer is promised per claim, and a 6-decimal token silently
  // read as 18 would advertise — and pay — a prize a trillionth of the real one.
  const decimals = await readTokenDecimals(input.tokenAddress);
  if (decimals === null) {
    return {
      error: "Couldn't read that token's decimals from the chain, and a prize has to be scaled by the contract's own number rather than a guess. Try again in a moment.",
      status: 503,
    };
  }
  const amount = parseAmount(input.amountPerClaimDisplay, decimals);
  if (amount === null || amount <= 0n) {
    return {
      error: `That isn't a valid prize for a token with ${decimals} decimals. Use a number like 100 or 0.5.`,
      status: 400,
    };
  }

  let closesAt: string | null = null;
  if (input.closesAt) {
    const parsed = new Date(input.closesAt);
    if (Number.isNaN(parsed.getTime())) return { error: "That closing time isn't a date.", status: 400 };
    if (parsed.getTime() <= Date.now()) return { error: "The closing time is already in the past.", status: 400 };
    closesAt = parsed.toISOString();
  }

  const { data: inserted, error } = await admin
    .from("drops")
    .insert({
      owner_id: ownerId,
      name: input.name,
      description: input.description || null,
      token_name: input.tokenName,
      token_symbol: input.tokenSymbol,
      token_address: token,
      token_decimals: decimals,
      amount_per_claim: amount.toString(),
      max_claims: input.maxClaims,
      status: "open",
      closes_at: closesAt,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !inserted) {
    // 23505 here is the `pool_tokens` lease trigger firing between the read
    // above and this insert — the case the read cannot cover. Same answer.
    if (error?.code === "23505") {
      return {
        error: "That token started funding another pool while you were filling this in. Use a different token, or try again once that one ends.",
        status: 409,
      };
    }
    return { error: error?.message ?? "Could not create the drop.", status: 500 };
  }

  return { ok: true, id: inserted.id };
}

export type DropAction = "pause" | "resume" | "end" | "extend";

/**
 * The owner's controls: stop new claims, start them again, end the drop, or
 * move (or clear) the closing time.
 *
 * WHAT IS DELIBERATELY NOT EDITABLE: the prize, the token, and the cap. A claim
 * is a promise made at a moment, and the claim row carries the prize it was
 * made for (`drop_claims.amount`, and the insert policy pins it to the drop's
 * own value). Allowing the prize to move afterwards would mean either paying a
 * promise at a new number or keeping two numbers that disagree — so the number
 * is fixed at creation and a different prize is a different drop.
 *
 * `end` is the only action that RELEASES the token lease, because it is the
 * only one that stops deposits for good.
 */
export async function manageDrop(
  ownerId: string,
  input: { dropId: string; action: DropAction; closesAt?: string },
): Promise<DropWriteResult> {
  if (!SUPABASE_CONFIGURED) return { error: "Not set up yet.", status: 503 };
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("drops")
    .select("id, owner_id, status")
    .eq("id", input.dropId)
    .maybeSingle<{ id: string; owner_id: string; status: DropStatus }>();
  if (!row) return { error: "That drop doesn't exist.", status: 404 };
  if (row.owner_id !== ownerId) return { error: "That isn't your drop.", status: 403 };
  if (row.status === "ended") return { error: "This drop has already ended.", status: 409 };

  if (input.action === "end") {
    const { error } = await admin
      .from("drops")
      .update({ status: "ended", updated_at: new Date().toISOString() })
      .eq("id", row.id);
    return error ? { error: error.message, status: 500 } : { ok: true };
  }

  if (input.action === "pause" || input.action === "resume") {
    const { error } = await admin
      .from("drops")
      .update({
        status: input.action === "pause" ? "paused" : "open",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return error ? { error: error.message, status: 500 } : { ok: true };
  }

  // extend: a new deadline, or none at all.
  let closesAt: string | null = null;
  if (input.closesAt) {
    const parsed = new Date(input.closesAt);
    if (Number.isNaN(parsed.getTime())) return { error: "That closing time isn't a date.", status: 400 };
    closesAt = parsed.toISOString();
  }
  const { error } = await admin
    .from("drops")
    .update({ closes_at: closesAt, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  return error ? { error: error.message, status: 500 } : { ok: true };
}

/* ------------------------------------------------------------------------- */
/* The claim                                                                  */
/* ------------------------------------------------------------------------- */

export type ClaimOutcome =
  | { ok: true; claimId: string; amount: string }
  | { error: string; status: number };

/**
 * Claim a prize.
 *
 * THE ORDER OF THE CHECKS IS THE DESIGN.
 *
 *  1. A claim is a PROMISE TO PAY, so it is refused while payouts are paused —
 *     the same reasoning the campaign and earn submit paths use. Banking a
 *     claim that cannot be paid is how a giveaway becomes a lie.
 *  2. The drop must be open and inside its window.
 *  3. The pot must still cover a whole prize AFTER everything already promised
 *     (`available`, not `remaining`) — the check that makes two claims in the
 *     same second safe.
 *  4. The cap must not be reached.
 *  5. The wallet, and the VERIFIED X account behind it, must not have claimed
 *     already. Both are also unique indexes, so a race cannot slip past; the
 *     read here exists to answer in a sentence.
 *
 * THE WRITE RUNS WITH THE CALLER'S SESSION, not the service role: the
 * `drop_claims_insert_own` policy is the enforcement that the row is the
 * caller's own profile and wallet and that the amount is the drop's own prize,
 * and a service-role insert would step around it.
 */
export async function claimDrop(profile: Profile, dropId: string): Promise<ClaimOutcome> {
  if (!SUPABASE_CONFIGURED) return { error: "Not set up yet.", status: 503 };

  const drop = await getDropById(dropId);
  if (!drop) return { error: "That drop doesn't exist.", status: 404 };
  if (drop.status === "ended") return { error: "This drop has ended.", status: 409 };
  if (drop.status === "paused") return { error: "This drop is paused — no new claims right now.", status: 409 };
  if (!dropIsOpen(drop)) return { error: "This drop's claim window has closed.", status: 409 };

  const stats = await getDropStats(drop);
  if (!stats.pool || stats.claimCount === null) {
    return { error: "Could not read the pot just now. Try again in a moment.", status: 503 };
  }
  if (stats.pool.available < drop.amountPerClaim) {
    return { error: "The pot is empty — every prize has been taken.", status: 409 };
  }
  if (stats.claimCount >= drop.maxClaims) {
    return { error: `All ${drop.maxClaims} prizes have been taken.`, status: 409 };
  }

  /*
   * 4½. AND CAN IT ACTUALLY PAY IT? A pot can be fully funded in the ledger
   * while the payout wallet cannot send a single transfer — no gas, or the
   * tokens moved out. Accepting the claim anyway is how a giveaway becomes a
   * lie, so the site refuses the claim with a Retry instead (the same rule the
   * earn submit path applies, through the same helper). The check is a read and
   * a read can fail; it answers "no" when it does, which is the refusal side.
   */
  if (!(await payoutWalletReady(drop.tokenAddress, drop.amountPerClaim))) {
    return { error: "Payouts are briefly offline — the pot is being funded. Try again in a moment.", status: 503 };
  }

  const wallet = profile.wallet_address.toLowerCase();
  // Only a VERIFIED X handle is an identity. An unverified one is a string
  // anyone can type into their profile, so it is stored as null and cannot
  // collide with anybody.
  const verifiedHandle =
    profile.x_verified_at && profile.x_handle ? profile.x_handle.trim().replace(/^@/, "").toLowerCase() : null;

  const admin = createAdminClient();
  const { data: prior, error: priorError } = await admin
    .from("drop_claims")
    .select("id, wallet_address, x_handle")
    .eq("drop_id", drop.id)
    .limit(ROW_CAP);
  if (priorError) {
    return { error: "Could not check your claim record. Try again in a moment.", status: 500 };
  }
  const claims = (prior ?? []) as { id: string; wallet_address: string; x_handle: string | null }[];
  if (claims.some((c) => c.wallet_address === wallet)) {
    return { error: "This wallet already claimed a prize from this drop.", status: 409 };
  }
  if (verifiedHandle && claims.some((c) => c.x_handle === verifiedHandle)) {
    return {
      error: "This X account already claimed — one prize per account per drop, however many wallets it has.",
      status: 409,
    };
  }

  const supabase = await createClient();
  const { data: inserted, error } = await supabase
    .from("drop_claims")
    .insert({
      drop_id: drop.id,
      user_id: profile.id,
      username: profile.username,
      wallet_address: wallet,
      amount: drop.amountPerClaim.toString(),
      x_handle: verifiedHandle,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !inserted) {
    if (error?.code === "23505") {
      // One of the three unique indexes won a race the reads above lost.
      return {
        error: "You've already claimed from this drop — one prize per wallet, per X account, per drop.",
        status: 409,
      };
    }
    return { error: error?.message ?? "Could not record your claim.", status: 500 };
  }

  return { ok: true, claimId: inserted.id, amount: drop.amountPerClaim.toString() };
}
