import "server-only";

import { createPublicClient, createWalletClient, http, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { DISTRIBUTOR_PRIVATE_KEY } from "@/lib/config";
import { robinhoodChain } from "@/lib/chains";
import { readDropPot } from "@/lib/drops";
import { erc20Abi } from "@/lib/erc20";
import { publishNotification } from "@/lib/notify";
import { payoutsAllowed } from "@/lib/payout-controls";
import { createAdminClient } from "@/lib/supabase/admin";
import { distributorAddress } from "@/lib/earn-distributor";

/**
 * THE DROP DISTRIBUTOR — the sending half of Drops.
 *
 * WHAT IS SHARED WITH CAMPAIGNS, EXACTLY. This file is a FRONT over the payout
 * engine, not a second engine. It shares, unchanged:
 *
 *   * THE WALLET AND KEY — `DISTRIBUTOR_PRIVATE_KEY`, one EOA, derived
 *     server-side only. A drop's prize and a campaign's budget leave the same
 *     address.
 *   * THE LEDGER — `begfi.earn_payouts`, the table BegFi's own pool pays from.
 *     A drop payout is that table's row with `drop_id` set instead of
 *     `campaign_id`, so one console, one audit trail and one reconciliation
 *     see every satoshi the site has ever paid out.
 *   * THE LEASE — the same conditional-update atom as the $BEGFI sweep and the
 *     campaign sweep, over `drop_claims` rows this time. A racing cron and a
 *     funds-arrival trigger cannot both send for one claim; the loser's update
 *     matches nothing.
 *   * THE GAS FLOOR, the per-run time budget, the confirm-then-record rule
 *     (a claim's `payout_tx` is written only after the transfer confirms), and
 *     the in-flight reconciler that settles a receipt the previous run did not
 *     wait for.
 *
 * WHAT IS DIFFERENT, AND WHY IT HAS TO BE.
 *
 *  1. ATTRIBUTION. A campaign's deposits are credited by token alone, because
 *     migration 0025 guarantees only one active campaign per token. A drop
 *     cannot inherit that: it is the second product on the same wallet, so a
 *     transfer would have no owner. Drops are therefore funded by INTENT — the
 *     funder registers `drop_fundings` (their own wallet, the token, the
 *     amount), sends, and the scan below matches the transfer against open
 *     intents. See migration 0029 for the full argument; the short version is
 *     that money must never be attributed to a guess.
 *
 *  2. THE CYCLE. A campaign pays a daily budget to a set of posters. A drop
 *     pays ONE PRIZE per claim, once, ever — so a drop claim is never
 *     re-considered for a later cycle, and the ledger's `(wallet, drop_id)`
 *     uniqueness is what makes that structural rather than remembered.
 *
 * THE ONE RULE THAT MATTERS MOST: a claim is a PROMISE, and a promise is paid
 * in full or not at all. Nothing here pays a partial prize; a pot that cannot
 * cover one more prize stops the sweep and the claim path refuses the next
 * claimer (lib/drops.ts checks `available`, which counts what is already
 * promised).
 */

/** One transfer's gas budget; the same floor the other two sweeps use. */
const GAS_UNITS = 120_000n;
const GAS_HEADROOM = 2n;
/** A lease older than this does not block a resend: the sender is presumed dead. */
const LEASE_MS = 10 * 60 * 1000;
/** A submitted-but-unconfirmed drop tx is presumed dropped after this long. */
const TX_DROP_MS = 10 * 60 * 1000;
/** Attempts beyond this leave a payout failed (console-inspectable), not retried. */
const MAX_ATTEMPTS = 10;
/** A pending intent stops matching after this: an old expectation must not claim a new transfer. */
const FUNDING_TTL_MS = 24 * 60 * 60 * 1000;
/** Intents scanned per indexer run — each distinct token costs one getLogs. */
const FUNDINGS_PER_SCAN = 25;
/** Prizes sent per run, whatever the time budget allows. */
const MAX_PAYOUTS_PER_RUN = 40;
/** Drops served per run. */
const MAX_DROPS_PER_RUN = 20;
/** Unpaid claims and ledger rows read per pool. */
const ROW_CAP = 10_000;

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/** The shape this file actually reads out of a Transfer log. */
type TransferLog = {
  args: { from: `0x${string}`; to: `0x${string}`; value: bigint };
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
  blockNumber: bigint | null;
};

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

export type DropSweepOutcome = {
  trigger: string;
  cycleDate: string;
  ran: boolean;
  dropsServed: number;
  sentCount: number;
  sentTotal: bigint;
  failedCount: number;
  notes: string[];
};

export function dropBudgetMs(): number {
  return 30_000;
}

function describeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 160);
}

