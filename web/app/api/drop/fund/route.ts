import { NextResponse } from "next/server";
import { z } from "zod";

import { distributorAddressPublic } from "@/lib/campaigns";
import { checkDropFunding } from "@/lib/drop-distributor";
import { getDropById } from "@/lib/drops";
import { parseAmount } from "@/lib/erc20";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    dropId: z.string().uuid(),
    /** Human units ("5000", "12.5") — converted with the DROP's own decimals. */
    amount: z.string().trim().min(1).max(40),
  }),
  z.object({
    action: z.literal("check"),
    fundingId: z.string().uuid(),
  }),
]);

/**
 * POST /api/drop/fund — fund a pot, and watch the transfer land.
 *
 * TWO VERBS, ONE SUBJECT, and the order between them is the whole design:
 *
 *   "create" — registers a FUNDING INTENT: this wallet is about to send this
 *     token to the payout address for this drop. The written row is what makes
 *     attribution exact, because a transfer with no intent cannot be told apart
 *     from any other transfer into the same wallet (migration 0029).
 *   "check"  — the funder's "I sent it" button. A recent block window is
 *     scanned with the same matcher the indexer uses, so a drop becomes
 *     claimable in seconds instead of waiting for the next indexer run.
 *
 * The intent is written through the CALLER'S OWN SESSION: the RLS policy on
 * `drop_fundings` is what enforces that the funder is the signed-in profile's
 * own wallet and that the drop is open. A service-role insert here would step
 * around the only rule that stops somebody registering an intent over a
 * stranger's wallet and having that stranger's transfer credited into a pot of
 * the attacker's choosing.
 */
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Sign in to fund a drop." }, { status: 401 });
  if (!profile.username) return NextResponse.json({ error: "Claim your username first." }, { status: 409 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That isn't a valid funding request." }, { status: 400 });
  }

  /* ------------------------------------------------------------------ check */
  if (parsed.data.action === "check") {
    let admin;
    try {
      admin = createAdminClient();
    } catch {
      return NextResponse.json({ error: "Not set up yet." }, { status: 503 });
    }
    const result = await checkDropFunding(admin, parsed.data.fundingId);
    return NextResponse.json({ ok: true, status: result.status, credited: result.credited, note: result.note });
  }

  /* ----------------------------------------------------------------- create */
  const drop = await getDropById(parsed.data.dropId);
  if (!drop) return NextResponse.json({ error: "That drop doesn't exist." }, { status: 404 });
  if (drop.status !== "open") {
    return NextResponse.json({ error: "This drop isn't taking deposits right now." }, { status: 409 });
  }

  const wei = parseAmount(parsed.data.amount, drop.tokenDecimals);
  if (wei === null || wei <= 0n) {
    return NextResponse.json(
      { error: `That isn't a valid amount for a token with ${drop.tokenDecimals} decimals. Use a number like 5000 or 12.5.` },
      { status: 400 },
    );
  }

  const address = distributorAddressPublic();
  if (!address) {
    return NextResponse.json(
      { error: "Deposits are not wired yet on this deployment — the payout wallet is not configured." },
      { status: 503 },
    );
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const sb = await createClient();
  const { data, error } = await sb
    .from("drop_fundings")
    .insert({
      drop_id: drop.id,
      funder_wallet: profile.wallet_address.toLowerCase(),
      token_address: drop.tokenAddress,
      expected_amount: wei.toString(),
      expires_at: expiresAt,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    if (error?.code === "23505") {
      return NextResponse.json(
        {
          error:
            "You already have an open deposit for this token — wait for it to match (or 24 hours for it to expire) before starting another, so your transfer can't be credited to the wrong intent.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error?.message ?? "Could not record that deposit." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    fundingId: data.id,
    address,
    tokenAddress: drop.tokenAddress,
    amount: wei.toString(),
    decimals: drop.tokenDecimals,
    symbol: drop.tokenSymbol,
    expiresAt,
  });
}
