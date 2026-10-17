import type { Metadata } from "next";
import Link from "next/link";

import { BattleCountdown } from "@/components/battle-countdown";
import {
  getMostActive,
  getSiteActivity,
  getTopBegged,
  getTopCampaigns,
  getTopEarners,
  getTopGivers,
  getTopHolders,
  getTopSupporters,
  LEADER_WINDOWS,
  parseWindow,
  type ActiveRow,
  type BeggedRow,
  type CampaignLeaderRow,
  type EarnerRow,
  type GiverRow,
  type HolderRow,
  type HolderSummary,
  type LeaderWindow,
  type SiteActivityItem,
  type SupporterRow,
} from "@/lib/leaderboard";
import { getWeeklyLeaders, weekBounds, battleMetric } from "@/lib/battles";
import { formatAmount } from "@/lib/erc20";
import { txUrl } from "@/lib/chains";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Seven boards built from confirmed on-chain rows: top earners, top begged, top supporters, top givers, most active, top campaigns and the token's largest holders. Filter by the last 24 hours, this week or all time.",
};

export const dynamic = "force-dynamic";

type TabKey = "earners" | "begged" | "supporters" | "givers" | "active" | "campaigns" | "holders";

const TABS: { key: TabKey; label: string; blurb: string; windowed: boolean }[] = [
  { key: "earners", label: "Top earners", blurb: "Paid out automatically by BegFi's own pool, in $BEGFI.", windowed: true },
  { key: "begged", label: "Top begged", blurb: "Confirmed support received. Payout and fee wallets don't count.", windowed: true },
  { key: "supporters", label: "Top supporters", blurb: "Sent to somebody else. Self-sends are purged.", windowed: true },
  { key: "givers", label: "Top givers", blurb: "Funded the pools other people earn and claim from. Ranked by pools funded, not by a sum across tokens.", windowed: true },
  { key: "active", label: "Most active", blurb: "Begs posted, pay links made, campaigns entered, drops claimed.", windowed: true },
  { key: "campaigns", label: "Campaigns", blurb: "Ranked by people paid, each total in its own token.", windowed: true },
  { key: "holders", label: "Holders", blurb: "The token's largest balances, read from the chain's explorer.", windowed: false },
];

type Viewer = { username: string; wallet: string } | null;

function isTab(value: string | undefined): value is TabKey {
  return TABS.some((t) => t.key === value);
}

/** A quiet marker on the signed-in visitor's own row, rendered on the server. */
function YouBadge({ viewer, username, wallet }: { viewer: Viewer; username: string | null; wallet?: string }) {
  if (!viewer) return null;
  const mine = (username !== null && username === viewer.username) || (wallet !== undefined && wallet === viewer.wallet);
  if (!mine) return null;
  return (
    <span className="shrink-0 rounded-full bg-beg-ink px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-beg-bg">
      you
    </span>
  );
}

function hrefFor(tab: TabKey, window: LeaderWindow): string {
  const params = new URLSearchParams({ tab });
  if (window !== "all") params.set("w", window);
  return `/leaderboard?${params.toString()}`;
}

