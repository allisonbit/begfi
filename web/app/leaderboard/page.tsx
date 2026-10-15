import type { Metadata } from "next";
import Link from "next/link";

import { BattleCountdown } from "@/components/battle-countdown";
import {
  getLeaderboard,
  getSiteActivity,
  getTopEarners,
  getTopSupporters,
  type EarnerRow,
  type LeaderRow,
  type SiteActivityItem,
  type SupporterRow,
} from "@/lib/leaderboard";
import { getWeeklyLeaders, weekBounds, battleMetric } from "@/lib/battles";
import { formatAmount } from "@/lib/erc20";
import { txUrl } from "@/lib/chains";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Who earned, who begged, who supported — every ranking here is built from confirmed on-chain rows: automatic payouts, real transfers, no estimates. Plus a live feed of what is happening on the site right now.",
};

export const dynamic = "force-dynamic";

type TabKey = "earners" | "begged" | "supporters";

const TABS: { key: TabKey; href: string; label: string }[] = [
  { key: "earners", href: "/leaderboard", label: "Top Earners" },
  { key: "begged", href: "/leaderboard?tab=begged", label: "Top Begged" },
  { key: "supporters", href: "/leaderboard?tab=supporters", label: "Top Supporters" },
];

/**
 * /leaderboard — THE PUBLIC BOARD.
 *
 * TABS ARE RANKINGS, NOT SKINS: each tab has its own data shape, its own
 * truth, and its own empty state. Top Earners reads the payout ledger (money
 * the sweeps actually paid); Top Begged reads confirmed receipts; Top
 * Supporters reads confirmed outflow with self-sends purged. The Beg Battle
 * and the live activity feed stay on the page because a board people check
 * daily needs today's contest AND today's pulse, not only a static ranking.
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; w?: string; m?: string }>;
}) {
  const { tab, w, m } = await searchParams;
  const active: TabKey = tab === "begged" ? "begged" : tab === "supporters" ? "supporters" : "earners";
  const battleWindow = w === "all" ? "all" : "week";
  const metric = battleMetric(m);

  // One flight per tab key: the visible board fetches the ranking it SHOWS,
  // not all three. The battle + feed serve every view.
  const [earners, begged, supporters, battle, activity] = await Promise.all([
    active === "earners" ? getTopEarners(25) : Promise.resolve({ rows: [] as EarnerRow[], dbFailed: false }),
    active === "begged" ? getLeaderboard(25, battleWindow) : Promise.resolve({ rows: [] as LeaderRow[], dbFailed: false }),
    active === "supporters" ? getTopSupporters(25) : Promise.resolve({ rows: [] as SupporterRow[], dbFailed: false }),
    getWeeklyLeaders(10),
    getSiteActivity(22),
  ]);

  return (
    <div className="safe-x mx-auto max-w-[1000px] py-10">
      <header className="max-w-[720px]">
        <h1 className="text-[clamp(32px,7vw,64px)] font-extrabold leading-[1] tracking-[-.04em]">The board.</h1>
        <p className="mt-3 text-lg text-beg-dim">
          Earners, beggars and supporters — ranked by confirmed on-chain activity, with a live feed of the site&apos;s pulse.
        </p>
        <nav aria-label="Leaderboard sections" className="mt-5 inline-flex rounded-full border-2 border-beg-ink bg-beg-card p-1">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              aria-current={active === t.key ? "page" : undefined}
              className={`rounded-full px-4 py-2 text-[13px] font-bold transition-colors ${
                active === t.key ? "bg-beg-lime text-beg-ink shadow-glow" : "text-beg-dim hover:text-beg-ink"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* ---- Board, per tab */}
      <section className="mt-8 grid gap-2">
        {active === "earners" ? (
          <EarnersBoard rows={earners.rows} failed={earners.dbFailed} />
        ) : active === "begged" ? (
          <BeggedBoard rows={begged.rows} failed={begged.dbFailed} />
        ) : (
          <SupportersBoard rows={supporters.rows} failed={supporters.dbFailed} />
        )}
      </section>

      {/* ---- The Beg Battle — kept, it's the weekly contest */}
      <section className="mt-8 card grid gap-3 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <b className="text-[17px]">This week's Beg Battle</b>
          <BattleCountdown endsAtIso={`${weekBounds()[1]}T00:00:00Z`} />
        </div>
        <p className="text-[12px] text-beg-dim">
          Confirmed receipts since Monday 00:00 UTC, ranked over real support — self-sends don&apos;t count. The top 3 take the
          Top Beggar badge for the week.{" "}
          <Link href={"/leaderboard?w=week&m=received"} className="underline underline-offset-2">
            Work the window
          </Link>
          .
        </p>
        {battle.dbFailed ? (
          <p className="notice-dashed p-4">The battle board can&apos;t be read just now. Try again in a moment.</p>
        ) : (
          <BattleMini metric={metric} battle={battle.rows} />
        )}
      </section>

      {/* ---- LIVE SITE ACTIVITY */}
      <section className="mt-8">
        <h2 className="mb-1 text-xl font-extrabold tracking-[-.03em]">Live activity</h2>
        <p className="mb-3 text-[12px] text-beg-dim">Payouts, campaign earnings and $BEGFI movements — newest first, straight from confirmed rows.</p>
        {activity.dbFailed ? (
          <p className="notice-dashed">The feed can&apos;t be read just now. Everything here is confirmed data, so it waits rather than invents.</p>
        ) : activity.items.length === 0 ? (
          <p className="notice-dashed">
            Nothing has happened yet. It starts with the first payout or the first beg.
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {activity.items.map((item, i) => (
              <ActivityRow key={`${item.kind}-${item.at}-${i}`} item={item} />
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 max-w-[70ch] text-[12px] text-beg-dim">
        Every ranking comes from rows the site recorded on Robinhood Chain — payouts after receipts, transfers after
        confirmation. Campaign earnings live on their own campaign board too (in each campaign&apos;s token); this all-time board
        ranks $BEGFI earned from BegFi&apos;s own pool.
      </p>
    </div>
  );
}

/* ---- boards */

function RankShell({ i, children }: { i: number; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-full border-2 border-beg-ink text-[13px] font-extrabold ${
          i === 0 ? "bg-beg-yellow" : i < 3 ? "bg-beg-lime" : "bg-beg-card"
        }`}
      >
        {i + 1}
      </span>
      {children}
    </span>
  );
}

function EarnersBoard({ rows, failed }: { rows: EarnerRow[]; failed: boolean }) {
  if (failed) return <p className="notice-dashed">The earners board can&apos;t be read right now — that&apos;s the database, not an empty board.</p>;
  if (rows.length === 0)
    return (
      <p className="notice-dashed">
        No earnings have been paid yet. The{" "}
        <Link href="/earn" className="underline underline-offset-2 hover:text-beg-ink">
          Earn page
        </Link>{" "}
        is where the money starts moving.
      </p>
    );
  return rows.map((row, i) => (
    <BoardLink key={row.wallet_address} href={row.username ? `/${row.username}` : null} highlight={i === 0}>
      <RankShell i={i}>
        <span className="min-w-0 truncate font-bold text-beg-ink">{row.username ? `@${row.username}` : `${row.wallet_address.slice(0, 6)}…${row.wallet_address.slice(-4)}`}</span>
      </RankShell>
      <span className="text-right font-extrabold text-beg-ink">{formatAmount(BigInt(row.paid))} $BEGFI</span>
    </BoardLink>
  ));
}

function BeggedBoard({ rows, failed }: { rows: LeaderRow[]; failed: boolean }) {
  if (failed) return <p className="notice-dashed">The board can&apos;t be read right now — try again in a moment.</p>;
  if (rows.length === 0)
    return (
      <p className="notice-dashed">
        Nobody has been begged yet.{" "}
        <Link href="/begs" className="underline underline-offset-2 hover:text-beg-ink">
          Begs
        </Link>{" "}
        are the constructor of this board.
      </p>
    );
  return rows.map((row, i) => (
    <BoardLink key={row.username} href={`/${row.username}`} highlight={i === 0}>
      <RankShell i={i}>
        {row.avatar_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={row.avatar_url} alt="" className="size-7 rounded-full border-[1.5px] border-beg-line object-cover" />
        ) : null}
        <span className="min-w-0 truncate font-bold text-beg-ink">{row.username}</span>
      </RankShell>
      <span className="text-right font-extrabold text-beg-ink">
        {formatAmount(BigInt(row.total_received))} $BEGFI
        <span className="ml-2 text-[12px] font-normal text-beg-dim">
          {row.supporters} supporter{row.supporters === 1 ? "" : "s"}
        </span>
      </span>
    </BoardLink>
  ));
}

function SupportersBoard({ rows, failed }: { rows: SupporterRow[]; failed: boolean }) {
  if (failed) return <p className="notice-dashed">The supporters board can&apos;t be read right now — try again in a moment.</p>;
  if (rows.length === 0)
    return (
      <p className="notice-dashed">
        No one has supported anything yet. Sending $BEGFI to another wallet is literally all this board asks — self-sends
        don&apos;t count and never will.
      </p>
    );
  return rows.map((row, i) => (
    <BoardLink key={row.wallet_address} href={row.username ? `/${row.username}` : null} highlight={i === 0}>
      <RankShell i={i}>
        {row.avatar_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={row.avatar_url} alt="" className="size-7 rounded-full border-[1.5px] border-beg-line object-cover" />
        ) : null}
        <span className="min-w-0 truncate font-bold text-beg-ink">{row.username ? `@${row.username}` : `${row.wallet_address.slice(0, 6)}…${row.wallet_address.slice(-4)}`}</span>
      </RankShell>
      <span className="text-right font-extrabold text-beg-ink">
        {formatAmount(BigInt(row.given))} $BEGFI
        <span className="ml-2 text-[12px] font-normal text-beg-dim">
          {row.recipients} {row.recipients === 1 ? "wallet" : "wallets"} helped
        </span>
      </span>
    </BoardLink>
  ));
}

function BoardLink({ href, highlight, children }: { href: string | null; highlight: boolean; children: React.ReactNode }) {
  const inner = (
    <div className={`card-sm flex flex-wrap items-center justify-between gap-3 ${highlight ? "border-[3px] bg-beg-lime/20" : ""}`}>{children}</div>
  );
  return <li>{href ? <Link href={href} className="with-hover">{inner}</Link> : inner}</li>;
}

/* ---- battle mini + feed */

function BattleMini({
  metric,
  battle,
}: {
  metric: ReturnType<typeof battleMetric>;
  battle: Awaited<ReturnType<typeof getWeeklyLeaders>>["rows"];
}) {
  if (battle.length === 0)
    return <p className="notice-dashed p-4">No confirmed $BEGFI received this week yet. The first send starts the battle.</p>;
  const sorted = [...battle]
    .sort((a, b) =>
      metric === "received" ? (a.received > b.received ? -1 : 1) : metric === "supporters" ? b.supporters - a.supporters : Math.max(0, b.newSupporters) - Math.max(0, a.newSupporters),
    )
    .slice(0, 3);
  return (
    <ol className="grid gap-2">
      {sorted.map((row, i) => (
        <li key={row.username}>
          <Link href={`/${row.username}`} className="card-sm flex flex-wrap items-center justify-between gap-2">
            <RankShell i={i}>
              <span className="truncate font-bold text-beg-ink">@{row.username}</span>
              {row.streakWeeks > 1 ? <span className="rounded-full bg-beg-card px-2 py-0.5 text-[11px] font-bold text-beg-ink">🔥 {row.streakWeeks}w</span> : null}
            </RankShell>
            <span className="font-extrabold text-beg-ink">{formatAmount(row.received)} $BEGFI</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function ActivityRow({ item }: { item: SiteActivityItem }) {
  const badgeBg = item.kind === "campaign_payout" ? "bg-beg-yellow" : item.kind === "payout" ? "bg-beg-lime" : "bg-beg-card";
  const label = item.kind === "campaign_payout" ? "Campaign" : item.kind === "payout" ? "BegFi earn" : "Transfer";
  return (
    <li className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]">
      <span className="flex min-w-0 items-center gap-2">
        <span className={`shrink-0 rounded-md border-2 border-beg-ink ${badgeBg} px-1.5 py-0.5 text-[10px] font-extrabold text-beg-ink`}>{label}</span>
        <span className="min-w-0 truncate text-beg-ink">{item.text}</span>
        {item.href ? (
          <Link href={item.href} className="shrink-0 text-[12px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
            ↗
          </Link>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <span className="text-[11px] text-beg-dim">{new Date(item.at).toLocaleString("en-GB")}</span>
        {item.tx ? (
          <a href={txUrl(item.tx)} target="_blank" rel="noreferrer" className="text-[12px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
            Explorer
          </a>
        ) : null}
      </span>
    </li>
  );
}
