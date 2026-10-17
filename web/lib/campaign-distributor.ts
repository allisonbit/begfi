import "server-only";

import { createPublicClient, createWalletClient, http, parseAbiItem } from "viem";

import { robinhoodChain } from "@/lib/chains";
import { distributorAccount, distributorSignerConfigured } from "@/lib/distributor-signer";
import { erc20Abi, TOKEN_DECIMALS } from "@/lib/erc20";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishEarnerNotification } from "@/lib/notify";
import { payoutsAllowed } from "@/lib/payout-controls";

/**
 * THE CAMPAIGN DISTRIBUTOR.
 *
 * Two jobs, one wallet, one key — server-side only, like the $BEGFI sweep:
 *
 *  1. CREDIT DEPOSITS. The indexer scans Transfer events FOR EVERY REGISTERED
 *     CAMPAIGN TOKEN addressed TO the distributor wallet and writes rows in
 *     `begfi.campaign_deposits` (idempotent by tx+log index). The pool is the
 *     sum of those rows minus confirmed payouts — never a mutable balance.
 *
 *  2. THE DAILY SWEEP. For each active campaign the cycle is the UTC day. The
 *     budget served is
 *         min(daily_budget − already-paid-this-cycle, pool_remaining)
 *     shared in EQUAL shares across the cycle's valid, unpaid posters — one
 *     ERC-20 transfer each, in the campaign's OWN token, from the distributor
 *     wallet. One ledger row per wallet per (campaign, cycle): the same
 *     unique index that guards BegFi's own ledger, scoped per campaign.
 *     Never more than the pool; never without gas; one failed wallet never
 *     stops the rest; every row recorded sent only after the tx confirms.
 *
 * The "already-paid-this-cycle" term is what makes trigger sweeps (the owner
 * funds mid-day, the indexer fires) honor the daily budget instead of
 * stacking a second full budget on top of the cron's run.
 */

/** One transfer's gas budget; the floor is applied once, before the run. */
const GAS_UNITS = 120_000n;
const GAS_HEADROOM = 2n;
/** A lease older than this does not block a resend: its sender is presumed dead. */
const LEASE_MS = 10 * 60 * 1000;
/** A registered-token catalog reads this many deposits per scan. */
const TOKENS_PER_SCAN = 60;

export type SweepCampaignOutcome = {
  trigger: string;
  cycleDate: string;
  ran: boolean;
  campaignsServed: number;
  sentCount: number;
  sentTotal: bigint;
  failedCount: number;
  notes: string[];
};

export function campaignBudgetMs(): number {
  return 45_000;
}

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

type CampaignRow = {
  id: string;
  slug: string;
  token_address: string;
  token_symbol: string;
  token_decimals: number;
  daily_budget: string;
  owner_id: string;
  status: string;
};

type UnpaidRow = {
  id: string;
  user_id: string;
  username: string;
  wallet_address: string;
  payout_lease: string | null;
  created_at: string;
};

function describeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 160);
}

function shortWallet(address: string): string {
  return `${address.slice(0, 8)}…`;
}

/* ------------------------------------------------------------------------- */
/* Deposit crediting (called by the indexer's transfer scan)                   */
/* ------------------------------------------------------------------------- */

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/**
 * Credits campaign-pool deposits found in the scanned window. Tokens are
 * bounded (TOKENS_PER_SCAN) because one getLogs per token per run is the
 * rate-limit shape of the public RPC. Returns how many deposit rows were
 * newly credited.
 */
