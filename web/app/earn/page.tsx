import type { Metadata } from "next";
import Link from "next/link";

import { ClaimButton } from "@/components/claim-button";
import { EarnSubmitBox } from "@/components/earn-submit";
import { RobinhoodFeather } from "@/components/robinhood-feather";
import { CampaignTile } from "@/components/campaign-card";
import { getActiveCampaigns, getRecentCampaignPayoutTicker } from "@/lib/campaigns";
import { BEG_TOKEN_ADDRESS, DISTRIBUTOR_PRIVATE_KEY } from "@/lib/config";
import {
  earningsFromSubmissions,
  getEarnFeed,
  getEarnSettings,
  getEarnStats,
  getMySubmissions,
  hasWalletClaimed,
  rewardDisplay,
} from "@/lib/earn";
import { formatAmount } from "@/lib/erc20";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = {
  title: "Earn",
  description:
    "Post about BegFi on X, drop the link, and get paid automatically — 10,000 $BEGFI per post. One claim per wallet, ever. The feed of posts people dropped is public.",
};

export const dynamic = "force-dynamic";

/**
 * /earn — post to earn.
 *
 * THE FLIP SIDE OF BEGGING: instead of asking, people earn by talking about
 * the protocol. Every number here is read from the database the same way the
 * rest of the site reads the chain: the settings row decides the reward, the
 * pool, the limit and the switch, and submissions are exactly what was
 * submitted — no seeded example rows, no invented usernames.
 *
 * PUBLIC BY DESIGN. A visitor can see everything before signing in — how it
 * works, who is earning, what the pool has. Only submitting, their own
 * earnings and their own rejected rows are behind a session.
 */

const STEPS = [
  { n: "1", label: "Log in and set your username" },
  { n: "2", label: "Post about BegFi on X" },
  { n: "3", label: "Paste your post link" },
  { n: "4", label: "Get paid automatically" },
] as const;

