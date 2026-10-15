import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CampaignCountdown } from "@/components/campaign-countdown";
import { CampaignSubmitBox } from "@/components/campaign-submit-box";
import { addressUrl, shortAddress, txUrl } from "@/lib/chains";
import { formatAmount } from "@/lib/erc20";
import {
  campaignPayoutSchedule,
  getCampaignBySlug,
  getCampaignDetail,
  hasPostedToday,
  type CampaignSubmission,
} from "@/lib/campaigns";
import { getProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * /earn/<slug> — a campaign's own page.
 *
 * Everything public reads from rows the chain already settled: leaderboard,
 * feed, pool bar. The submit box is honest about WHY it may be closed — pool
 * empty, campaign paused, wallet already posted today — and the countdown
 * points at the one moment payouts go out (the sweep's UTC schedule).
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const campaign = await getCampaignBySlug(slug);
  if (!campaign) return { title: "Campaign" };
  return {
    title: `${campaign.name} — Post & Earn`,
    description:
      campaign.description ??
      `Post about ${campaign.name} on X and earn your share of ${campaign.tokenName} automatically. One post per wallet per day, paid from the project's own pool.`,
  };
}

export default async function CampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const campaign = await getCampaignBySlug(slug);
  if (!campaign) notFound();

  const [detail, profile] = await Promise.all([getCampaignDetail(campaign), getProfile()]);
  if (!detail) notFound();
  const { stats, feed, leaders, recentPayouts } = detail;

  const emptyPool = stats.poolRemaining <= 0n;
  const paused = campaign.status !== "active";
  const unit = (value: bigint) => formatAmount(value, campaign.tokenDecimals);
  const progress =
    stats.poolTotal > 0n ? Math.max(2, Math.min(100, Number((stats.poolRemaining * 100n) / stats.poolTotal))) : 0;
  const daysLeft = campaign.dailyBudget > 0n ? Number(stats.poolRemaining / campaign.dailyBudget) : null;

  // The gated answer the DB itself enforces on submit — not a scan of a
  // display list, so the box is honest even beyond 30 feed rows.
  const myPostToday = profile ? await hasPostedToday(campaign.id, profile.wallet_address) : false;
  const schedule = campaignPayoutSchedule();

  return (
    <div className="safe-x mx-auto max-w-[1000px] py-8">
      {/* Banner / identity */}
      <header className="grid gap-4">
        {campaign.bannerUrl ? (
          <div className="overflow-hidden rounded-[20px] border-2 border-beg-ink">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={campaign.bannerUrl} alt="" className="max-h-[220px] w-full object-cover" />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {campaign.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={campaign.logoUrl} alt="" className="size-14 rounded-2xl border-2 border-beg-ink object-cover" />
          ) : (
            <span className="grid size-14 place-items-center rounded-2xl border-2 border-beg-ink bg-beg-lime text-[15px] font-extrabold text-beg-ink">
              {campaign.tokenSymbol.slice(0, 3)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-2 text-[clamp(26px,5vw,40px)] font-extrabold leading-none tracking-[-.04em]">
              {campaign.name}
              {campaign.isVerified ? (
                <span title="Verified by BegFi" className="rounded-full border-2 border-beg-ink bg-beg-lime px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-[.05em] text-beg-ink">
                  ✓ verified project
                </span>
              ) : null}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-beg-dim">
              <span>
                {campaign.tokenName} ({campaign.tokenSymbol})
              </span>
              <a href={addressUrl(campaign.tokenAddress)} target="_blank" rel="noreferrer" className="font-mono text-[11px] underline underline-offset-2 hover:text-beg-ink">
                {shortAddress(campaign.tokenAddress)} ↗
              </a>
              {campaign.xUrl ? (
                <a href={campaign.xUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-beg-ink">
                  X ↗
                </a>
              ) : null}
              {campaign.websiteUrl ? (
                <a href={campaign.websiteUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-beg-ink">
                  Website ↗
                </a>
              ) : null}
            </p>
          </div>
        </div>
        {campaign.description ? (
          <p className="max-w-[720px] text-[15px] text-beg-dim">{campaign.description}</p>
        ) : null}
      </header>

      {/* Pool meter + countdown */}
      <section className="mt-5 card grid gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <b className="text-[16px] text-beg-ink">
            {emptyPool ? "Pool empty / Ended" : "Rewards pool"}
          </b>
          {!emptyPool && !paused ? (
            <span className="flex items-baseline gap-2 text-[12px] text-beg-dim">
              next payout in <CampaignCountdown hourUtc={schedule.hourUtc} minuteUtc={schedule.minuteUtc} />
            </span>
          ) : null}
        </div>
        <div className="progress">
          <div className="progress-fill" style={{ width: `${emptyPool ? 2 : progress}%` }} />
        </div>
        <p className="text-[12px] text-beg-dim">
          {unit(stats.poolRemaining)} {campaign.tokenSymbol} left of {unit(stats.poolTotal)} deposited ·{" "}
          {unit(campaign.dailyBudget)} {campaign.tokenSymbol} shared every day
          {daysLeft !== null && !emptyPool ? ` · ~${daysLeft} day${daysLeft === 1 ? "" : "s"} of payouts left` : ""}
          {emptyPool ? " — the project gets an alert and can top up; deposits are detected automatically." : ""}
        </p>
      </section>

      {/* Submit */}
      <section className="mt-4">
        <CampaignSubmitBox
          slug={campaign.slug}
          requiredEntry={campaign.requiredEntry}
          notifyOn={`today's`}
          alreadyPostedToday={myPostToday}
          disabledReason={
            paused
              ? `This campaign is ${campaign.status} right now.`
              : null
          }
        />
      </section>

      {campaign.instructions ? (
        <section className="mt-4 notice">
          <b className="text-beg-ink">What to post</b>
          <p className="mt-1 text-[13px] text-beg-dim">{campaign.instructions}</p>
        </section>
      ) : null}

      {/* Live project grid face: who got paid today */}
      {recentPayouts.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-3 text-xl font-extrabold tracking-[-.03em]">Recently paid</h2>
          <ul className="grid gap-2">
            {recentPayouts.slice(0, 8).map((p, i) => (
              <li key={`${p.tx_hash ?? "notx"}-${i}`} className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span className="flex items-center gap-2">
                  {p.username ? <b className="text-beg-ink">@{p.username}</b> : <span className="font-mono text-[11px] text-beg-dim">{shortAddress(p.wallet_address)}</span>}
                  <span className="font-bold text-beg-ink">
                    +{formatAmount(BigInt(p.amount), campaign.tokenDecimals)} {campaign.tokenSymbol}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-[11px] text-beg-dim">cycle {p.cycle_date}</span>
                  {p.tx_hash ? (
                    <a href={txUrl(p.tx_hash)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
                      {shortAddress(p.tx_hash)} ↗
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Campaign leaderboard */}
      <section className="mt-6">
        <h2 className="mb-3 text-xl font-extrabold tracking-[-.03em]">Campaign leaderboard</h2>
        {leaders.length === 0 ? (
          <p className="notice-dashed">No posters yet. The first valid post opens this board — and today&apos;s budget is waiting.</p>
        ) : (
          <ol className="grid gap-2">
            {leaders.map((row, i) => (
              <li key={row.wallet_address} className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-full border-2 border-beg-ink text-[12px] font-extrabold ${
                      i === 0 ? "bg-beg-yellow" : i < 3 ? "bg-beg-lime" : "bg-beg-card"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <b className="truncate text-beg-ink">@{row.username}</b>
                  {row.streak > 1 ? (
                    <span title={`${row.streak} days in a row`} className="rounded-full bg-beg-card px-2 py-0.5 text-[11px] font-bold text-beg-ink">
                      🔥 {row.streak}d
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-wrap items-center gap-3">
                  <span className="text-[12px] text-beg-dim">
                    {row.count} post{row.count === 1 ? "" : "s"}
                  </span>
                  {row.paid > 0n ? (
                    <span className="font-bold text-beg-ink">
                      {formatAmount(row.paid, campaign.tokenDecimals)} {campaign.tokenSymbol}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Submissions feed (valid posts) */}
      <section className="mt-6">
        <h2 className="mb-3 text-xl font-extrabold tracking-[-.03em]">Posts people dropped</h2>
        {feed.length === 0 ? (
          <p className="notice-dashed">No posts yet — yours would be first.</p>
        ) : (
          <ul className="grid gap-2">
            {feed.map((row: CampaignSubmission, i) => (
              <li key={`${row.id}-${i}`} className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span className="font-bold text-beg-ink">@{row.username}</span>
                <a href={row.post_url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-beg-dim underline underline-offset-2 hover:text-beg-ink">
                  {row.post_url.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
                <span className={`rounded-full border-2 border-beg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.04em] text-beg-ink ${row.payout_tx ? "bg-beg-lime" : "bg-beg-yellow"}`}>
                  {row.payout_tx ? "paid" : "sharing today"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 max-w-[70ch] text-[12px] text-beg-dim">
        Every campaign pays from its own pool, on-chain, automatically — the pool is the project&apos;s own deposit, tracked by
        the ledger the payouts write to. One post per wallet per day, verified against the required mention. Not financial
        advice; BegFi is not affiliated with any listed project.
      </p>

      <div className="mt-4">
        <Link href="/earn" className="text-[13px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
          ← All earning options
        </Link>
      </div>
    </div>
  );
}
