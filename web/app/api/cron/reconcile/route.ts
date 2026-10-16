import { NextResponse } from "next/server";
import { createPublicClient, formatUnits, http } from "viem";

import { robinhoodChain } from "@/lib/chains";
import { BEG_TOKEN_ADDRESS } from "@/lib/config";
import { recordAudit } from "@/lib/audit";
import { adminWallets } from "@/lib/earn";
import { distributorAddress, gasFloor } from "@/lib/earn-distributor";
import { erc20Abi, TOKEN_DECIMALS } from "@/lib/erc20";
import { publishNotification } from "@/lib/notify";
import { adminProfileIds, readPayoutControls, setPayoutsPaused } from "@/lib/payout-controls";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/reconcile — do the books match the chain?
 *
 * THE QUESTION NOBODY WAS ASKING. Until this route existed, nothing compared
 * what the database says BegFi owes against what the payout wallet actually
 * holds. Drift from a missed indexer window, a silently failed write, a
 * transfer tax on a project's token, or a misattributed deposit could run for
 * weeks and only surface as a claim that reverts — the worst possible time to
 * discover an accounting error, because by then someone is owed money in
 * public.
 *
 * THE MODEL, STATED PLAINLY, BECAUSE IT IS AN APPROXIMATION AND SHOULD NOT
 * PRETEND OTHERWISE. All pools are funded to ONE distributor address, so the
 * chain cannot be asked "how much is in campaign X" — there is no such balance.
 * What can be compared is:
 *
 *     OBLIGATIONS(token) = Σ over campaigns (deposits credited − payouts sent)
 *                          + BegFi's approved-but-unpaid rewards, for $BEGFI
 *     OBSERVED(token)    = the distributor's live balance of that token
 *
 * Extra float is NORMAL and not an alarm: the owner tops the wallet up ahead of
 * a sweep, and BegFi's own pool money sits there too. What is never normal is
 * `observed < obligations` — the wallet cannot cover what the database says is
 * owed. That is the only condition that raises drift, and it is the one that
 * matters, because it is the one that ends in a failed payout.
 *
 * OWED MEANS OWED, NOT BUDGETED. BegFi's half deliberately sums the reward rows
 * it has already promised (`earn_submissions` approved with no payout tx) rather
 * than `earn_settings.pool_remaining`, which is the day's remaining ALLOWANCE —
 * money nobody has claimed is not money the wallet must cover, and comparing
 * against it would pause every payout on every quiet day. The budget is still
 * reported, as a note, when the balance is under it: covered-but-tight is worth
 * knowing, and it is not drift.
 *
 * IT NEVER DECLARES "OK" FROM A TRUNCATED SUM. Every read below has a row cap;
 * if a cap is reached, the token is reported as `unreadable` with a note rather
 * than as balanced. A reconciliation that says "fine" because it only looked at
 * the first ten thousand rows is worse than no reconciliation, because someone
 * would trust it.
 *
 * IT RUNS EVEN WHEN PAYOUTS ARE PAUSED — especially then. The pause is often a
 * response to drift, and a monitoring job that switches itself off during the
 * incident it monitors is a monitoring job that never reports the incident.
 */
const ROW_CAP = 10_000;

type TokenObligation = {
  token: string;
  symbol: string | null;
  /** The token's own decimals: 18 is the ERC-20 default, never an assumption to render with. */
  decimals: number;
  expected: bigint;
  /** Set when a read was capped or failed: the token cannot be judged. */
  unreadable: string | null;
};

