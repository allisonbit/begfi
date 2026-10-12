import type { Metadata } from "next";
import { txUrl } from "@/lib/chains";
import { getActivityFeed } from "@/lib/dashboard";
import { getProfile } from "@/lib/session";
import { ActivityFeed } from "@/components/activity-feed";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

/**
 * The Activity tab: one feed, three kinds, newest first.
 *
 * Begs received, trades this wallet made, and launches it signed — merged and
 * sorted on the server, then filtered in the browser island so switching
 * between All, Begs, Trades and Launches is instant and costs no fetch. Fee
 * claims are absent for a documented reason (the escrow exposes no claimed
 * history in the ABI BegFi reads; the Fees tab shows claim state live).
 *
 * Every entry carries its transaction hash, so anything in the feed can be
 * checked against the chain in one click.
 */
export default async function ActivityPage() {
  const profile = await getProfile();
  if (!profile) return null;

  const { items, dbFailed } = await getActivityFeed(profile.wallet_address);

  return (
    <>
      <header>
        <h1 className="text-[clamp(28px,6vw,40px)] font-extrabold tracking-[-.05em]">Activity</h1>
        <p className="mt-1 text-beg-dim">Begs received, trades, and launches, from confirmed on-chain events.</p>
      </header>

      {dbFailed ? (
        <p className="notice-dashed p-5">
          Couldn&apos;t read the feed just now. This is the database, not an empty history. Try
          again in a moment.
        </p>
      ) : (
        <ActivityFeed items={items} explorerHref={(tx) => txUrl(tx)} />
      )}

      <p className="text-[12px] text-beg-dim">
        Transfers appear once the indexer confirms them on-chain; a trade shows here a few seconds
        after it lands in a block, and in every figure at the next page refresh.
      </p>
    </>
  );
}
