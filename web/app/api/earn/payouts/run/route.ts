import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { sweepEarnPayouts, sweepBudgetMs } from "@/lib/earn-distributor";
import { isAdminWallet } from "@/lib/earn";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/earn/payouts/run — the admin console's sweep trigger.
 *
 * Admin-gated like every other console route (the SIGNED-IN profile's wallet
 * is checked server-side; nothing here trusts a client-claimed identity).
 * What it is NOT is an approval: the sweep pays every wallet the lease and
 * funding allow, exactly as the cron and funds triggers would.
 */
export async function POST() {
  const profile = await getProfile();
  if (!profile || !isAdminWallet(profile.wallet_address)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  try {
    const result = await sweepEarnPayouts("admin-console", { budgetMs: sweepBudgetMs() });

    // A manual sweep is an admin action and is audited as one, whether it paid
    // anybody or parked — "I pressed it and nothing happened" is exactly the
    // question this row answers.
    try {
      await recordAudit(createAdminClient(), {
        actor: profile.wallet_address,
        action: "payouts.sweep",
        subject: result.cycleDate,
        detail: `${result.sentCount} sent, ${result.failedCount} failed, stopped: ${result.stopped ?? "nobody left to pay"}.`,
      });
    } catch {
      // The sweep ran; the record of it is second (see lib/audit.ts).
    }

    return NextResponse.json({
      ok: true,
      cycleDate: result.cycleDate,
      sentCount: result.sentCount,
      sentAmount: result.sentAmount.toString(),
      failedCount: result.failedCount,
      stopped: result.stopped ?? null,
      notes: result.notes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
