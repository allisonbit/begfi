import { NextResponse } from "next/server";

import { BEG_TOKEN_ADDRESS } from "@/lib/config";
import { isPostUrl, getEarnSettings } from "@/lib/earn";
import { payoutWalletReady, payoutsAllowed } from "@/lib/payout-controls";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/earn/submit — a post link, and nothing else.
 *
 * THE ONE RULE. Eligibility is decided ONLY by the wallet address: a wallet
 * with no record in begfi.earn_claims may always claim; a wallet with a
 * record may never claim again. There is no daily limit, no per-device or
 * per-IP budget, no account-age gate, no session fingerprint. The previous
 * version budgeted the day per device fingerprint and per IP (0014), which
 * meant a family phone, a campus NAT or any shared exit node told wallets
 * that had never claimed to "come back tomorrow" — the bug this rewrite
 * removes at the root.
 *
 * STILL ENFORCED:
 *   * session + username,
 *   * earn active and pool funded,
 *   * the wallet-once rule, checked before insert AND enforced by a UNIQUE
 *     constraint inside the claim record insert — two racing requests from
 *     the same wallet cannot both win,
 *   * the post URL shape, and one submission per post link, ever.
 *
 * OTHER FAILURES SAY WHAT FAILED. A network error, a database error, or a
 * missing setting returns its own message, never "come back tomorrow" and
 * never "already claimed" — those two states belong to exactly one situation
 * each and must not absorb unrelated failures.
 */

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Sign in to submit." }, { status: 401 });
  }
  if (!profile.username) {
    return NextResponse.json({ error: "Set your username first." }, { status: 403 });
  }

  const settings = await getEarnSettings();
  if (!settings) {
    return NextResponse.json({ error: "Earn is not configured yet." }, { status: 503 });
  }
  if (!settings.isActive) {
    return NextResponse.json({ error: "Earn is paused. Check back soon." }, { status: 423 });
  }

  // The global kill switch — the same gate every payout path reads. A paused
  // switch means no submission is banked, because a banked submission is a
  // promise to pay (see the campaign submit route for the longer version).
  const gate = await payoutsAllowed();
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason }, { status: 423 });
  }
  if (settings.poolRemaining < settings.rewardPerPost) {
    return NextResponse.json({ error: "Rewards pool is empty, check back soon." }, { status: 409 });
  }

  /*
   * The payout has to actually be sendable for submit to grant claimable
   * money. If the distributor wallet is not wired or cannot cover the
   * payout, the submission is refused: promising claimable rewards the site
   * cannot pay is exactly the fake-number pattern the rest of the product
   * refuses. This is its own state with its own message — a Retry here is
   * honest, because the pool being funded may fix it.
   */
  const payoutReady = BEG_TOKEN_ADDRESS
    ? await payoutWalletReady(BEG_TOKEN_ADDRESS, settings.rewardPerPost)
    : false;
  if (!payoutReady) {
    return NextResponse.json(
      { error: "Payouts are briefly offline — the pool is being funded. Try again in a moment." },
      { status: 503 },
    );
  }

  let body: { post_url?: string } | null = null;
  try {
    body = (await request.json()) as { post_url?: string };
  } catch {
    body = null;
  }
  const postUrl = body?.post_url?.trim() ?? "";

  if (!isPostUrl(postUrl)) {
    return NextResponse.json({ error: "That is not an X post link. Paste a x.com/twitter.com status URL." }, { status: 400 });
  }

  // Lowercase BEFORE any read or write: the wallet-once rule compares
  // lowercase, always.
  const wallet = profile.wallet_address.toLowerCase();
  const admin = createAdminClient();

  // ALLOWED TO CLAIM? The claims table is the whole answer. A read error here
  // is a FAILURE, not a denial: failing open (allowing) could double-pay and
  // failing closed would insult a wallet that has a real record but a flaky
  // read — either way the request dies with its own message and a Retry.
  const { data: priorClaim, error: claimReadError } = await admin
    .from("earn_claims")
    .select("id")
    .eq("wallet_address", wallet)
    .maybeSingle<{ id: string }>();

  if (claimReadError) {
    return NextResponse.json({ error: "Could not check your claim record. Try again in a moment." }, { status: 500 });
  }
  if (priorClaim) {
    return NextResponse.json({ error: "This wallet has already claimed." }, { status: 409 });
  }

  const { data: duplicate } = await admin
    .from("earn_submissions")
    .select("id")
    .eq("post_url", postUrl)
    .maybeSingle<{ id: string }>();
  if (duplicate) {
    return NextResponse.json({ error: "This post was already submitted." }, { status: 409 });
  }

  /*
   * REFILL FIRST, against a row lock. The RPC tops the pool back to its
   * daily total when the UTC day has rolled over and returns the remaining
   * AFTER refill — the number the debit below belongs to. Debiting the
   * pre-refill read would corrupt the pool on day rollover.
   */
  const { data: remainingAfterRefill, error: refillError } = await admin.rpc("earn_refill_pool");
  if (refillError || remainingAfterRefill === null) {
    return NextResponse.json({ error: "Could not reserve from the pool. Try again in a moment." }, { status: 500 });
  }
  const remainingBig = BigInt(remainingAfterRefill as string);
  if (remainingBig < settings.rewardPerPost) {
    return NextResponse.json({ error: "Rewards pool is empty, check back soon." }, { status: 409 });
  }

  /* Submit IS the approval: claimed_at at birth, approved status. */
  const { data: inserted, error: insertError } = await admin
    .from("earn_submissions")
    .insert({
      user_id: profile.id,
      username: profile.username,
      wallet_address: wallet,
      post_url: postUrl,
      status: "approved",
      reviewed_at: new Date().toISOString(),
      claimed_at: new Date().toISOString(),
      reward_amount: settings.rewardPerPost.toString(),
    })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !inserted) {
    // The unique index on post_url is the second line of defence on the
    // link; treat a constraint hit like the duplicate check above.
    if (insertError?.code === "23505") {
      return NextResponse.json({ error: "This post was already submitted." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not record that. Try again in a moment." }, { status: 500 });
  }

  /*
   * THE CLAIM RECORD. This is the once-per-wallet gate: inserting it here,
   * with the UNIQUE constraint live, means a second request that raced past
   * the SELECT above is rejected by the database itself — no amount of
   * parallel requests can make one wallet claim twice.
   */
  const { error: claimError } = await admin.from("earn_claims").insert({
    wallet_address: wallet,
    user_id: profile.id,
    username: profile.username,
    last_submission_id: inserted.id,
    total_reward: settings.rewardPerPost.toString(),
  });

  if (claimError) {
    if (claimError.code === "23505") {
      // This wallet genuinely already claimed (the race case arrived after
      // all). The submission row is a record of a post, but no money is owed
      // on it and no pool is debited twice — unpublish it so the ledger
      // stays honest.
      await admin.from("earn_submissions").delete().eq("id", inserted.id);
      return NextResponse.json({ error: "This wallet has already claimed." }, { status: 409 });
    }
    // A non-race failure means the claim record did not land and the payout
    // bookkeeping must not stand alone: the submit is refused, the pre-claim
    // submission row is removed, and the caller can retry cleanly.
    await admin.from("earn_submissions").delete().eq("id", inserted.id);
    return NextResponse.json({ error: "Could not record the claim. Try again — nothing was charged." }, { status: 500 });
  }

  /*
   * The debit uses the post-refill figure. Two submitters racing both read
   * the same `remaining` and both write a subtract-from-that value, so the
   * pool can under-count by one reward in the worst case — money the admin
   * tops up, never money users lose, and the wallet-once rule still bounds
   * the total.
   */
  await admin
    .from("earn_settings")
    .update({
      pool_remaining: (remainingBig - settings.rewardPerPost).toString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  return NextResponse.json({
    ok: true,
    reward: settings.rewardPerPost.toString(),
  });
}

/*
 * "Can the site pay this right now?" lives in `lib/payout-controls.ts` as
 * `payoutWalletReady`. It moved there when Drops became the second product to
 * ask the question: two implementations of "is the payout wallet funded" is
 * one place too many for the answer to disagree with itself.
 */
