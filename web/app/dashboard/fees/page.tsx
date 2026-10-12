import type { Metadata } from "next";
import { FeesPanel } from "@/components/fees-panel";
import { getLauncherDashboard } from "@/lib/dashboard";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Fees" };
export const dynamic = "force-dynamic";

/**
 * The Fees tab.
 *
 * What it refuses to do, on purpose: estimate anything. The per-token shares
 * come from `balanceOfToken` on the factory's own escrow (the panel reads them
 * with the connected wallet), so the numbers are what a claim would actually
 * pay. The tokens listed are the wallet's catalog launches, each one already
 * proven on-chain by /api/launch before it earns a row here.
 *
 * "Total earned to date" per token is deliberately absent: Pons' escrow does
 * not expose a cumulative-earned getter in the surface BegFi reads, and a
 * number invented from the difference between two unknowns would be worse
 * than the gap it fills. Claimable is real; history would be a guess.
 */
export default async function FeesPage() {
  const profile = await getProfile();
  if (!profile) return null;

  const { launches, dbFailed } = await getLauncherDashboard(profile.wallet_address);
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
        <FeesPanel wallet={profile.wallet_address} tokens={tokens} />
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
