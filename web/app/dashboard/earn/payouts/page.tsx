import type { Metadata } from "next";

import { PayoutTrigger } from "@/components/earn-payout-trigger";
import { PayoutSwitch } from "@/components/payout-switch";
import { addressUrl, shortAddress, txUrl } from "@/lib/chains";
import { formatAmount } from "@/lib/erc20";
import { getDistributorSnapshot, type PayoutRowSnapshot } from "@/lib/earn-distributor";
import { isAdminWallet } from "@/lib/earn";
import {
  readPayoutControls,
  recentReconciliations,
  type ReconcileRow,
} from "@/lib/payout-controls";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Automatic payouts" };
export const dynamic = "force-dynamic";

/**
 * The automatic-payouts console.
 *
 * Every number here is read from chain or ledger on render — nothing is
 * cached or invented. Balance is the distributor wallet's actual $BEGFI and
 * gas; distributed is the sum of settled ledger rows; remaining is the live
 * balance; owed is the approved-but-unpaid sum waiting for the next sweep.
 * The same numbers agree with each other because they all come from the same
 * two sources (on-chain reads, `begfi.earn_payouts`), not from four guesses.
 *
 * THE INCIDENT CONTROLS COME FIRST, and that is a layout decision, not a
 * stylistic one. Whoever opens this page during a problem is looking for the
 * switch and the reconciliation history — a stop button below four stat cards
 * is a stop button found a scroll too late.
 */
