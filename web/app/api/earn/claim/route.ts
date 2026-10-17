import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";

import { robinhoodChain } from "@/lib/chains";
import { BEG_TOKEN_ADDRESS } from "@/lib/config";
import { distributorAccount, distributorSignerConfigured } from "@/lib/distributor-signer";
import { getApprovedUnclaimed, leaseClaim, recordPayout, releaseClaim } from "@/lib/earn";
import { erc20Abi } from "@/lib/erc20";
import { payoutsAllowed } from "@/lib/payout-controls";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/earn/claim — pay approved, unclaimed rewards to the caller.
 *
 * The noncustodial rule has a precise edge here: BegFi does sign a transfer.
 * It is allowed to, because the reward pool is BegFi's own treasury — not
 * escrowed user money, not a send a user parked with the site. What the rule
 * forbids (and this route keeps out) is BegFi ever standing between two users.
 *
 * THE CRASH WINDOW, HANDLED EXPLICITLY. A transfer that reverts or dies after
 * `claimed_at` was set must retry, not double-pay or strand the reward. So:
 *   stage (`claimed_at`) -> transfer -> record (`payout_tx`).
 * A retry picks up rows with claimed_at set and no payout_tx and pays exactly
 * those, so between marking and paying the money can go nowhere twice.
 *
 * SUBMIT-AND-CLAIM: the submit route stages rows at birth, so the claim
 * route is purely the payout leg — the retry path for a transfer that failed
 * and the collector for a fresh submission. Nothing is review-gated. Since the
 * AUTOMATIC distributor shipped (lib/earn-distributor), this route is the
 * optional fast path: the sweep pays the same rows anyway, and the lease
 * decides who sends.
 */
export async function POST() {
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Sign in to claim." }, { status: 401 });
  }
  if (!BEG_TOKEN_ADDRESS) {
    return NextResponse.json({ error: "$BEGFI sends are not live yet." }, { status: 503 });
  }
  if (!distributorSignerConfigured()) {
    return NextResponse.json(
      { error: "Claim is not wired yet — the payout wallet is not configured." },
      { status: 503 },
    );
  }
  const account = distributorAccount();
  if (!account) {
    return NextResponse.json({ error: "Payout wallet is misconfigured." }, { status: 503 });
  }

  /*
   * The kill switch stops THIS path too, which is the point of a global switch:
   * the claim button is an independent sender from the sweep (they share the
   * lease, not the gate), so a pause that only covered the cron would leave one
   * door open exactly when an operator wants them all shut.
   */
  const gate = await payoutsAllowed();
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason }, { status: 423 });
  }

  const { ids, total } = await getApprovedUnclaimed(profile.id);
  if (ids.length === 0 || total === 0n) {
    return NextResponse.json({ error: "Nothing to claim yet." }, { status: 400 });
  }

  const walletClient = createWalletClient({ account, chain: robinhoodChain, transport: http() });
  const publicClient = createPublicClient({ chain: robinhoodChain, transport: http() });

  // LEASE, then pay, then record. The lease (payout_lease) is what makes the
 // crash window single-entry ACROSS ALL SENDERS — the automatic sweep and the
 // funds-arrival trigger take the same lease, so whoever wins it sends and
 // everyone else backs off. The claim column stays "sending" while it runs.
  const leased = await leaseClaim(ids);
  if (leased.ids.length === 0) {
    // Every unpaid row is leased by another sender: money is in motion.
    return NextResponse.json(
      { error: "Your payout is already being sent — give it a moment." },
      { status: 409 },
    );
  }

  const payingIds = leased.ids;
  const amount = leased.total;

  try {
    const hash = await walletClient.writeContract({
      address: BEG_TOKEN_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "transfer",
      args: [profile.wallet_address as `0x${string}`, amount],
    });

    // A filed tx is not a confirmed tx. Wait it out so the row records a
    // payout that actually exists, or surface the failure and keep the claim
    // retryable.
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return NextResponse.json(
        { error: "The payout transaction failed. It will retry — nothing was lost." },
        { status: 502 },
      );
    }

    await recordPayout(payingIds, hash);
    return NextResponse.json({ ok: true, tx: hash, amount: amount.toString() });
  } catch {
    // Release the lease: release the hold so a later press can try again
    // cleanly. This only releases a PRE-SEND failure (the send never left,
    // so no one is waiting on a receipt) and cannot collide with the sweep
    // — it would have to have won the lease, which by definition this caller
    // did not.
    await releaseClaim(payingIds);

    return NextResponse.json(
      { error: "Could not send the payout — try again in a moment." },
      { status: 502 },
    );
  }
}
