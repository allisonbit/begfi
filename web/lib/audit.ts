import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

/**
 * THE AUDIT TRAIL, written from the code that DID the thing.
 *
 * One function, called where an action happens rather than after it, because an
 * audit written by an observer is an audit that can miss. Every caller passes the
 * admin client it already holds — no new connection, no new failure mode on the
 * money path.
 *
 * IT NEVER THROWS, AND THAT IS THE DELIBERATE TRADE. A switch that has already
 * stopped payouts must not be rolled back because its audit row failed to insert:
 * the money-facing act is the point, the record of it is important but second. The
 * failure is returned as `false` rather than swallowed silently, so a caller that
 * cares (the admin console can, if it wants to) can say so — and the honest
 * limitation is recorded in `KNOWN_ISSUES.md` #11: an audit that cannot write is
 * an audit with a hole, and the hole is only visible if someone looks.
 *
 * `detail` is a SENTENCE. The row has to be readable on its own, at 2am, without
 * the schema next to it — see the reasoning in migration 0028.
 */
export type AuditEntry = {
  /** Lowercase wallet address, or the machine's own address for automatic acts. */
  actor: string;
  /** Dotted and verb-shaped: 'payouts.pause', 'payouts.sweep', 'reconcile.run'. */
  action: string;
  /** The token, pool or cycle the action concerned, if it was about one. */
  subject?: string | null;
  detail?: string;
};

export async function recordAudit(
  admin: ReturnType<typeof createAdminClient>,
  entry: AuditEntry,
): Promise<boolean> {
  if (!SUPABASE_CONFIGURED) return false;

  try {
    const { error } = await admin.from("audit_log").insert({
      actor: entry.actor.toLowerCase(),
      action: entry.action,
      subject: entry.subject ?? null,
      detail: entry.detail ?? "",
    });
    return !error;
  } catch {
    return false;
  }
}