export async function creditCampaignDeposits(
  admin: SupabaseAdmin,
  client: ReturnType<typeof createPublicClient>,
  fromBlock: bigint,
  toBlock: bigint,
  distributorAddress: string | null,
): Promise<{ credited: number; tokensWithDeposits: number }> {
  if (!distributorAddress) return { credited: 0, tokensWithDeposits: 0 };

  const { data: campaigns } = await admin
    .from("campaigns")
    .select("id, token_address")
    .not("status", "eq", "draft")
    .limit(TOKENS_PER_SCAN);
  if (!campaigns || campaigns.length === 0) return { credited: 0, tokensWithDeposits: 0 };

  const tokens = [...new Set((campaigns as { id: string; token_address: string }[]).map((c) => c.token_address.toLowerCase()))];

  let credited = 0;
  let tokensWithDeposits = 0;

  for (const token of tokens) {
    try {
      const logs = await client.getLogs({
        address: token as `0x${string}`,
        event: TRANSFER_EVENT,
        args: { to: distributorAddress as `0x${string}` },
        fromBlock: fromBlock + 1n,
        toBlock,
      });
      if (logs.length === 0) continue;
      tokensWithDeposits += 1;

      const campaignId = (campaigns as { id: string; token_address: string }[]).find((c) => c.token_address.toLowerCase() === token)!.id;
      const rows = logs.map((log) => ({
        campaign_id: campaignId,
        token_address: token,
        amount: log.args.value!.toString(),
        // The deposit trail records WHO funded, for the dashboard, and
        // idempotency lives on (tx_hash, log_index).
        depositor: log.args.from!.toLowerCase(),
        tx_hash: log.transactionHash,
        log_index: log.logIndex,
        block_number: Number(log.blockNumber),
      }));
      const { data: inserted, error } = await admin.from("campaign_deposits").upsert(rows, { onConflict: "tx_hash,log_index", ignoreDuplicates: true }).select("id");
      if (error) {
        // One token's write failure must not stop the catalog scan.
        continue;
      }
      credited += inserted?.length ?? 0;
    } catch {
      // This token's log read failed; it retries on the next run and the
      // other tokens' deposits are unaffected.
    }
  }
  return { credited, tokensWithDeposits };
}

/* ------------------------------------------------------------------------- */
/* Sweep                                                                      */
/* ------------------------------------------------------------------------- */

