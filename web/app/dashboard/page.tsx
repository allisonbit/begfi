import type { Metadata } from "next";
import Link from "next/link";
import { BegComposer } from "@/components/beg-composer";
import { CopyLink } from "@/components/copy-link";
import { NeedsSignIn, NeedsUsername } from "@/components/needs-sign-in";
import { shortAddress } from "@/lib/chains";
import { BEG_CONFIGURED, linkFor } from "@/lib/config";
import { formatAmount } from "@/lib/erc20";
import { getRecentTransfers, getStats } from "@/lib/queries";
import { getProfile, getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * The overview: what you have received, who to share with, and what happened
 * recently.
 *
 * THREE STATES, and they are not the same page. No session means "sign in";
 * a session with no username means "finish claiming your link"; only the third
 * has anything to show. The previous version redirected all three to the home
 * page, which is why pressing Dashboard appeared to do nothing.
 *
 * Every number here comes from `transfers`, which the indexer fills from
 * confirmed on-chain events — never from the browser's claim that a send
 * happened (spec §7.4). A new account shows zeros, which is honest.
 */
export default async function DashboardPage() {
  const profile = await getProfile();

  if (!profile) {
    const { signedIn } = await getSession();
    return signedIn ? <NeedsUsername /> : <NeedsSignIn what="your dashboard" />;
  }

  const [stats, transfers] = await Promise.all([
    getStats(profile.id),
    getRecentTransfers(profile.wallet_address, 10),
  ]);

  return (
    <div className="mx-auto grid max-w-[1000px] gap-8 px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">
            @{profile.username}
          </h1>
          <p className="font-mono text-[13px] text-beg-dim" title={profile.wallet_address}>
            {shortAddress(profile.wallet_address)}
          </p>
        </div>

        <nav className="flex flex-wrap gap-3 text-[13px]">
          <Link href="/dashboard/profile" className="text-beg-dim underline underline-offset-2">
            Edit profile
          </Link>
          <Link href="/dashboard/activity" className="text-beg-dim underline underline-offset-2">
            Activity
          </Link>
          <Link href="/dashboard/launches" className="text-beg-dim underline underline-offset-2">
            Launches
          </Link>
        </nav>
      </header>

      <CopyLink url={linkFor(profile.username)} />

      {/*
        The composer sits above the stats deliberately. Writing a beg is the thing
        a person comes here to do; the totals are what they check afterwards.
      */}
      <section className="grid gap-3">
        <h2 className="text-xl font-extrabold tracking-[-.03em]">Write a beg</h2>
        <BegComposer />
      </section>

      <section className="grid gap-3.5 sm:grid-cols-2">
        <Stat label="$BEG received" value={formatAmount(BigInt(stats.total_received))} />
        <Stat label="Supporters" value={String(stats.supporters)} />
      </section>

      {!BEG_CONFIGURED ? (
        <p className="rounded-2xl border-[1.5px] border-dashed border-beg-line p-5 text-[13px] text-beg-dim">
          Sending isn&apos;t live yet — $BEG hasn&apos;t been launched, so no transfers can exist until
          it is. These totals start moving the moment it does. Your link works now.
        </p>
      ) : null}

      <section className="grid gap-3">
        <h2 className="text-xl font-extrabold tracking-[-.03em]">Recent activity</h2>

        {transfers.length === 0 ? (
          <p className="rounded-2xl border-[1.5px] border-beg-line p-5 text-[13px] text-beg-dim">
            Nothing yet. Share your link and the first send shows up here.
          </p>
        ) : (
          <ul className="grid gap-2">
            {transfers.map((t) => (
              <li
                key={`${t.tx_hash}-${t.log_index}`}
                className="flex items-center justify-between rounded-2xl border-[1.5px] border-beg-line bg-beg-card p-4 text-[13px]"
              >
                <span className="font-mono text-beg-dim">{shortAddress(t.from_address)}</span>
                <span className="font-bold text-beg-lime">{formatAmount(BigInt(t.amount))} $BEG</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border-[1.5px] border-beg-line bg-beg-card p-5">
      <div className="text-[13px] text-beg-dim">{label}</div>
      <div className="mt-1 text-[36px] font-extrabold tracking-[-.04em] text-beg-lime">{value}</div>
    </div>
  );
}
