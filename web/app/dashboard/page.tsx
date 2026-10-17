import type { Metadata } from "next";
import Link from "next/link";

import { ClaimButton } from "@/components/claim-button";
import { CopyLink } from "@/components/copy-link";
import { shortAddress } from "@/lib/chains";
import { BEG_CONFIGURED, BEG_TOKEN_ADDRESS, linkFor } from "@/lib/config";
import { distributorSignerConfigured } from "@/lib/distributor-signer";
import { getOverview, getOverviewExtras, type OverviewPayout } from "@/lib/dashboard";
import { formatAmount } from "@/lib/erc20";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

/**
 * The Overview: everything someone checks in a reflex, on one screen.
 *
 * WHAT CHANGED, AND WHY. This page used to lead with a watchlist for a launchpad
 * that no longer exists, and its totals function made an unbounded run of chain
 * reads for a meter the page never showed. Both are gone. What replaced them is
 * the money this product actually deals in: what arrived, what can still be
 * claimed, the last seven days, the last payouts, and four ways to do the next
 * thing. Every number comes from confirmed rows, and a failed read says so
 * rather than becoming a zero.
 */
export default async function DashboardPage() {
  const profile = await getProfile();
  if (!profile) return null;

  const [overview, extras] = await Promise.all([
    getOverview(profile.wallet_address),
    getOverviewExtras(profile.id, profile.wallet_address),
  ]);

  const claimable = BigInt(extras.claimable);
  const payoutConfigured = distributorSignerConfigured() && Boolean(BEG_TOKEN_ADDRESS);

  return (
    <>
      <header className="grid gap-1">
        <h1 className="text-[clamp(28px,6vw,40px)] font-extrabold tracking-[-.05em]">@{profile.username}</h1>
        <p className="font-mono text-[13px] text-beg-dim" title={profile.wallet_address}>
          {shortAddress(profile.wallet_address)}
        </p>
      </header>

      {overview.dbFailed || extras.dbFailed ? (
        <p className="notice-dashed p-4">
          Part of this page couldn&apos;t be read just now. That is the database, not an empty account — the sections
          that did load are still true.
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="$BEGFI received"
          value={overview.dbFailed ? "Unavailable" : formatAmount(BigInt(overview.totalReceived))}
          glow
        />
        <Stat label="Supporters" value={overview.dbFailed ? "Unavailable" : String(overview.supporters)} />
        <Stat label="Payouts paid" value={extras.dbFailed ? "Unavailable" : String(extras.payoutCount)} />
      </section>

      {!BEG_CONFIGURED ? (
        <p className="notice-dashed">
          Sending isn&apos;t live yet because the token isn&apos;t on the chain, so $BEGFI totals stay at zero until it
          is. Your begs and your link work now.
        </p>
      ) : null}

      {/* ---- Claimable: only the legacy pool needs a button */}
      {claimable > 0n ? (
        <section className="card grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="text-[13px] text-beg-dim">Ready to claim</p>
            <p className="mt-0.5 text-[26px] font-extrabold tracking-[-.03em] text-beg-ink">
              {formatAmount(claimable)} $BEGFI
            </p>
            <p className="mt-1 text-[12px] text-beg-dim">
              Approved work in the BegFi pool that has not been paid. Campaign and drop payouts are automatic and do not
              wait here.
            </p>
          </div>
          <ClaimButton claimableDisplay={formatAmount(claimable)} payoutConfigured={payoutConfigured} />
        </section>
      ) : extras.dbFailed ? (
        <p className="notice-dashed">Couldn&apos;t check whether anything is claimable. It will show here when the read works.</p>
      ) : (
        <p className="text-[12px] text-beg-dim">
          Nothing waiting to be claimed. Campaign and drop payouts are sent automatically; the Claim button appears here
          only when approved BegFi-pool work is unpaid.
        </p>
      )}

      <SevenDays days={extras.days} failed={extras.dbFailed} />

      {/* ---- Recent payouts */}
      <section className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-extrabold tracking-[-.02em]">Recent payouts</h2>
          <Link href="/dashboard/activity" className="text-[12px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
            All activity
          </Link>
        </div>
        {extras.dbFailed ? (
          <p className="notice-dashed">The payout history can&apos;t be read right now. Try again in a moment.</p>
        ) : extras.payouts.length === 0 ? (
          <p className="notice-dashed">
            No payouts yet.{" "}
            <Link href="/earn" className="underline underline-offset-2 hover:text-beg-ink">
              Earn
            </Link>{" "}
            is where they start.
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {extras.payouts.map((p, i) => (
              <PayoutRow key={`${p.at}-${i}`} payout={p} />
            ))}
          </ul>
        )}
      </section>

      <CopyLink url={linkFor(profile.username)} />

      <section>
        <h2 className="mb-2 text-[17px] font-extrabold tracking-[-.02em]">Do the next thing</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <TileLink href="/dashboard/begs" title="Write a beg" subtitle="A short ask with its own shareable page" />
          <TileLink href="/dashboard/pay-links" title="Create a pay link" subtitle="An exact amount with a memo and a QR" />
          <TileLink href="/earn" title="Find a campaign" subtitle="Post about a project and get paid from its pool" />
          <TileLink href="/drops" title="Claim a giveaway" subtitle="A fixed prize, one per wallet, paid on the spot" />
        </div>
      </section>
    </>
  );
}

function Stat({ label, value, glow = false }: { label: string; value: string; glow?: boolean }) {
  return (
    <div className="card">
      <div className="text-[13px] text-beg-dim">{label}</div>
      <div className={`mt-1 text-[32px] font-extrabold tracking-[-.04em] text-beg-ink ${glow ? "text-glow" : ""}`}>
        {value}
      </div>
    </div>
  );
}

/**
 * Seven days of receipts, drawn with CSS. A chart library for seven bars would
 * cost more than the page it sits on, and this one is server-rendered, so it
 * arrives with the data instead of after a hydration.
 */
function SevenDays({ days, failed }: { days: { date: string; amount: string }[]; failed: boolean }) {
  if (failed) return <p className="notice-dashed">The seven-day chart can&apos;t be read right now.</p>;

  const values = days.map((d) => BigInt(d.amount));
  const max = values.reduce((m, v) => (v > m ? v : m), 0n);
  const total = values.reduce((t, v) => t + v, 0n);

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-extrabold">Last 7 days</h2>
        <p className="text-[12px] text-beg-dim">
          <b className="text-beg-ink">{formatAmount(total)}</b> $BEGFI received
        </p>
      </div>
      <div className="mt-4 flex h-[92px] items-end gap-1.5" role="img" aria-label="Daily $BEGFI received for the last seven days">
        {days.map((d) => {
          const v = BigInt(d.amount);
          const height = max === 0n ? 0 : Number((v * 100n) / max);
          const label = new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
          return (
            <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <div
                className={`w-full rounded-t-md border-2 border-beg-ink ${v > 0n ? "bg-beg-lime" : "bg-beg-card"}`}
                style={{ height: `${Math.max(v > 0n ? 8 : 3, height)}%` }}
                title={`${label}: ${formatAmount(v)} $BEGFI`}
              />
              <span className="text-[10px] text-beg-dim">{label}</span>
            </div>
          );
        })}
      </div>
      {total === 0n ? (
        <p className="mt-3 text-[12px] text-beg-dim">Nothing arrived in the last seven days. The chart stays up rather than hiding.</p>
      ) : null}
    </section>
  );
}

function PayoutRow({ payout }: { payout: OverviewPayout }) {
  const amount = `${formatAmount(BigInt(payout.amount), payout.token_decimals)} ${payout.token_symbol}`;
  const inner = (
    <div className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]">
      <span className="min-w-0 truncate text-beg-ink">
        {payout.campaign_name ? (
          <>
            <b>{amount}</b> <span className="text-beg-dim">in {payout.campaign_name}</span>
          </>
        ) : (
          <>
            <b>{amount}</b> <span className="text-beg-dim">from the BegFi pool</span>
          </>
        )}
      </span>
      <span className="shrink-0 text-[11px] text-beg-dim">{new Date(payout.at).toLocaleDateString("en-GB")}</span>
    </div>
  );
  if (!payout.campaign_slug) return <li>{inner}</li>;
  return (
    <li>
      <Link href={`/earn/${payout.campaign_slug}`} className="with-hover">
        {inner}
      </Link>
    </li>
  );
}

function TileLink({ href, title, subtitle }: { href: string; title: string; subtitle: string }) {
  return (
    <Link href={href} className="card-hover card-sm block">
      <b className="text-[15px] text-beg-ink">{title}</b>
      <p className="mt-1 text-[12px] text-beg-dim">{subtitle}</p>
    </Link>
  );
}