export default async function AutoPayoutsPage() {
  const profile = await getProfile();
  const admin = profile?.wallet_address ? isAdminWallet(profile.wallet_address) : false;
  if (!profile || !admin) {
    return (
      <div className="card grid gap-2 p-6">
        <b className="text-[16px] text-beg-ink">Not authorized</b>
        <p className="text-[13px] text-beg-dim">
          This console runs for the admin wallet only. Sign in with it and come back.
        </p>
      </div>
    );
  }

  const [{ controls, readOk }, reconciliations, snapshot] = await Promise.all([
    readPayoutControls(),
    recentReconciliations(60),
    getDistributorSnapshot(),
  ]);

  if (!snapshot) {
    return (
      <>
        <Header />
        <p className="notice-dashed p-5">The database couldn&apos;t be read. Check Supabase configuration.</p>
      </>
    );
  }

  const balance = snapshot.tokenBalance; // null = chain read failed or not configured
  const failed = snapshot.recent.filter((r) => r.status === "failed");

  return (
    <>
      <Header />

      <PayoutSwitch
        initialPaused={controls.is_paused}
        initialReason={controls.reason}
        initialBy={controls.paused_by}
        initialAt={controls.paused_at}
        readOk={readOk}
      />

      <Reconciliation rows={reconciliations} />

      {!snapshot.configured ? (
        <p className="notice-dashed p-5">
          The distributor wallet key is not configured on this deployment — the sweep is parked,
          no wallet is being paid. Set <code>DISTRIBUTOR_PRIVATE_KEY</code> (server-side secret, never public) and fund the wallet.
        </p>
      ) : balance === null ? (
        <p className="notice-dashed p-5">The on-chain balance read failed — showing ledger figures only.</p>
      ) : (
        <PayoutTrigger />
      )}

      {/* The four figures the product reports on itself */}
      <section className="grid gap-3 sm:grid-cols-2">
        <Stat
          label="Distributor balance"
          value={balance === null ? "—" : `${formatAmount(balance)} $BEGFI`}
          sub={
            snapshot.walletAddress ? (
              <a href={addressUrl(snapshot.walletAddress)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
                {shortAddress(snapshot.walletAddress)} ↗
              </a>
            ) : null
          }
        />
        <Stat
          label="$BEGFI distributed"
          value={`${formatAmount(snapshot.distributed)} $BEGFI`}
          sub={`BegFi's own pool only — plus ${snapshot.campaignPayouts} campaign payout(s) and ${snapshot.dropPrizes} drop prize(s) in their own tokens`}
        />
        <Stat
          label="Remaining to distribute"
          value={balance === null ? "—" : `${formatAmount(balance)} $BEGFI`}
          sub={balance !== null && snapshot.nativeBalance !== null ? `gas on hand: ${formatAmount(snapshot.nativeBalance)} ETH` : null}
        />
        <Stat
          label="Owed (next sweeps)"
          value={`${formatAmount(snapshot.owed)} $BEGFI`}
          sub={`${snapshot.owedWallets} wallet(s), paid FIFO by their oldest unpaid post`}
        />
      </section>

      {failed.length > 0 && (
        <section>
          <h2 className="mb-1 text-xl font-extrabold tracking-[-.03em]">
            Failed payouts ({snapshot.failedCount})
          </h2>
          <p className="mb-3 text-[12px] text-beg-dim">
            These wallets were NOT paid — their money has not moved. The sweep retries automatically (up to 10 attempts); a permanently failing row is a real recipient problem to inspect, and the wallet stays pending.
          </p>
          <ul className="grid gap-2">
            {failed.map((row, index) => (
              <PayoutRow key={`${row.cycle_date}-${row.wallet_address}-${index}`} row={row} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-xl font-extrabold tracking-[-.03em]">
          Payout ledger ({snapshot.recent.length} recent)
        </h2>
        <p className="mb-3 text-[12px] text-beg-dim">
          One row per wallet per cycle, for all three pools. &quot;sent&quot; links to the transfer that settled it;
          &quot;pending&quot; is a send whose confirmation hasn&apos;t returned yet (it settles itself); &quot;failed&quot;
          keeps the wallet unpaid and retrying. Each row carries the pool it paid for, and its amount is in that
          pool&apos;s own token — $BEGFI for BegFi&apos;s pool, a campaign&apos;s token, or a drop&apos;s prize
          token.
        </p>
        <ul className="grid gap-2">
          {snapshot.recent.length === 0 ? (
            <p className="notice-dashed">No automatic payouts yet. The first sweep happens the moment the wallet is funded and a trigger fires.</p>
          ) : (
            snapshot.recent.map((row, index) => <PayoutRow key={`${row.wallet_address}-${row.cycle_date}-${index}`} row={row} />)
          )}
        </ul>
      </section>
    </>
  );
}

/**
 * What the chain held versus what the books said.
 *
 * The three statuses are rendered as three different things on purpose:
 *   ok         — the wallet holds at least what is owed.
 *   drift      — it does not, and the switch was flipped automatically.
 *   unreadable — the comparison could not be made (chain read failed, or a
 *                read hit its row cap). This is NOT a pass, and the copy says
 *                so, because a monitoring gap that renders as green is worse
 *                than one that renders as unknown.
 */
function Reconciliation({ rows }: { rows: ReconcileRow[] | null }) {
  if (rows === null) {
    return (
      <section className="grid gap-2">
        <h2 className="text-xl font-extrabold tracking-[-.03em]">Reconciliation</h2>
        <p className="notice-dashed p-4">
          The reconciliation history could not be read — this console cannot say whether the wallet covers
          what is owed. Check Supabase configuration, and treat payouts as unverified until it reads.
        </p>
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section className="grid gap-2">
        <h2 className="text-xl font-extrabold tracking-[-.03em]">Reconciliation</h2>
        <p className="notice-dashed p-4">
          Nothing has been reconciled yet. The job compares every pool&apos;s obligations against the
          distributor&apos;s live balance and records the result — until the first run lands, coverage is
          unverified rather than proven.
        </p>
      </section>
    );
  }

  // A run is one insert, so every row carries the same `checked_at`. Grouping on
  // it is what turns the ledger back into "the latest check" and "earlier ones".
  const runs = new Map<string, ReconcileRow[]>();
  for (const row of rows) {
    const bucket = runs.get(row.checked_at);
    if (bucket) bucket.push(row);
    else runs.set(row.checked_at, [row]);
  }

  const ordered = [...runs.entries()];
  const [latestAt, latest] = ordered[0];
  const earlier = ordered.slice(1);

  return (
    <section className="grid gap-2">
      <h2 className="text-xl font-extrabold tracking-[-.03em]">Reconciliation</h2>
      <p className="text-[12px] text-beg-dim">
        Obligations (credited deposits minus confirmed payouts, plus BegFi&apos;s own pool in $BEGFI) against
        the wallet&apos;s live on-chain balance. Extra float is normal — the owner funds ahead of a sweep. A
        shortfall is the failure that ends in an unpaid claim, so it pauses payouts by itself.
      </p>

      <ul className="grid gap-2">
        {latest.map((row) => (
          <ReconcileCard key={`${row.token_address}-${row.checked_at}`} row={row} checkedAt={latestAt} />
        ))}
      </ul>

      {earlier.length > 0 && (
        <ul className="grid gap-1">
          {earlier.slice(0, 8).map(([checkedAt, runRows]) => {
            const worst = runRows.some((row) => row.status === "drift")
              ? "drift"
              : runRows.some((row) => row.status === "unreadable")
                ? "unreadable"
                : "ok";
            return (
              <li key={checkedAt} className="flex flex-wrap items-center gap-2 text-[12px] text-beg-dim">
                <span>{new Date(checkedAt).toLocaleString("en-GB")}</span>
                <StatusBadge status={worst} />
                <span>{runRows.length} token(s) checked</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const STATUS_COPY: Record<ReconcileRow["status"], string> = {
  ok: "covered",
  drift: "short",
  unreadable: "not verified",
};

function StatusBadge({ status }: { status: ReconcileRow["status"] }) {
  const badge = status === "ok" ? "bg-beg-lime" : status === "drift" ? "bg-beg-card" : "bg-beg-yellow";
  return (
    <span
      className={`rounded-full border-2 border-beg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.04em] text-beg-ink ${badge}`}
    >
      {STATUS_COPY[status]}
    </span>
  );
}

function ReconcileCard({ row, checkedAt }: { row: ReconcileRow; checkedAt: string }) {
  const decimals = row.token_decimals ?? 18;
  // `formatAmount` does the division, with THIS token's decimals — the whole
  // reason `token_decimals` is recorded. A 6-decimal campaign token rendered
  // through the 18-decimal default would read a trillionth of its real size.
  const human = (value: string | null) =>
    value === null ? "—" : formatAmount(BigInt(value), decimals);
  const label = row.token_symbol ?? `${row.token_address.slice(0, 6)}…${row.token_address.slice(-4)}`;

  return (
    <li className="card-sm grid gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-[14px] text-beg-ink">{label}</b>
          <a
            href={addressUrl(row.token_address)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] text-beg-dim underline underline-offset-2 hover:text-beg-ink"
          >
            {shortAddress(row.token_address)} ↗
          </a>
          <StatusBadge status={row.status} />
        </div>
        <span className="text-[11px] text-beg-dim">{new Date(checkedAt).toLocaleString("en-GB")}</span>
      </div>

      <div className="flex flex-wrap gap-4 text-[12px]">
        <span className="text-beg-dim">
          Owed <b className="text-beg-ink">{human(row.expected)}</b>
        </span>
        <span className="text-beg-dim">
          Held <b className="text-beg-ink">{human(row.observed)}</b>
        </span>
        {row.drift !== null && (
          <span className="text-beg-dim">
            Difference <b className="text-beg-ink">{human(row.drift)}</b>
          </span>
        )}
      </div>

      {row.note && <span className="text-[11px] text-beg-dim">{row.note}</span>}
    </li>
  );
}

function Header() {
  return (
    <header>
      <h1 className="text-[clamp(28px,6vw,40px)] font-extrabold tracking-[-.05em]">Automatic payouts</h1>
      <p className="mt-1 text-beg-dim">
        The distributor wallet pays completers by itself: daily cron, plus the moment it is funded. No approval, no click — funded money goes out in batches until it is exhausted.
      </p>
    </header>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="card-sm grid gap-1 p-4">
      <span className="text-[11px] font-bold uppercase tracking-[.06em] text-beg-dim">{label}</span>
      <span className="text-[20px] font-extrabold text-beg-ink">{value}</span>
      {sub && <span className="text-[11px] text-beg-dim">{sub}</span>}
    </div>
  );
}

function PayoutRow({ row }: { row: PayoutRowSnapshot }) {
  const badge =
    row.status === "sent" ? "bg-beg-lime" : row.status === "pending" ? "bg-beg-yellow" : "bg-beg-card";
  return (
    <li className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="rounded-full border-2 border-beg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.04em] text-beg-ink bg-beg-card">
          cycle {row.cycle_date}
        </span>
        <span className="rounded-full border-2 border-beg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.04em] text-beg-ink bg-beg-card">
          {row.drop_id ? "drop" : row.campaign_id ? "campaign" : "pool"}
        </span>
        {row.username ? <b className="text-beg-ink">@{row.username}</b> : null}
        <a href={addressUrl(row.wallet_address)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
          {shortAddress(row.wallet_address)} ↗
        </a>
        {/*
          The row's OWN token, at its own scale. A campaign paying in a
          6-decimal token rendered through the 18-decimal default would read a
          trillionth of its real size — and since 0029 the same ledger holds
          prizes in arbitrary tokens, so "what did this row pay in" is a
          question the console has to answer per row.
        */}
        <span className="font-bold text-beg-ink">
          {formatAmount(BigInt(row.amount), row.token_decimals ?? 18)} {row.token_symbol ?? "tokens"}
        </span>
        {row.attempts > 1 && <span className="text-[11px] text-beg-dim">attempt {row.attempts}</span>}
      </div>
      <div className="flex items-center gap-2">
        {row.last_error && <span className="max-w-[220px] truncate text-[11px] text-beg-dim" title={row.last_error}>{row.last_error}</span>}
        <span className={`rounded-full border-2 border-beg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.04em] text-beg-ink ${badge}`}>
          {row.status}
        </span>
        {row.tx_hash ? (
          <a href={txUrl(row.tx_hash)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
            {shortAddress(row.tx_hash)} ↗
          </a>
        ) : (
          <span className="text-[11px] text-beg-dim">{new Date(row.created_at).toLocaleDateString("en-GB")}</span>
        )}
      </div>
    </li>
  );
}
