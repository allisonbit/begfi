import type { Metadata } from "next";

import { CopyLink } from "@/components/copy-link";
import { PayLinkForm } from "@/components/pay-link-form";
import { PayLinkList, type PayLinkListItem } from "@/components/pay-link-list";
import { linkFor } from "@/lib/config";
import { listOwnPayLinks, settlementFor, type PayLinkView } from "@/lib/pay-links";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = { title: "Pay links" };
export const dynamic = "force-dynamic";

/**
 * Pay links: ask for an amount, get a link that carries the number.
 *
 * WHAT THIS PAGE IS FOR. `/[username]` is "send me something"; this is "send me
 * 20 for lunch". The number, the note and the link are the product, and the
 * person who asks has to be able to see at a glance which of their requests have
 * been answered — which is why every row carries the received total and a state
 * badge rather than only a copy button.
 *
 * THE PAID BADGE IS NOW FREE FOR EVERY ROW, and that changed with migration
 * 0027: the indexer records the settling transfer on the request itself, so the
 * badge reads a column instead of searching the owner's transfers. Every request
 * this account ever had shows its true state — not just the newest twelve.
 *
 * THE RECEIVED TOTAL IS STILL CAPPED, and the cap is stated instead of hidden:
 * the running total comes from `received_since`, one aggregate call per row, so
 * it is computed for the twelve most recent requests. A receiver with more than
 * twelve sees all of them, with the older ones showing their amount, their state
 * and their link — and each one's own page computes its exact total. Doing it for
 * every row would turn opening this tab into dozens of queries for numbers that
 * are one click away.
 */
const SETTLE_LIMIT = 12;

export default async function PayLinksPage() {
  const profile = await getProfile();
  if (!profile) return null;

  const links = await listOwnPayLinks(profile.id);

  const recent = links.slice(0, SETTLE_LIMIT);
  const settled = await Promise.all(
    recent.map(async (row) => {
      /*
       * A full `PayLinkView`, assembled from the row plus this profile, so the
       * dashboard and the public page settle the same link through the same
       * function. Two implementations of "was this paid" is the bug this
       * avoids — and the owner's own identity here is not a guess: it is the
       * session's profile.
       */
      const view: PayLinkView = {
        ...row,
        owner_wallet: profile.wallet_address,
        owner_username: profile.username,
        owner_display_name: null,
        owner_avatar_url: null,
        owner_is_hidden: false,
      };
      return settlementFor(view);
    }),
  );

  const items: PayLinkListItem[] = links.map((row, index) => ({
    id: row.id,
    amount: row.amount,
    memo: row.memo,
    is_active: row.is_active,
    created_at: row.created_at,
    received_total: index < SETTLE_LIMIT ? (settled[index]?.received_total ?? null) : null,
    // The row's own settlement first (exact, and free), the computed fallback
    // second — which is what covers requests paid before migration 0027 recorded
    // settlements at all.
    paid: row.settled_tx !== null || (index < SETTLE_LIMIT && settled[index]?.status === "paid"),
  }));

  const overflow = links.length - recent.length;

  return (
    <>
      <header>
        <h1 className="text-[clamp(28px,6vw,40px)] font-extrabold tracking-[-.05em]">Pay links</h1>
        <p className="mt-1 text-beg-dim">
          A request with an amount and a note. Share the link; the money comes straight to your wallet.
        </p>
      </header>

      <CopyLink url={linkFor(profile.username)} />

      <section className="card grid gap-4">
        <h2 className="text-xl font-extrabold tracking-[-.03em]">New request</h2>
        <PayLinkForm />
      </section>

      <section>
        <h2 className="mb-3 text-xl font-extrabold tracking-[-.03em]">Your requests</h2>
        <PayLinkList items={items} />
        {overflow > 0 ? (
          <p className="mt-3 text-[12px] text-beg-dim">
            {overflow} older {overflow === 1 ? "request is" : "requests are"} listed without a live total.
            Each one&apos;s own page shows its exact received amount.
          </p>
        ) : null}
      </section>
    </>
  );
}
