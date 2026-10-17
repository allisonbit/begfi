import "server-only";

import { createPublicClient, http } from "viem";
import { distributorSignerAddress, distributorSignerConfigured } from "@/lib/distributor-signer";

import { robinhoodChain } from "@/lib/chains";

import { erc20Abi } from "@/lib/erc20";
import { distributorAddress } from "@/lib/earn-distributor";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import { isAdminWallet } from "@/lib/earn";

/**
 * THE KILL SWITCH.
 *
 * One row in `begfi.payout_controls` decides whether any money leaves the
 * distributor wallet — BegFi's own pool and every campaign alike. It is read at
 * the top of every sweep, every claim, and every submission, so flipping it is
 * a single UPDATE rather than a walk through eight campaigns, which is not an
 * incident response.
 *
 * WHY IT FAILS CLOSED, WHICH IS THE OPPOSITE OF EVERY OTHER CONTROL HERE.
 * Everywhere else in this codebase an error fails open — a rate limiter outage
 * must not stop a real person from writing a beg, and the comment there says so.
 * Money is the other way round. If the switch cannot be read, the honest
 * assumption is NOT "it was probably off": the one moment you need a kill switch
 * is the moment the database is misbehaving, and a switch that silently
 * un-pauses itself during an incident is worse than no switch at all.
 *
 * The cost of failing closed is a delayed payout, which the next scheduled sweep
 * picks up. The cost of failing open is paying during the exact incident the
 * switch exists for. Those are not symmetric, so the code does not treat them as
 * if they were.
 *
 * It costs nothing extra in practice: the sweep reads its own queued rows from
 * the same database, so a database outage already parks it. This makes the
 * parking explicit and observable instead of incidental.
 */

export type PayoutControls = {
  is_paused: boolean;
  reason: string | null;
  paused_at: string | null;
  paused_by: string | null;
};

/** What an operator sees before anything has ever been flipped. */
const UNPAUSED: PayoutControls = {
  is_paused: false,
  reason: null,
  paused_at: null,
  paused_by: null,
};

export type ControlsRead = {
  controls: PayoutControls;
  /** False when the row could not be read — callers must treat this as paused. */
  readOk: boolean;
};

export async function readPayoutControls(): Promise<ControlsRead> {
  if (!SUPABASE_CONFIGURED) return { controls: UNPAUSED, readOk: false };

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("payout_controls")
      .select("is_paused, reason, paused_at, paused_by")
      .eq("id", true)
      .maybeSingle<PayoutControls>();

    if (error || !data) return { controls: UNPAUSED, readOk: false };
    return { controls: data, readOk: true };
  } catch {
    return { controls: UNPAUSED, readOk: false };
  }
}

/**
 * The question every money path actually asks: may I send?
 *
 * Returns the reason to show a user when the answer is no, so the UI never has
 * to invent one — and so a pause with no `reason` set still produces a sentence
 * that is true rather than a blank.
 */
export async function payoutsAllowed(): Promise<
  { allowed: true } | { allowed: false; reason: string }
> {
  const { controls, readOk } = await readPayoutControls();

  if (!readOk) {
    return {
      allowed: false,
      reason: "Payouts are held while the payout switch can't be read. Nothing is lost — try again shortly.",
    };
  }

  if (controls.is_paused) {
    return {
      allowed: false,
      reason: controls.reason?.trim()
        ? `Payouts are paused: ${controls.reason.trim()}`
        : "Payouts are paused right now. Nothing is lost — try again shortly.",
    };
  }

  return { allowed: true };
}

/**
 * Flip the switch. Called only from the admin route, which checks the caller's
 * wallet first — this function does not authorise anything itself, and says so
 * rather than looking like a control.
 */
