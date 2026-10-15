import "server-only";

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { BEG_TOKEN_ADDRESS, DISTRIBUTOR_PRIVATE_KEY } from "@/lib/config";
import { robinhoodChain } from "@/lib/chains";
import { erc20Abi } from "@/lib/erc20";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import { publishEarnerNotification } from "@/lib/notify";

/**
 * AUTOMATIC REWARD DISTRIBUTION.
 *
 * The rules this module implements, in the order they matter:
 *
 *  1. NO SMART CONTRACT, NO ESCROW. The distributor is an EOA whose key lives
 *     ONLY in a server-side secret (DISTRIBUTOR_PRIVATE_KEY — the encrypted
 *     deployment env, the same class of storage a Supabase Edge Function
 *     secret is). It is never NEXT_PUBLIC_, never in the browser bundle,
 *     never in the database, never in a log line. Only its ADDRESS (public by
 *     nature) is derived here.
 *
 *  2. IT RUNS BY ITSELF. Three triggers call `sweepEarnPayouts`:
 *       - the daily cron route (/api/cron/earn-payouts, scheduled in vercel.json);
 *       - the funds-arrival trigger: the indexer's transfer scan notices a
 *         transfer TO the distributor wallet and fires a sweep;
 *       - the admin console's "trigger a sweep now" button — which runs the
 *         SAME automatic path, not an approval.
 *     A sweep pays every wallet owed money that the funding allows. No manual
 *     approval anywhere in the path.
 *
 *  3. CYCLES. A cycle is the UTC day of the sweep. The owner funds the wallet;
 *     each day's sweep pays that day's completers (and, while backlog exists,
 *     the unpaid past completers) until the funded amount is exhausted. One
 *     ledger row per wallet per cycle — the UNIQUE key in migration 0021.
 *
 *  4. NO DOUBLE PAYMENT. Two independent layers:
 *       - money truth: only rows with `payout_tx IS NULL` are ever eligible,
 *         and payout_tx is set only after a transfer CONFIRMED on-chain;
 *       - send truth: a sender must first TAKE the payout lease on the
 *         submission rows (migration 0021 explains why `claimed_at` could not
 *         be that signal — submit stages it at birth). The lease is taken by
 *         a conditional UPDATE, which is atomic: racing senders (sweep cron
 *         vs funds trigger vs the user's own Claim button) cannot both win.
 *
 *  5. NEVER MORE THAN THE BALANCE. The sweep reads the distributor's live
 *     $BEGFI balance before each send and skips a wallet whose total owed
 *     exceeds what is left. It also holds a native-ETH gas floor: a balance
 *     that cannot pay one more send's gas ends the run instead of producing
 *     a dying transaction.
 *
 *  6. BATCHES AND RETRIES. Wallets are paid one ERC-20 transfer each, and one
 *     wallet's failure does not stop the rest — the loop moves to the next
 *     wallet on catch. A failed row retries on the next trigger, up to
 *     MAX_ATTEMPTS, then stays visibly `failed` on the console rather than
 *     burning gas forever on a send that will never succeed.
 */

/** A lease older than this does not block a resend: the sender is presumed dead. */
const LEASE_MS = 10 * 60 * 1000;
/** A submitted-but-unconfirmed tx is presumed dropped after this long and re-sent. */
const TX_DROP_MS = 10 * 60 * 1000;
/** Attempts beyond this leave a payout failed (console-inspectable), not retried. */
const MAX_ATTEMPTS = 10;

/** Hard ceiling on wallets paid per sweep, whatever the time budget allows. */
const MAX_PAYOUTS_PER_RUN = 40;

/**
 * Gas units budgeted per ERC-20 transfer. Real spend on this L2 is ~60-80k;
 * the slack is deliberate — running the distributor out of gas because an
 * estimate was optimistic is the one failure this constant exists to prevent.
 */
const GAS_UNITS = 120_000n;
/** The next send's gas must fit twice over: a price spike never strands a run. */
const GAS_HEADROOM = 2n;

