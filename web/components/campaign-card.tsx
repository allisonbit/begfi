import Link from "next/link";

import { formatAmount } from "@/lib/erc20";
import type { CampaignCard } from "@/lib/campaigns";

/**
 * A campaign's grid card on the Earn page.
 *
 * Everything here is one truth or nothing: pool left, daily budget, and
 * participation come from ledger rows the sweep and indexer wrote — never a
 * number the owner typed. A campaign with NO money shows its honest state
 * ("pool empty — waiting for the deposit") instead of a promising button.
 */
export function CampaignTile({ campaign }: { campaign: CampaignCard }) {
  const { stats } = campaign;
  const empty = stats.poolRemaining <= 0n;
  const unitDisplay = (value: bigint) => formatAmount(value, campaign.tokenDecimals);
  const progress =
    stats.poolTotal > 0n ? Math.max(2, Math.min(100, Number((stats.poolRemaining * 100n) / stats.poolTotal))) : 0;

  return (
    <li>
      <Link
        href={`/earn/${campaign.slug}`}
        className="card-hover card-sm grid gap-3"
      >
        <div className="flex items-center gap-3">
          {campaign.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={campaign.logoUrl} alt="" className="size-10 shrink-0 rounded-xl border-[1.5px] border-beg-line object-cover" />
          ) : (
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border-[1.5px] border-beg-line bg-beg-card text-[13px] font-extrabold text-beg-ink">
              {campaign.tokenSymbol.slice(0, 3)}
            </span>
          )}
          <div className="min-w-0">
            <b className="flex items-center gap-1.5 truncate text-beg-ink">
              {campaign.name}
              {campaign.isVerified ? (
                <span title="Verified by BegFi" className="text-beg-logo text-[13px]">
                  ✓
                </span>
              ) : null}
            </b>
            <span className="block truncate text-[12px] text-beg-dim">
              {unitDisplay(stats.poolRemaining)} {campaign.tokenSymbol}
            </span>
          </div>
        </div>

        <div className="grid gap-1">
          <div className="flex items-baseline justify-between text-[11px] text-beg-dim">
            <span>{empty ? "Pool empty — deposit pending" : "Pool"}</span>
            <span>
              {unitDisplay(campaign.dailyBudget)}/day
              {stats.daysLeft !== null && !empty ? ` · ~${stats.daysLeft}d left` : ""}
            </span>
          </div>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${empty ? 2 : progress}%` }} />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[12px] text-beg-dim">{stats.participants} poster{stats.participants === 1 ? "" : "s"}</span>
          <span
            className={`rounded-full border-2 border-beg-ink px-3 py-1 text-[11px] font-extrabold text-beg-ink ${
              empty ? "bg-beg-card" : "bg-beg-lime"
            }`}
          >
            {empty ? "View" : "Post & Earn →"}
          </span>
        </div>
      </Link>
    </li>
  );
}