export async function sweepCampaignPayouts(
  trigger: string,
  opts: { budgetMs?: number; maxCampaigns?: number } = {},
): Promise<SweepCampaignOutcome> {
  const notes: string[] = [];
  const cycleDate = new Date().toISOString().slice(0, 10);
  const out: SweepCampaignOutcome = { trigger, cycleDate, ran: false, campaignsServed: 0, sentCount: 0, sentTotal: 0n, failedCount: 0, notes };

  if (!distributorSignerConfigured()) {
    notes.push("distributor signer missing — campaign sweep parked");
    return out;
  }
  let admin: SupabaseAdmin;
  try {
    admin = createAdminClient();
  } catch {
    return out;
  }

  // The global kill switch, before a single balance is read. Fails closed:
  // see lib/payout-controls.ts.
  const gate = await payoutsAllowed();
  if (!gate.allowed) {
    notes.push(gate.reason);
    return out;
  }

  const account = distributorAccount();
  if (!account) {
    notes.push("distributor signer unavailable — campaign sweep parked");
    return out;
  }
  const client = createPublicClient({ chain: robinhoodChain, transport: http() });
  const walletClient = createWalletClient({ account, chain: robinhoodChain, transport: http() });

  const gasPrice = await client.getGasPrice().catch(() => 0n);
  const gasNeeded = GAS_UNITS * (gasPrice > 0n ? gasPrice : 30_000_000_000n) * GAS_HEADROOM;

  const deadline = Date.now() + (opts.budgetMs ?? campaignBudgetMs());
  const maxCampaigns = opts.maxCampaigns ?? 20;

  // Recycle rows whose confirmation outlived the previous run BEFORE paying:
  // a slow receipt is settled, never re-sent.
  await reconcileCampaignInFlight(admin, client, notes);

  const { data: campaigns, error } = await admin
    .from("campaigns")
    .select("id, slug, token_address, token_symbol, token_decimals, daily_budget, owner_id, status")
    .eq("status", "active")
    .limit(100);
  if (error) {
    notes.push(`campaign read failed: ${error.message}`);
    return out;
  }

  for (const campaign of ((campaigns ?? []) as CampaignRow[]).slice(0, maxCampaigns)) {
    if (Date.now() > deadline) {
      notes.push("time budget reached — remaining campaigns wait for the next trigger");
      break;
    }

    const [depRes, payAllRes, unpaidRes] = await Promise.all([
      admin.from("campaign_deposits").select("amount::text").eq("campaign_id", campaign.id).limit(10_000),
      admin
        .from("earn_payouts")
        .select("amount::text, cycle_date")
        .eq("campaign_id", campaign.id)
        .eq("status", "sent")
        .limit(10_000),
      admin
        .from("campaign_submissions")
        .select("id, user_id, username, wallet_address, payout_lease, created_at")
        .eq("campaign_id", campaign.id)
        .eq("status", "valid")
        .is("payout_tx", null)
        .order("created_at", { ascending: true })
        .limit(2_000),
    ]);
    if (depRes.error || payAllRes.error || unpaidRes.error) {
      notes.push(`${campaign.slug}: ledger read failed, skipped`);
      continue;
    }

    let deposited = 0n;
    let paidLifetime = 0n;
    let paidThisCycle = 0n;
    for (const d of (depRes.data ?? []) as { amount: string }[]) deposited += BigInt(d.amount);
    for (const p of (payAllRes.data ?? []) as { amount: string; cycle_date: string }[]) {
      paidLifetime += BigInt(p.amount);
      if (p.cycle_date === cycleDate) paidThisCycle += BigInt(p.amount);
    }
    const poolRemaining = deposited - paidLifetime;
    if (poolRemaining <= 0n) {
      notes.push(`${campaign.slug}: pool empty — the campaign stays live so the owner can top up`);
      continue;
    }

    const unpaid = (unpaidRes.data ?? []) as UnpaidRow[];

    // Per wallet, FIFO by earliest post. Live-leased rows belong to another
    // sender right now.
    const byWallet = new Map<string, { user_id: string; username: string; ids: string[]; oldest: string }>();
    for (const row of unpaid) {
      if (!/^0x[0-9a-f]{40}$/.test(row.wallet_address)) continue;
      if (row.payout_lease && Date.now() - new Date(row.payout_lease).getTime() < LEASE_MS) continue;
      const w = byWallet.get(row.wallet_address) ?? { user_id: row.user_id, username: row.username, ids: [], oldest: row.created_at };
      w.ids.push(row.id);
      if (row.created_at < w.oldest) w.oldest = row.created_at;
      byWallet.set(row.wallet_address, w);
    }
    let wallets = [...byWallet.entries()].sort((a, b) => (a[1].oldest < b[1].oldest ? -1 : 1));
    if (wallets.length === 0) continue;

    out.campaignsServed += 1;

    // RUN BUDGET: the daily budget minus what this cycle already paid out,
    // then capped by the pool. Never beyond either.
    const dailyBudget = BigInt(campaign.daily_budget);
    let budgetLeft = dailyBudget - paidThisCycle;
    if (budgetLeft < 0n) budgetLeft = 0n;
    if (budgetLeft > poolRemaining) budgetLeft = poolRemaining;
    if (budgetLeft <= 0n) {
      notes.push(`${campaign.slug}: today's budget exhausted — resumes on the next cycle`);
      continue;
    }

    const tokenAddress = campaign.token_address as `0x${string}`;

    while (wallets.length > 0 && budgetLeft > 0n && Date.now() <= deadline) {
      // Gas floor: a balance that cannot pay one more send's gas ends the run.
      const nativeLeft = await client.getBalance({ address: account.address }).catch(() => 0n);
      if (nativeLeft <= gasNeeded) {
        notes.push("native balance reached the gas floor — run stops before a send can fail on gas");
        break;
      }

      // Equal shares, recomputed against the wallets still in line.
      const perShare = budgetLeft / BigInt(wallets.length);
      if (perShare <= 0n) break;
      const [wallet, entry] = wallets[0];

      // THE LEASE — the same atom the $BEGFI sweep uses, over campaign rows:
      // a conditional claim decides who sends, and a racing sweep (cron vs
      // funds-arrival trigger) cannot win the same rows.
      const cutoff = new Date(Date.now() - LEASE_MS).toISOString();
      const owned = await takeCampaignLease(admin, entry.ids, cutoff);
      if (owned.length === 0) {
        wallets = wallets.slice(1);
        continue;
      }

      try {
        const { data: payoutRow, error: payoutErr } = await admin
          .from("earn_payouts")
          .insert({
            cycle_date: cycleDate,
            wallet_address: wallet,
            campaign_id: campaign.id,
            user_id: entry.user_id,
            username: entry.username,
            amount: (perShare * BigInt(owned.length > 0 ? 1 : 1)).toString(),
            submission_ids: owned,
            token_address: campaign.token_address,
            attempts: 1,
          })
          .select("id, status")
          .single<{ id: string; status: string }>();

        if (payoutErr) {
          if (payoutErr.code === "23505") {
            // This wallet was already served this cycle (a racing trigger):
            // skip it, never double-send.
            wallets = wallets.slice(1);
            continue;
          }
          throw new Error(`ledger write failed: ${payoutErr.message}`);
        }

        const hash = await walletClient.writeContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "transfer",
          args: [wallet as `0x${string}`, perShare],
        });
        // Persist the hash BEFORE waiting: a dead run settles instead of re-sending.
        await admin.from("earn_payouts").update({ tx_hash: hash }).eq("id", payoutRow.id);

        let receipt;
        try {
          receipt = await client.waitForTransactionReceipt({ hash, timeout: 20_000 });
        } catch {
          notes.push(`${campaign.slug}: confirmation pending (${hash.slice(0, 12)}…) — settles on the next run`);
          break;
        }
        if (receipt.status !== "success") throw new Error("transfer reverted on-chain");

        const settleErr = await admin
          .from("campaign_submissions")
          .update({ payout_tx: hash, payout_lease: null })
          .in("id", owned)
          .is("payout_tx", null);
        if (settleErr.error) notes.push(`${campaign.slug}: bookkeeping hiccup after confirmed send — reconcile next run`);
        await admin.from("earn_payouts").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", payoutRow.id);
        await publishEarnerNotification(admin, {
          profileId: entry.user_id,
          amount: perShare.toString(),
          decimals: campaign.token_decimals || CAMPAIGN_TOKEN_DECIMALS_FALLBACK,
          symbol: campaign.token_symbol,
          txHash: hash,
          campaignSlug: campaign.slug,
          refPrefix: `campaignpayout-${campaign.id}`,
        });

        budgetLeft -= perShare;
        out.sentCount += 1;
        out.sentTotal += perShare;
        out.ran = true;
      } catch (e) {
        out.failedCount += 1;
        notes.push(`${campaign.slug}: ${shortWallet(wallet)} send failed: ${describeError(e)}`);
      }
      wallets = wallets.slice(1);
    }

    // OWNER ALERTS from the sweep's own arithmetic — but only when the money
    // truth agrees (the ledger rows the sweep itself wrote).
    const campaignOutcome = {
      sentCount: out.sentCount,
      poolRemaining,
      dailyBudget,
      slug: campaign.slug,
    };
    if (campaignOutcome.sentCount > 0) {
      await publishCampaignNotifications(admin, campaign.owner_id, campaign.id, campaign.slug, "payout");
    }
    if (poolRemaining < dailyBudget && poolRemaining > 0n) {
      await publishCampaignNotifications(admin, campaign.owner_id, campaign.id, campaign.slug, "pool_low");
    }
  }

  return out;
}

