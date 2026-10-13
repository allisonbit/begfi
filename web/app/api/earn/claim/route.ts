import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { robinhoodChain } from "@/lib/chains";
import { BEG_TOKEN_ADDRESS, DISTRIBUTOR_PRIVATE_KEY } from "@/lib/config";
import { getApprovedUnclaimed, recordPayout, stageClaim } from "@/lib/earn";
import { erc20Abi } from "@/lib/erc20";
import { createAdminClient } from "@/lib/supabase/admin";
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
 * SUBMIT-AND-CLAIM: the submit route now stages rows at birth, so the claim
 * route is purely the payout leg — the retry path for a transfer that failed
 * and the collector for a fresh submission. Nothing is review-gated.
 */
export async function POST() {
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Sign in to claim." }, { status: 401 });
  }
  if (!BEG_TOKEN_ADDRESS) {
    return NextResponse.json({ error: "$BEGFI sends are not live yet." }, { status: 503 });
  }
  if (!DISTRIBUTOR_PRIVATE_KEY) {
    return NextResponse.json(
      { error: "Claim is not wired yet — the payout wallet is not configured." },
      { status: 503 },
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(DISTRIBUTOR_PRIVATE_KEY)) {
    return NextResponse.json({ error: "Payout wallet is misconfigured." }, { status: 503 });
  }

  const { ids, total } = await getApprovedUnclaimed(profile.id);
  if (ids.length === 0 || total === 0n) {
    return NextResponse.json({ error: "Nothing to claim yet." }, { status: 400 });
  }

  const account = privateKeyToAccount(DISTRIBUTOR_PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: robinhoodChain, transport: http() });
  const publicClient = createPublicClient({ chain: robinhoodChain, transport: http() });

  // Stage, then pay, then record. Staging first is what makes the crash
  // window single-entry: a row whose claimed_at is set but payout_tx is not
  // is always "needs paying", never "paid twice".
  await stageClaim(ids);

  try {
    const hash = await walletClient.writeContract({
      address: BEG_TOKEN_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "transfer",
      args: [profile.wallet_address as `0x${string}`, total],
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

    await recordPayout(ids, hash);
    return NextResponse.json({ ok: true, tx: hash, amount: total.toString() });
  } catch {
    // Unstage: release the hold so a later press can try again cleanly.
    // (stageClaim's hold is what prevents concurrent double-pay; clearing it
    // after a *pre-send* failure cannot create that race because the send
    // never left.)
    const supabase = createAdminClient();
    await supabase.from("earn_submissions").update({ claimed_at: null }).in("id", ids).is("payout_tx", null);

    return NextResponse.json(
      { error: "Could not send the payout — try again in a moment." },
      { status: 502 },
    );
  }
}
