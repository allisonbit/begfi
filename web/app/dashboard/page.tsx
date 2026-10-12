import type { Metadata } from "next";
import Link from "next/link";
import { ClaimOverview } from "@/components/claim-overview";
import { CopyLink } from "@/components/copy-link";
import { shortAddress } from "@/lib/chains";
import { BEG_CONFIGURED, linkFor } from "@/lib/config";
import { formatAmount } from "@/lib/erc20";
import { getLauncherDashboard, getOverview } from "@/lib/dashboard";
import { getWatchlistRows } from "@/lib/watchlist-data";
import { getWatchlist } from "@/lib/watchlist";
import { getProfile } from "@/lib/session";
import { WatchlistPanel } from "@/components/watchlist-panel";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

/**
 * The Overview tab: everything someone checks in a reflex, in one screen.
 *
 * Wallet, $BEG received, supporters, fees — all read from the chain or the
 * indexer's confirmed rows, so a number here is a fact even when it is zero.
 * The claimable figure and the BegFi meter are client/server splits on
 * purpose: the escrow balance has to be read with the connected wallet
 * (everything else would pay someone else), while totals belong to the server
 * read.
 */
export default async function DashboardPage() {
  const profile = await getProfile();
  if (!profile) return null;

  const [overview, launchesResult, watchRows] = await Promise.all([
    getOverview(profile.wallet_address),
    getLauncherDashboard(profile.wallet_address),
    getWatchlist(),
  ]);

  const watchlistData = await getWatchlistRows(
    watchRows.map((w) => ({
      tokenAddress: w.token_address,
      alertOnMove: w.alert_on_move,
      alertOnGraduation: w.alert_on_graduation,
    })),
  );

  const meterNumerator = overview.meterPooledWei ? Number(overview.meterPooledWei) : null;
  const meterDenominator = overview.meterThresholdWei ? Number(overview.meterThresholdWei) : null;
  const meterRatio = meterNumerator !== null && meterDenominator !== null && meterDenominator > 0
    ? Math.min(1, meterNumerator / meterDenominator)
    : null;

  return (
    <>
      <header className="grid gap-1">
        <h1 className="text-[clamp(28px,6vw,40px)] font-extrabold tracking-[-.05em]">
          @{profile.username}
        </h1>
        <p className="font-mono text-[13px] text-beg-dim" title={profile.wallet_address}>
          {shortAddress(profile.wallet_address)}
        </p>
      </header>

      {overview.dbFailed ? (
        <p className="notice-dashed p-5">
          Couldn&apos;t read your totals just now. This is a problem reaching the database, not an
          empty account. Try again in a moment.
        </p>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2">
          <Stat label="$BEG received" value={formatAmount(BigInt(overview.totalReceived))} glow />
          <Stat label="Supporters" value={String(overview.supporters)} />
        </section>
      )}

      {!BEG_CONFIGURED ? (
        <p className="notice-dashed">
          Sending isn&apos;t live yet because $BEG hasn&apos;t been launched, so $BEG totals stay at
          zero until it is. Your launches and your link work now.
        </p>
      ) : null}

      <ClaimOverview wallet={launchesResult.launches.length > 0 ? profile.wallet_address : null} />

      {meterRatio !== null && launchesResult.launches.length > 0 ? (
        <section className="card grid gap-2">
          <div className="flex items-baseline justify-between">
            <b className="text-[14px]">BegFi meter</b>
            <span className="text-[12px] text-beg-dim">
              {Math.round(meterRatio * 100)}% toward graduation, across your tokens
            </span>
          </div>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${Math.max(2, meterRatio * 100)}%` }} />
          </div>
          <p className="text-[12px] text-beg-dim">
            Pooled ETH across the tokens this wallet launched, against their combined graduation
            thresholds. Read live from the curves.
          </p>
        </section>
      ) : null}

      <WatchlistPanel rows={watchlistData} />

      <CopyLink url={linkFor(profile.username)} />

      <section className="grid gap-2 sm:grid-cols-3">
        <TileLink href="/dashboard/begs" title="Your begs" subtitle="Write, edit and share what you are asking for" />
        <TileLink href="/beg-to-launch" title="Beg to launch" subtitle="Open an ask supporters can fund toward your launch" />
        <TileLink href="/dashboard/launches" title="Launches" subtitle="Tokens this wallet launched, with live numbers" />
        <TileLink href="/dashboard/activity" title="Activity" subtitle="Everything that reached this account" />
      </section>
    </>
  );
}

function Stat({ label, value, glow = false }: { label: string; value: string; glow?: boolean }) {
  return (
    <div className="card">
      <div className="text-[13px] text-beg-dim">{label}</div>
      <div
        className={`mt-1 text-[36px] font-extrabold tracking-[-.04em] text-beg-ink ${glow ? "text-glow" : ""}`}
      >
        {value}
      </div>
    </div>
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
