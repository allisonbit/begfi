import type { Metadata } from "next";

import { addressUrl } from "@/lib/chains";
import { BEG_TOKEN_ADDRESS } from "@/lib/config";
import { formatAmount, TOKEN_DECIMALS } from "@/lib/erc20";
import { getDistributorSnapshot } from "@/lib/earn-distributor";
import { readPayoutControls, recentReconciliations, type ReconcileRow } from "@/lib/payout-controls";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The books",
  description:
    "BegFi's payout wallet, its live balance, what it has paid out, what it owes, and the last reconciliation against the chain.",
};

/**
 * /transparency — THE BOOKS, PUBLISHED.
 *
 * WHY THIS PAGE EXISTS AT ALL. BegFi holds pool money in a backend wallet: campaign
 * projects fund a pool, and the site pays posters from it later. That is a custody
 * promise, and the defensible posture for one is to show the numbers rather than
 * assert that they are fine. Every figure below is read live — the balance from the
 * chain, the payouts and the obligations from our own ledger, the reconciliation
 * from the job that compares the two.
 *
 * WHAT IT DELIBERATELY SHOWS THAT A MARKETING PAGE WOULD NOT. If the wallet is
 * short, if the switch is paused, if a balance could not be read — all of that is
 * rendered, in the same words the admin console uses. A transparency page that only
 * looks good when things are good is a marketing page with a ledger in it.
 *
 * CUSTODY, STATED PLAINLY, in the footer copy: the wallet is BegFi's, the funds in
 * it are pool money and its own reward pool, and the site can sign transfers from
 * it. What it cannot do is touch money that never enters it — a `/username` payment
 * or a `/pay/<id>` request moves wallet to wallet, and those never appear here
 * because they never pass through us.
 */
type AuditRow = { at: string; actor: string; action: string; subject: string | null; detail: string };

/** The last few things that happened to the money, from the append-only log. */
async function recentActions(limit = 8): Promise<AuditRow[] | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("audit_log")
      .select("at, actor, action, subject, detail")
      .order("at", { ascending: false })
      .limit(limit);
    if (error || !data) return null;
    return data as AuditRow[];
  } catch {
    return null;
  }
}

const ACTION_LABELS: Record<string, string> = {
  "payouts.pause": "Payouts paused",
  "payouts.resume": "Payouts resumed",
  "payouts.sweep": "Payout sweep ran",
  "reconcile.run": "Reconciliation ran",
  "gas.low": "Gas balance flagged low",
};