export async function setPayoutsPaused(input: {
  paused: boolean;
  reason?: string | null;
  by: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("payout_controls")
      .update({
        is_paused: input.paused,
        reason: input.paused ? (input.reason?.trim() || null) : null,
        paused_at: input.paused ? new Date().toISOString() : null,
        paused_by: input.paused ? input.by.toLowerCase() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown" };
  }
}

/**
 * The reconciliation ledger, most recent first.
 *
 * Returns `null` when the rows could not be read — the same rule the rest of
 * this file follows. An empty array means "nothing has been checked yet", and
 * those are different answers: one is a monitoring gap, the other is a
 * monitoring failure, and a console that rendered both as "no drift" would be
 * lying about which one is happening.
 *
 * Rows are read with the service role. `reconciliation_runs` deliberately has
 * no client-readable policy at all (migration 0025), so this function is only
 * ever reached from a page that has already checked `isAdminWallet`.
 */
/**
 * CAN THE SITE ACTUALLY PAY THIS, RIGHT NOW?
 *
 * One function, because there are now three products that ask it and they must
 * not each carry their own idea of "funded". The payout wallet must exist, hold
 * at least `amount` of `tokenAddress`, and hold some native ETH for gas — a
 * wallet with the token and no gas produces a transaction that dies, and a
 * promise made against it is a promise the site cannot keep.
 *
 * It is a READ, and a read can fail: a failed read answers false, which is the
 * refusal side. That is the right direction here for the same reason the kill
 * switch fails closed — the cost is a claim or a submission that says "try again
 * in a moment", and the cost of the other answer is a promise nobody can pay.
 */
export async function payoutWalletReady(tokenAddress: string, amount: bigint): Promise<boolean> {
  const address = distributorSignerAddress();
  if (!distributorSignerConfigured() || !address) return false;
  try {
    const client = createPublicClient({ chain: robinhoodChain, transport: http() });
    const [balance, native] = await Promise.all([
      client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      }) as unknown as Promise<bigint>,
      client.getBalance({ address: address as `0x${string}` }),
    ]);
    return balance >= amount && native > 0n;
  } catch {
    return false;
  }
}

export type ReconcileRow = {
  token_address: string;
  token_symbol: string | null;
  token_decimals: number;
  expected: string;
  observed: string | null;
  drift: string | null;
  status: "ok" | "drift" | "unreadable";
  note: string | null;
  checked_at: string;
};

export async function recentReconciliations(limit = 40): Promise<ReconcileRow[] | null> {
  if (!SUPABASE_CONFIGURED) return null;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("reconciliation_runs")
      .select(
        "token_address, token_symbol, token_decimals, expected::text, observed::text, drift::text, status, note, checked_at",
      )
      .order("checked_at", { ascending: false })
      .limit(limit);

    if (error || !data) return null;
    return data as unknown as ReconcileRow[];
  } catch {
    return null;
  }
}

/**
 * Every admin wallet that has a profile, for belling them.
 *
 * An alert nobody sees is not an alert. The allowlist is the same one the Earn
 * console checks (`isAdminWallet`, driven by `EARN_ADMIN_WALLETS` with the
 * genesis wallet as the fallback), so a new admin is added in one place.
 *
 * THE DISTRIBUTOR'S OWN WALLET IS ADDED AS A CANDIDATE, and that is not
 * decoration. The allowlist is an environment allowlist: it routinely resolves to
 * a wallet nobody has signed in with, so it has no profile, so `in("wallet_address")`
 * returns nothing and an alarm about money reaches zero people. The wallet that
 * signs the payouts is the one wallet guaranteed to be involved, and if a profile
 * exists for it, its owner is exactly who needs to hear that the money ran out.
 *
 * The caller gets a COUNT of recipients, so "we alerted nobody" can be said out
 * loud instead of being inferred from silence — see the reconciliation job's
 * `alerted` field and its `alert.undelivered` audit row.
 */
export async function adminProfileIds(
  candidates: string[],
): Promise<{ id: string }[]> {
  if (!SUPABASE_CONFIGURED) return [];

  const distributor = distributorAddress();
  const wallets = [...new Set([...candidates, ...(distributor ? [distributor] : [])].map((w) => w.toLowerCase()))];
  if (wallets.length === 0) return [];

  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("id, wallet_address")
      .in("wallet_address", wallets);

    return ((data ?? []) as { id: string; wallet_address: string }[])
      .filter((row) => isAdminWallet(row.wallet_address) || row.wallet_address === distributor)
      .map((row) => ({ id: row.id }));
  } catch {
    return [];
  }
}
