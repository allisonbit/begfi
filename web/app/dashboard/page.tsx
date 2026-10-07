import type { Metadata } from "next";
import Link from "next/link";
import { BegComposer } from "@/components/beg-composer";
import { CopyLink } from "@/components/copy-link";
import { shortAddress } from "@/lib/chains";
import { BEG_CONFIGURED, linkFor } from "@/lib/config";
import { formatAmount } from "@/lib/erc20";
import { getProfile } from "@/lib/session";
import { getRecentTransfers, getStats } from "@/lib/queries";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * The overview: what you have received, who to share with, what you are asking
 * for.
 *
 * The gate and the navigation live in `layout.tsx`, so this page is only ever
 * reached by someone with a claimed username and does not re-implement either.
 */
export default async function DashboardPage() {
  const profile = await getProfile();
  // The layout has already shown the right prompt; this is a type narrowing.
  if (!profile) return null;

  const [stats, transfers] = await Promise.all([
    getStats(profile.id),
    getRecentTransfers(profile.wallet_address, 10),
  ]);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">
            @{profile.username}
          </h1>
          <p className="font-mono text-[13px] text-beg-dim" title={profile.wallet_address}>
            {shortAddress(profile.wallet_address)}
          </p>
        </div>
      </header>

      <section className="grid gap-3.5 sm:grid-cols-2">
        <Stat label="$BEG received" value={formatAmount(BigInt(stats.total_received))} glow />
        <Stat label="Supporters" value={String(stats.supporters)} />
      </section>

      {!BEG_CONFIGURED ? (
        <p className="notice-dashed">
          Sending isn&apos;t live yet because $BEG hasn&apos;t been launched, so no transfers can exist until
          it is. Your link and your begs work now; the totals start moving the moment it does.
        </p>
      ) : null}

      <CopyLink url={linkFor(profile.username)} />

      {/*
        The composer sits above the activity deliberately: writing a beg is what a
        person comes here to do, and the totals are what they check afterwards.
      */}
      <section className="grid gap-3">
        <h2 className="text-xl font-extrabold tracking-[-.03em]">Write a beg</h2>
        <BegComposer />
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-extrabold tracking-[-.03em]">Recent activity</h2>
          <Link href="/dashboard/activity" className="text-[13px] text-beg-dim underline underline-offset-2">
            See all
          </Link>
        </div>

        {transfers.length === 0 ? (
          <p className="rounded-2xl border-[1.5px] border-beg-line p-5 text-[13px] text-beg-dim">
            Nothing yet. Share your link and the first send shows up here.
          </p>
        ) : (
          <ul className="grid gap-2">
            {transfers.map((t) => (
              <li
                key={`${t.tx_hash}-${t.log_index}`}
                className="card-sm flex items-center justify-between text-[13px]"
              >
                <span className="font-mono text-beg-dim">{shortAddress(t.from_address)}</span>
                <span className="font-bold text-beg-ink">{formatAmount(BigInt(t.amount))} $BEG</span>
              </li>
            ))}
          </ul>
        )}
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
