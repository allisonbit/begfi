import { NextResponse, after } from "next/server";
import { z } from "zod";

import { sweepDropPayouts } from "@/lib/drop-distributor";
import { claimDrop } from "@/lib/drops";
import { payoutsAllowed } from "@/lib/payout-controls";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({ dropId: z.string().uuid() });

/**
 * POST /api/drop/claim — take a prize.
 *
 * THE ORDER OF THE CHECKS IS THE DESIGN, and `claimDrop` holds it: the payout
 * gate first (a claim is a promise to pay, so it is refused while payouts are
 * paused), then the drop's window, then the pot's AVAILABLE money — deposits
 * minus confirmed payouts minus prizes already promised to claims whose
 * transfers have not confirmed — then the cap, then "this wallet and this
 * verified X account have not claimed already". Both "already claimed" rules
 * are unique indexes as well as reads, so two racing claims cannot both win.
 *
 * THEN THE NUDGE. A claim that lands while the pot is funded is paid within
 * seconds: the sweep runs after this response (`after` keeps the request fast
 * and the function's own budget intact). It is the SAME automatic path the
 * cron uses — not an approval, not a special case for this claimer. Paying
 * prizes a day later would make a giveaway a promise with a queue.
 */
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Sign in to claim." }, { status: 401 });
  if (!profile.username) return NextResponse.json({ error: "Claim your username first." }, { status: 409 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That isn't a valid claim." }, { status: 400 });
  }

  // The global kill switch, checked here as well as inside the sweep: refusing
  // the claim is the honest answer while payouts are paused, and it is the same
  // answer the campaign and earn submit paths give.
  const gate = await payoutsAllowed();
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason }, { status: 423 });
  }

  const result = await claimDrop(profile, parsed.data.dropId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  after(async () => {
    try {
      await sweepDropPayouts("claim", { budgetMs: 20_000, maxDrops: 4 });
    } catch {
      // The claim is recorded and the sweep retries on the next cron window,
      // the next deposit or the next claim. Nothing here is lost by failing.
    }
  });

  return NextResponse.json({ ok: true, claimId: result.claimId, amount: result.amount });
}
