import type { Metadata } from "next";
import Link from "next/link";

import { getLeaderboard, type LeaderRow } from "@/lib/leaderboard";
import { formatAmount } from "@/lib/erc20";
import { getWeeklyLeaders, weekBounds, battleMetric } from "@/lib/battles";
import { BattleCountdown } from "@/components/battle-countdown";

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
  searchParams: Promise<{ w?: string; m?: string }>;
}) {
  const { w, m } = await searchParams;
  const window = w === "week" ? "week" : "all";
  const metric = battleMetric(m);
  const { rows, dbFailed } = await getLeaderboard(25, window);
  const battle = await getWeeklyLeaders(10);

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

      {/*
        WEEKLY BEG BATTLES. The ranking is this week's confirmed receipts,
        Monday-UTC based, computed per request. The countdown resets with it.
      */}
      <section className="mt-8 card grid gap-3 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <b className="text-[17px]">This week's Beg Battle</b>
          <BattleCountdown endsAtIso={`${weekBounds()[1]}T00:00:00Z`} />
        </div>
        <p className="text-[12px] text-beg-dim">
          Confirmed receipts since Monday 00:00 UTC, ranked over real support —
          self-sends and program wallets don&apos;t count. The top 3 take the Top
          Beggar badge for the following week.
        </p>

        {/*
          THE THREE METRICS. All three are the same qualifying receipts read
          different ways: the sum invites whales, the distinct-sender count
          invites wash (many small self-spun sends), and the first-time count
          takes a NEW wallet every week, which wash finds hardest.
        */}
        <div className="flex flex-wrap gap-2">
          <Link
            href="/leaderboard?w=week"
            aria-current={metric === "received" ? "page" : undefined}
            className={`rounded-full border-[1.5px] px-3 py-1 text-[12px] font-bold ${
              metric === "received" ? "border-beg-ink bg-beg-lime text-beg-ink" : "border-beg-line text-beg-dim hover:text-beg-ink"
            }`}
          >
            Received
          </Link>
          <Link
            href="/leaderboard?w=week&m=sup"
            aria-current={metric === "supporters" ? "page" : undefined}
            className={`rounded-full border-[1.5px] px-3 py-1 text-[12px] font-bold ${
              metric === "supporters" ? "border-beg-ink bg-beg-lime text-beg-ink" : "border-beg-line text-beg-dim hover:text-beg-ink"
            }`}
          >
            Supporters
          </Link>
          <Link
            href="/leaderboard?w=week&m=new"
            aria-current={metric === "new" ? "page" : undefined}
            className={`rounded-full border-[1.5px] px-3 py-1 text-[12px] font-bold ${
              metric === "new" ? "border-beg-ink bg-beg-lime text-beg-ink" : "border-beg-line text-beg-dim hover:text-beg-ink"
            }`}
          >
            First-time
          </Link>
        </div>

        {battle.dbFailed ? (
          <p className="notice-dashed p-4">Couldn&apos;t read this week&apos;s battle just now. Try again in a moment.</p>
        ) : battle.rows.length === 0 ? (
          <p className="notice-dashed p-4">
            No confirmed $BEGFI has been received this week yet. The first send starts the battle.
          </p>
        ) : (
          <>
            <ol className="grid gap-2">
              {[...battle.rows]
                .sort((a, b) =>
                  metric === "received"
                    ? a.received > b.received
                      ? -1
                      : 1
                    : metric === "supporters"
                      ? b.supporters - a.supporters
                      : Math.max(0, b.newSupporters) - Math.max(0, a.newSupporters),
                )
                .slice(0, 3)
                .map((row, i) => (
                  <li key={row.username}>
                    <Link
                      href={`/${row.username}`}
                      className={`card-sm flex flex-wrap items-center justify-between gap-2 ${i === 0 ? "border-[3px] bg-beg-lime/20" : ""}`}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span
                          className={`grid size-7 shrink-0 place-items-center rounded-full border-2 border-beg-ink text-[12px] font-extrabold ${
                            i === 0 ? "bg-beg-yellow" : "bg-beg-lime"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span className="truncate font-bold text-beg-ink">@{row.username}</span>
                        {row.streakWeeks > 1 ? (
                          <span
                            title={`${row.streakWeeks} straight weeks with a confirmed receipt`}
                            className="rounded-full bg-beg-card px-2 py-0.5 text-[11px] font-bold text-beg-ink"
                          >
                            🔥 {row.streakWeeks}w
                          </span>
                        ) : null}
                      </span>
                      <span className="text-right font-extrabold text-beg-ink">
                        {metric === "received"
                          ? `${formatAmount(row.received)} $BEGFI`
                          : metric === "supporters"
                            ? `${row.supporters} ${row.supporters === 1 ? "supporter" : "supporters"}`
                            : row.newSupporters >= 0
                              ? `${row.newSupporters} ${row.newSupporters === 1 ? "first" : "first-time"}`
                              : "history unread"}
                        <span className="ml-2 font-mono text-[11px] text-beg-dim">
                          {metric === "received"
                            ? `${row.supporters} ${row.supporters === 1 ? "sender" : "senders"}`
                            : `${formatAmount(row.received)} $BEGFI`}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
            </ol>
            {metric !== "received" && battle.rows.some((r) => r.streakWeeks < 0) ? (
              <p className="text-[12px] text-beg-dim">The first-time and streak figures need the transfer history read, which is failing right now — count only what carries a number.</p>
            ) : null}
          </>
        )}
      </section>

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