export async function GET(request: Request) {
  // Same bearer check as the indexer: without it this endpoint lets anyone make
  // the deployment do unbounded RPC work on demand.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!SUPABASE_CONFIGURED) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const distributor = distributorAddress();
  if (!distributor) {
    // No payout wallet means no balance to reconcile; say so rather than
    // reporting everything as balanced.
    return NextResponse.json({ ok: false, error: "distributor not configured" }, { status: 503 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  // ---------------------------------------------------------------------
  // Obligations, per token
  // ---------------------------------------------------------------------
  const obligations = new Map<string, TokenObligation>();
  /** $BEGFI's remaining daily pool budget, read for the caveat below — never for the verdict. */
  let begPoolBudget: bigint | null = null;

  const add = (token: string, symbol: string | null, decimals: number, amount: bigint) => {
    const key = token.toLowerCase();
    const existing = obligations.get(key);
    if (existing) {
      existing.expected += amount;
      if (!existing.symbol && symbol) existing.symbol = symbol;
      // Two campaigns on one token should be impossible (the partial unique
      // index in migration 0025), but if it ever happens and the decimals
      // disagree, the sums are not comparable — say so instead of picking one.
      if (existing.decimals !== decimals) {
        note(key, `tokens with conflicting decimals (${existing.decimals} and ${decimals}) share this address`);
      }
      return;
    }
    obligations.set(key, { token: key, symbol, decimals, expected: amount, unreadable: null });
  };

  /**
   * A read that failed or was capped: the token cannot be judged at all.
   *
   * Kept apart from the informational notes below for a reason worth stating:
   * `unreadable` is a verdict of "no verdict", while an info note is a caveat on
   * a verdict that WAS reached. Folding them together would make one column mean
   * "something is wrong" in two different ways.
   */
  const note = (token: string, why: string) => {
    const key = token.toLowerCase();
    const existing = obligations.get(key);
    if (existing) {
      existing.unreadable = existing.unreadable ? `${existing.unreadable}; ${why}` : why;
    } else {
      obligations.set(key, { token: key, symbol: null, decimals: 18, expected: 0n, unreadable: why });
    }
  };

  // Campaign pools: credited deposits minus confirmed payouts.
  const { data: campaigns, error: campaignError } = await admin
    .from("campaigns")
    .select("id, slug, token_address, token_symbol, token_decimals, status")
    .neq("status", "draft")
    .limit(500);

  if (campaignError) {
    return NextResponse.json({ error: `campaign read failed: ${campaignError.message}` }, { status: 500 });
  }

  const rows = (campaigns ?? []) as {
    id: string;
    slug: string;
    token_address: string;
    token_symbol: string;
    token_decimals: number;
    status: string;
  }[];

  const { data: deposits, error: depositError } = await admin
    .from("campaign_deposits")
    .select("campaign_id, amount::text")
    .limit(ROW_CAP);

  if (depositError) {
    return NextResponse.json({ error: `deposit read failed: ${depositError.message}` }, { status: 500 });
  }

  const { data: payouts, error: payoutError } = await admin
    .from("earn_payouts")
    .select("campaign_id, amount::text")
    .eq("status", "sent")
    .limit(ROW_CAP);

  if (payoutError) {
    return NextResponse.json({ error: `payout read failed: ${payoutError.message}` }, { status: 500 });
  }

  const credited = new Map<string, bigint>();
  for (const row of (deposits ?? []) as { campaign_id: string; amount: string }[]) {
    credited.set(row.campaign_id, (credited.get(row.campaign_id) ?? 0n) + BigInt(row.amount));
  }

  const paid = new Map<string, bigint>();
  for (const row of (payouts ?? []) as { campaign_id: string | null; amount: string }[]) {
    if (!row.campaign_id) continue; // BegFi's own pool is accounted separately, below.
    paid.set(row.campaign_id, (paid.get(row.campaign_id) ?? 0n) + BigInt(row.amount));
  }

  for (const campaign of rows) {
    const inTotal = credited.get(campaign.id) ?? 0n;
    const outTotal = paid.get(campaign.id) ?? 0n;
    const remaining = inTotal > outTotal ? inTotal - outTotal : 0n;
    // Registers the token even at zero, so a fully-spent pool still gets its
    // balance checked instead of quietly dropping out of the comparison.
    add(campaign.token_address, campaign.token_symbol, campaign.token_decimals, remaining);
  }

  if ((deposits?.length ?? 0) >= ROW_CAP || (payouts?.length ?? 0) >= ROW_CAP) {
    // Snapshot the keys: `note` may insert, and mutating a Map while iterating
    // its keys is not something to leave to chance.
    for (const token of [...obligations.keys()]) {
      note(token, `row cap of ${ROW_CAP} reached — the sum may be incomplete`);
    }
  }

  // ---------------------------------------------------------------------
  // BegFi's own pool: what is OWED, not what the day's budget allows
  // ---------------------------------------------------------------------
  // THE DISTINCTION IS THE WHOLE DESIGN, and getting it wrong would make this
  // job worse than useless. `earn_settings.pool_remaining` is a BUDGET — the
  // day's remaining allowance, refilled to `pool_total` every UTC day. It is
  // not money owed to anybody: nothing has been promised for budget that nobody
  // claimed. Comparing the balance to it would raise drift whenever the wallet
  // held less than the day's cap, pause every payout, and be wrong every time.
  //
  // What IS owed is the rows the sweep and the claim route will actually try to
  // pay: approved submissions with no payout transaction yet. That is the sum
  // the earn console already shows as "Owed", and it is the money a wallet can
  // be short of.
  //
  // The budget still matters — it decides whether a claim TODAY can be
  // accepted — so it is reported as a note when the balance is under it, with
  // no effect on status. Informational, and explicitly not an alarm.
  const { data: owedEarn, error: owedError } = await admin
    .from("earn_submissions")
    .select("reward_amount::text")
    .eq("status", "approved")
    .is("payout_tx", null)
    .limit(ROW_CAP);

  if (owedError) {
    // Not fatal: the campaign half of the comparison is still meaningful, and
    // the $BEGFI half reports itself as unjudgeable rather than as zero.
    if (BEG_TOKEN_ADDRESS) note(BEG_TOKEN_ADDRESS, `earn owed read failed: ${owedError.message}`);
  } else {
    let owed = 0n;
    for (const row of (owedEarn ?? []) as { reward_amount: string }[]) owed += BigInt(row.reward_amount);

    if (BEG_TOKEN_ADDRESS) {
      add(BEG_TOKEN_ADDRESS, "BEGFI", TOKEN_DECIMALS, owed);
      if ((owedEarn?.length ?? 0) >= ROW_CAP) {
        note(BEG_TOKEN_ADDRESS, `row cap of ${ROW_CAP} reached — the owed sum may be incomplete`);
      }

      const { data: earnSettings } = await admin
        .from("earn_settings")
        .select("pool_remaining::text")
        .eq("id", true)
        .maybeSingle<{ pool_remaining: string }>();

      begPoolBudget = earnSettings?.pool_remaining ? BigInt(earnSettings.pool_remaining) : null;
    }
  }

  // ---------------------------------------------------------------------
  // Observed balances, and the comparison
  // ---------------------------------------------------------------------
  const client = createPublicClient({ chain: robinhoodChain, transport: http() });
  const results: {
    token: string;
    symbol: string | null;
    decimals: number;
    expected: bigint;
    observed: bigint | null;
    status: "ok" | "drift" | "unreadable";
    note: string | null;
  }[] = [];

  for (const obligation of obligations.values()) {
    let observed: bigint | null = null;
    let readNote: string | null = obligation.unreadable;

    try {
      observed = (await client.readContract({
        abi: erc20Abi,
        address: obligation.token as `0x${string}`,
        functionName: "balanceOf",
        args: [distributor as `0x${string}`],
      })) as unknown as bigint;
    } catch (error) {
      // A failed chain read is its OWN status: "could not read" and "read zero"
      // are different facts, and reporting the first as the second would raise
      // a drift alarm every time the RPC hiccuped.
      observed = null;
      readNote = readNote ?? `balance read failed: ${error instanceof Error ? error.message : "unknown"}`;
    }

    const status: "ok" | "drift" | "unreadable" =
      observed === null || readNote ? "unreadable" : observed < obligation.expected ? "drift" : "ok";

    // One `note` column holds both channels — the blocking reason first, so a
    // reader scanning the console sees why the token could not be judged before
    // any caveat about what was judged. Informational notes never touch `status`.
    const noteParts: string[] = readNote ? [readNote] : [];

    // The $BEGFI budget caveat, and only in the case where it is TRUE and worth
    // knowing: the owed money is covered, but not the day's remaining budget.
    //
    // It is deliberately NOT emitted on a drift row. There the reassuring half
    // of the sentence ("every reward actually owed is covered") would be false,
    // and a monitor that produces a confident, wrong sentence next to a red row
    // is worse than one that says nothing.
    if (
      status === "ok" &&
      begPoolBudget !== null &&
      BEG_TOKEN_ADDRESS &&
      obligation.token === BEG_TOKEN_ADDRESS.toLowerCase() &&
      observed !== null &&
      observed < begPoolBudget
    ) {
      noteParts.push(
        `every reward actually owed is covered, but today's remaining $BEGFI pool budget is ${begPoolBudget / 10n ** BigInt(TOKEN_DECIMALS)} and the balance is under that — a busy day would outrun the wallet before it outruns the daily cap`,
      );
    }

    results.push({
      token: obligation.token,
      symbol: obligation.symbol,
      decimals: obligation.decimals,
      expected: obligation.expected,
      observed,
      status,
      note: noteParts.length > 0 ? noteParts.join(" · ") : null,
    });
  }

  const { error: insertError } = await admin.from("reconciliation_runs").insert(
    results.map((row) => ({
      token_address: row.token,
      token_symbol: row.symbol,
      token_decimals: row.decimals,
      expected: row.expected.toString(),
      observed: row.observed === null ? null : row.observed.toString(),
      drift: row.observed === null ? null : (row.observed - row.expected).toString(),
      status: row.status,
      note: row.note,
    })),
  );

  if (insertError) {
    return NextResponse.json({ error: `could not record the run: ${insertError.message}` }, { status: 500 });
  }

  // ---------------------------------------------------------------------
  // Drift: stop the bleeding, then tell a human
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // Gas: the failure that looks like nothing to do
  // ---------------------------------------------------------------------
  // A sweep with no native balance and a sweep with no wallets to pay fail
  // identically from the outside — nothing is sent. The difference is that one of
  // them is an incident, and until this check existed nothing said which. The
  // floor is the sweep's own arithmetic via `gasFloor` (ten sends' worth), so the
  // alert and the sender cannot disagree about what "low" means.
  //
  // It ALERTS AND DOES NOT PAUSE. No gas stops sends by itself, at the exact
  // moment they are attempted; pausing would be a second, slower way of saying
  // the same thing — and would need a human to undo even after a top-up.
  const gasPrice = await client.getGasPrice().catch(() => 0n);
  const gasNeeded = gasFloor(gasPrice, 10);
  const nativeBalance = await client.getBalance({ address: distributor as `0x${string}` }).catch(() => null);
  const gasLow = nativeBalance !== null && nativeBalance < gasNeeded;

  const drifting = results.filter((row) => row.status === "drift");
  let paused: boolean | null = null;

  // Whole-token figures for humans. The unit is the TOKEN's own decimals, taken
  // from the contract per campaign — never an assumed 18 on a number a person
  // will act on.
  const human = (value: bigint, decimals: number) =>
    (value / 10n ** BigInt(decimals)).toLocaleString("en-GB");

  if (drifting.length > 0) {
    const summary = drifting
      .map(
        (row) =>
          `${row.symbol ?? row.token.slice(0, 10)} is short by ${human(
            row.expected - (row.observed ?? 0n),
            row.decimals,
          )}`,
      )
      .join("; ");

    // Auto-pause, before the alert. The order matters: if the bell fails, the
    // switch is already off, and if the switch fails the bell still says why.
    const flip = await setPayoutsPaused({
      paused: true,
      reason: `Automatic: reconciliation found the wallet short — ${summary}`.slice(0, 160),
      by: distributor,
    });
    paused = flip.ok;
  }

  // The audit trail: the run itself, then whatever it did about it. Written
  // BEFORE the bells, like the switch flip — the record of an action should not
  // depend on a notification succeeding.
  await recordAudit(admin, {
    actor: distributor,
    action: "reconcile.run",
    detail:
      results.length === 0
        ? "No pool had an obligation to check."
        : results
            .map(
              (row) =>
                `${row.symbol ?? row.token.slice(0, 10)}: owed ${human(row.expected, row.decimals)}, held ${
                  row.observed === null ? "unreadable" : human(row.observed, row.decimals)
                } (${row.status})`,
            )
            .join(" · "),
  });

  if (drifting.length > 0) {
    await recordAudit(admin, {
      actor: distributor,
      action: "payouts.pause",
      subject: drifting.map((row) => row.token).join(","),
      detail: `Automatic: reconciliation found the wallet short — ${drifting
        .map((row) => `${row.symbol ?? row.token.slice(0, 10)} short by ${human(row.expected - (row.observed ?? 0n), row.decimals)}`)
        .join("; ")}`,
    });
  }

  if (gasLow && nativeBalance !== null) {
    await recordAudit(admin, {
      actor: distributor,
      action: "gas.low",
      detail: `Native balance ${formatUnits(nativeBalance, 18)} ETH is under the ${formatUnits(gasNeeded, 18)} ETH floor for ten sends.`,
    });
  }

  const { controls } = await readPayoutControls();
  let alerted = 0;

  if (drifting.length > 0) {
    try {
      const recipients = await adminProfileIds(adminWallets());
      alerted = recipients.length;
      for (const recipient of recipients) {
        await publishNotification(admin, {
          profileId: recipient.id,
          kind: "reconcile_alert",
          title: "Payout wallet is short",
          body: drifting
            .map((row) => {
              return `${row.symbol ?? row.token.slice(0, 12)}: owed ${human(
                row.expected,
                row.decimals,
              )}, held ${human(row.observed ?? 0n, row.decimals)} — short ${human(
                row.expected - (row.observed ?? 0n),
                row.decimals,
              )}`;
            })
            .join(" · "),
          ref: `reconcile-${new Date().toISOString().slice(0, 13)}`,
          href: "/dashboard/earn/payouts",
        });
      }
    } catch {
      // The switch is already off; a failed bell must not undo that.
    }

    /*
     * NOBODY TO TELL, SAID OUT LOUD.
     *
     * The switch is off either way, so the money is safe — but if the admin
     * allowlist resolves to wallets with no profiles, the alarm reached nobody, and
     * the difference between "payouts are paused and the humans know" and "payouts
     * are paused and nobody knows" is the whole incident. It goes in the audit trail
     * as its own action so it is findable rather than inferable.
     */
    if (alerted === 0) {
      await recordAudit(admin, {
        actor: distributor,
        action: "alert.undelivered",
        detail:
          "Reconciliation found a shortfall and paused payouts, but no admin wallet in the allowlist has a profile — nobody was belled. Sign in with an admin wallet to receive these.",
      });
    }
  }

  // The gas alert, deduplicated by the HOUR: a low balance is a standing condition,
  // so one bell per hour is a reminder and one bell per run is spam.
  if (gasLow && nativeBalance !== null) {
    try {
      const recipients = await adminProfileIds(adminWallets());
      const hour = new Date().toISOString().slice(0, 13);
      for (const recipient of recipients) {
        await publishNotification(admin, {
          profileId: recipient.id,
          kind: "low_gas",
          title: "The payout wallet is low on gas",
          body: `${formatUnits(nativeBalance, 18)} ETH on hand, under the ${formatUnits(
            gasNeeded,
            18,
          )} ETH needed for ten more sends. Payouts will start failing once it runs out — top the wallet up.`,
          ref: `gas-${hour}`,
          href: "/dashboard/earn/payouts",
        });
      }
    } catch {
      // The balance is in the response either way; a failed bell is not a reason
      // to fail the check.
    }
  }

  return NextResponse.json({
    ok: true,
    distributor,
    checked: results.length,
    pausedByIncident: drifting.length > 0 && paused === true,
    // How many humans were told. Zero on a drifting run is a configuration hole,
    // not a quiet success.
    alerted,
    gas: {
      native: nativeBalance === null ? null : nativeBalance.toString(),
      floorForTenSends: gasNeeded.toString(),
      low: gasLow,
    },
    controls,
    rows: results.map((row) => ({
      token: row.token,
      symbol: row.symbol,
      decimals: row.decimals,
      expected: row.expected.toString(),
      observed: row.observed?.toString() ?? null,
      status: row.status,
      note: row.note,
    })),
  });
}
