import type { Metadata } from "next";
import Link from "next/link";
import { ageWords, compactAmount } from "@/lib/format";
import { getActiveLaunchBegs } from "@/lib/launch-begs";

export const metadata: Metadata = {
  title: "Begs to launch",
  description: "Open asks: tokens people are begging support to launch on BegFi.",
};
export const revalidate = 20;

/**
 * The index of open launch begs.
 *
 * Raised figures are computed client-side of this page's render — the sum of
 * confirmed transfers each creator has received since their ask opened — and
 * the page says the boundary in plain words, so a figure can never be confused
 * with "everything this wallet ever received".
 *
 * Creates-and-forgets the honest failure modes: an unhealthy read renders the
 * error notice, an empty healthy list renders the empty state, and neither is
 * allowed to look like the other.
 */
export default async function BegsToLaunchPage() {
  const { items, dbFailed } = await getActiveLaunchBegs();

  return (
    <div className="safe-x mx-auto grid max-w-[1000px] gap-6 py-8">
      <header>
        <h1 className="text-[clamp(32px,7vw,48px)] font-extrabold tracking-[-.05em]">Begs to launch</h1>
        <p className="mt-1 max-w-[62ch] text-beg-dim">
          Open asks. Send $BEG to the creator&apos;s wallet to back one; BegFi never holds the
          money. Every figure here is confirmed transfers since that ask opened.
        </p>
      </header>

      {dbFailed ? (
        <p className="notice-dashed p-5">
          Couldn&apos;t read the open asks just now. This is a database problem, not an empty
          list. Try again in a moment.
        </p>
      ) : items.length === 0 ? (
        <p className="notice-dashed p-5">
          No open begs to launch right now. Anyone with a claimed username can open one from
          their dashboard; the ask appears here the moment it exists.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((b) => (
            <li key={b.id}>
              <Link href={`/beg-to-launch/${b.id}`} className="card-hover card-sm block h-full">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[16px] font-extrabold text-beg-ink">
                    {b.token_name}
                  </span>
                  <span className="rounded-full border-2 border-beg-ink bg-beg-lime px-2 py-0.5 text-[10px] font-bold text-beg-ink">
                    ${b.token_ticker}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] text-beg-dim">{b.one_liner}</p>
                <p className="mt-2 text-[12px] text-beg-dim">
                  by @{b.username} · goal {compactAmount(Number(BigInt(b.goal) / 10n ** 12n))} $BEG ·
                  opened {ageWords(b.created_at)} ago
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="notice">
        Supporting a launch beg is sending tokens to the person who opened it — the same kind of
        transaction as any send on this site. It is not a purchase, the future token is not owed,
        and nothing here is financial advice.
      </p>
    </div>
  );
}