function shortWallet(address: string): string {
  return `${address.slice(0, 8)}…`;
}

/* ------------------------------------------------------------------------- */
/* Funding: intents, matched against real transfers                            */
/* ------------------------------------------------------------------------- */

export type FundingCreditResult = {
  credited: number;
  matched: number;
  expired: number;
};

type FundingRow = {
  id: string;
  drop_id: string;
  funder_wallet: string;
  token_address: string;
  status: "pending" | "matched" | "expired";
  matched_at: string | null;
};

/**
 * Credits a drop pot from transfers that match a funding INTENT.
 *
 * THE MATCH KEY IS (funder wallet, token). The database keeps at most one OPEN
 * intent per (funder, token) — the partial unique index in 0029 — which is what
 * makes the match a fact rather than a coin flip. A transfer to the distributor
 * for a token whose ONLY live pool is this drop, from a wallet that registered
 * an intent for it, can be for nothing else.
 *
 * RECENT MATCHES STAY IN THE MATCH SET, deliberately. A funder who sends the
 * pot in two transfers (or sends twice by mistake) would otherwise have the
 * second transfer credited to nobody. Their first transfer settled the intent;
 * `matched_at` inside the window keeps the same (funder, token) matchable for
 * the same drop, so the second arrival is credited to the pot it was sent to.
 * The window closes after `FUNDING_TTL_MS`, which is also when a pending intent
 * expires — one rule, one clock.
 *
 * Returns what it did; every credited row is idempotent on (tx_hash, log_index),
 * so a re-scanned window re-credits nothing and re-bells nothing.
 */
export async function creditDropDeposits(
  admin: SupabaseAdmin,
  client: ReturnType<typeof createPublicClient>,
  fromBlock: bigint,
  toBlock: bigint,
  distributorAddress: string | null,
): Promise<FundingCreditResult> {
  const out: FundingCreditResult = { credited: 0, matched: 0, expired: 0 };
  if (!distributorAddress) return out;

  // 1. Intents that outlived their window stop matching. Doing this first is
  //    what keeps the match set small and the arithmetic honest.
  const expiredCutoff = new Date(Date.now() - FUNDING_TTL_MS).toISOString();
  const { data: expiredRows } = await admin
    .from("drop_fundings")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id");
  out.expired = expiredRows?.length ?? 0;

  // 2. The match set: open intents, plus recently matched ones (see above),
  //    whose drop has not ended.
  const { data: fundings, error } = await admin
    .from("drop_fundings")
    .select("id, drop_id, funder_wallet, token_address, status, matched_at")
    .or(`status.eq.pending,and(status.eq.matched,matched_at.gte.${expiredCutoff})`)
    .limit(FUNDINGS_PER_SCAN);
  if (error || !fundings || fundings.length === 0) return out;

  const rows = (fundings ?? []) as FundingRow[];

  // Oldest intent first, so if two candidates ever resolve to the same
  // (funder, token) — which the lease and the expiry make impossible — the
  // earlier promise is the one credited.
  rows.sort((a, b) => (a.status === b.status ? 0 : a.status === "pending" ? -1 : 1));

  const byToken = new Map<string, FundingRow[]>();
  for (const row of rows) {
    const token = row.token_address.toLowerCase();
    byToken.set(token, [...(byToken.get(token) ?? []), { ...row, token_address: token }]);
  }

  for (const [token, intents] of byToken) {
    let logs: TransferLog[] = [];
    try {
      logs = (await client.getLogs({
        address: token as `0x${string}`,
        event: TRANSFER_EVENT,
        args: { to: distributorAddress as `0x${string}` },
        fromBlock: fromBlock + 1n,
        toBlock,
      })) as unknown as TransferLog[];
    } catch {
      // This token's window could not be read; it stays matchable and the
      // next run retries the same window (cursors are not advanced on failure).
      continue;
    }
    if (logs.length === 0) continue;

    for (const log of logs) {
      // A log without a transaction identity cannot be credited idempotently,
      // so it is skipped rather than written with a made-up key. The window is
      // scanned below the confirmation head, so this is theoretical.
      if (!log.transactionHash || log.logIndex === null || log.blockNumber === null) continue;

      const from = log.args.from.toLowerCase();
      const intent = intents.find((i) => i.funder_wallet === from);
      if (!intent) {
        // A transfer that matches no intent is credited NOWHERE. It sits in the
        // wallet and the drop page says the pot is unfunded until someone
        // registers the intent for it — the honest outcome, stated in 0029.
        continue;
      }
      const value = log.args.value;

      const { data: inserted, error: insertError } = await admin
        .from("drop_deposits")
        .upsert(
          {
            drop_id: intent.drop_id,
            funding_id: intent.id,
            token_address: token,
            amount: value.toString(),
            depositor: from,
            tx_hash: log.transactionHash,
            log_index: log.logIndex,
            block_number: Number(log.blockNumber),
          },
          { onConflict: "tx_hash,log_index", ignoreDuplicates: true },
        )
        .select("id");

      if (insertError || !inserted || inserted.length === 0) continue;
      out.credited += 1;

      // Settle the intent (only while it is still pending — a later arrival
      // must not move a settled row's stamp).
      if (intent.status === "pending") {
        await admin
          .from("drop_fundings")
          .update({
            status: "matched",
            tx_hash: log.transactionHash,
            log_index: log.logIndex,
            block_number: Number(log.blockNumber),
            matched_amount: value.toString(),
            matched_at: new Date().toISOString(),
          })
          .eq("id", intent.id)
          .eq("status", "pending");
        out.matched += 1;
        intent.status = "matched";
      }

      // The owner's bell, per credited transfer. The ref carries the chain
      // coordinates, so re-scans of the same window re-bell nothing.
      await publishDropFundedNotification(admin, intent.drop_id, value.toString(), log.transactionHash, Number(log.logIndex));
    }
  }

  return out;
}