type OwnedRow = { id: string; reward_amount?: string };

/** The lease claim: one conditional update wins; the loser's update matches nothing. */
async function takeCampaignLease(admin: SupabaseAdmin, ids: string[], staleCutoff: string): Promise<string[]> {
  const now = new Date().toISOString();
  const fresh = await admin
    .from("campaign_submissions")
    .update({ payout_lease: now })
    .in("id", ids)
    .is("payout_tx", null)
    .is("payout_lease", null)
    .select("id");
  let owned = ((fresh.data ?? []) as { id: string }[]).map((r) => r.id);

  const rest = ids.filter((id) => !owned.includes(id));
  if (rest.length > 0) {
    const staleLeased = await admin
      .from("campaign_submissions")
      .update({ payout_lease: now })
      .in("id", rest)
      .is("payout_tx", null)
      .lt("payout_lease", staleCutoff)
      .select("id");
    owned = owned.concat(((staleLeased.data ?? []) as { id: string }[]).map((r) => r.id));
  }
  return owned;
}

/**
 * Rows `pending` with a tx hash: the transfer exists — or was dropped. A
 * confirmed receipt settles the row AND its submissions; a hash with no
 * receipt after an hour clears for a re-send.
 */
async function reconcileCampaignInFlight(admin: SupabaseAdmin, client: ReturnType<typeof createPublicClient>, notes: string[]): Promise<void> {
  const { data: inflight, error } = await admin
    .from("earn_payouts")
    .select("id, tx_hash, created_at, user_id, amount::text, token_address")
    .eq("status", "pending")
    .not("campaign_id", "is", null)
    .not("tx_hash", "is", null)
    .limit(100);
  if (error) return;

  for (const row of (inflight ?? []) as { id: string; tx_hash: string; created_at: string; user_id: string | null; amount: string }[]) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: row.tx_hash as `0x${string}` });
      if (receipt.status === "success") {
        const { data: idsRow } = await admin
          .from("earn_payouts")
          .select("submission_ids, campaign_id")
          .eq("id", row.id)
          .maybeSingle<{ submission_ids: string[]; campaign_id: string | null }>();
        const ids = idsRow?.submission_ids ?? [];
        if (ids.length > 0) {
          await admin
            .from("campaign_submissions")
            .update({ payout_tx: row.tx_hash, payout_lease: null })
            .in("id", ids)
            .is("payout_tx", null);
        }
        await admin.from("earn_payouts").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", row.id);
        if (row.user_id) {
          const { data: camp } = await admin
            .from("campaigns")
            .select("slug, token_symbol, token_decimals")
            .eq("id", idsRow?.campaign_id ?? "00000000-0000-0000-0000-000000000000")
            .maybeSingle<{ slug: string; token_symbol: string; token_decimals: number }>();
          await publishEarnerNotification(admin, {
            profileId: row.user_id,
            amount: String(row.amount),
            decimals: camp?.token_decimals ?? 18,
            symbol: camp?.token_symbol ?? "tokens",
            txHash: row.tx_hash,
            campaignSlug: camp?.slug ?? undefined,
            refPrefix: `campaignpayout-${idsRow?.campaign_id ?? ""}`,
          });
        }
      } else {
        notes.push(`an in-flight campaign payout reverted (${row.tx_hash.slice(0, 12)}…) — wallet stays unpaid and retries`);
        await admin.from("earn_payouts").update({ status: "failed", last_error: "reverted on-chain" }).eq("id", row.id);
      }
    } catch {
      const age = Date.now() - new Date(row.created_at).getTime();
      if (age > 60 * 60 * 1000) {
        notes.push(`an in-flight campaign tx has no receipt after 60min — presumed dropped, re-enqueued`);
        await admin.from("earn_payouts").update({ tx_hash: null }).eq("id", row.id);
      }
    }
  }
}

