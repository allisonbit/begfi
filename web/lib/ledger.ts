import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

/**
 * Pool totals from `begfi.ledger` (migration 0030).
 *
 * ONE READ INSTEAD OF TWO. A campaign's deposited and paid figures used to be
 * two queries over `campaign_deposits` and `earn_payouts`; the ledger already
 * holds both, written by triggers in the same transaction as the rows they
 * describe. Reading it here means a caller cannot pair a deposit query from one
 * instant with a payout query from another.
 *
 * NULL MEANS "DO NOT KNOW", NOT "ZERO". A missing table, a revoked grant or a
 * failed read returns null so the caller can fall back to the source tables.
 * Returning empty maps would make every campaign look unfunded, which is a
 * worse failure than a slower read.
 *
 * Only `deposit` and `payout` are summed. `fee` and `refund` are valid kinds
 * with no writer yet; if one is added later this function must decide whether
 * it belongs in the balance rather than summing it by accident.
 */
export type PoolTotals = {
  deposited: Map<string, bigint>;
  paid: Map<string, bigint>;
};

/** The cap matches every other pool sum in the codebase. */
const ROW_CAP = 10_000;

export async function getCampaignPoolTotals(): Promise<PoolTotals | null> {
  if (!SUPABASE_CONFIGURED) return null;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  const { data, error } = await admin
    .from("ledger")
    .select("pool_id, kind, amount::text")
    .eq("pool_kind", "campaign")
    .in("kind", ["deposit", "payout"])
    .limit(ROW_CAP);

  if (error || !data) return null;
  if (data.length >= ROW_CAP) return null; // a capped sum is not a total

  const deposited = new Map<string, bigint>();
  const paid = new Map<string, bigint>();
  for (const row of data as { pool_id: string | null; kind: string; amount: string }[]) {
    if (!row.pool_id) continue;
    const target = row.kind === "deposit" ? deposited : paid;
    target.set(row.pool_id, (target.get(row.pool_id) ?? 0n) + BigInt(row.amount));
  }
  return { deposited, paid };
}