export function distributorConfigured(): boolean {
  return Boolean(BEG_TOKEN_ADDRESS) && /^0x[0-9a-fA-F]{64}$/.test(DISTRIBUTOR_PRIVATE_KEY);
}

/** The distributor's address, derived only on the server from the key secret. */
export function distributorAddress(): string | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(DISTRIBUTOR_PRIVATE_KEY)) return null;
  return privateKeyToAccount(DISTRIBUTOR_PRIVATE_KEY as `0x${string}`)?.address.toLowerCase() ?? null;
}

/** The time budget a sweep inside a Vercel function must keep (60s limit). */
export function sweepBudgetMs(): number {
  return 45_000;
}

export type SweepOutcome = {
  trigger: string;
  cycleDate: string;
  /** True when at least one send was attempted (sent or failed). */
  ran: boolean;
  stopped?: "not-configured" | "no-unpaid" | "no-funds" | "no-gas" | "db";
  tokenBalance: bigint;
  nativeBalance: bigint;
  sentAmount: bigint;
  sentCount: number;
  failedCount: number;
  notes: string[];
};

export type WalletPlan = {
  wallet_address: string;
  user_id: string;
  username: string;
  ids: string[];
  owed: bigint;
  oldest: string;
};

type SupabaseAdmin = ReturnType<typeof createAdminClient>;
type UnpaidRow = {
  id: string;
  user_id: string;
  username: string;
  wallet_address: string;
  reward_amount: string;
  payout_lease: string | null;
  created_at: string;
};

/* ------------------------------------------------------------------------- */
/* The sweep                                                                  */
/* ------------------------------------------------------------------------- */

