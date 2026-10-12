import type { Metadata } from "next";
import { CopyLink } from "@/components/copy-link";
import { OwnBegList } from "@/components/own-beg-list";
import { shortAddress } from "@/lib/chains";
import { linkFor } from "@/lib/config";
import { getOwnBegs } from "@/lib/dashboard";
import { formatAmount } from "@/lib/erc20";
import { getRecentTransfers } from "@/lib/queries";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Begs" };
export const dynamic = "force-dynamic";

/**
 * The Begs tab: your link, your supporters, your asks.
 *
 * Supporters and amounts come from the indexer's confirmed transfers — the
 * same rows the Overview total is built from — so a supporter named here gave
 * something that is actually on the chain. The begs list links to each beg's
 * own shareable page.
 */
export default async function BegsPage() {
  const profile = await getProfile();
  if (!profile) return null;

  const { begs, dbFailed } = await getOwnBegs(profile.username);

  return (
    <>
      <header>
        <h1 className="text-[clamp(28px,6vw,40px)] font-extrabold tracking-[-.05em]">Begs</h1>
        <p className="mt-1 text-beg-dim">Your link, your supporters, what you are asking for.</p>
      </header>

      <CopyLink url={linkFor(profile.username)} />

      <section>
        <h2 className="mb-3 text-xl font-extrabold tracking-[-.03em]">Recent supporters</h2>
        <SupportersMiniList wallet={profile.wallet_address} />
      </section>

      <section>
        <h2 className="mb-3 text-xl font-extrabold tracking-[-.03em]">Your begs</h2>
        {dbFailed ? (
          <p className="notice-dashed p-5">
            Couldn&apos;t read your begs just now. This is the database, not an empty account. Try
            again in a moment.
          </p>
        ) : begs.length === 0 ? (
          <p className="notice-dashed p-5">
            No begs written yet. Write one and it shows up here, with its own shareable page at
            its own link.
          </p>
        ) : (
          <OwnBegList begs={begs} />
        )}
      </section>
    </>
  );
}

/**
 * The supporters list is a server component inside a server page — no island,
 * because nothing here needs a browser. Confirmed transfers only, newest
 * first, amounts formatted with the shared 18-decimal formatter.
 */
async function SupportersMiniList({ wallet }: { wallet: string }) {
  const transfers = await getRecentTransfers(wallet, 8);

  if (transfers.length === 0) {
    return (
      <p className="rounded-2xl border-[1.5px] border-beg-line p-5 text-[13px] text-beg-dim">
        Nobody has sent yet. Share the link above; the first confirmed send shows up here with its
        amount and time.
      </p>
    );
  }

  return (
    <ul className="grid gap-2">
      {transfers.map((t) => (
        <li
          key={`${t.tx_hash}-${t.log_index}`}
          className="card-sm flex flex-wrap items-center justify-between gap-2 text-[13px]"
        >
          <span className="font-mono text-beg-dim">{shortAddress(t.from_address)}</span>
          <span className="text-beg-dim">{new Date(t.block_time).toLocaleString("en-GB")}</span>
          <span className="font-bold text-beg-ink">{formatAmount(BigInt(t.amount))} $BEG</span>
        </li>
      ))}
    </ul>
  );
}