/** Blocks a deliberate on-demand check looks back: a recent window, not a scan. */
const FUNDING_LOOKBACK_BLOCKS = 900n;

export type FundingCheck = {
  status: "pending" | "matched" | "expired" | "unknown";
  /** Transfers this check credited (the funder's own, plus any other intent's in the window). */
  credited: number;
  note: string | null;
};

/**
 * The funder's "I sent it — check now" path.
 *
 * The indexer is the GUARANTEE that a matching transfer is credited; this is an
 * ACCELERATOR, so a giveaway does not have to wait for the next indexer run to
 * become claimable. It reads a recent block window and runs the same matcher as
 * `creditDropDeposits` — same match key, same idempotency, no second rule about
 * what money belongs to whom. A window too small to contain the transfer is not
 * an error: the intent stays pending and the indexer will find it, which the
 * returned note says out loud.
 */
export async function checkDropFunding(
  admin: SupabaseAdmin,
  fundingId: string,
): Promise<FundingCheck> {
  const { data: row, error } = await admin
    .from("drop_fundings")
    .select("id, drop_id, funder_wallet, token_address, status")
    .eq("id", fundingId)
    .maybeSingle<FundingRow>();
  if (error || !row) return { status: "unknown", credited: 0, note: "That funding request could not be read." };
  if (row.status !== "pending") return { status: row.status, credited: 0, note: null };

  const distributor = distributorAddress();
  if (!distributor) return { status: "pending", credited: 0, note: "The payout wallet is not configured on this deployment." };

  const client = createPublicClient({ chain: robinhoodChain, transport: http() });
  let head: bigint;
  try {
    head = await client.getBlockNumber();
  } catch {
    return { status: "pending", credited: 0, note: "The chain could not be read just now — it is credited as soon as it can be." };
  }

  const from = head > FUNDING_LOOKBACK_BLOCKS ? head - FUNDING_LOOKBACK_BLOCKS : 0n;
  const result = await creditDropDeposits(admin, client, from, head, distributor);

  const { data: after } = await admin
    .from("drop_fundings")
    .select("status")
    .eq("id", fundingId)
    .maybeSingle<{ status: FundingRow["status"] }>();

  return {
    status: after?.status ?? row.status,
    credited: result.credited,
    note:
      result.credited === 0
        ? "No matching transfer found yet. If the send is still confirming, check again in a moment — the indexer credits it either way."
        : null,
  };
}

