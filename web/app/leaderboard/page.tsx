import type { Metadata } from "next";
import Link from "next/link";

import { getLeaderboard, type LeaderRow } from "@/lib/leaderboard";
import { formatAmount } from "@/lib/erc20";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "The wallets $BEGFI actually reached, ranked by confirmed on-chain receipts. Weekly and all-time. Every figure is a transfer the indexer has recorded — nothing is estimated.",
};

export const dynamic = "force-dynamic";

/**
 * /leaderboard — who $BEGFI actually reached, in two time slices.
 *
 * TABS ARE WINDOWS, NOT LIES. `All time` ranks what the chain says ever
 * arrived; `This week` sums confirmed transfers since (-7 days) fresh per
 * request. The window is on every row, so a number is never ambiguous about
 * what period it claims — the mistake that makes leaderboards feel rigged.
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  const { w } = await searchParams;
  const window = w === "week" ? "week" : "all";
  const { rows, dbFailed } = await getLeaderboard(25, window);

  const emptyCopy =
    window === "week"
      ? "No confirmed $BEGFI moved to a visible profile this week. The board fills the moment the first transfer confirms."
      : "Nobody has received $BEGFI yet. The first confirmed send starts the board.";

  return (
    <div className="safe-x mx-auto max-w-[1000px] py-10">
      <header className="max-w-[700px]">
        <h1 className="text-[clamp(32px,7vw,64px)] font-extrabold leading-[1] tracking-[-.04em]">
          The board.
        </h1>
        <p className="mt-3 text-lg text-beg-dim">
          Who $BEGFI actually reached — ranked by confirmed on-chain receipts.
        </p>
        <div className="mt-5 inline-flex rounded-full border-2 border-beg-ink bg-beg-card p-1">
          <Link
            href="/leaderboard"
            aria-current={window === "all" ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-[13px] font-bold transition-colors ${
              window === "all" ? "bg-beg-lime text-beg-ink shadow-glow" : "text-beg-dim hover:text-beg-ink"
            }`}
          >
            All time
          </Link>
          <Link
            href="/leaderboard?w=week"
            aria-current={window === "week" ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-[13px] font-bold transition-colors ${
              window === "week" ? "bg-beg-lime text-beg-ink shadow-glow" : "text-beg-dim hover:text-beg-ink"
            }`}
          >
            This week
          </Link>
        </div>
      </header>

      {dbFailed ? (
        <p className="notice-dashed mt-8">
          Couldn&apos;t read the board just now. That&apos;s the database, not an empty board. Try again in a moment.
        </p>
      ) : rows.length === 0 ? (
        <p className="notice-dashed mt-8">
          {emptyCopy}{" "}
          <Link href="/earn" className="underline underline-offset-2 hover:text-beg-ink">
            Earn some
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
                    {supportersCopy(row, window)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-6 max-w-[70ch] text-[12px] text-beg-dim">
        Ranks come from confirmed transfers the indexer recorded on Robinhood Chain — the same
        totals shown on every profile. {window === "week" ? "This week = the last 7 days, UTC." : "All time = everything the indexer has on file."}{" "}
        Earnings from the pool and begs are both receipts; the chain does not distinguish and
        neither does this board.
      </p>
    </div>
  );
}

/**
 * The supporter line, worded for the window. A weekly row counts senders
 * within the week — a wallet could have had fifty supporters all time and
 * three this week, and the row must not blur those.
 */
function supportersCopy(row: LeaderRow, window: "all" | "week"): string {
  if (window === "week") {
    const n = row.windowSupporters ?? row.supporters;
    return n === 1 ? "1 sender this week" : `${n} senders this week`;
  }
  return row.supporters === 1 ? "1 supporter" : `${row.supporters} supporters`;
}