export async function sweepEarnPayouts(
  trigger: string,
  opts: { budgetMs?: number; maxPayouts?: number } = {},
): Promise<SweepOutcome> {
  const notes: string[] = [];
  const cycleDate = new Date().toISOString().slice(0, 10);
  const base: SweepOutcome = {
    trigger,
    cycleDate,
    ran: false,
    tokenBalance: 0n,
    nativeBalance: 0n,
    sentAmount: 0n,
    sentCount: 0,
    failedCount: 0,
    notes,
  };

  // 1. Configuration. A missing secret is a fact about the deployment, not an
  //    error to mask: the console shows "not configured" and nothing moves.
  if (!distributorConfigured()) {
    notes.push("distributor key or token address missing");
    return { ...base, stopped: "not-configured" };
  }
  let admin: SupabaseAdmin;
  try {
    admin = createAdminClient();
  } catch {
    return { ...base, stopped: "db" };
  }

  const account = privateKeyToAccount(DISTRIBUTOR_PRIVATE_KEY as `0x${string}`);
  const client = createPublicClient({ chain: robinhoodChain, transport: http() });
  const walletClient = createWalletClient({ account, chain: robinhoodChain, transport: http() });
  const tokenAddress = BEG_TOKEN_ADDRESS as `0x${string}`;

  // 2. Live on-chain balances. The token balance is the funding budget; the
  //    native balance is the gas budget. Nothing here comes from a cache.
  let tokenBalance: bigint;
  let nativeBalance: bigint;
  try {
    const [token, native] = await Promise.all([
      client.readContract({
        abi: erc20Abi,
        address: tokenAddress,
        functionName: "balanceOf",
        args: [account.address],
      }) as unknown as Promise<bigint>,
      client.getBalance({ address: account.address }),
    ]);
    tokenBalance = token;
    nativeBalance = native;
  } catch (error) {
    notes.push(`RPC read failed: ${describeError(error)}`);
    return { ...base, stopped: "no-funds" };
  }

  if (tokenBalance === 0n) {
    notes.push("the distributor wallet holds no $BEGFI — sweep parked until it is funded");
    return { ...base, tokenBalance, nativeBalance, stopped: "no-funds" };
  }

  const gasPrice = await client.getGasPrice().catch(() => 0n);
  const gasNeeded = GAS_UNITS * (gasPrice > 0n ? gasPrice : 30_000_000_000n) * GAS_HEADROOM;
  if (nativeBalance <= gasNeeded) {
    notes.push("native balance is at the gas floor — sweep parked until it is funded");
    return { ...base, tokenBalance, nativeBalance, stopped: "no-gas" };
  }

  // 3. Settle sends whose confirmation outlived the previous run BEFORE
  //    anything new is attempted — a slow receipt is settled, never re-sent.
  await reconcileInFlight(admin, client, notes);

  // 4. Who is owed: approved rows with no payout tx and no live lease,
  //    grouped per wallet, sorted FIFO by the wallet's oldest unpaid post.
  const staleCutoff = new Date(Date.now() - LEASE_MS).toISOString();
  const { data: unpaid, error } = await admin
    .from("earn_submissions")
    .select("id, user_id, username, wallet_address, reward_amount::text, payout_lease, created_at")
    .eq("status", "approved")
    .is("payout_tx", null)
    .order("created_at", { ascending: true })
    .limit(2_000);

  if (error) {
    notes.push(`db read failed: ${error.message}`);
    return { ...base, tokenBalance, nativeBalance, stopped: "db" };
  }

  const wallets = groupWallets((unpaid ?? []) as UnpaidRow[], staleCutoff);
  if (wallets.length === 0) {
    notes.push("nothing unpaid");
    return { ...base, tokenBalance, nativeBalance, stopped: "no-unpaid" };
  }

  // 5. The send loop. Deliberately sequential: one transfer, wait for its
  //    receipt, record, then the next wallet. A failed wallet moves on to the
  //    next one instead of aborting the batch.
  let tokenLeft = tokenBalance;
  let sentAmount = 0n;
  let sentCount = 0;
  let failedCount = 0;

  const deadline = Date.now() + (opts.budgetMs ?? sweepBudgetMs());
  const maxPayouts = opts.maxPayouts ?? MAX_PAYOUTS_PER_RUN;

  for (const plan of wallets) {
    if (sentCount + failedCount >= maxPayouts || Date.now() > deadline) {
      notes.push(`stopping early: the remaining wallets wait for the next trigger`);
      break;
    }

    // The balance cap, exactly as the brief states: a wallet whose total owed
    // is more than what is left IS NOT PAID PARTIALLY. It keeps its full
    // pending amount and the next funded trigger pays it (oldest first).
    if (plan.owed > tokenLeft) {
      notes.push(`${short(plan.wallet_address)} owes more than the remaining budget — left for after the wallet is funded again`);
      continue;
    }
    const gasLeft = await client.getBalance({ address: account.address }).catch(() => 0n);
    if (gasLeft <= gasNeeded) {
      notes.push("native balance ran down to the gas floor — stopping before a send can fail on gas");
      break;
    }

    // 5a. Own the rows. The lease decides WHO sends, so a racing cron, a funds
    //     trigger and the user's own Claim button cannot all transfer.
    const owned = await takeLease(admin, plan.ids, staleCutoff);
    if (owned.length === 0) {
      notes.push(`${short(plan.wallet_address)} lease held by another sender — skipped this run`);
      continue;
    }
    // The amount is recomputed from the rows the lease actually won, so the
    // transfer can never send more than the rows it owns justify.
    const amount = owned.reduce((sum, r) => sum + BigInt(r.reward_amount), 0n);
    if (amount === 0n || amount > tokenLeft) continue;

    // 5b. The ledger row: one per (wallet, cycle). A conflict attaches to the
    //     earlier run's row (its retry) instead of paying twice.
    const rowId = await ensurePayoutRow(admin, plan, owned, amount.toString(), cycleDate, notes);
    if (!rowId || rowId === "sent") {
      if (rowId === "sent") notes.push(`${short(plan.wallet_address)} was already paid this cycle — anything newly approved waits for the next day's cycle`);
      continue;
    }

    // 5c. Attempt bookkeeping. Bumped before the send so a dead run leaves a
    //     counted attempt behind, and a send that can never succeed stops
    //     burning gas after the budget.
    const { data: currentRow } = await admin
      .from("earn_payouts")
      .select("attempts")
      .eq("id", rowId)
      .maybeSingle<{ attempts: number }>();
    const attempts = (currentRow?.attempts ?? 0) + 1;
    if (attempts > MAX_ATTEMPTS) {
      notes.push(`${short(plan.wallet_address)} exhausted ${MAX_ATTEMPTS} attempts — left failed for the console`);
      await admin.from("earn_payouts").update({ status: "failed", attempts, last_error: "retries exhausted" }).eq("id", rowId);
      failedCount += 1;
      continue;
    }
    await admin
      .from("earn_payouts")
      .update({ attempts, status: "pending", amount: amount.toString(), submission_ids: owned.map((o) => o.id) })
      .eq("id", rowId);

    // 5d. Send.
    try {
      const hash = await walletClient.writeContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "transfer",
        args: [plan.wallet_address as `0x${string}`, amount],
      });

      // 5e. Persist the hash IMMEDIATELY, before waiting to confirm. If this
      //     run dies mid-confirmation, the next sweep reconciles against the
      //     hash (reconcileInFlight) instead of sending the money twice.
      await admin.from("earn_payouts").update({ tx_hash: hash }).eq("id", rowId);

      let receipt;
      try {
        receipt = await client.waitForTransactionReceipt({ hash, timeout: 20_000 });
      } catch {
        // The tx may still land. The hash is on the row; the next trigger settles it.
        notes.push(`${short(plan.wallet_address)} confirmation is still pending (${hash.slice(0, 12)}…) — settles on the next trigger`);
        continue;
      }

      if (receipt.status !== "success") throw new Error("transfer reverted on-chain");

      // 5f. Confirmed. Bookkeeping problems AFTER the transfer count as sent —
      //     the money moved; a hiccup here is a note, never a false failure.
      try {
        await settlePayout(admin, rowId, owned, hash);
        await publishEarnerNotification(admin, {
          profileId: plan.user_id,
          amount: amount.toString(),
          decimals: 18,
          symbol: "$BEGFI",
          txHash: hash,
          refPrefix: "earnpayout",
        });
      } catch (error) {
        notes.push(`confirmed, but bookkeeping hiccuped (${describeError(error)}) — settled on the next reconcile`);
      }
      tokenLeft -= amount;
      sentAmount += amount;
      sentCount += 1;
    } catch (error) {
      // One failed transfer does not stop the rest.
      failedCount += 1;
      const message = describeError(error);
      notes.push(`${short(plan.wallet_address)} send failed: ${message}`);
      await admin.from("earn_payouts").update({ status: "failed", last_error: message }).eq("id", rowId);
      // Release the lease on a PRE-SEND failure (the transfer never left, so
      // holding it adds a pointless 10-minute wait). A post-send failure keeps
      // is — the tx may exist and reconcileInFlight owns that case.
      if (message.includes("reverted on-chain")) {
        await admin.from("earn_submissions").update({ payout_lease: null }).in("id", owned.map((o) => o.id)).is("payout_tx", null);
      }
    }
  }

  // Closing balances, straight from the chain — the truth the console shows.
  const [finalToken, finalNative] = await Promise.all([
    client
      .readContract({ abi: erc20Abi, address: tokenAddress, functionName: "balanceOf", args: [account.address] })
      .catch(() => null) as unknown as Promise<bigint | null>,
    client.getBalance({ address: account.address }).catch(() => null),
  ]);

  return {
    ...base,
    ran: sentCount > 0 || failedCount > 0,
    tokenBalance: finalToken ?? tokenLeft,
    nativeBalance: finalNative ?? 0n,
    sentAmount,
    sentCount,
    failedCount,
    notes,
  };
}

