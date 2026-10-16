import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { sweepCampaignPayouts, type SweepCampaignOutcome } from "@/lib/campaign-distributor";
import { sweepDropPayouts, type DropSweepOutcome } from "@/lib/drop-distributor";
import { distributorAddress, distributorConfigured, sweepEarnPayouts } from "@/lib/earn-distributor";
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
 * token — and then `sweepDropPayouts`, which pays the prizes people already
 * claimed from a drop. Three sweeps, one schedule, three honest budgets that
 * sum inside the function's limit; a sweep that misses the window re-fires on
 * the next trigger (a deposit, a claim, or tomorrow's run) without anyone
 * chasing it. Drops get no cron entry of their own on purpose: the plan allows
 * two, the products share one wallet and one ledger, and a third schedule would
 * only be a second way to ask the same question.
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

  /*
   * THE THREE SLICES OF ONE 60-SECOND WINDOW. Explicit numbers, not each
   * sweep's own default: every default (45s) is sized for a run that has the
   * function to itself, and three of those do not fit. 22 + 22 + 12 = 56s,
   * leaving room for the audit write at the end. A sweep that runs out of its
   * slice stops cleanly and its remaining wallets wait for the next trigger.
   */
  const EARN_BUDGET_MS = 22_000;
  const CAMPAIGN_BUDGET_MS = 22_000;
  const DROP_BUDGET_MS = 12_000;

  // BegFi's own pool first: it is the product's own promise and the more
  // time-sensitive one.
  if (distributorConfigured()) {
    try {
      const result = await sweepEarnPayouts("cron", { budgetMs: EARN_BUDGET_MS });
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
    campaignResult = await sweepCampaignPayouts("cron", { budgetMs: CAMPAIGN_BUDGET_MS });
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
   * Drops last, and their budget is the SMALLEST of the three — not because a
   * prize matters less, but because a drop sweep is the one that has already
   * been nudged: a claim fires it, and a deposit fires it. Whatever this run
   * finds is the residue of triggers that could not finish, so it gets the
   * leftover of the window rather than a third of it.
   */
  let dropResult: DropSweepOutcome | null = null;
  try {
    dropResult = await sweepDropPayouts("cron", { budgetMs: DROP_BUDGET_MS });
    response.drops = {
      cycleDate: dropResult.cycleDate,
      dropsServed: dropResult.dropsServed,
      sentCount: dropResult.sentCount,
      sentTotal: dropResult.sentTotal.toString(),
      failedCount: dropResult.failedCount,
      notes: dropResult.notes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.drops = { ok: false, error: message };
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
      const dropSummary = response.drops as
        | { sentCount?: number; failedCount?: number; dropsServed?: number }
        | undefined;
      await recordAudit(createAdminClient(), {
        actor,
        action: "payouts.sweep",
        subject: new Date().toISOString().slice(0, 10),
        detail: `Daily run — $BEGFI: ${earnSummary?.sentCount ?? 0} sent, ${earnSummary?.failedCount ?? 0} failed, stopped: ${
          earnSummary?.stopped ?? "nobody left to pay"
        }; campaigns: ${campaignSummary?.sentCount ?? 0} sent across ${campaignSummary?.campaignsServed ?? 0} campaign(s); drops: ${
          dropSummary?.sentCount ?? 0
        } prize(s) sent across ${dropSummary?.dropsServed ?? 0} drop(s).`,
      });
    } catch {
      // The sweeps already ran; the record of them is second (see lib/audit.ts).
    }
  }

  return NextResponse.json(response);
}
