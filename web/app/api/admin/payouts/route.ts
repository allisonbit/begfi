import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAudit } from "@/lib/audit";
import { isAdminWallet, adminWallets } from "@/lib/earn";
import { publishNotification } from "@/lib/notify";
import { adminProfileIds, readPayoutControls, setPayoutsPaused } from "@/lib/payout-controls";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/session";


export const dynamic = "force-dynamic";

/**
 * POST /api/admin/payouts — flip the global payout switch.
 *
 * ADMIN-GATED SERVER-SIDE, like every other console route: the signed-in
 * profile's wallet is checked against the allowlist (`isAdminWallet`), and
 * nothing here trusts a client-claimed identity.
 *
 * WHY THIS IS A ROUTE RATHER THAN A DATABASE EDIT. An incident lever has to be
 * reachable in one click by whoever is on call, without a psql session, and the
 * act has to leave a trace: the row records who flipped it and when, and every
 * admin's bell gets a notification. A control that requires reading the schema
 * first is a control that gets used too late.
 *
 * GET is for the console's initial state, POST for the flip. Both are
 * admin-only; a non-admin gets a 403 rather than a redacted version of the
 * answer, because "is the payout system paused" is a fact about money.
 */
const Body = z.object({
  paused: z.boolean(),
  reason: z.string().trim().max(160).optional().nullable(),
});

export async function GET() {
  const profile = await getProfile();
  if (!profile || !isAdminWallet(profile.wallet_address)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const { controls, readOk } = await readPayoutControls();
  return NextResponse.json({ ok: true, readOk, controls });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile || !isAdminWallet(profile.wallet_address)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Send { paused: true|false }." }, { status: 400 });
  }

  // A pause with no reason is allowed but discouraged: the UI sends one, and
  // payoutsAllowed() falls back to a sentence that is true rather than blank.
  const result = await setPayoutsPaused({
    paused: parsed.data.paused,
    reason: parsed.data.reason ?? null,
    by: profile.wallet_address,
  });

  if (!result.ok) {
    return NextResponse.json({ error: "Could not change the switch." }, { status: 500 });
  }

  // The audit row is written FIRST, before the bells: an incident review reads this
  // table, and the record of a stop should not depend on a notification succeeding.
  try {
    await recordAudit(createAdminClient(), {
      actor: profile.wallet_address,
      action: parsed.data.paused ? "payouts.pause" : "payouts.resume",
      detail: parsed.data.paused
        ? parsed.data.reason?.trim() || "No reason given."
        : "Resumed by an admin.",
    });
  } catch {
    // The switch is flipped; that is the part that matters (see lib/audit.ts).
  }

  // Tell the humans. `ref` carries the timestamp so pausing twice in one
  // incident produces two bells — which is correct, because they are two
  // separate decisions — while a retried request in the same second does not.
  try {
    const admin = createAdminClient();
    const recipients = await adminProfileIds(adminWallets());
    for (const recipient of recipients) {
      await publishNotification(admin, {
        profileId: recipient.id,
        kind: "payouts_paused",
        title: parsed.data.paused ? "Payouts paused" : "Payouts resumed",
        body: parsed.data.paused
          ? parsed.data.reason?.trim() || "The global payout switch was turned off by an admin."
          : "The global payout switch is back on. Queued payouts resume on the next sweep.",
        ref: `payout-switch-${Date.now()}`,
        href: "/dashboard/earn/payouts",
      });
    }
  } catch {
    // The switch is already flipped and that is the part that matters. An alert
    // that fails to send must not roll back an incident response.
  }

  const { controls } = await readPayoutControls();
  return NextResponse.json({ ok: true, controls });
}