/* ------------------------------------------------------------------------- */
/* The lease: the atom of safe sending                                        */
/* ------------------------------------------------------------------------- */

type OwnedRow = { id: string; reward_amount: string };

/**
 * Own the rows this sender will pay. The update only matches rows whose lease
 * is free (or expired) and which are still unpaid — its return value is
 * exactly what THIS call won. A racer's update matches nothing and it backs off.
 */
export async function takeLease(admin: SupabaseAdmin, ids: string[], staleCutoff: string): Promise<OwnedRow[]> {
  const now = new Date().toISOString();

  // Fresh (free) leases first.
  const fresh = await admin
    .from("earn_submissions")
    .update({ payout_lease: now, claimed_at: now })
    .in("id", ids)
    .is("payout_tx", null)
    .is("payout_lease", null)
    .select("id, reward_amount::text");

  let owned = (fresh.data ?? []) as OwnedRow[];

  // Expired leases are re-taken under the same atomic rule.
  const rest = ids.filter((id) => !owned.some((o) => o.id === id));
  if (rest.length > 0) {
    const stale = await admin
      .from("earn_submissions")
      .update({ payout_lease: now, claimed_at: now })
      .in("id", rest)
      .is("payout_tx", null)
      .lt("payout_lease", staleCutoff)
      .select("id, reward_amount::text");
    owned = owned.concat((stale.data ?? []) as OwnedRow[]);
  }

  return owned.map((r) => ({ id: r.id, reward_amount: String(r.reward_amount) }));
}

