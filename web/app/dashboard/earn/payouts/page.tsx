import type { Metadata } from "next";

import { PayoutTrigger } from "@/components/earn-payout-trigger";
import { addressUrl, shortAddress, txUrl } from "@/lib/chains";
import { formatAmount } from "@/lib/erc20";
import { getDistributorSnapshot, type PayoutRowSnapshot } from "@/lib/earn-distributor";
import { isAdminWallet } from "@/lib/earn";
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

  const snapshot = await getDistributorSnapshot();

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
          label="Total distributed"
          value={`${formatAmount(snapshot.distributed)} $BEGFI`}
          sub={`across settled automatic payouts`}
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
          One row per wallet per cycle. &quot;sent&quot; links to the transfer that settled it; &quot;pending&quot; is a send whose confirmation hasn&apos;t returned yet (it settles itself); &quot;failed&quot; keeps the wallet unpaid and retrying.
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
        {row.username ? <b className="text-beg-ink">@{row.username}</b> : null}
        <a href={addressUrl(row.wallet_address)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
          {shortAddress(row.wallet_address)} ↗
        </a>
        <span className="font-bold text-beg-ink">{formatAmount(BigInt(row.amount))} $BEGFI</span>
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