/** "Your pot just got funded" — one bell per confirmed deposit, never per scan. */
async function publishDropFundedNotification(
  admin: SupabaseAdmin,
  dropId: string,
  amount: string,
  txHash: string,
  logIndex: number,
): Promise<void> {
  const { data: drop } = await admin
    .from("drops")
    .select("name, owner_id, token_symbol, token_decimals")
    .eq("id", dropId)
    .maybeSingle<{ name: string; owner_id: string; token_symbol: string; token_decimals: number }>();
  if (!drop) return;

  const display = (BigInt(amount) / 10n ** BigInt(drop.token_decimals)).toLocaleString("en-GB");
  await publishNotification(admin, {
    profileId: drop.owner_id,
    kind: "drop_funded",
    title: `${display} ${drop.token_symbol} credited to ${drop.name}`,
    body: "Your deposit is confirmed on-chain and the pot can pay prizes with it now.",
    ref: `dropfunded-${dropId}-${txHash}-${logIndex}`,
    href: "/dashboard/drops",
    payload: { drop_id: dropId, tx: txHash, amount },
  });
}

/* ------------------------------------------------------------------------- */
/* The sweep                                                                  */
/* ------------------------------------------------------------------------- */

type ClaimRow = {
  id: string;
  drop_id: string;
  user_id: string;
  username: string;
  wallet_address: string;
  amount: string;
  payout_lease: string | null;
  created_at: string;
};

type DropRow = {
  id: string;
  name: string;
  owner_id: string;
  token_address: string;
  token_symbol: string;
  token_decimals: number;
  status: string;
};

/**
 * THE DROP PAYOUT SWEEP.
 *
 * WHERE IT DIFFERS FROM THE OTHER TWO SWEEPS, and nowhere else:
 *
 *   * It is driven by UNPAID CLAIMS, not by a list of pools. A claim accepted
 *     while the drop was open stays payable after the owner pauses or ends the
 *     drop — pausing stops NEW claims, it does not break a promise already
 *     made. Reading the claims first is what makes that true by construction.
 *   * The amount is the CLAIM'S OWN snapshot, summed over the rows the lease
 *     won (a drop claim carries the prize it was made for; the drop's current
 *     number would be a different promise).
 *   * There is no daily budget. The drop's cap and its pot are its budget, both
 *     already checked at claim time; the sweep's job is to make the promises
 *     real, oldest first.
 */