/** Mark the submission rows paid (money truth) and close their lease. */
async function settlePayout(admin: SupabaseAdmin, rowId: string, owned: OwnedRow[], hash: string): Promise<void> {
  const { error: subError } = await admin
    .from("earn_submissions")
    .update({ payout_tx: hash, payout_lease: null })
    .in("id", owned.map((o) => o.id))
    .is("payout_tx", null);
  const { error: rowError } = await admin
    .from("earn_payouts")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", rowId);
  if (subError || rowError) {
    throw new Error(`bookkeeping after send failed: ${subError?.message ?? rowError?.message}`);
  }
}

/** Insert the ledger row, or attach to this cycle's existing row for a retry. */
async function ensurePayoutRow(
  admin: SupabaseAdmin,
  plan: WalletPlan,
  owned: OwnedRow[],
  amount: string,
  cycleDate: string,
  notes: string[],
): Promise<string | "sent" | null> {
  const insert = {
    cycle_date: cycleDate,
    wallet_address: plan.wallet_address,
    user_id: plan.user_id,
    username: plan.username,
    amount,
    submission_ids: owned.map((o) => o.id),
  };

  const { data, error } = await admin
    .from("earn_payouts")
    .insert(insert)
    .select("id, status");

  const row = (data?.[0] ?? null) as { id: string; status: string } | null;

  if (error) {
    if (error.code === "23505") {
      // This wallet already has a row in this cycle, from the same sweep day's
      // earlier attempt. Attach to it; pay only if it has not already settled.
      const { data: existing } = await admin
        .from("earn_payouts")
        .select("id, status")
        .eq("wallet_address", plan.wallet_address)
        .eq("cycle_date", cycleDate)
        .maybeSingle<{ id: string; status: string }>();
      if (!existing) {
        notes.push("ledger row vanished between conflict and re-read");
        return null;
      }
      return existing.status === "sent" ? "sent" : existing.id;
    }
    notes.push(`ledger write failed: ${error.message}`);
    return null;
  }
  if (!row) return null;
  return row.status === "sent" ? "sent" : row.id;
}

/* ------------------------------------------------------------------------- */
/* Settlement of sends whose receipt came back after the previous run ended   */
/* ------------------------------------------------------------------------- */