export default async function EarnPage() {
  const profile = await getProfile();

  const [settings, stats, feed, campaigns, ticker] = await Promise.all([
    getEarnSettings(),
    getEarnStats(),
    getEarnFeed(24),
    getActiveCampaigns(),
    getRecentCampaignPayoutTicker(8),
  ]);

  const mine = profile ? await getMySubmissions(profile.id) : { rows: [], dbFailed: false };
  const walletClaimed = profile ? await hasWalletClaimed(profile.wallet_address) : false;

  const reward = settings ? rewardDisplay(settings.rewardPerPost) : "—";
  const poolOut = settings && settings.poolRemaining < settings.rewardPerPost;
  const submitBlocked =
    settings === null
      ? "Earn is not set up yet."
      : !settings.isActive
        ? "Earn is paused. Check back soon."
        : poolOut
          ? "Rewards pool is empty, check back soon."
          : null;

  const payoutConfigured = Boolean(DISTRIBUTOR_PRIVATE_KEY) && Boolean(BEG_TOKEN_ADDRESS);

  const my = earningsFromSubmissions(mine.rows);

  return (
    <div className="safe-x mx-auto max-w-[1000px] py-10">
      {/* 1. Hero */}
      <header className="max-w-[720px]">
        <h1 className="text-[clamp(32px,7vw,64px)] font-extrabold leading-[1] tracking-[-.04em]">
          Post about BegFi.
          <br />
          <span className="animate-wobble inline-block rounded-[18px] border-[3px] border-beg-ink bg-beg-lime px-[0.14em] text-beg-ink shadow-glow">Get paid in $BEGFI.</span>
        </h1>
        <p className="mt-4 text-lg text-beg-dim">Make a post on X, drop the link, earn.</p>
        <div className="mt-5 inline-flex animate-pop-in items-center rounded-full border-[3px] border-beg-ink bg-beg-yellow px-5 py-2.5 text-[16px] font-extrabold text-beg-ink shadow-glow">
          {reward} $BEGFI per approved post
          <RobinhoodFeather className="ml-2 text-beg-logo" />
        </div>
      </header>

      {/* 2. How it works */}
      <section className="mt-8">
        <h2 className="mb-3 text-xl font-extrabold tracking-[-.03em]">How it works</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          {STEPS.map((step) => (
            <div key={step.n} className="card-sm flex items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg border-2 border-beg-ink bg-beg-lime text-[13px] font-extrabold text-beg-ink">
                {step.n}
              </span>
              <span className="text-[13px] font-bold text-beg-ink">{step.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 2½. Project campaigns — the grid the site earns with */}
      <section className="mt-8">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-extrabold tracking-[-.03em]">Campaigns — earn in other projects&apos; tokens</h2>
          <p className="text-[12px] text-beg-dim">Trending: ordered by who is actually posting today.</p>
        </div>
        <p className="mb-3 max-w-[720px] text-[13px] text-beg-dim">
          Any project can open its own pool on BegFi: you post with its required tag, paste the link, and its budget pays you
          automatically the next cycle — one post per wallet per day. BegFi never mixes a campaign&apos;s money with another.
        </p>
        {campaigns.dbFailed ? (
          <p className="notice-dashed">Campaigns couldn&apos;t load right now — that&apos;s the database talking, check back in a moment.</p>
        ) : campaigns.items.length === 0 ? (
          <p className="notice-dashed">
            No campaigns are live yet. Run one for your own project on{" "}
            <Link href="/dashboard/campaigns" className="underline underline-offset-2 hover:text-beg-ink">
              your dashboard
            </Link>{" "}
            — fund the pool and BegFi pays its posters automatically.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.items.map((campaign) => (
              <CampaignTile key={campaign.id} campaign={campaign} />
            ))}
          </ul>
        )}
      </section>

      {/* 2¾. The live ticker of automatic payouts across ALL campaigns */}
      {ticker.length > 0 ? (
        <section className="mt-4 card-sm overflow-x-auto p-4">
          <b className="text-[13px] text-beg-ink">Recently paid</b>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {ticker.map((t, i) => (
              <li key={`${t.slug}-${t.wallet_address}-${i}`} className="flex items-baseline gap-1.5 text-[12px]">
                {t.username ? (
                  <b className="text-beg-ink">@{t.username}</b>
                ) : (
                  <span className="font-mono text-[11px] text-beg-dim">{t.wallet_address.slice(0, 6)}…</span>
                )}
                <span className="text-beg-dim">
                  earned {formatAmount(BigInt(t.amountBase), t.decimals)} {t.tokenSymbol} in{" "}
                  <Link href={`/earn/${t.slug}`} className="underline underline-offset-2 hover:text-beg-ink">
                    {t.campaignName}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 3. Rules */}
      <section className="mt-4 notice">
        <b className="text-beg-ink">Rules</b>
        <ul className="mt-2 grid list-disc gap-1 pl-5 text-[13px]">
          <li>{reward} $BEGFI per post, paid automatically on submit</li>
          <li>Post must be public and must mention BegFi or $BEGFI</li>
          <li>The same link can&apos;t be submitted twice</li>
          <li>ONE claim per wallet, ever — not per day, not per device</li>
          <li>{settings ? formatAmount(settings.poolRemaining) : "…"} $BEGFI left in the pool</li>
        </ul>
      </section>

      {/* 4. Rewards pool meter — today's 1,000,000, until tomorrow */}
      {settings ? (
        <section className="mt-4 card grid gap-2">
          <div className="flex items-baseline justify-between">
            <b className="text-[15px]">Rewards pool</b>
            <span className="text-[12px] text-beg-dim">
              {formatAmount(settings.poolRemaining)} of {formatAmount(settings.poolTotal)} $BEGFI remaining
            </span>
          </div>
          <div className="progress">
            <div
              className="progress-fill"
              style={{
                width: `${Math.max(2, Math.min(100, (Number(settings.poolRemaining) / Math.max(1, Number(settings.poolTotal))) * 100))}%`,
              }}
            />
          </div>
          <p className="text-[12px] text-beg-dim">
            {stats.dbFailed ? null : `${stats.totalPosts} posts submitted · ${formatAmount(stats.totalPaid)} $BEGFI paid to date.`}
            {poolOut ? " The pool is empty right now." : ""}
          </p>
        </section>
      ) : null}

      {/* 5. Submit box — the states live inside the component */}
      <section className="mt-4">
        <EarnSubmitBox disabledReason={walletClaimed ? "This wallet has already claimed." : submitBlocked} />
      </section>

      {/* 6. My earnings — logged in only */}
      {profile ? (
        <section className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
          <div className="card grid gap-3 p-6">
            <b className="text-[16px] text-beg-ink">My earnings</b>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-[24px] font-extrabold text-beg-ink">{formatAmount(my.earned)}</div>
                <div className="text-[11px] text-beg-dim">Total earned</div>
              </div>
              <div>
                <div className="text-[24px] font-extrabold text-beg-ink">{formatAmount(my.claimable)}</div>
                <div className="text-[11px] text-beg-dim">Claimable now</div>
              </div>
              <div>
                <div className="text-[24px] font-extrabold text-beg-ink">{formatAmount(my.pending)}</div>
                <div className="text-[11px] text-beg-dim">Pending</div>
              </div>
            </div>
          </div>
          <div className="card p-6">
            <ClaimButton claimableDisplay={formatAmount(my.claimable)} payoutConfigured={payoutConfigured} />
          </div>
        </section>
      ) : null}

      {/* 7. My submissions — logged in only */}
      {profile ? (
        <section className="mt-4">
          <h2 className="mb-3 text-xl font-extrabold tracking-[-.03em]">My submissions</h2>
          {mine.rows.length === 0 ? (
            <p className="notice-dashed">No submissions yet. Make your first post.</p>
          ) : (
            <ul className="grid gap-2">
              {mine.rows.map((row) => (
                <li key={row.id} className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <a href={row.post_url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-beg-dim underline underline-offset-2 hover:text-beg-ink">
                    {row.post_url.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                  <StatusChip status={row.status} />
                  <span className="font-bold text-beg-ink">{formatAmount(BigInt(row.reward_amount))} $BEGFI</span>
                  <span className="shrink-0 text-[11px] text-beg-dim">
                    {new Date(row.created_at).toLocaleDateString("en-GB")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* 8. Live feed — public */}
      <section className="mt-6">
        <h2 className="mb-3 text-xl font-extrabold tracking-[-.03em]">Posts people dropped</h2>
        {feed.dbFailed ? (
          <p className="notice-dashed">Couldn&apos;t load the feed right now. That&apos;s the database, not the feed being empty.</p>
        ) : feed.items.length === 0 ? (
          <p className="notice-dashed">
            Nobody has dropped a post yet. Yours would be first.
          </p>
        ) : (
          <ul className="grid gap-2">
            {feed.items.map((row) => (
              <li
                key={row.id}
                className={`card-sm flex flex-wrap items-center justify-between gap-2 text-[13px] ${
                  row.status === "approved" ? "bg-beg-lime/20" : ""
                }`}
              >
                <span className="font-bold text-beg-ink">@{row.username}</span>
                <a href={row.post_url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-beg-dim underline underline-offset-2 hover:text-beg-ink">
                  {row.post_url.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
                <StatusChip status={row.status} />
                {row.status === "approved" ? (
                  <span className="font-bold text-beg-ink">+{formatAmount(BigInt(row.reward_amount))} $BEGFI</span>
                ) : null}
                <TimeAgo iso={row.created_at} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 card-hover card-sm flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold text-beg-ink">See who the pool reached</p>
          <p className="mt-1 text-[12px] text-beg-dim">The leaderboard ranks confirmed receipts — payouts and begs alike.</p>
        </div>
        <Link href="/leaderboard" className="btn-ghost shrink-0 px-4 py-2 text-[13px] font-bold text-beg-ink">
          Open the board →
        </Link>
      </section>

      <p className="mt-6 max-w-[70ch] text-[12px] text-beg-dim">        Rewards come from BegFi&apos;s own pool and pay on-chain from the BegFi payout wallet,
        automatically on submit. One claim per wallet, ever — decided only by the wallet address.
        Nothing here is financial advice, and BegFi is not affiliated with Robinhood.
      </p>
    </div>
  );
}

/**
 * Status chip: pending yellow, approved green, rejected red. The rejected red
 * stays a literal because the sticker palette has no red — a one-off shade,
 * refused as a token, is the honest way to mark "declined".
 */
function StatusChip({ status }: { status: "pending" | "approved" | "rejected" }) {
  const bg =
    status === "pending" ? "bg-beg-yellow" : status === "approved" ? "bg-beg-lime" : "bg-[#ff6b6b]";

  return (
    <span className={`rounded-full border-2 border-beg-ink px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[.04em] text-beg-ink ${bg}`}>
      {status}
    </span>
  );
}

/** "3h"-style age, matching the ageWords vocabulary used elsewhere. */
function TimeAgo({ iso }: { iso: string }) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  const text =
    mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h` : `${Math.floor(mins / 1440)}d`;
  return <span className="shrink-0 text-[11px] text-beg-dim">{text}</span>;
}