export async function sweepDropPayouts(
  trigger: string,
  opts: { budgetMs?: number; maxPayouts?: number; maxDrops?: number } = {},
): Promise<DropSweepOutcome> {
  const notes: string[] = [];
  const cycleDate = new Date().toISOString().slice(0, 10);
  const out: DropSweepOutcome = {
    trigger,
    cycleDate,
    ran: false,
    dropsServed: 0,
    sentCount: 0,
    sentTotal: 0n,
    failedCount: 0,
    notes,
  };

  if (!/^0x[0-9a-fA-F]{64}$/.test(DISTRIBUTOR_PRIVATE_KEY)) {
    notes.push("distributor key missing — drop sweep parked");
    return out;
  }
  let admin: SupabaseAdmin;
  try {
    admin = createAdminClient();
  } catch {
    return out;
  }

  // The global kill switch, before anything is read.
  const gate = await payoutsAllowed();
  if (!gate.allowed) {
    notes.push(gate.reason);
    return out;
  }

  const account = privateKeyToAccount(DISTRIBUTOR_PRIVATE_KEY as `0x${string}`);
  const client = createPublicClient({ chain: robinhoodChain, transport: http() });
  const walletClient = createWalletClient({ account, chain: robinhoodChain, transport: http() });

  const gasPrice = await client.getGasPrice().catch(() => 0n);
  const gasNeeded = GAS_UNITS * (gasPrice > 0n ? gasPrice : 30_000_000_000n) * GAS_HEADROOM;

  const deadline = Date.now() + (opts.budgetMs ?? dropBudgetMs());
  const maxPayouts = opts.maxPayouts ?? MAX_PAYOUTS_PER_RUN;
  const maxDrops = opts.maxDrops ?? MAX_DROPS_PER_RUN;

  // Settle sends whose receipt outlived the previous run BEFORE paying again.
  await reconcileDropInFlight(admin, client, notes);

  // 1. The promises: every claim with no payout tx yet, oldest first. This is
  //    the pool list — a drop appears here because somebody is owed a prize.
  const { data: claims, error } = await admin
    .from("drop_claims")
    .select("id, drop_id, user_id, username, wallet_address, amount::text, payout_lease, created_at")
    .is("payout_tx", null)
    .order("created_at", { ascending: true })
    .limit(ROW_CAP);
  if (error) {
    notes.push(`claim read failed: ${error.message}`);
    return out;
  }

  const unpaid = (claims ?? []) as ClaimRow[];
  if (unpaid.length === 0) {
    notes.push("nothing unpaid");
    return out;
  }

  // 2. Their drops, with the token and decimals each pot pays in.
  const allDropIds = [...new Set(unpaid.map((c) => c.drop_id))];
  const dropIds = allDropIds.slice(0, maxDrops);
  if (allDropIds.length > dropIds.length) {
    notes.push("claims beyond this run's drop budget wait for the next trigger");
  }
  const { data: drops, error: dropError } = await admin
    .from("drops")
    .select("id, name, owner_id, token_address, token_symbol, token_decimals, status")
    .in("id", dropIds);
  if (dropError) {
    notes.push(`drop read failed: ${dropError.message}`);
    return out;
  }
  const dropById = new Map((((drops ?? []) as DropRow[]).map((d) => [d.id, d])));

  for (const dropId of dropIds) {
    const drop = dropById.get(dropId);
    if (!drop) continue;
    if (Date.now() > deadline) {
      notes.push("time budget reached — remaining drops wait for the next trigger");
      break;
    }

    const mine = unpaid.filter((c) => c.drop_id === dropId);
    if (mine.length === 0) continue;

    // 3. The pot's arithmetic — THE SAME FUNCTION THE PAGE AND THE CLAIM GATE
    //    READ (`readDropPot`). A sweep with its own copy of this sum is a sweep
    //    that can pay out of a pot the claim path thinks is empty, or skip one
    //    it thinks is full.
    const pot = await readDropPot(admin, dropId);
    if (!pot) {
      notes.push(`${drop.name}: ledger read failed, skipped`);
      continue;
    }
    let potLeft = pot.pool.remaining;
    if (potLeft <= 0n) {
      notes.push(`${drop.name}: pot is empty — accepted claims wait for a top-up`);
      continue;
    }

    out.dropsServed += 1;

    for (const claim of mine) {
      if (sentOrFailed(out) >= maxPayouts || Date.now() > deadline) {
        notes.push("stopping early: the remaining prizes wait for the next trigger");
        break;
      }
      const prize = BigInt(claim.amount);

      // A PRIZE IS PAID IN FULL OR NOT AT ALL. No partial sends, ever: the
      // claim row is the promise and its number is what the claimer was told.
      if (prize > potLeft) {
        notes.push(`${drop.name}: pot no longer covers the remaining prizes — claims wait for a top-up`);
        break;
      }

      const gasLeft = await client.getBalance({ address: account.address }).catch(() => 0n);
      if (gasLeft <= gasNeeded) {
        notes.push("native balance reached the gas floor — run stops before a send can fail on gas");
        break;
      }

      // THE LEASE — the same atom as the other sweeps, over claim rows.
      const staleCutoff = new Date(Date.now() - LEASE_MS).toISOString();
      const owned = await takeDropLease(admin, [claim.id], staleCutoff);
      if (owned.length === 0) {
        notes.push(`${drop.name}: lease held by another sender — skipped this run`);
        continue;
      }
      const amount = owned.reduce((sum, r) => sum + BigInt(r.amount), 0n);
      if (amount === 0n || amount > potLeft) continue;

      // 3a. The ledger row: one per (wallet, drop). A conflict on an already
      //     SENT row means this wallet has been paid for this drop — skip it;
      //     on a pending/failed row it is this payout's retry.
      const rowRef = await ensureDropPayoutRow(admin, drop, claim, owned, amount.toString(), cycleDate, notes);
      if (!rowRef) continue;
      if (rowRef === "sent") {
        // The LEDGER says this wallet was paid for this drop. If its claim row
        // never learned the hash (a crash between the transfer and the claim
        // update), the ledger's own hash repairs it here rather than leaving a
        // paid claim that looks unpaid forever — the ledger is the money truth.
        const { data: prior } = await admin
          .from("earn_payouts")
          .select("tx_hash")
          .eq("wallet_address", claim.wallet_address)
          .eq("drop_id", drop.id)
          .maybeSingle<{ tx_hash: string | null }>();
        notes.push(`${drop.name}: ${shortWallet(claim.wallet_address)} was already paid — settling bookkeeping`);
        await admin
          .from("drop_claims")
          .update(prior?.tx_hash ? { payout_tx: prior.tx_hash, payout_lease: null } : { payout_lease: null })
          .in("id", owned.map((o) => o.id))
          .is("payout_tx", null);
        continue;
      }

      const { data: currentRow } = await admin
        .from("earn_payouts")
        .select("attempts")
        .eq("id", rowRef)
        .maybeSingle<{ attempts: number }>();
      const attempts = (currentRow?.attempts ?? 0) + 1;
      if (attempts > MAX_ATTEMPTS) {
        notes.push(`${drop.name}: ${shortWallet(claim.wallet_address)} exhausted ${MAX_ATTEMPTS} attempts — left failed for the console`);
        await admin.from("earn_payouts").update({ status: "failed", attempts, last_error: "retries exhausted" }).eq("id", rowRef);
        out.failedCount += 1;
        continue;
      }
      await admin
        .from("earn_payouts")
        .update({ attempts, status: "pending", amount: amount.toString(), submission_ids: owned.map((o) => o.id) })
        .eq("id", rowRef);

      // 3b. Send.
      try {
        const hash = await walletClient.writeContract({
          address: drop.token_address as `0x${string}`,
          abi: erc20Abi,
          functionName: "transfer",
          args: [claim.wallet_address as `0x${string}`, amount],
        });

        // The hash is filed BEFORE the wait: a run that dies mid-confirmation
        // settles on the next trigger instead of sending a second prize.
        await admin.from("earn_payouts").update({ tx_hash: hash }).eq("id", rowRef);

        let receipt;
        try {
          receipt = await client.waitForTransactionReceipt({ hash, timeout: 20_000 });
        } catch {
          notes.push(`${drop.name}: confirmation pending (${hash.slice(0, 12)}…) — settles on the next trigger`);
          break;
        }
        if (receipt.status !== "success") throw new Error("transfer reverted on-chain");

        const settleNote = await settleDropPayout(admin, rowRef, owned, hash);
        if (settleNote) notes.push(`${drop.name}: ${settleNote}`);
        await publishDropRewardNotification(admin, drop, claim, amount.toString(), hash);

        potLeft -= amount;
        out.sentCount += 1;
        out.sentTotal += amount;
        out.ran = true;
      } catch (e) {
        out.failedCount += 1;
        const message = describeError(e);
        notes.push(`${drop.name}: ${shortWallet(claim.wallet_address)} send failed: ${message}`);
        await admin.from("earn_payouts").update({ status: "failed", last_error: message }).eq("id", rowRef);
        // Release a PRE-SEND lease; a post-send failure keeps it because the tx
        // may exist and the in-flight reconciler owns that case.
        if (message.includes("reverted on-chain")) {
          await admin
            .from("drop_claims")
            .update({ payout_lease: null })
            .in("id", owned.map((o) => o.id))
            .is("payout_tx", null);
        }
      }
    }

    // The owner's summary, written from the sweep's own arithmetic.
    if (out.sentCount > 0) {
      await publishDropOwnerSummary(admin, drop);
    }
  }

  return out;
}

