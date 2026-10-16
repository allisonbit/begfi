import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { campaignBudgetMs, sweepCampaignPayouts, type SweepCampaignOutcome } from "@/lib/campaign-distributor";
import { distributorAddress, distributorConfigured, sweepBudgetMs, sweepEarnPayouts } from "@/lib/earn-distributor";
import { createAdminClient } from "@/lib/supabase/admin";

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

  /*
   * THE DAILY RUN, AUDITED — ONE ROW, NOT TWO.
   *
   * This is the scheduled sweep: the entry point an incident review looks for
   * ("did the machine run today, and what did it do?"). The funds-arrival triggers
   * inside the indexer are deliberately NOT audited here — they fire on every
   * deposit and would bury the schedule in noise; their result is the payout ledger
   * rows themselves, which the console shows with their transactions.
   */
  const actor = distributorAddress();
  if (actor) {
    try {
      const earnSummary = response.earn as { sentCount?: number; failedCount?: number; stopped?: string } | undefined;
      const campaignSummary = response.campaigns as
        | { sentCount?: number; failedCount?: number; campaignsServed?: number }
        | undefined;
      await recordAudit(createAdminClient(), {
        actor,
        action: "payouts.sweep",
        subject: new Date().toISOString().slice(0, 10),
        detail: `Daily run — $BEGFI: ${earnSummary?.sentCount ?? 0} sent, ${earnSummary?.failedCount ?? 0} failed, stopped: ${
          earnSummary?.stopped ?? "nobody left to pay"
        }; campaigns: ${campaignSummary?.sentCount ?? 0} sent across ${campaignSummary?.campaignsServed ?? 0} campaign(s).`,
      });
    } catch {
      // The sweeps already ran; the record of them is second (see lib/audit.ts).
    }
  }

  return NextResponse.json(response);
}
