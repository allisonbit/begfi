import type { Metadata } from "next";
import Link from "next/link";

import { DropForm } from "@/components/drop-form";
import { DropOwnerControls } from "@/components/drop-owner-controls";
import { distributorAddressPublic } from "@/lib/campaigns";
import { addressUrl, shortAddress, txUrl } from "@/lib/chains";
import { getOwnerDrops } from "@/lib/drops";
import { formatAmount } from "@/lib/erc20";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Your drops" };
export const dynamic = "force-dynamic";

/**
 * The giveaway dashboard.
 *
 * WHAT AN OWNER NEEDS TO SEE, in the order they need it: is the pot funded, how
 * many prizes are left, who claimed, and did each prize actually leave the
 * wallet. Every figure is the ledger's — deposits minus confirmed payouts — and
 * a read that failed says so rather than rendering a zero, because the one
 * mistake that matters here is telling an owner their pot is empty when it is
 * merely unreadable.
 *
 * THE HONEST PART, STATED ON THE PAGE: a drop's pot is spent as prizes are
 * claimed, and an unclaimed remainder stays in the shared payout wallet. There
 * is no automatic return path yet — per-pool deposit addresses and refunds are
 * the next build (docs/DROPS.md, KNOWN_ISSUES #21) — so the page says that
 * instead of implying a refund that does not exist.
 */