function sentOrFailed(out: DropSweepOutcome): number {
  return out.sentCount + out.failedCount;
}

type OwnedClaim = { id: string; amount: string };

/**
 * Own the claim rows this sender will pay — the campaign lease's conditional
 * update, over `drop_claims`. Fresh leases first, then expired ones re-taken.
 */
async function takeDropLease(admin: SupabaseAdmin, ids: string[], staleCutoff: string): Promise<OwnedClaim[]> {
  const now = new Date().toISOString();
  const fresh = await admin
    .from("drop_claims")
    .update({ payout_lease: now })
    .in("id", ids)
    .is("payout_tx", null)
    .is("payout_lease", null)
    .select("id, amount::text");
  let owned = ((fresh.data ?? []) as { id: string; amount: string }[]).map((r) => ({ id: r.id, amount: String(r.amount) }));

  const rest = ids.filter((id) => !owned.some((o) => o.id === id));
  if (rest.length > 0) {
    const stale = await admin
      .from("drop_claims")
      .update({ payout_lease: now })
      .in("id", rest)
      .is("payout_tx", null)
      .lt("payout_lease", staleCutoff)
      .select("id, amount::text");
    owned = owned.concat(((stale.data ?? []) as { id: string; amount: string }[]).map((r) => ({ id: r.id, amount: String(r.amount) })));
  }
  return owned;
}

