import Link from "next/link";

import { formatAmount } from "@/lib/erc20";
import type { DropCard as DropCardData } from "@/lib/drops";

/**
 * A drop, as a sticker on the /drops sheet.
 *
 * TWO FIGURES, BOTH EARNED. The prize is the drop's own `amount_per_claim`
 * scaled by the token's OWN decimals (read from its contract at creation), and
 * "prizes left" is the smaller of the cap and the money — computed by
 * `getDropStats` from the deposit/payout ledger, never stored. When a figure
 * could not be read it renders as "—", because an empty-looking pot that is not
 * empty is the one lie a giveaway must not tell.
 */
export function DropTile({ drop, stats }: DropCardData) {
  const unit = (v: bigint) => formatAmount(v, drop.tokenDecimals);
  const claimed = stats.claimCount;
  const progress =
    claimed === null ? 0 : Math.max(2, Math.min(100, Math.round((claimed / Math.max(1, drop.maxClaims)) * 100)));

  return (
    <li className="card-sm card-hover grid gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <b className="block truncate text-[15px] text-beg-ink">{drop.name}</b>
          <span className="font-mono text-[11px] text-beg-dim">{drop.tokenSymbol}</span>
        </div>
        <span className="shrink-0 rounded-full border-2 border-beg-ink bg-beg-lime px-2.5 py-0.5 text-[11px] font-extrabold text-beg-ink">
          {unit(drop.amountPerClaim)} {drop.tokenSymbol}
        </span>
      </div>

      {drop.description ? <p className="line-clamp-2 text-[12px] text-beg-dim">{drop.description}</p> : null}

      <div className="progress">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-[11px] text-beg-dim">
        <span>
          {claimed === null ? (
            "claims unreadable"
          ) : stats.prizesLeft === null ? (
            `${claimed}/${drop.maxClaims} claimed`
          ) : stats.prizesLeft > 0 ? (
            `${stats.prizesLeft} prize${stats.prizesLeft === 1 ? "" : "s"} left`
          ) : claimed >= drop.maxClaims ? (
            "all prizes taken"
          ) : (
            "pot empty — awaiting funding"
          )}
        </span>
        <span>
          {drop.closesAt
            ? Date.now() >= new Date(drop.closesAt).getTime()
              ? "window closed"
              : `closes ${new Date(drop.closesAt).toLocaleDateString("en-GB")}`
            : "no deadline"}
        </span>
      </div>

      <Link
        href={`/drop/${drop.id}`}
        className={`btn-primary justify-self-start px-4 py-2 text-[13px] ${
          stats.isClaimable ? "" : "opacity-70"
        }`}
      >
        {stats.isClaimable ? "Claim a prize →" : "See the drop →"}
      </Link>
    </li>
  );
}
