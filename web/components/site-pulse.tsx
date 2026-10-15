import Link from "next/link";

import { CampaignTile } from "@/components/campaign-card";
import { formatAmount } from "@/lib/erc20";
import { getActiveCampaigns, getRecentCampaignPayoutTicker } from "@/lib/campaigns";
import { getSiteActivity } from "@/lib/leaderboard";

/**
 * THE SITE'S PULSE, ON THE FRONT DOOR.
 *
 * Three real feeds—trending campaigns, who got paid, what moved on-chain—
 * so the homepage answers the returning visitor's one question ("what
 * happened since I left?") before any copy does. Every figure is a row the
 * indexer or a sweep already wrote; nothing here is a placeholder or a
 * seeded story.
 */
export async function SitePulse() {
  const [campaigns, ticker, activity] = await Promise.all([
    getActiveCampaigns(),
    getRecentCampaignPayoutTicker(5),
    getSiteActivity(6),
  ]);

  const featured = campaigns.items.slice(0, 3);
  const emptySite = campaigns.dbFailed && ticker.length === 0 && activity.dbFailed;

  if (emptySite) {
    return null; // the homepage NEVER lies: no data, no invented pulse strip
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[clamp(22px,4vw,30px)] font-extrabold tracking-[-.03em]">Happening right now</h2>
        <Link href="/earn" className="text-[13px] font-bold text-beg-dim underline underline-offset-2 hover:text-beg-ink">
          Post & Earn →
        </Link>
      </div>

      {featured.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-3">
          {featured.map((campaign) => (
            <CampaignTile key={campaign.id} campaign={campaign} />
          ))}
        </ul>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card-sm grid gap-2 p-4">
          <b className="text-[14px] text-beg-ink">Recently paid</b>
          {ticker.length === 0 ? (
            <p className="text-[12px] text-beg-dim">The first automatic payout lights this up.</p>
          ) : (
            <ul className="grid gap-1.5">
              {ticker.map((t, i) => (
                <li key={`${t.slug}-${t.wallet_address}-${i}`} className="flex items-baseline gap-1.5 text-[12px]">
                  {t.username ? (
                    <b className="shrink-0 text-beg-ink">@{t.username}</b>
                  ) : (
                    <span className="shrink-0 font-mono text-[11px] text-beg-dim">{t.wallet_address.slice(0, 6)}…</span>
                  )}
                  <span className="min-w-0 truncate text-beg-dim">
                    +{formatAmount(BigInt(t.amountBase), t.decimals)} {t.tokenSymbol}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/leaderboard" className="text-[12px] font-bold text-beg-dim underline underline-offset-2 hover:text-beg-ink">
            The full board →
          </Link>
        </div>

        <div className="card-sm grid gap-2 p-4">
          <b className="text-[14px] text-beg-ink">On-chain right now</b>
          {activity.dbFailed || activity.items.length === 0 ? (
            <p className="text-[12px] text-beg-dim">Fetches from confirmed rows only; the first event starts this feed.</p>
          ) : (
            <ul className="grid gap-1.5">
              {activity.items.map((item, i) => (
                <li key={`${item.kind}-${item.at}-${i}`} className="min-w-0 truncate text-[12px] text-beg-dim">
                  <span className="text-beg-ink">{item.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
