import { NextResponse } from "next/server";

import { distributorConfigured, sweepBudgetMs, sweepEarnPayouts } from "@/lib/earn-distributor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/earn-payouts — THE DAILY DISTRIBUTION.
 *
 * Scheduled in vercel.json (once a day, the Hobby-plan ceiling). The
 * authorization rule is the indexer's, reused exactly: Vercel sends
 * `Authorization: Bearer $CRON_SECRET` on a scheduled invocation, and anything
 * else is refused — this route must never become a way for a stranger to make
 * the server sign transfers.
 *
 * This route holds no payout logic of its own. It is one of three triggers
 * that call `sweepEarnPayouts` (see lib/earn-distributor.ts); the other two
 * are the funds-arrival trigger in the indexer's transfer scan, and the admin
 * console's "trigger a sweep now" — which runs this exact automatic path,
 * not an approval. One code path for every trigger means a fix anywhere
 * applies everywhere.
 *
 * A run pays as many wallets as the time budget and funding allow, and leaves
 * the rest pending for the next trigger — nothing is lost by hitting the
 * ceiling, nothing is double-sent by finishing it.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!distributorConfigured()) {
    return NextResponse.json({ ok: false, stopped: "not-configured" }, { status: 503 });
  }

  try {
    const result = await sweepEarnPayouts("cron", { budgetMs: sweepBudgetMs() });
    return NextResponse.json({
      ok: true,
      cycleDate: result.cycleDate,
      sentCount: result.sentCount,
      sentAmount: result.sentAmount.toString(),
      failedCount: result.failedCount,
      stopped: result.stopped ?? null,
      tokenBalance: result.tokenBalance.toString(),
      nativeBalance: result.nativeBalance.toString(),
      notes: result.notes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
