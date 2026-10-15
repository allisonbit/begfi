import { NextResponse } from "next/server";

import { campaignBudgetMs, sweepCampaignPayouts, type SweepCampaignOutcome } from "@/lib/campaign-distributor";
import { distributorConfigured, sweepBudgetMs, sweepEarnPayouts } from "@/lib/earn-distributor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/earn-payouts — THE DAILY DISTRIBUTION.
 *
 * Scheduled in vercel.json (once a day, the Hobby-plan ceiling, and one of
 * only two cron entries the plan allows us). The authorization rule is the
 * indexer's, reused exactly: Vercel sends `Authorization: Bearer
 * $CRON_SECRET` on a scheduled invocation, and anything else is refused —
 * this route must never become a way for a stranger to make the server sign
 * transfers.
 *
 * The route holds no payout logic of its own. It is one of three triggers
 * that call `sweepEarnPayouts` (see lib/earn-distributor.ts); the other two
 * are the funds-arrival trigger in the indexer's transfer scan, and the admin
 * console's "trigger a sweep now" — which runs this exact automatic path,
 * not an approval.
 *
 * CAMPAIGNS SERVICE THE SAME WINDOW. After the $BEGFI sweep (its own time
 * budget), the same cron serves `sweepCampaignPayouts` — every campaign's
 * daily budget, shared across that cycle's posters, in each campaign's own
 * token. Two sweeps, one schedule, two honest budgets that sum inside the
 * function's limit; a campaign sweep that misses the window re-fires on the
 * next deposit or the next day without anyone chasing it.
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

  const response: Record<string, unknown> = { ok: true };

  // BegFi's own pool first: it is the product's own promise and the more
  // time-sensitive one.
  if (distributorConfigured()) {
    try {
      const result = await sweepEarnPayouts("cron", { budgetMs: 25_000 });
      response.earn = {
        cycleDate: result.cycleDate,
        sentCount: result.sentCount,
        sentAmount: result.sentAmount.toString(),
        failedCount: result.failedCount,
        stopped: result.stopped ?? null,
        tokenBalance: result.tokenBalance.toString(),
        nativeBalance: result.nativeBalance.toString(),
        notes: result.notes,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.earn = { ok: false, error: message };
    }
  }

  // Campaigns after, on the remaining slice of the same window.
  let campaignResult: SweepCampaignOutcome | null = null;
  try {
    campaignResult = await sweepCampaignPayouts("cron", { budgetMs: 30_000 });
    response.campaigns = {
      cycleDate: campaignResult.cycleDate,
      campaignsServed: campaignResult.campaignsServed,
      sentCount: campaignResult.sentCount,
      sentTotal: campaignResult.sentTotal.toString(),
      failedCount: campaignResult.failedCount,
      notes: campaignResult.notes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.campaigns = { ok: false, error: message };
  }

  return NextResponse.json(response);
}
