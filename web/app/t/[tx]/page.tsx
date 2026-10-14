import type { Metadata } from "next";
import Link from "next/link";

import { TipBackButton } from "@/components/tip-back-button";
import { txUrl } from "@/lib/chains";
import { isTxHash, getReceipt } from "@/lib/receipts";
import { formatAmount } from "@/lib/erc20";

export const dynamic = "force-dynamic";

/**
 * /t/[tx] — a tip receipt. One confirmed $BEGFI transfer, framed as something
 * worth posting.
 *
 * WHY A PAGE. A send that lands in a wallet dies there on most sites; BegFi
 * turns the confirmation itself into the social artifact — a receipt the
 * sender flashes ("I paid her"), a flex with a proof link nobody can dispute
 * and a `Tip back` one tap away. The indexer's transfer row and attached
 * message are the receipt's truth; the page includes nothing that is not
 * already public on the chain and on the profiles.
 *
 * The OG card at /t/[tx]/opengraph-image is what a posted link unfurls on X
 * and Telegram — same facts, drawn for the timeline.
 */
export async function generateMetadata({ params }: { params: Promise<{ tx: string }> }): Promise<Metadata> {
  const { tx } = await params;
  if (!isTxHash(tx)) return { title: "That transaction doesn't look right." };
  const receipt = await getReceipt(tx);
  if (!receipt) return { title: "This send isn't on file (yet)." };
  const who = receipt.to_username ? `@${receipt.to_username}` : `${receipt.to_wallet.slice(0, 6)}…${receipt.to_wallet.slice(-4)}`;
  return { title: `A receipt: ${formatAmount(BigInt(receipt.amount))} $BEGFI to ${who}` };
}

export default async function ReceiptPage({ params }: { params: Promise<{ tx: string }> }) {
  const { tx } = await params;
  if (!isTxHash(tx)) {
    return <p className="mx-auto mt-20 max-w-[560px] text-center text-beg-dim">That doesn&apos;t look like a transaction hash.</p>;
  }
  const receipt = await getReceipt(tx);

  if (!receipt) {
    return (
      <p className="mx-auto mt-20 max-w-[560px] text-center text-beg-dim">
        This transaction has no confirmed $BEGFI transfer on file. If the send
        just landed, it appears the moment the indexer sees it —{" "}
        <Link href="/" className="underline underline-offset-2 hover:text-beg-ink">back home</Link>.
      </p>
    );
  }

  const name = receipt.to_username
    ? receipt.to_display_name ?? `@${receipt.to_username}`
    : `${receipt.to_wallet.slice(0, 6)}…${receipt.to_wallet.slice(-4)}`;

  return (
    <main className="safe-x mx-auto max-w-[560px] py-12">
      <div className="card p-7 text-center">
        <div className="text-[13px] text-beg-dim">Confirmed tip · ${receipt.block_time.slice(0, 10)}</div>

        <div className="mt-3 text-glow text-[44px] font-extrabold leading-none tracking-[-.04em] text-beg-ink">
          {formatAmount(BigInt(receipt.amount))} $BEGFI
        </div>

        {receipt.to_avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={receipt.to_avatar_url} alt="" className="mx-auto mt-5 size-16 rounded-full border-[1.5px] border-beg-line object-cover" />
        ) : (
          <div className="mx-auto mt-5 grid size-16 place-items-center rounded-full bg-beg-lime text-[24px] font-extrabold text-beg-ink">
            {name.replace(/^@/, "")[0]?.toUpperCase()}
          </div>
        )}
        <p className="mt-2 font-bold text-beg-ink">{name}</p>
        <p className="font-mono text-[12px] text-beg-dim" title={receipt.to_wallet}>
          received {receipt.from_username ? `from @${receipt.from_username} · ` : ""}
          {receipt.to_wallet.slice(0, 6)}…{receipt.to_wallet.slice(-4)}
        </p>

        {receipt.message_hidden ? (
          <p className="mt-4 text-[13px] text-beg-dim italic">The attached message is private.</p>
        ) : receipt.message ? (
          <p className="mt-4 break-words rounded-2xl border-[1.5px] border-beg-line p-3 text-[13px] font-bold text-beg-ink">
            {receipt.message}
          </p>
        ) : null}

        <a
          href={txUrl(receipt.tx_hash)}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-4 inline-block text-[13px] text-beg-ink underline underline-offset-2"
        >
          View on explorer
        </a>

        {receipt.to_username ? <TipBackButton username={receipt.to_username} amount={receipt.amount} /> : null}
      </div>

      <p className="mt-4 text-center text-[12px] text-beg-dim">
        Receipts are generated from the indexer&apos;s confirmed transfers. BegFi is never the
        counterparty; check the tx, not the name.
      </p>
    </main>
  );
}