/**
 * /leaderboard — THE PUBLIC BOARDS.
 *
 * TABS ARE RANKINGS, NOT SKINS: each tab has its own data shape, its own
 * source and its own empty state. Every money number comes from a confirmed
 * row — a `sent` payout in the ledger the sweeps wrote, or a transfer the
 * indexer recorded — and every tab says where its number comes from, because a
 * leaderboard that cannot name its source is a rumour with a table around it.
 *
 * THE WINDOW IS THE SECOND AXIS, not a decoration. "Top earner today" and
 * "top earner all time" are different races and both are worth watching: the
 * first makes the board worth checking, the second is the record. Holders has
 * no window because a balance is a snapshot, not a race.
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; w?: string; m?: string }>;
}) {
  const { tab, w, m } = await searchParams;
  const active: TabKey = isTab(tab) ? tab : "earners";
  const window = parseWindow(w);
  const metric = battleMetric(m);
  const current = TABS.find((t) => t.key === active)!;
  const profile = await getProfile();
  const viewer = profile ? { username: profile.username, wallet: profile.wallet_address.toLowerCase() } : null;

  // One flight per tab: the visible board fetches the ranking it SHOWS, not
  // all six. The battle and the feed serve every view.
  const [earners, begged, supporters, givers, activeRows, campaigns, holders, battle, activity] = await Promise.all([
    active === "earners" ? getTopEarners(25, window) : Promise.resolve({ rows: [] as EarnerRow[], dbFailed: false }),
    active === "begged" ? getTopBegged(25, window) : Promise.resolve({ rows: [] as BeggedRow[], dbFailed: false }),
    active === "supporters" ? getTopSupporters(25, window) : Promise.resolve({ rows: [] as SupporterRow[], dbFailed: false }),
    active === "givers" ? getTopGivers(25, window) : Promise.resolve({ rows: [] as GiverRow[], dbFailed: false }),
    active === "active" ? getMostActive(25, window) : Promise.resolve({ rows: [] as ActiveRow[], dbFailed: false }),
    active === "campaigns" ? getTopCampaigns(25, window) : Promise.resolve({ rows: [] as CampaignLeaderRow[], dbFailed: false }),
    active === "holders"
      ? getTopHolders(25)
      : Promise.resolve({ rows: [] as HolderRow[], dbFailed: false, summary: null as HolderSummary | null }),
    getWeeklyLeaders(10),
    getSiteActivity(22),
  ]);

  return (
    <div className="safe-x mx-auto max-w-[1000px] py-10">
      <header className="max-w-[760px]">
        <h1 className="text-[clamp(32px,7vw,64px)] font-extrabold leading-[1] tracking-[-.04em]">The board.</h1>
        <p className="mt-3 text-lg text-beg-dim">
          Seven rankings, every one of them a read of confirmed rows. Pick a board, then pick a window.
        </p>
      </header>

      <nav aria-label="Leaderboard boards" className="mt-5 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={hrefFor(t.key, window)}
            aria-current={active === t.key ? "page" : undefined}
            className={`rounded-full border-2 border-beg-ink px-3.5 py-2 text-[13px] font-bold transition-colors ${
              active === t.key ? "bg-beg-lime text-beg-ink shadow-glow" : "bg-beg-card text-beg-dim hover:text-beg-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-[13px] text-beg-dim">{current.blurb}</p>
        {current.windowed ? (
          <nav aria-label="Leaderboard window" className="inline-flex rounded-full border-2 border-beg-line bg-beg-card p-1">
            {LEADER_WINDOWS.map((win) => {
              const on = window === win.key;
              return (
                <Link
                  key={win.key}
                  href={hrefFor(active, win.key)}
                  aria-current={on ? "page" : undefined}
                  className={`rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors ${
                    on ? "bg-beg-ink text-beg-bg" : "text-beg-dim hover:text-beg-ink"
                  }`}
                >
                  {win.label}
                </Link>
              );
            })}
          </nav>
        ) : (
          <span className="rounded-full border-2 border-beg-line px-3 py-1.5 text-[12px] font-bold text-beg-dim">
            Live snapshot
          </span>
        )}
      </div>

      <section className="mt-5 grid gap-2">
        {active === "earners" ? (
          <EarnersBoard rows={earners.rows} failed={earners.dbFailed} window={window} viewer={viewer} />
        ) : active === "begged" ? (
          <BeggedBoard rows={begged.rows} failed={begged.dbFailed} window={window} viewer={viewer} />
        ) : active === "supporters" ? (
          <SupportersBoard rows={supporters.rows} failed={supporters.dbFailed} window={window} viewer={viewer} />
        ) : active === "givers" ? (
          <GiversBoard rows={givers.rows} failed={givers.dbFailed} window={window} viewer={viewer} />
        ) : active === "active" ? (
          <ActiveBoard rows={activeRows.rows} failed={activeRows.dbFailed} window={window} viewer={viewer} />
        ) : active === "campaigns" ? (
          <CampaignsBoard rows={campaigns.rows} failed={campaigns.dbFailed} window={window} />
        ) : (
          <HoldersBoard rows={holders.rows} failed={holders.dbFailed} summary={holders.summary} viewer={viewer} />
        )}
      </section>

      {/* ---- The Beg Battle — the weekly contest, on every view */}
      <section className="mt-8 card grid gap-3 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <b className="text-[17px]">This week&apos;s Beg Battle</b>
          <BattleCountdown endsAtIso={`${weekBounds()[1]}T00:00:00Z`} />
        </div>
        <p className="text-[12px] text-beg-dim">
          Confirmed receipts since Monday 00:00 UTC, ranked over real support — self-sends and payout wallets don&apos;t
          count. The top 3 take the Top Beggar badge for the week.{" "}
          <Link href={hrefFor("begged", "week")} className="underline underline-offset-2">
            See the week
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
        <p className="mb-3 text-[12px] text-beg-dim">
          Payouts, campaign earnings and $BEGFI movements — newest first, straight from confirmed rows.
        </p>
        {activity.dbFailed ? (
          <p className="notice-dashed">
            The feed can&apos;t be read just now. Everything here is confirmed data, so it waits rather than invents.
          </p>
        ) : activity.items.length === 0 ? (
          <p className="notice-dashed">Nothing has happened yet. It starts with the first payout or the first beg.</p>
        ) : (
          <ul className="grid gap-1.5">
            {activity.items.map((item, i) => (
              <ActivityRow key={`${item.kind}-${item.at}-${i}`} item={item} />
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 max-w-[74ch] text-[12px] text-beg-dim">
        Every ranking comes from rows the site recorded on Robinhood Chain — payouts after receipts, transfers after
        confirmation. Campaign totals are kept in each campaign&apos;s own token and never added together, because two
        tokens do not share a unit. Holder balances come from the chain&apos;s explorer, not from this site&apos;s index.
      </p>
    </div>
  );
}

/* ---- shell */

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

function BoardLink({ href, highlight, children }: { href: string | null; highlight: boolean; children: React.ReactNode }) {
  const inner = (
    <div className={`card-sm flex flex-wrap items-center justify-between gap-3 ${highlight ? "border-[3px] bg-beg-lime/20" : ""}`}>
      {children}
    </div>
  );
  return <li>{href ? <Link href={href} className="with-hover">{inner}</Link> : inner}</li>;
}

function Avatar({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img src={url} alt="" className="size-7 rounded-full border-[1.5px] border-beg-line object-cover" />
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="notice-dashed">{children}</p>;
}

function windowWord(window: LeaderWindow): string {
  return window === "day" ? "in the last 24 hours" : window === "week" ? "this week" : "all time";
}

/* ---- boards */

function EarnersBoard({ rows, failed, window, viewer }: { rows: EarnerRow[]; failed: boolean; window: LeaderWindow; viewer: Viewer }) {
  if (failed) return <Empty>The earners board can&apos;t be read right now — that&apos;s the database, not an empty board.</Empty>;
  if (rows.length === 0)
    return (
      <Empty>
        Nothing has been paid automatically {windowWord(window)}.{" "}
        <Link href="/earn" className="underline underline-offset-2 hover:text-beg-ink">
          Earn
        </Link>{" "}
        is where the money starts moving.
      </Empty>
    );
  return (
    <ul className="grid gap-2">
      {rows.map((row, i) => (
        <BoardLink key={row.wallet_address} href={row.username ? `/${row.username}` : null} highlight={i === 0}>
          <RankShell i={i}>
            <Avatar url={row.avatar_url} />
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-bold text-beg-ink">
                {row.username ? `@${row.username}` : `${row.wallet_address.slice(0, 6)}…${row.wallet_address.slice(-4)}`}
              </span>
              <YouBadge viewer={viewer} username={row.username} wallet={row.wallet_address} />
            </span>
          </RankShell>
          <span className="text-right font-extrabold text-beg-ink">
            {formatAmount(BigInt(row.paid))} $BEGFI
            <span className="mt-0.5 block text-[12px] font-normal text-beg-dim">
              {row.payouts} payout{row.payouts === 1 ? "" : "s"}
            </span>
          </span>
        </BoardLink>
      ))}
    </ul>
  );
}

function BeggedBoard({ rows, failed, window, viewer }: { rows: BeggedRow[]; failed: boolean; window: LeaderWindow; viewer: Viewer }) {
  if (failed) return <Empty>The board can&apos;t be read right now — try again in a moment.</Empty>;
  if (rows.length === 0)
    return (
      <Empty>
        Nobody has been begged {windowWord(window)}.{" "}
        <Link href="/begs" className="underline underline-offset-2 hover:text-beg-ink">
          Begs
        </Link>{" "}
        are the constructor of this board.
      </Empty>
    );
  return (
    <ul className="grid gap-2">
      {rows.map((row, i) => (
        <BoardLink key={row.username} href={`/${row.username}`} highlight={i === 0}>
          <RankShell i={i}>
            <Avatar url={row.avatar_url} />
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-bold text-beg-ink">@{row.username}</span>
              <YouBadge viewer={viewer} username={row.username} wallet={row.wallet_address} />
            </span>
          </RankShell>
          <span className="text-right font-extrabold text-beg-ink">
            {formatAmount(BigInt(row.received))} $BEGFI
            <span className="mt-0.5 block text-[12px] font-normal text-beg-dim">
              {row.supporters} supporter{row.supporters === 1 ? "" : "s"}
            </span>
          </span>
        </BoardLink>
      ))}
    </ul>
  );
}

function SupportersBoard({ rows, failed, window, viewer }: { rows: SupporterRow[]; failed: boolean; window: LeaderWindow; viewer: Viewer }) {
  if (failed) return <Empty>The supporters board can&apos;t be read right now — try again in a moment.</Empty>;
  if (rows.length === 0)
    return (
      <Empty>
        No one has supported anything {windowWord(window)}. Sending $BEGFI to another wallet is literally all this board
        asks — self-sends don&apos;t count and never will.
      </Empty>
    );
  return (
    <ul className="grid gap-2">
      {rows.map((row, i) => (
        <BoardLink key={row.wallet_address} href={row.username ? `/${row.username}` : null} highlight={i === 0}>
          <RankShell i={i}>
            <Avatar url={row.avatar_url} />
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-bold text-beg-ink">
                {row.username ? `@${row.username}` : `${row.wallet_address.slice(0, 6)}…${row.wallet_address.slice(-4)}`}
              </span>
              <YouBadge viewer={viewer} username={row.username} wallet={row.wallet_address} />
            </span>
          </RankShell>
          <span className="text-right font-extrabold text-beg-ink">
            {formatAmount(BigInt(row.given))} $BEGFI
            <span className="mt-0.5 block text-[12px] font-normal text-beg-dim">
              {row.recipients} {row.recipients === 1 ? "wallet" : "wallets"} helped
            </span>
          </span>
        </BoardLink>
      ))}
    </ul>
  );
}

function GiversBoard({ rows, failed, window, viewer }: { rows: GiverRow[]; failed: boolean; window: LeaderWindow; viewer: Viewer }) {
  if (failed) return <Empty>The givers board can&apos;t be read right now — try again in a moment.</Empty>;
  if (rows.length === 0)
    return (
      <Empty>
        No one has funded a pool {windowWord(window)}.{" "}
        <Link href="/drops" className="underline underline-offset-2 hover:text-beg-ink">
          Create a drop
        </Link>{" "}
        or{" "}
        <Link href="/dashboard/campaigns" className="underline underline-offset-2 hover:text-beg-ink">
          fund a campaign
        </Link>{" "}
        and this board has its first name.
      </Empty>
    );
  return (
    <ul className="grid gap-2">
      {rows.map((row, i) => (
        <BoardLink key={row.wallet_address} href={row.username ? `/${row.username}` : null} highlight={i === 0}>
          <RankShell i={i}>
            <Avatar url={row.avatar_url} />
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-bold text-beg-ink">
                {row.username ? `@${row.username}` : `${row.wallet_address.slice(0, 6)}…${row.wallet_address.slice(-4)}`}
              </span>
              <YouBadge viewer={viewer} username={row.username} wallet={row.wallet_address} />
            </span>
          </RankShell>
          <span className="text-right font-extrabold text-beg-ink">
            {row.pools} pool{row.pools === 1 ? "" : "s"} funded
            <span className="mt-0.5 block text-[12px] font-normal text-beg-dim">
              {[
                row.campaigns ? `${row.campaigns} campaign${row.campaigns === 1 ? "" : "s"}` : null,
                row.drops ? `${row.drops} drop${row.drops === 1 ? "" : "s"}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </BoardLink>
      ))}
    </ul>
  );
}

function ActiveBoard({ rows, failed, window, viewer }: { rows: ActiveRow[]; failed: boolean; window: LeaderWindow; viewer: Viewer }) {
  if (failed) return <Empty>The activity board can&apos;t be read right now — try again in a moment.</Empty>;
  if (rows.length === 0)
    return (
      <Empty>
        Nobody has posted, asked or claimed {windowWord(window)}. That is a real empty room, not a broken board.
      </Empty>
    );
  return (
    <ul className="grid gap-2">
      {rows.map((row, i) => (
        <BoardLink key={row.profile_id} href={`/${row.username}`} highlight={i === 0}>
          <RankShell i={i}>
            <Avatar url={row.avatar_url} />
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-bold text-beg-ink">@{row.username}</span>
              <YouBadge viewer={viewer} username={row.username} />
            </span>
          </RankShell>
          <span className="text-right text-[12px] text-beg-dim">
            <span className="block font-extrabold text-beg-ink">{row.total} action{row.total === 1 ? "" : "s"}</span>
            <span className="mt-0.5 block">
              {[
                row.begs ? `${row.begs} beg${row.begs === 1 ? "" : "s"}` : null,
                row.pay_links ? `${row.pay_links} link${row.pay_links === 1 ? "" : "s"}` : null,
                row.campaign_posts ? `${row.campaign_posts} campaign post${row.campaign_posts === 1 ? "" : "s"}` : null,
                row.drop_claims ? `${row.drop_claims} drop${row.drop_claims === 1 ? "" : "s"}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </BoardLink>
      ))}
    </ul>
  );
}

function CampaignsBoard({ rows, failed, window }: { rows: CampaignLeaderRow[]; failed: boolean; window: LeaderWindow }) {
  if (failed) return <Empty>The campaigns board can&apos;t be read right now — try again in a moment.</Empty>;
  if (rows.length === 0)
    return (
      <Empty>
        No campaign has paid anybody {windowWord(window)}.{" "}
        <Link href="/earn" className="underline underline-offset-2 hover:text-beg-ink">
          Open Earn
        </Link>{" "}
        to see the ones taking entries now.
      </Empty>
    );
  return (
    <ul className="grid gap-2">
      {rows.map((row, i) => (
        <BoardLink key={row.id} href={`/earn/${row.slug}`} highlight={i === 0}>
          <RankShell i={i}>
            <Avatar url={row.logo_url} />
            <span className="min-w-0">
              <span className="block truncate font-bold text-beg-ink">{row.name}</span>
              <span className="text-[11px] text-beg-dim">{row.earners} earner{row.earners === 1 ? "" : "s"} paid</span>
            </span>
          </RankShell>
          <span className="text-right font-extrabold text-beg-ink">
            {formatAmount(BigInt(row.paid), row.token_decimals)} {row.token_symbol}
            <span className="mt-0.5 block text-[12px] font-normal text-beg-dim">
              {row.payouts} payout{row.payouts === 1 ? "" : "s"}
            </span>
          </span>
        </BoardLink>
      ))}
    </ul>
  );
}

function HoldersBoard({
  rows,
  failed,
  summary,
  viewer,
}: {
  rows: HolderRow[];
  failed: boolean;
  summary: HolderSummary | null;
  viewer: Viewer;
}) {
  /*
   * The explorer is the only source that NAMES holders, and it sits behind a
   * bot challenge that does not answer every network. When it is silent the
   * market feed still knows the count and the concentration, so the tab shows
   * that and says which question each number answers. What it never does is
   * print an empty list as "no holders".
   */
  if (failed && !summary)
    return (
      <Empty>
        Neither the explorer nor the market feed answered, so there is no holder number to show. This board reads the
        chain, not a cached figure — try again in a minute rather than trusting an empty list.
      </Empty>
    );

  const summaryCard = summary ? (
    <div className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px] text-beg-dim">
      <span>
        <b className="text-beg-ink">{summary.count.toLocaleString("en-GB")}</b> holders
        {summary.top10Pct ? <> · top 10 hold <b className="text-beg-ink">{summary.top10Pct}%</b></> : null}
      </span>
      <span className="text-[11px]">
        {summary.asOf ? `Feed as of ${new Date(summary.asOf).toLocaleString("en-GB")}` : "Live holder count"}
      </span>
    </div>
  ) : null;

  if (rows.length === 0)
    return (
      <div className="grid gap-2">
        {summaryCard}
        <Empty>
          The explorer didn&apos;t answer with a named list, so the count and concentration above are what is verifiable
          right now. The largest accounts are worth checking directly on the explorer.
        </Empty>
      </div>
    );

  return (
    <div className="grid gap-2">
      {summaryCard}
      <ul className="grid gap-2">
      {rows.map((row, i) => (
        <BoardLink key={row.address} href={row.username ? `/${row.username}` : null} highlight={i === 0}>
          <RankShell i={i}>
            <Avatar url={row.avatar_url} />
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-bold text-beg-ink">
                {row.username ? `@${row.username}` : `${row.address.slice(0, 6)}…${row.address.slice(-4)}`}
              </span>
              <YouBadge viewer={viewer} username={row.username} wallet={row.address} />
            </span>
          </RankShell>
          <span className="text-right font-extrabold text-beg-ink">{formatAmount(BigInt(row.balance))} $BEGFI</span>
        </BoardLink>
      ))}
      </ul>
    </div>
  );
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
      metric === "received"
        ? a.received > b.received
          ? -1
          : 1
        : metric === "supporters"
          ? b.supporters - a.supporters
          : Math.max(0, b.newSupporters) - Math.max(0, a.newSupporters),
    )
    .slice(0, 3);
  return (
    <ol className="grid gap-2">
      {sorted.map((row, i) => (
        <li key={row.username}>
          <Link href={`/${row.username}`} className="card-sm flex flex-wrap items-center justify-between gap-2">
            <RankShell i={i}>
              <span className="truncate font-bold text-beg-ink">@{row.username}</span>
              {row.streakWeeks > 1 ? (
                <span className="rounded-full bg-beg-card px-2 py-0.5 text-[11px] font-bold text-beg-ink">
                  🔥 {row.streakWeeks}w
                </span>
              ) : null}
            </RankShell>
            <span className="font-extrabold text-beg-ink">{formatAmount(row.received)} $BEGFI</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function ActivityRow({ item }: { item: SiteActivityItem }) {
  const badgeBg =
    item.kind === "campaign_payout"
      ? "bg-beg-yellow"
      : item.kind === "payout" || item.kind === "drop_payout"
        ? "bg-beg-lime"
        : item.kind === "campaign" || item.kind === "drop"
          ? "bg-beg-blue"
          : "bg-beg-card";
  const label =
    item.kind === "campaign_payout"
      ? "Campaign"
      : item.kind === "drop_payout"
        ? "Drop win"
        : item.kind === "payout"
          ? "BegFi earn"
          : item.kind === "drop"
            ? "New drop"
            : item.kind === "campaign"
              ? "New campaign"
              : "Transfer";
  return (
    <li className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]">
      <span className="flex min-w-0 items-center gap-2">
        <span className={`shrink-0 rounded-md border-2 border-beg-ink ${badgeBg} px-1.5 py-0.5 text-[10px] font-extrabold text-beg-ink`}>
          {label}
        </span>
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
