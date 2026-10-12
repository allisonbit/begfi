import type { Metadata } from "next";
import Link from "next/link";
import { LaunchRow } from "@/components/launch-row";
import { shortAddress } from "@/lib/chains";
import { getLauncherDashboard } from "@/lib/dashboard";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Launches" };
export const dynamic = "force-dynamic";

/**
 * The Launches tab: every token this wallet launched, with the numbers a
 * launcher checks — market cap, 24h volume, curve progress, graduation — and
 * the link they are supposed to be sharing.
 *
 * The shared copy button lives on the row (a client island) because clipboard
 * calls are browser-only; everything else is server-read. Fees for individual
 * tokens live on the Fees tab, where the claim buttons are.
 */
export default async function LaunchesPage() {
  const profile = await getProfile();
  if (!profile) return null;

  const { launches, dbFailed } = await getLauncherDashboard(profile.wallet_address);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(28px,6vw,40px)] font-extrabold tracking-[-.05em]">Launches</h1>
          <p className="mt-1 text-beg-dim">Tokens launched from this wallet, with live numbers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/beg-to-launch" className="btn-ghost px-4 py-2.5 text-[13px] font-bold text-beg-ink">
            Beg to launch first
          </Link>
          <Link href="/launch" className="btn-primary">
            Launch a token
          </Link>
        </div>
      </header>

      {dbFailed ? (
        <p className="notice-dashed p-5">
          Couldn&apos;t read your launches just now. This is the database, not an empty record. Try
          again in a moment.
        </p>
      ) : launches.length === 0 ? (
        <div className="rounded-2xl border-[1.5px] border-dashed border-beg-line p-5 text-[13px] text-beg-dim">
          <p className="font-bold text-beg-ink">No launches yet.</p>
          <p className="mt-1.5">
            Tokens you launch appear here the moment the chain confirms them and the catalog records
            them. Standard mode is open to every wallet.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {launches.map((l) => (
            <LaunchRow key={l.token_address} launch={l} shareUrl={`https://www.begfi.io/token/${l.token_address}`} />
          ))}
        </ul>
      )}

      <p className="text-[12px] text-beg-dim">
        Wallet: <span className="font-mono">{shortAddress(profile.wallet_address)}</span>. Holders
        per token are not indexed yet, so cards count distinct 24h traders instead of inventing a
        holder total.
      </p>
    </>
  );
}
