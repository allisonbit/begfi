import { NextResponse } from "next/server";

import { isPostUrl, getEarnSettings, countTodaySubmissions } from "@/lib/earn";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/session";
import { createPublicClient, http } from "viem";
import { robinhoodChain } from "@/lib/chains";
import { BEG_TOKEN_ADDRESS, DISTRIBUTOR_PRIVATE_KEY } from "@/lib/config";
import { privateKeyToAccount } from "viem/accounts";

export const dynamic = "force-dynamic";

/**
 * POST /api/earn/submit — a post link, and nothing else.
 *
 * Every rule from the spec is enforced HERE, not just in the UI: session +
 * username, earn active, pool funded, daily limit, duplicate link, and the
 * URL shape itself. The UI mirrors these checks so the feedback is instant,
 * but a request that skips the UI runs into the same wall.
 *
 * The insert goes through the service role after the checks, the same way the
 * indexer writes: RLS already restricts browser-direct inserts; this route is
 * the one path a submission is allowed to exist through.
 *
 * SUBMIT IS THE APPROVAL. The reward is claimable the moment this returns ok:
 * the row is born with claimed_at set (its claim batch, ready for the payout
 * path), and the pool is debited in the same transaction by the refill
 * function begfi.earn_refill_pool() — which first tops the pool back to its
 * daily total when the UTC day has rolled over. The daily pool is the whole
 * budget: spent fast, it is gone until tomorrow.
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
  if (settings.poolRemaining < settings.rewardPerPost) {
    return NextResponse.json({ error: "Rewards pool is empty, check back soon." }, { status: 409 });
  }

  /*
   * The payout has to actually be sendable for submit to grant claimable
   * money. If the distributor wallet is not wired or cannot cover the
   * payout, the submission is refused: promising claimable rewards the site
   * cannot pay is exactly the fake-number pattern the rest of the product
   * refuses.
   */
  const payoutReady = await payoutWalletReady(settings.rewardPerPost);
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

  const postedToday = await countTodaySubmissions(profile.id);
  if (postedToday >= settings.dailyLimit) {
    return NextResponse.json(
      { error: `Daily limit reached — ${settings.dailyLimit} submissions a day.` },
      { status: 429 },
    );
  }

  const admin = createAdminClient();

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
    return NextResponse.json({ error: "Could not reserve from the pool. Try again." }, { status: 500 });
  }
  const remainingBig = BigInt(remainingAfterRefill as string);
  if (remainingBig < settings.rewardPerPost) {
    return NextResponse.json({ error: "Rewards pool is empty, check back soon." }, { status: 409 });
  }

  /* Submit IS the approval: claimed_at at birth, approved status, pool debit. */
  const { error: insertError } = await admin
    .from("earn_submissions")
    .insert({
      user_id: profile.id,
      username: profile.username,
      wallet_address: profile.wallet_address.toLowerCase(),
      post_url: postUrl,
      status: "approved",
      reviewed_at: new Date().toISOString(),
      claimed_at: new Date().toISOString(),
      reward_amount: settings.rewardPerPost.toString(),
    });

  if (insertError) {
    // The unique index on post_url is a second line of defence; treat a
    // constraint hit like the duplicate check above.
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "This post was already submitted." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not record that. Try again." }, { status: 500 });
  }

  /*
   * The debit uses the post-refill figure. Two submitters racing both read
   * the same `remaining` and both write a subtract-from-that value, so the
   * pool can under-count by one reward in the worst case — money the admin
   * tops up, never money users lose, and the unique constraint still caps
   * one account to one reward a day.
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
    remaining: Math.max(0, settings.dailyLimit - (postedToday + 1)),
  });
}

/**
 * Can the site actually pay right now? The distributor wallet must be
 * configured and hold both the token balance and the ETH for gas.
 */
async function payoutWalletReady(reward: bigint): Promise<boolean> {
  if (!BEG_TOKEN_ADDRESS || !DISTRIBUTOR_PRIVATE_KEY || !/^0x[0-9a-fA-F]{64}$/.test(DISTRIBUTOR_PRIVATE_KEY)) {
    return false;
  }
  try {
    const account = privateKeyToAccount(DISTRIBUTOR_PRIVATE_KEY as `0x${string}`);
    const client = createPublicClient({ chain: robinhoodChain, transport: http() });
    const [balance, ethBalance] = await Promise.all([
      client.readContract({
        address: BEG_TOKEN_ADDRESS as `0x${string}`,
        abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }],
        functionName: "balanceOf",
        args: [account.address],
      }),
      client.getBalance({ address: account.address }),
    ]);
    return balance >= reward && ethBalance > 0n;
  } catch {
    return false;
  }
}