/**
 * Rows still `pending` with a tx hash: the transfer is on-chain — or dropped.
 * A confirmed receipt settles the row and its submissions NOW. A hash with no
 * receipt after TX_DROP_MS is cleared so the wallet is re-sent afresh, not
 * stranded behind a tx that will never mine.
 */
async function reconcileInFlight(
  admin: SupabaseAdmin,
  client: ReturnType<typeof createPublicClient>,
  notes: string[],
): Promise<void> {
  const { data: inflight, error } = await admin
    .from("earn_payouts")
    .select("id, tx_hash, created_at, user_id, amount::text")
    .eq("status", "pending")
    .not("tx_hash", "is", null)
    .limit(100);
  if (error) return;

  for (const row of (inflight ?? []) as { id: string; tx_hash: string; created_at: string; user_id: string | null; amount: string }[]) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: row.tx_hash as `0x${string}` });
      if (receipt.status === "success") {
        notes.push(`settled an in-flight payout: tx ${row.tx_hash.slice(0, 12)}…`);
        await admin.from("earn_payouts").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", row.id);
        if (row.user_id) {
          await publishEarnerNotification(admin, {
            profileId: row.user_id,
            amount: String(row.amount),
            decimals: 18,
            symbol: "$BEGFI",
            txHash: row.tx_hash,
            refPrefix: "earnpayout",
          });
        }
        const { data: idsRow } = await admin
          .from("earn_payouts")
          .select("submission_ids")
          .eq("id", row.id)
          .maybeSingle<{ submission_ids: string[] }>();
        const ids = idsRow?.submission_ids ?? [];
        if (ids.length > 0) {
          await admin
            .from("earn_submissions")
            .update({ payout_tx: row.tx_hash, payout_lease: null })
            .in("id", ids)
            .is("payout_tx", null);
        }
      } else {
        notes.push(`an in-flight payout reverted (${row.tx_hash.slice(0, 12)}…) — wallet stays unpaid and retries`);
        await admin.from("earn_payouts").update({ status: "failed", last_error: "reverted on-chain" }).eq("id", row.id);
      }
    } catch {
      const age = Date.now() - new Date(row.created_at).getTime();
      if (age > TX_DROP_MS) {
        notes.push(`an in-flight tx has no receipt after ${TX_DROP_MS / 60_000}min — presumed dropped, wallet re-enqueued`);
        await admin.from("earn_payouts").update({ tx_hash: null }).eq("id", row.id);
      }
    }
  }
}

/* ------------------------------------------------------------------------- */
/* Grouping                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Approved unpaid rows → one plan per wallet, oldest-unpaid-first. Rows under
 * a LIVE lease are excluded: another sender owns them right now. (An expired
 * lease keeps the row eligible — takeLease re-takes it.)
 */
function groupWallets(rows: UnpaidRow[], _staleCutoff: string): WalletPlan[] {
  const byWallet = new Map<
    string,
    { user_id: string; username: string; rows: UnpaidRow[]; oldest: string }
  >();

  for (const row of rows) {
    if (!/^0x[0-9a-f]{40}$/.test(row.wallet_address)) continue;
    if (row.payout_lease && Date.now() - new Date(row.payout_lease).getTime() < LEASE_MS) continue;

    const entry = byWallet.get(row.wallet_address);
    if (entry) {
      entry.rows.push(row);
      if (row.created_at < entry.oldest) entry.oldest = row.created_at;
    } else {
      byWallet.set(row.wallet_address, {
        user_id: row.user_id,
        username: row.username,
        rows: [row],
        oldest: row.created_at,
      });
    }
  }

  const plans: WalletPlan[] = [];
  for (const [wallet_address, entry] of byWallet) {
    plans.push({
      wallet_address,
      user_id: entry.user_id,
      username: entry.username,
      ids: entry.rows.map((r) => r.id),
      owed: entry.rows.reduce((sum, r) => sum + BigInt(r.reward_amount), 0n),
      oldest: entry.oldest,
    });
  }

  // FIFO by the wallet's oldest unpaid post: earliest completers first.
  plans.sort((a, b) => (a.oldest < b.oldest ? -1 : a.oldest > b.oldest ? 1 : 0));
  return plans;
}

