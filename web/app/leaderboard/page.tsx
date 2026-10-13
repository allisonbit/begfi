import type { Metadata } from "next";
import Link from "next/link";

import { getLeaderboard } from "@/lib/leaderboard";
import { formatAmount } from "@/lib/erc20";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "The wallets $BEGFI actually reached, ranked by confirmed on-chain receipts. Every figure is a transfer the indexer has recorded — nothing is estimated.",
};

export const dynamic = "force-dynamic";

/**
 * /leaderboard — who $BEGFI actually reached.
 *
 * ONE FACT PER ROW, VERIFIABLE BY ANYONE. A rank is the wallet's confirmed
 * receipts, from the same `profile_stats` view the public profiles show, so
 * the leaderboard and `/username` can never disagree about the same wallet.
 * It ranks receiving, not claiming: what the chain says arrived, not what
 * someone said they would earn.
 *
 * The empty state is a real state — a young pool may not have paid anyone
 * yet — and it says that rather than inventing tiers or placeholders.
 */
export default async function LeaderboardPage() {
  const { rows, dbFailed } = await getLeaderboard(25);

  return (
    <div className="safe-x mx-auto max-w-[1000px] py-10">
      <header className="max-w-[700px]">
        <h1 className="text-[clamp(32px,7vw,64px)] font-extrabold leading-[1] tracking-[-.04em]">
          The board.
          <span aria-hidden className="caret" />
        </h1>
        <p className="mt-3 text-lg text-beg-dim">
          Who $BEGFI actually reached — ranked by confirmed on-chain receipts, supporters second.
        </p>
      </header>

      {dbFailed ? (
        <p className="notice-dashed mt-8">
          Couldn&apos;t read the board just now. That&apos;s the database, not an empty board. Try again in a moment.
        </p>
      ) : rows.length === 0 ? (
        <p className="notice-dashed mt-8">
          Nobody has received $BEGFI yet. The first confirmed send starts the board —{" "}
          <Link href="/earn" className="underline underline-offset-2 hover:text-beg-ink">
            earn some
          </Link>{" "}
          or{" "}
          <Link href="/begs" className="underline underline-offset-2 hover:text-beg-ink">
            beg some
          </Link>
          .
        </p>
      ) : (
        <ol className="mt-8 grid gap-2">
          {rows.map((row, i) => (
            <li key={row.username}>
              <Link
                href={`/${row.username}`}
                className={`card-hover card-sm flex flex-wrap items-center justify-between gap-3 ${
                  i === 0 ? "border-[3px] bg-beg-lime/20" : ""
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-full border-2 border-beg-ink text-[13px] font-extrabold ${
                      i === 0 ? "bg-beg-yellow" : i < 3 ? "bg-beg-lime" : "bg-beg-card"
                    }`}
                  >
                    {i + 1}
                  </span>
                  {row.avatar_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={row.avatar_url} alt="" className="size-8 rounded-full border-[1.5px] border-beg-line object-cover" />
                  ) : null}
                  <span className="min-w-0 truncate font-bold text-beg-ink">
                    {row.display_name ?? `@${row.username}`}
                  </span>
                  <span className="hidden text-[13px] text-beg-dim sm:inline">@{row.username}</span>
                </div>
                <div className="text-right">
                  <span className="font-extrabold text-beg-ink">{formatAmount(BigInt(row.total_received))} $BEGFI</span>
                  <span className="ml-2 text-[12px] text-beg-dim">
                    {row.supporters === 1 ? "1 supporter" : `${row.supporters} supporters`}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-6 max-w-[70ch] text-[12px] text-beg-dim">
        Ranks come from confirmed transfers the indexer recorded on Robinhood Chain — the same
        totals shown on every profile. Earnings from the pool and begs are both receipts; the
        chain does not distinguish and neither does this board.
      </p>
    </div>
  );
}