/**
 * The ledger row for one (wallet, drop) payout — or the reason not to write it.
 *
 * `(wallet_address, drop_id)` is unique on `earn_payouts` (migration 0029): a
 * drop pays a wallet ONCE, ever. A conflict therefore means either "already
 * sent, nothing to do" or "this run's earlier attempt, retry it", and the two
 * are told apart by the existing row's status — never by assumption.
 */
async function ensureDropPayoutRow(
  admin: SupabaseAdmin,
  drop: DropRow,
  claim: ClaimRow,
  owned: OwnedClaim[],
  amount: string,
  cycleDate: string,
  notes: string[],
): Promise<string | "sent" | null> {
  const insert = {
    cycle_date: cycleDate,
    wallet_address: claim.wallet_address,
    drop_id: drop.id,
    user_id: claim.user_id,
    username: claim.username,
    amount,
    submission_ids: owned.map((o) => o.id),
    token_address: drop.token_address,
    attempts: 1,
  };

  const { data, error } = await admin.from("earn_payouts").insert(insert).select("id, status");
  const row = (data?.[0] ?? null) as { id: string; status: string } | null;
  if (!error && row) return row.status === "sent" ? "sent" : row.id;

  if (error?.code === "23505") {
    const { data: existing } = await admin
      .from("earn_payouts")
      .select("id, status")
      .eq("wallet_address", claim.wallet_address)
      .eq("drop_id", drop.id)
      .maybeSingle<{ id: string; status: string }>();
    if (!existing) {
      notes.push(`${drop.name}: ledger row vanished between conflict and re-read`);
      return null;
    }
    return existing.status === "sent" ? "sent" : existing.id;
  }
  notes.push(`${drop.name}: ledger write failed: ${error?.message ?? "unknown"}`);
  return null;
}

/**
 * Mark the claim paid (money truth) and close its lease, then close the ledger
 * row. Returns a note when a bookkeeping write failed — the money moved either
 * way, so a hiccup here is a sentence, never a false failure, and the next
 * sweep's ledger check repairs the claim row.
 */
async function settleDropPayout(
  admin: SupabaseAdmin,
  rowId: string,
  owned: OwnedClaim[],
  hash: string,
): Promise<string | null> {
  const { error: claimError } = await admin
    .from("drop_claims")
    .update({ payout_tx: hash, payout_lease: null })
    .in("id", owned.map((o) => o.id))
    .is("payout_tx", null);
  const { error: rowError } = await admin
    .from("earn_payouts")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", rowId);
  if (claimError || rowError) {
    return `bookkeeping after a confirmed send failed (${claimError?.message ?? rowError?.message}) — the ledger repairs it on the next run`;
  }
  return null;
}

/**
 * The claimer's bell: "you won" with the prize, the drop's name, the tx.
 *
 * A dedicated kind (`drop_reward`) rather than the earn bell, because the two
 * tell different stories and the bell is the product's memory: a prize is a
 * moment, a campaign payout is an income.
 */
async function publishDropRewardNotification(
  admin: SupabaseAdmin,
  drop: DropRow,
  claim: ClaimRow,
  amount: string,
  txHash: string,
): Promise<void> {
  const display = (BigInt(amount) / 10n ** BigInt(drop.token_decimals)).toLocaleString("en-GB");
  await publishNotification(admin, {
    profileId: claim.user_id,
    kind: "drop_reward",
    title: `You won ${display} ${drop.token_symbol} in ${drop.name}`,
    body: "Paid straight to your wallet — the transfer is confirmed on-chain.",
    ref: `dropreward-${drop.id}-${txHash}`,
    href: `/drop/${drop.id}`,
    payload: { drop_id: drop.id, tx: txHash, amount },
  });
}