export default async function DropsDashboardPage() {
  const profile = await getProfile();
  if (!profile) return null; // the dashboard layout gates this

  const drops = await getOwnerDrops(profile.id);
  const distributor = distributorAddressPublic();

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(26px,5vw,36px)] font-extrabold tracking-[-.05em]">Your drops</h1>
          <p className="mt-1 max-w-[60ch] text-beg-dim">
            A drop pays one fixed prize to each of the first claimers, straight to their wallets — the same payout engine that pays
            BegFi&apos;s own pool and every campaign.
          </p>
        </div>
        {!distributor ? null : (
          <div className="card-sm grid gap-1 p-4 text-[12px]">
            <b className="text-beg-ink">Payout / deposit address</b>
            <a href={addressUrl(distributor)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
              {shortAddress(distributor)} ↗
            </a>
            <span className="max-w-[240px] break-all text-[11px] text-beg-dim">{distributor}</span>
            <span className="text-[11px] text-beg-dim">
              Register the deposit on the drop&apos;s page first — a transfer with no intent cannot be credited to a pot.
            </span>
          </div>
        )}
      </header>

      <section className="mt-4">
        <DropForm />
      </section>

      {drops.length === 0 ? (
        <section className="mt-4">
          <p className="notice-dashed">
            No drops yet. Create one, fund its pot from the drop&apos;s own page, and the first claimers get paid within seconds of
            claiming.
          </p>
        </section>
      ) : (
        drops.map(({ drop, stats, claims, fundings, depositCount }) => {
          const unit = (v: bigint | null) => (v === null ? "—" : formatAmount(v, drop.tokenDecimals));
          const paidClaims = claims.filter((c) => c.payoutTx !== null).length;
          const pendingClaims = claims.length - paidClaims;
          const progress =
            stats.claimCount === null
              ? 0
              : Math.max(2, Math.min(100, Math.round((stats.claimCount / Math.max(1, drop.maxClaims)) * 100)));

          return (
            <section key={drop.id} className="mt-6 grid gap-3">
              <div className="card grid gap-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <b className="text-[16px] text-beg-ink">
                      {drop.name}{" "}
                      <span className="align-middle text-[10px] font-bold uppercase tracking-[.06em] text-beg-dim">· {drop.status}</span>
                    </b>
                    <Link href={`/drop/${drop.id}`} className="block text-[12px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
                      /drop/{drop.id.slice(0, 8)}… ↗
                    </Link>
                  </div>
                  <span className="rounded-full border-2 border-beg-ink bg-beg-lime px-3 py-1 text-[12px] font-extrabold text-beg-ink">
                    {unit(drop.amountPerClaim)} {drop.tokenSymbol} each
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                  <div>
                    <div className="text-[20px] font-extrabold text-beg-ink">
                      {unit(stats.pool?.remaining ?? null)}
                    </div>
                    <div className="text-[11px] text-beg-dim">In the pot</div>
                  </div>
                  <div>
                    <div className="text-[20px] font-extrabold text-beg-ink">{stats.prizesLeft ?? "—"}</div>
                    <div className="text-[11px] text-beg-dim">Prizes left</div>
                  </div>
                  <div>
                    <div className="text-[20px] font-extrabold text-beg-ink">
                      {paidClaims}
                      {pendingClaims > 0 ? <span className="text-[12px] text-beg-dim"> +{pendingClaims} sending</span> : null}
                    </div>
                    <div className="text-[11px] text-beg-dim">Prizes paid</div>
                  </div>
                  <div>
                    <div className="text-[20px] font-extrabold text-beg-ink">{unit(stats.pool?.deposited ?? null)}</div>
                    <div className="text-[11px] text-beg-dim">Deposited ({depositCount ?? "—"} transfer{depositCount === 1 ? "" : "s"})</div>
                  </div>
                </div>

                <div className="grid gap-1">
                  <div className="progress">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-[11px] text-beg-dim">
                    {stats.claimCount === null ? "Claims unreadable just now." : `${stats.claimCount}/${drop.maxClaims} claimed`} ·{" "}
                    {drop.closesAt
                      ? Date.now() >= new Date(drop.closesAt).getTime()
                        ? `window closed ${new Date(drop.closesAt).toLocaleString("en-GB")}`
                        : `closes ${new Date(drop.closesAt).toLocaleString("en-GB")}`
                      : "no deadline"}{" "}
                    · token{" "}
                    <a href={addressUrl(drop.tokenAddress)} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-2 hover:text-beg-ink">
                      {shortAddress(drop.tokenAddress)} ↗
                    </a>
                  </p>
                  {stats.pool && stats.prizesLeft === 0 && drop.status !== "ended" ? (
                    <p className="text-[12px] font-bold text-beg-ink">
                      {stats.claimCount !== null && stats.claimCount >= drop.maxClaims
                        ? "Every prize has been claimed — the cap is reached."
                        : "The pot cannot cover another prize. Fund it to open more prizes."}
                    </p>
                  ) : null}
                </div>

                <DropOwnerControls dropId={drop.id} status={drop.status} />
              </div>

              {/* Deposits registered against this drop — the attribution trail. */}
              {fundings.length > 0 ? (
                <div className="card-sm p-4">
                  <b className="text-[14px] text-beg-ink">Deposits</b>
                  <ul className="mt-2 grid gap-1.5">
                    {fundings.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                        <span className="font-mono text-[11px] text-beg-dim">{shortAddress(f.funderWallet)}</span>
                        <span className="font-bold text-beg-ink">
                          {formatAmount(f.matchedAmount ?? f.expectedAmount, drop.tokenDecimals)} {drop.tokenSymbol}
                          {f.matchedAmount === null ? " intended" : ""}
                        </span>
                        <span
                          className={`rounded-full border-2 border-beg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.04em] text-beg-ink ${
                            f.status === "matched" ? "bg-beg-lime" : f.status === "pending" ? "bg-beg-yellow" : "bg-beg-card"
                          }`}
                        >
                          {f.status}
                        </span>
                        {f.txHash ? (
                          <a href={txUrl(f.txHash)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-beg-dim underline underline-offset-2">
                            {shortAddress(f.txHash)} ↗
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-beg-dim">
                    A pending row is an intent, not money: it turns into a definite deposit when the transfer from that wallet is seen
                    on-chain. It stops matching after 24 hours.
                  </p>
                </div>
              ) : null}

              {/* Claims — paid and in flight, with their own transactions. */}
              {claims.length > 0 ? (
                <div className="card-sm p-4">
                  <b className="text-[14px] text-beg-ink">Claims</b>
                  <ul className="mt-2 grid gap-1.5">
                    {claims.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                        <Link href={`/${c.username}`} className="font-bold text-beg-ink underline underline-offset-2">
                          @{c.username}
                        </Link>
                        <span className="font-mono text-[11px] text-beg-dim">{shortAddress(c.walletAddress)}</span>
                        <span className="font-bold text-beg-ink">
                          {formatAmount(c.amount, drop.tokenDecimals)} {drop.tokenSymbol}
                        </span>
                        <span
                          className={`rounded-full border-2 border-beg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.04em] text-beg-ink ${
                            c.payoutTx ? "bg-beg-lime" : "bg-beg-yellow"
                          }`}
                        >
                          {c.payoutTx ? "paid" : "sending"}
                        </span>
                        {c.payoutTx ? (
                          <a href={txUrl(c.payoutTx)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-beg-dim underline underline-offset-2">
                            {shortAddress(c.payoutTx)} ↗
                          </a>
                        ) : (
                          <span className="text-[11px] text-beg-dim">paid by the next sweep</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          );
        })
      )}

      <section className="mt-6 notice">
        <b className="text-beg-ink">Where the money sits</b>
        <p className="mt-2 text-[12px]">
          The pot is held in the BegFi payout wallet from the moment your deposit confirms, and it leaves as prizes are claimed — one
          transfer per claimer. Every payout is on-chain and visible above.
        </p>
        <p className="mt-2 text-[12px]">
          An unclaimed remainder stays in that wallet: there is no automatic return path yet, and this page will not pretend otherwise.
          Per-pool deposit addresses and refunds are the next build (docs/DROPS.md).
        </p>
      </section>
    </>
  );
}
