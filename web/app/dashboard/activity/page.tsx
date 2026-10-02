import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { shortAddress, txUrl } from "@/lib/chains";
import { formatAmount } from "@/lib/erc20";
import { getRecentTransfers } from "@/lib/queries";
import { requireProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

/**
 * Every transfer received, newest first.
 *
 * Readable because the RLS policy on `transfers` allows a row to the two
 * addresses involved and nobody else — so this shows the recipient their own
 * history and would show them nothing of anyone else's, even if the query were
 * pointed at another wallet.
 */
export default async function ActivityPage() {
  const profile = await requireProfile();
  const transfers = await getRecentTransfers(profile.wallet_address, 200);

  return (
    <div className="mx-auto max-w-[1000px] px-5">
      <SiteNav />
      <main className="grid gap-6 py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">Activity</h1>
          <Link href="/dashboard" className="text-[13px] text-beg-dim underline underline-offset-2">
            Back to dashboard
          </Link>
        </header>

        {transfers.length === 0 ? (
          <p className="rounded-2xl border-[1.5px] border-beg-line p-5 text-[13px] text-beg-dim">
            No transfers yet. This list is built from confirmed on-chain events, so it stays empty
            until something really arrives.
          </p>
        ) : (
          <ul className="grid gap-2">
            {transfers.map((t) => (
              <li
                key={`${t.tx_hash}-${t.log_index}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-[1.5px] border-beg-line bg-beg-card p-4 text-[13px]"
              >
                <span className="font-mono text-beg-dim">{shortAddress(t.from_address)}</span>
                <span className="text-beg-dim">{new Date(t.block_time).toLocaleString("en-GB")}</span>
                <span className="font-bold text-beg-lime">{formatAmount(BigInt(t.amount))} $BEG</span>
                <a
                  href={txUrl(t.tx_hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-beg-ink underline underline-offset-2"
                >
                  Explorer
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
