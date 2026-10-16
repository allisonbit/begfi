import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PayLinkShare } from "@/components/pay-link-share";
import { SendPanel } from "@/components/send-panel";
import { shortAddress, txUrl } from "@/lib/chains";
import { publicUrl } from "@/lib/config";
import { formatAmount } from "@/lib/erc20";
import { getPayLink, isPayLinkId, settlementFor } from "@/lib/pay-links";

export const dynamic = "force-dynamic";

/**
 * /pay/<id> — one request, one link, money straight to a wallet.
 *
 * THE PAYER NEEDS NO ACCOUNT. Open the link, connect a wallet, send. The
 * transfer goes from the payer's wallet to the receiver's wallet through the
 * same `SendPanel` the profile page uses — one implementation of a transfer on
 * this site, not two, so every guard (wrong network, no gas, insufficient
 * balance, the irreversible-send acknowledgement) is identical here by
 * construction rather than by copying.
 *
 * WHAT "PAID" MEANS HERE. Not a row we own: a confirmed `Transfer` the indexer
 * recorded. `settlementFor` derives it, so a page can be wrong about a name but
 * cannot be wrong about the money.
 *
 * WHY NOTHING HERE SHOWS WHO PAID. The `transfers` policy in migration 0001 is
 * involved-parties-only for a stated reason — a public transfers table publishes
 * everyone's payment history. So the page shows the aggregate that is already
 * public for begs, the amount, and the settling transaction's hash (public
 * on-chain, and already the content of `/t/<tx>`). The payer's address is not
 * rendered because it is not fetched.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!isPayLinkId(id)) return { title: "That request link isn't right." };

  const link = await getPayLink(id);
  if (!link) return { title: "This request isn't on file." };

  const who = link.owner_username ? `@${link.owner_username}` : shortAddress(link.owner_wallet);
  const ask = link.amount ? `${formatAmount(BigInt(link.amount))} $BEGFI` : "$BEGFI";
  const title = link.memo ? `${link.memo}` : `Pay ${who} ${ask}`;

  return {
    title,
    description: `A BegFi payment request: ${ask} to ${who}, wallet to wallet on Robinhood Chain.`,
    openGraph: { title, url: publicUrl(`/pay/${id}`) },
    twitter: { card: "summary_large_image" },
    alternates: { canonical: publicUrl(`/pay/${id}`) },
  };
}

export default async function PayLinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A malformed id is a 404, not a database error — `isPayLinkId` keeps
  // "someone mistyped a URL" out of the logs as a 22P02.
  if (!isPayLinkId(id)) notFound();

  const link = await getPayLink(id);
  if (!link) notFound();

  const settlement = await settlementFor(link);
  const url = publicUrl(`/pay/${link.id}`);
  const who = link.owner_username ? `@${link.owner_username}` : shortAddress(link.owner_wallet);
  const ask = link.amount ? `${formatAmount(BigInt(link.amount))} $BEGFI` : null;
  const received = settlement.received_total ? formatAmount(BigInt(settlement.received_total)) : null;

  return (
    <div className="safe-x mx-auto grid max-w-[620px] gap-6 py-8">
      <header className="grid gap-2">
        <span className="w-fit rounded-md border-[1.5px] border-beg-line px-2 py-0.5 text-[11px] font-bold uppercase tracking-[.09em] text-beg-dim">
          Payment request
        </span>
        <h1 className="text-[clamp(28px,7vw,44px)] font-extrabold leading-[1.05] tracking-[-.04em]">
          {link.memo ?? "Pay me in $BEGFI"}
        </h1>
        <p className="text-beg-dim">
          to{" "}
          {link.owner_username ? (
            <Link href={`/${link.owner_username}`} className="font-bold text-beg-ink hover:underline">
              {who}
            </Link>
          ) : (
            <span className="font-bold text-beg-ink">{who}</span>
          )}
          {link.owner_is_hidden ? " (wallet only — this account keeps its name private)" : null}
        </p>
      </header>

      <section className="card grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[clamp(30px,8vw,44px)] font-extrabold tracking-[-.04em] text-beg-ink">
            {ask ?? "Any amount"}
          </div>
          <StatusChip status={settlement.status} />
        </div>

        {/*
         * The received line is the aggregate `received_since` returns — exact
         * however many payments arrive, and the same number the profile page
         * shows for a beg. It is shown even when it is zero, because a zero that
         * is a fact is worth more than a blank that might be a bug.
         */}
        <p className="text-[13px] text-beg-dim">
          {settlement.status === "unknown" ? (
            "We couldn't read the chain just now, so the received total is unavailable — the request itself still works."
          ) : (
            <>
              {received ?? "0"} $BEGFI received since this request was created.
              {settlement.status === "paid" && settlement.settling_tx ? (
                <>
                  {" "}
                  <a
                    href={txUrl(settlement.settling_tx)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline underline-offset-2 hover:text-beg-ink"
                  >
                    See the payment
                  </a>
                  .
                </>
              ) : null}
            </>
          )}
        </p>

        {/*
         * THE SEND PANEL IS KEYED OFF THE LINK, NOT OFF SETTLEMENT.
         *
         * `settlement.status` answers a different question — has money arrived —
         * and "paid" deliberately beats "closed" there, because a retired link
         * whose ask was met is still a link that was paid (see `settlementFor`).
         * Deciding whether to OFFER a payment from that status therefore got the
         * retired case exactly backwards: a closed link that had been paid
         * rendered a send panel, inviting more money to a request its owner had
         * already retired. The link's own `is_active` is the only field that
         * answers "should this still take payments", so that is what this
         * branch reads.
         */}
        {!link.is_active ? (
          <p className="notice p-4 text-[13px]">
            This request was closed by {who}. Nothing is wrong — the link is simply retired, and any money
            that already arrived is in their wallet.
          </p>
        ) : (
          <SendPanel
            recipient={link.owner_wallet}
            username={link.owner_username ?? undefined}
            initialAmount={link.amount ? formatAmount(BigInt(link.amount)) : undefined}
            lockAmount={Boolean(link.amount)}
          />
        )}
      </section>

      <PayLinkShare
        url={url}
        amount={ask}
        memo={link.memo}
        payLinkId={link.id}
        label={who}
      />

      <footer className="grid gap-1 text-[12px] text-beg-dim">
        <p>
          This request is an ask, not an account. The money goes straight from your wallet to theirs —
          BegFi never holds it, takes no fee, and cannot reverse a transfer.
        </p>
        <p>
          Only the amount and the transaction are shown here. Who paid is between you and the chain.
        </p>
      </footer>
    </div>
  );
}

/** The one badge, with four honest states rather than two. */
function StatusChip({ status }: { status: "paid" | "waiting" | "closed" | "unknown" }) {
  const map = {
    paid: { label: "Paid", className: "bg-beg-lime text-beg-ink" },
    waiting: { label: "Waiting for payment", className: "bg-beg-bg text-beg-dim" },
    closed: { label: "Closed", className: "bg-beg-bg text-beg-dim" },
    // A failed read is not a status, and the chip says so rather than claiming
    // "waiting" — which would be a lie about money.
    unknown: { label: "Status unavailable", className: "bg-beg-bg text-beg-dim" },
  } as const;

  const { label, className } = map[status];

  return (
    <span
      className={`rounded-full border-[1.5px] border-beg-ink px-3 py-1 text-[12px] font-bold ${className}`}
    >
      {label}
    </span>
  );
}
