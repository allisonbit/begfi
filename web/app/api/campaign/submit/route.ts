import { NextResponse } from "next/server";
import { z } from "zod";

import { submitCampaignPost } from "@/lib/campaigns";
import { payoutsAllowed } from "@/lib/payout-controls";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({
  slug: z.string().min(1).max(40),
  postUrl: z.string().min(1).max(300),
});

/**
 * POST /api/campaign/submit — paste the post link for a campaign.
 *
 * The server, not the browser, verifies the post with the site's normal
 * oEmbed read: it must exist and carry the campaign's required mention.
 * Ownership is the session — no client-claimed wallet or username ever
 * enters this route.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Send the campaign slug and the post link." }, { status: 400 });
  }

  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!profile.username) return NextResponse.json({ error: "Claim your username first." }, { status: 409 });

  /*
   * Refused while payouts are paused, rather than accepted and queued.
   *
   * The alternative is worse than it looks: this route's promise is "your post
   * shares in today's payout, automatically". With the switch on, that promise
   * is false, and accepting the post would bank an obligation the product
   * cannot currently keep. A refusal is recoverable — paste the same link when
   * it resumes — and it is the same reasoning the Earn route already applies
   * when the pool cannot pay.
   */
  const gate = await payoutsAllowed();
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason }, { status: 423 });
  }

  const result = await submitCampaignPost({
    userId: profile.id,
    username: profile.username,
    walletAddress: profile.wallet_address,
    slug: parsed.data.slug,
    postUrl: parsed.data.postUrl,
  });

  if ("transient" in result && result.transient) {
    // A read failure that can be retried is a 503 with NO row written — the
    // wallet's daily slot survives for a real attempt.
    return NextResponse.json({ error: result.transient }, { status: 503 });
  }
  if ("error" in result && result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