/* ------------------------------------------------------------------------- */
/* Owner notifications (the existing bell, campaign-scoped)                    */
/* ------------------------------------------------------------------------- */

/**
 * One row per (owner, campaign, kind, cycle) — the ref-deupe rule the indexer
 * uses, so re-runs never re-bell the same news. Kinds:
 *   "payout"   — today's automatic payout summary,
 *   "pool_low" — the pool is under a day's budget.
 */
export async function publishCampaignNotifications(
  admin: SupabaseAdmin,
  ownerId: string,
  campaignId: string,
  campaignSlug: string,
  kind: "payout" | "pool_low",
): Promise<void> {
  const cycleKey = new Date().toISOString().slice(0, 10);
  const kindFull = kind === "payout" ? "campaign_payout" : "campaign_pool_low";
  const ref = `${kindFull}-${campaignId}-${cycleKey}`;

  const { data: existing } = await admin
    .from("notifications")
    .select("id")
    .eq("profile_id", ownerId)
    .eq("kind", kindFull)
    .contains("payload", { ref })
    .limit(1);
  if (existing && existing.length > 0) return;

  await admin.from("notifications").insert({
    profile_id: ownerId,
    kind: kindFull,
    title: kind === "payout" ? "Your campaign paid its posters" : "Your campaign's pool is running low",
    body:
      kind === "payout"
        ? `Today's payout for /earn/${campaignSlug} went out automatically. Submissions and amounts are on your campaign dashboard.`
        : `The pool behind /earn/${campaignSlug} is below one day's budget. Top up the distributor wallet with your token to keep paying.`,
    payload: { ref, campaign_id: campaignId, campaign_slug: campaignSlug },
    href: "/dashboard/campaigns",
  });
}

export const CAMPAIGN_TOKEN_DECIMALS_FALLBACK = TOKEN_DECIMALS;

/**
 * The campaign funds trigger's rate limiter: a separate key from BegFi's own
 * (keying them together would make a BegFi top-up silence a campaign
 * deposit, or vice versa), same 5-minute shape as the other triggers.
 */
export async function shouldTriggerOnCampaignFunds(admin: SupabaseAdmin): Promise<boolean> {
  const minInterval = 5 * 60 * 1000;
  const { data } = await admin
    .from("app_config")
    .select("value, updated_at")
    .eq("key", "campaign_funds_trigger_at")
    .maybeSingle<{ value: string; updated_at: string }>();
  if (data?.updated_at && Date.now() - new Date(data.updated_at).getTime() < minInterval) return false;
  await admin
    .from("app_config")
    .upsert(
      { key: "campaign_funds_trigger_at", value: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  return true;
}
