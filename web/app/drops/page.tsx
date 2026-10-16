import type { Metadata } from "next";
import Link from "next/link";

import { DropTile } from "@/components/drop-card";
import { getOpenDrops } from "@/lib/drops";

export const metadata: Metadata = {
  title: "Drops",
  description:
    "Live giveaways on BegFi: a pot of one token, a fixed prize, a cap on winners. Sign in, claim your prize, and it is paid straight to your wallet.",
};

export const dynamic = "force-dynamic";

/**
 * /drops — the giveaway shelf.
 *
 * PUBLIC, like every other door on this site: a giveaway that needs an account
 * to READ is a giveaway nobody shares. The list is the `open` drops newest
 * first, each with the two figures that matter — the prize and how many are
 * left — and nothing invented to fill the grid. When the database cannot be
 * read the page says so instead of rendering an empty shelf.
 */
export default async function DropsPage() {
  const { items, dbFailed } = await getOpenDrops(24, 12);

  return (
    <div className="safe-x mx-auto max-w-[1000px] py-10">
      <header className="max-w-[720px]">
        <h1 className="text-[clamp(32px,7vw,60px)] font-extrabold leading-[1] tracking-[-.04em]">
          Drops.
          <br />
          <span className="inline-block rounded-[18px] border-[3px] border-beg-ink bg-beg-lime px-[0.14em] text-beg-ink shadow-glow">
            First come, first paid.
          </span>
        </h1>
        <p className="mt-4 text-lg text-beg-dim">
          A project funds a pot, sets one prize, and the first people to claim get it — sent to their own wallet, automatically.
        </p>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="card-sm">
          <b className="text-[13px] text-beg-ink">1. Sign in, claim</b>
          <p className="mt-1 text-[12px] text-beg-dim">Your wallet claims the prize. One per wallet, and one per verified X account.</p>
        </div>
        <div className="card-sm">
          <b className="text-[13px] text-beg-ink">2. Paid automatically</b>
          <p className="mt-1 text-[12px] text-beg-dim">The prize is transferred on-chain within seconds of your claim. No forms, no approval queue.</p>
        </div>
        <div className="card-sm">
          <b className="text-[13px] text-beg-ink">3. Run your own</b>
          <p className="mt-1 text-[12px] text-beg-dim">
            Fund a pot and set the prize on{" "}
            <Link href="/dashboard/drops" className="underline underline-offset-2 hover:text-beg-ink">
              your dashboard
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-extrabold tracking-[-.03em]">Live drops</h2>
        {dbFailed ? (
          <p className="notice-dashed">Drops couldn&apos;t load right now — that&apos;s the database talking, check back in a moment.</p>
        ) : items.length === 0 ? (
          <p className="notice-dashed">
            No drops are live yet. Anyone can start one —{" "}
            <Link href="/dashboard/drops" className="underline underline-offset-2 hover:text-beg-ink">
              fund a pot
            </Link>{" "}
            and the first claimers get it.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <DropTile key={item.drop.id} drop={item.drop} stats={item.stats} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 notice">
        <b className="text-beg-ink">How the money works</b>
        <ul className="mt-2 grid list-disc gap-1 pl-5 text-[13px]">
          <li>A drop pays ONE fixed prize per claimer, in the token the owner funded — never a share of a budget.</li>
          <li>One prize per wallet per drop, and one per X-verified account, so two wallets from one person cannot take two.</li>
          <li>The pot is a ledger of confirmed deposits minus confirmed prizes: what the page shows is what the chain proves.</li>
          <li>Prizes are refused rather than queued when the pot cannot cover one — nobody is told yes and paid later, or never.</li>
        </ul>
      </section>
    </div>
  );
}
