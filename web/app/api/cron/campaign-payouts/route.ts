import { NextResponse } from "next/server";

import { campaignBudgetMs, sweepCampaignPayouts } from "@/lib/campaign-distributor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/campaign-payouts — THE DAILY CAMPAIGN SWEEP.
 *
 * Same authorization contract as the other cron routes: Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; anything else is refused. It is one
 * trigger of `sweepCampaignPayouts` — the other two are a campaign deposit
 * arriving (the indexer fires it) and a re-run after any failed attempt.
 * Each run serves each active campaign up to its daily budget, leases per
 * wallet, and records sent only after a confirmed receipt.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await sweepCampaignPayouts("cron", { budgetMs: campaignBudgetMs() });
    return NextResponse.json({
      ok: true,
      cycleDate: result.cycleDate,
      campaignsServed: result.campaignsServed,
      sentCount: result.sentCount,
      sentTotal: result.sentTotal.toString(),
      failedCount: result.failedCount,
      notes: result.notes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