/* ------------------------------------------------------------------------- */
/* The snapshot the admin console renders                                     */
/* ------------------------------------------------------------------------- */

export type PayoutRowSnapshot = {
  cycle_date: string;
  wallet_address: string;
  username: string | null;
  amount: string;
  status: string;
  tx_hash: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

export type DistributorSnapshot = {
  configured: boolean;
  walletAddress: string | null;
  tokenBalance: bigint | null;
  nativeBalance: bigint | null;
  distributed: bigint;
  owed: bigint;
  owedWallets: number;
  pendingCount: number;
  failedCount: number;
  recent: PayoutRowSnapshot[];
};

export async function getDistributorSnapshot(): Promise<DistributorSnapshot | null> {
  if (!SUPABASE_CONFIGURED) return null;

  let admin: SupabaseAdmin;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  const [unpaidRes, sentRes, cycleRes, failedRes, recentRes] = await Promise.all([
    admin
      .from("earn_submissions")
      .select("wallet_address, reward_amount::text")
      .eq("status", "approved")
      .is("payout_tx", null)
      .limit(5_000),
    admin.from("earn_payouts").select("amount::text").eq("status", "sent").limit(10_000),
    admin.from("earn_payouts").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("earn_payouts").select("id", { count: "exact", head: true }).eq("status", "failed"),
    admin
      .from("earn_payouts")
      .select("cycle_date, wallet_address, username, amount::text, status, tx_hash, attempts, last_error, created_at, sent_at")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  let owed = 0n;
  const owedWallets = new Set<string>();
  for (const row of (unpaidRes.data ?? []) as { wallet_address: string; reward_amount: string }[]) {
    owed += BigInt(row.reward_amount);
    owedWallets.add(row.wallet_address);
  }

  let distributed = 0n;
  for (const row of (sentRes.data ?? []) as { amount: string }[]) distributed += BigInt(row.amount);

  // On-chain truth, only when the key is configured (the page says so otherwise).
  let tokenBalance: bigint | null = null;
  let nativeBalance: bigint | null = null;
  const address = distributorAddress();
  if (distributorConfigured() && address && BEG_TOKEN_ADDRESS) {
    const client = createPublicClient({ chain: robinhoodChain, transport: http() });
    try {
      const [token, native] = await Promise.all([
        client.readContract({
          abi: erc20Abi,
          address: BEG_TOKEN_ADDRESS as `0x${string}`,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        }) as unknown as Promise<bigint>,
        client.getBalance({ address: address as `0x${string}` }),
      ]);
      tokenBalance = token;
      nativeBalance = native;
    } catch {
      tokenBalance = null;
      nativeBalance = null;
    }
  }

  return {
    configured: distributorConfigured(),
    walletAddress: address,
    tokenBalance,
    nativeBalance,
    distributed,
    owed,
    owedWallets: owedWallets.size,
    pendingCount: cycleRes.count ?? 0,
    failedCount: failedRes.count ?? 0,
    recent: (recentRes.data ?? []) as PayoutRowSnapshot[],
  };
}

/** The funds-arrival trigger's rate limiter, in app_config (5-minute spacing). */
export async function shouldTriggerOnFunds(admin: SupabaseAdmin): Promise<boolean> {
  const minInterval = 5 * 60 * 1000;
  const { data } = await admin
    .from("app_config")
    .select("value, updated_at")
    .eq("key", "earn_funds_trigger_at")
    .maybeSingle<{ value: string; updated_at: string }>();
  if (data?.updated_at && Date.now() - new Date(data.updated_at).getTime() < minInterval) return false;
  await admin
    .from("app_config")
    .upsert(
      { key: "earn_funds_trigger_at", value: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  return true;
}

function short(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-4)}`;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 200);
  return String(error).slice(0, 200);
}