/** The owner's bell: "your pot paid prizes today", once per drop per day. */
async function publishDropOwnerSummary(admin: SupabaseAdmin, drop: DropRow): Promise<void> {
  const cycleKey = new Date().toISOString().slice(0, 10);
  await publishNotification(admin, {
    profileId: drop.owner_id,
    kind: "drop_payout",
    title: `${drop.name} paid prizes today`,
    body: "Prizes from your drop went out automatically — the winners and the pot are on your drop dashboard.",
    ref: `droppayout-${drop.id}-${cycleKey}`,
    href: "/dashboard/drops",
    payload: { drop_id: drop.id },
  });
}

/**
 * Rows still `pending` with a tx hash and a drop_id: the transfer is on-chain —
 * or dropped. A confirmed receipt settles the row and its claims NOW. A hash
 * with no receipt after TX_DROP_MS is cleared so the prize is re-sent rather
 * than stranded behind a tx that will never mine.
 */
async function reconcileDropInFlight(
  admin: SupabaseAdmin,
  client: ReturnType<typeof createPublicClient>,
  notes: string[],
): Promise<void> {
  const { data: inflight, error } = await admin
    .from("earn_payouts")
    .select("id, tx_hash, created_at, user_id, amount::text, drop_id, token_address")
    .eq("status", "pending")
    .not("drop_id", "is", null)
    .not("tx_hash", "is", null)
    .limit(100);
  if (error) return;

  for (const row of (inflight ?? []) as {
    id: string;
    tx_hash: string;
    created_at: string;
    user_id: string | null;
    amount: string;
    drop_id: string;
    token_address: string | null;
  }[]) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: row.tx_hash as `0x${string}` });
      if (receipt.status !== "success") {
        notes.push(`an in-flight drop payout reverted (${row.tx_hash.slice(0, 12)}…) — the prize stays unpaid and retries`);
        await admin.from("earn_payouts").update({ status: "failed", last_error: "reverted on-chain" }).eq("id", row.id);
        continue;
      }

      const { data: idsRow } = await admin
        .from("earn_payouts")
        .select("submission_ids")
        .eq("id", row.id)
        .maybeSingle<{ submission_ids: string[] }>();
      const ids = idsRow?.submission_ids ?? [];
      if (ids.length > 0) {
        await admin
          .from("drop_claims")
          .update({ payout_tx: row.tx_hash, payout_lease: null })
          .in("id", ids)
          .is("payout_tx", null);
      }
      await admin.from("earn_payouts").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", row.id);

      const { data: drop } = await admin
        .from("drops")
        .select("id, name, owner_id, token_address, token_symbol, token_decimals, status")
        .eq("id", row.drop_id)
        .maybeSingle<DropRow>();
      const { data: claim } = await admin
        .from("drop_claims")
        .select("id, drop_id, user_id, username, wallet_address, amount::text, payout_lease, created_at")
        .eq("id", ids[0] ?? "00000000-0000-0000-0000-000000000000")
        .maybeSingle<ClaimRow>();
      if (drop && claim) {
        await publishDropRewardNotification(admin, drop, claim, String(row.amount), row.tx_hash);
      }
    } catch {
      const age = Date.now() - new Date(row.created_at).getTime();
      if (age > TX_DROP_MS) {
        notes.push(`an in-flight drop tx has no receipt after ${TX_DROP_MS / 60_000}min — presumed dropped, prize re-enqueued`);
        await admin.from("earn_payouts").update({ tx_hash: null }).eq("id", row.id);
      }
    }
  }
}

/**
 * The drop funds trigger's rate limiter, its own key like the other two: keying
 * them together would make one product's funding silence another's sweep.
 */
export async function shouldTriggerOnDropFunds(admin: SupabaseAdmin): Promise<boolean> {
  const minInterval = 5 * 60 * 1000;
  const { data } = await admin
    .from("app_config")
    .select("value, updated_at")
    .eq("key", "drop_funds_trigger_at")
    .maybeSingle<{ value: string; updated_at: string }>();
  if (data?.updated_at && Date.now() - new Date(data.updated_at).getTime() < minInterval) return false;
  await admin
    .from("app_config")
    .upsert(
      { key: "drop_funds_trigger_at", value: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  return true;
}