export default async function TransparencyPage() {
  const [snapshot, controls, reconciliations, actions] = await Promise.all([
    getDistributorSnapshot(),
    readPayoutControls().then((r) => r.controls),
    recentReconciliations(20),
    recentActions(),
  ]);

  const balance = snapshot?.tokenBalance ?? null;
  const gas = snapshot?.nativeBalance ?? null;

  // The latest reconciliation run, per token — one insert per run, so every row of
  // it carries the same `checked_at`.
  const latestRunAt = reconciliations?.[0]?.checked_at ?? null;
  const latestRun = (reconciliations ?? []).filter((row) => row.checked_at === latestRunAt);

  return (
    <div className="safe-x mx-auto grid max-w-[900px] gap-6 py-10">
      <header className="grid gap-2">
        <span className="w-fit rounded-md border-[1.5px] border-beg-line px-2 py-0.5 text-[11px] font-bold uppercase tracking-[.09em] text-beg-dim">
          Transparency
        </span>
        <h1 className="text-[clamp(30px,7vw,46px)] font-extrabold leading-[1.05] tracking-[-.04em]">
          The books
        </h1>
        <p className="max-w-[62ch] text-beg-dim">
          BegFi pays campaign posters and its own Earn pool from a wallet it controls. This page shows what
          that wallet holds, what it has paid out, what it currently owes, and the last time an automated job
          checked the ledger against the chain. Nothing here is cached or estimated.
        </p>
      </header>

      {!snapshot || !snapshot.configured ? (
        <p className="notice-dashed p-5 text-[13px]">
          The payout wallet is not configured on this deployment, so there is nothing to report — no wallet
          holds pool money here, and no payouts can be sent.
        </p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2">
            <Stat
              label="In the payout wallet"
              value={balance === null ? "Unreadable" : `${formatAmount(balance)} $BEGFI`}
              sub={
                snapshot.walletAddress ? (
                  <a
                    href={addressUrl(snapshot.walletAddress)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] underline underline-offset-2 hover:text-beg-ink"
                  >
                    {snapshot.walletAddress.slice(0, 10)}…{snapshot.walletAddress.slice(-6)} ↗
                  </a>
                ) : null
              }
            />
            <Stat
              label="Gas for sending"
              value={gas === null ? "Unreadable" : `${formatAmount(gas, 18)} ETH`}
              sub="payouts stop when this reaches zero, and the alert fires early"
            />
            <Stat
              label="Paid out, all time"
              value={`${formatAmount(snapshot.distributed)} $BEGFI`}
              sub="confirmed transfers only — a pending send is never counted"
            />
            <Stat
              label="Owed right now"
              value={`${formatAmount(snapshot.owed)} $BEGFI`}
              sub={`to ${snapshot.owedWallets} wallet(s) whose rewards are approved and unpaid`}
            />
          </section>

          {/* The switch, in the same words the admin console uses. */}
          <section className="card grid gap-2 p-5">
            <span className="text-[11px] font-bold uppercase tracking-[.06em] text-beg-dim">Payout status</span>
            <b className="text-[18px] font-extrabold text-beg-ink">
              {controls.is_paused ? "Paused — no money is leaving" : "Running — payouts are automatic"}
            </b>
            <span className="text-[13px] text-beg-dim">
              {controls.is_paused
                ? controls.reason?.trim() || "Paused by an admin, with no reason recorded."
                : "Sweeps pay approved rewards automatically, on a schedule and whenever the wallet is funded."}
              {controls.paused_at ? ` Since ${new Date(controls.paused_at).toLocaleString("en-GB")}.` : ""}
            </span>
          </section>

          {/* Ledger versus chain: the job whose whole purpose is to disagree with
              us when we are wrong. */}
          <section className="grid gap-2">
            <h2 className="text-xl font-extrabold tracking-[-.03em]">Ledger against the chain</h2>
            <p className="text-[13px] text-beg-dim">
              An hourly job adds up what the ledger says is owed for each token and compares it with the
              wallet&apos;s live on-chain balance. Extra float is normal — pools are topped up ahead of a
              sweep. A shortfall pauses payouts automatically, before anyone is told.
            </p>

            {reconciliations === null ? (
              <p className="notice-dashed p-4 text-[13px]">
                The reconciliation history could not be read, so this page cannot say whether the wallet
                covers what is owed. Treat payouts as unverified until it reads.
              </p>
            ) : latestRun.length === 0 ? (
              <p className="notice-dashed p-4 text-[13px]">
                No reconciliation has run yet. Until the first check lands, coverage is unverified rather than
                proven.
              </p>
            ) : (
              <>
                <p className="text-[12px] text-beg-dim">
                  Last checked {new Date(latestRunAt!).toLocaleString("en-GB")}.
                </p>
                <ul className="grid gap-2">
                  {latestRun.map((row) => (
                    <ReconcileCard key={row.token_address} row={row} />
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* What happened, in order. */}
          <section className="grid gap-2">
            <h2 className="text-xl font-extrabold tracking-[-.03em]">Recent actions</h2>
            <p className="text-[13px] text-beg-dim">
              Every switch flip, sweep and reconciliation, append-only. Written by the code that did the
              thing, not by anything watching it.
            </p>
            {actions === null ? (
              <p className="notice-dashed p-4 text-[13px]">The action log could not be read.</p>
            ) : actions.length === 0 ? (
              <p className="notice-dashed p-4 text-[13px]">
                Nothing recorded yet. The log starts with the next payout action.
              </p>
            ) : (
              <ul className="grid gap-2">
                {actions.map((row) => (
                  <li key={`${row.at}-${row.action}-${row.subject ?? ""}`} className="card-sm grid gap-1 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <b className="text-[13px] text-beg-ink">
                        {ACTION_LABELS[row.action] ?? row.action}
                        {row.subject ? ` · ${row.subject}` : ""}
                      </b>
                      <span className="text-[11px] text-beg-dim">
                        {new Date(row.at).toLocaleString("en-GB")}
                      </span>
                    </div>
                    {row.detail ? <span className="text-[12px] text-beg-dim">{row.detail}</span> : null}
                    <span className="font-mono text-[10px] text-beg-dim">
                      by {row.actor.slice(0, 8)}…{row.actor.slice(-6)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="card grid gap-2 p-5">
        <h2 className="text-[16px] font-extrabold text-beg-ink">What is and is not in this wallet</h2>
        <p className="text-[13px] text-beg-dim">
          In it: campaign pool deposits and BegFi&apos;s own reward pool — money the site is holding in order to
          pay people later. Not in it: anything sent with a <code>/username</code> link or a{" "}
          <code>/pay/&lt;id&gt;</code> request. Those transfers go straight from the payer&apos;s wallet to the
          receiver&apos;s, which is why they never appear on this page: they never pass through us.
        </p>
        {BEG_TOKEN_ADDRESS ? (
          <p className="text-[12px] text-beg-dim">
            The token is{" "}
            <a
              href={addressUrl(BEG_TOKEN_ADDRESS)}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline underline-offset-2 hover:text-beg-ink"
            >
              {BEG_TOKEN_ADDRESS}
            </a>
            . Balances are read from Robinhood Chain on every load; payouts link to their own transaction, so
            any figure here can be checked against the chain independently.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="card-sm grid gap-1 p-4">
      <span className="text-[11px] font-bold uppercase tracking-[.06em] text-beg-dim">{label}</span>
      <span className="text-[20px] font-extrabold text-beg-ink">{value}</span>
      {sub ? <span className="text-[11px] text-beg-dim">{sub}</span> : null}
    </div>
  );
}

function ReconcileCard({ row }: { row: ReconcileRow }) {
  const decimals = row.token_decimals ?? TOKEN_DECIMALS;
  const human = (value: string | null) => (value === null ? "unreadable" : formatAmount(BigInt(value), decimals));
  const badge = row.status === "ok" ? "bg-beg-lime" : row.status === "drift" ? "bg-beg-card" : "bg-beg-yellow";

  return (
    <li className="card-sm grid gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="text-[14px] text-beg-ink">{row.token_symbol ?? `${row.token_address.slice(0, 10)}…`}</b>
        <span
          className={`rounded-full border-2 border-beg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.04em] text-beg-ink ${badge}`}
        >
          {row.status === "ok" ? "Covered" : row.status === "drift" ? "Short" : "Not verified"}
        </span>
      </div>
      <div className="flex flex-wrap gap-4 text-[12px] text-beg-dim">
        <span>
          Owed <b className="text-beg-ink">{human(row.expected)}</b>
        </span>
        <span>
          Held <b className="text-beg-ink">{human(row.observed)}</b>
        </span>
      </div>
      {row.note ? <span className="text-[11px] text-beg-dim">{row.note}</span> : null}
    </li>
  );
}
