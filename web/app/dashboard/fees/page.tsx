import type { Metadata } from "next";
import { FeeChart } from "@/components/fee-chart";
import { FeesPanel } from "@/components/fees-panel";
import { getFeeHistory } from "@/lib/fees-history";
import { getLauncherDashboard } from "@/lib/dashboard";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Fees" };
export const dynamic = "force-dynamic";

/**
 * The Fees tab.
 *
 * Two sources, both real, kept visually apart because they measure different
 * things: the CLAIMABLE cards read the escrow contract (what a claim would pay
 * right now, wallet-connected), and the HISTORY chart reads the indexer's
 * recorded taxes on confirmed trades (the shape of earnings over time). The
 * chart's total and the escrow's claimable can differ — taxes recorded land in
 * the escrow but the escrow also holds fees from before this chart's window —
 * so neither is presented as a view of the other.
 *
 * Per-token shares and the tokens listed come from the catalog, each launch
 * already proven on-chain by /api/launch before it earns a row here.
 */
export default async function FeesPage() {
  const profile = await getProfile();
  if (!profile) return null;

  const [{ launches, dbFailed }, history] = await Promise.all([
    getLauncherDashboard(profile.wallet_address),
    getFeeHistory(profile.wallet_address, "all"),
  ]);
  const tokens = launches.map((l) => l.token_address);

  return (
    <>
      <header>
        <h1 className="text-[clamp(28px,6vw,40px)] font-extrabold tracking-[-.05em]">Fees</h1>
        <p className="mt-1 text-beg-dim">
          What your launched tokens have earned, straight from the escrow contract.
        </p>
      </header>

      {dbFailed ? (
        <p className="notice-dashed p-5">
          Couldn&apos;t read your launch list just now, so the per-token shares cannot be looked
          up. This is the database, not an empty balance. Try again in a moment.
        </p>
      ) : (
        <>
          <FeesPanel wallet={profile.wallet_address} tokens={tokens} />
          <FeeChart history={history} />
        </>
      )}

      {launches.length > 0 ? (
        <p className="text-[12px] text-beg-dim">
          {tokens.length} token{tokens.length === 1 ? "" : "s"} launched from this wallet. The
          escrow credits the recipient recorded on each launch, which is the wallet that signed it.
        </p>
      ) : null}
    </>
  );
}
