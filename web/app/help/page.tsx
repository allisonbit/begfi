import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Help",
  description:
    "How BegFi pays, who holds the money, what happens to an unspent pot, and what the X tick means. Plain answers, including the limits.",
  alternates: { canonical: "/help" },
};

/**
 * /help — the questions behind the product.
 *
 * WHY A SEPARATE PAGE FROM /how. /how explains the four products to someone
 * deciding whether to use BegFi at all. This page answers the questions people
 * ask AFTER they have money in play: why a claim did not pay, who can see my
 * profile, what happened to the rest of the pot. Those answers are operational,
 * and they belong next to the support link rather than halfway down a pitch.
 *
 * Every custody sentence here is the same sentence as `docs/BEGFI_CONTEXT.md`.
 * The FAQ structured data is built from the same array the page renders, so a
 * crawler can never be told a different answer from a reader.
 */
type QA = { q: string; a: string };

const FAQ: QA[] = [
  {
    q: "What is BegFi?",
    a: "Four ways to move crypto with a link: a beg page, a Pay Link for an exact amount, a campaign that pays people to post, and a drop (giveaway) with a fixed prize. One wallet, one username, one dashboard.",
  },
  {
    q: "Does BegFi hold my money?",
    a: "Depends on the product, and the difference matters. Beg pages, tips and Pay Links move money straight from the payer's wallet to the receiver's. BegFi never holds those funds and cannot reverse a transaction. Campaign pools and drop pots are different: they are sent to a BegFi payout wallet and stay there until they are paid out to earners and claimers.",
  },
  {
    q: "How does a drop pay?",
    a: "The funder sends the pot to the BegFi payout wallet and registers the drop. A claim is accepted only if the pot still covers one whole prize and the cap has room. The claim takes a lease so it cannot be paid twice, and the prize is sent automatically after the transaction is sent. The claim page shows the transaction hash.",
  },
  {
    q: "Why did a drop stop paying?",
    a: "Three honest reasons: the cap was reached, the pot no longer covers a whole prize, or the drop was paused or ended. A fourth is operational: the payout wallet can be paused automatically when reconciliation finds it holds less than it owes. Transparency always shows that switch state.",
  },
  {
    q: "What happens to an unspent pot?",
    a: "It stays in the BegFi payout wallet. There is no automatic refund today, and no button that sends it back, so fund only what you intend to give away. This is a known limitation, stated on the drop page, the footer and in the docs rather than hidden behind a promise.",
  },
  {
    q: "How does Earn pay?",
    a: "A campaign has a daily budget and a rule for a valid post. Qualifying submissions are paid automatically from the campaign's pool, once per wallet per campaign per day. A campaign pays in its own token, at its own decimals; the campaign page shows the pool remaining and who was paid.",
  },
  {
    q: "What is claimable, and why is there a Claim button?",
    a: "Campaign and drop payouts are automatic, so they do not wait for a button. The Claim button exists for approved work in BegFi's original pool that has not been paid yet. The dashboard shows it only when there is something to claim.",
  },
  {
    q: "Who can claim a drop?",
    a: "One prize per wallet and one per verified X account, up to the cap, while the pot covers the prize. The site checks the wallet and, when a handle is verified, the X account. It does not use device fingerprinting: shared phones and shared networks were flagging honest people.",
  },
  {
    q: "What does the X tick mean?",
    a: "That the account on your profile proved it controls the handle by posting a one-use code from that account. The tick is tied to the handle it was proved against: change the handle and the tick goes with it.",
  },
  {
    q: "Is $BEGFI the protocol?",
    a: "No. $BEGFI is the token the site is named after, on Robinhood Chain. Beg pages, Pay Links and campaigns all work without holding it, and a campaign can pay in its own token. The address is pinned in the app so nobody has to trust a link.",
  },
  {
    q: "Why does a number say unavailable instead of zero?",
    a: "Because the read failed. A zero would be a statement about your money; unavailable is a statement about the database. The site does not turn a failed read into a number.",
  },
  {
    q: "How do I hide my profile?",
    a: "Settings has a visibility switch. Hiding removes your profile page from public view and takes you off the leaderboards and the sitemap. Your pay links keep working; they stop showing your name and avatar. You can turn it back on at any time.",
  },
];

const FAQ_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export default function HelpPage() {
  return (
    <div className="safe-x mx-auto max-w-[760px] py-10">
      <script
        type="application/ld+json"
        // The payload is built from FAQ above, not from request input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_SCHEMA) }}
      />

      <header>
        <p className="text-[12px] font-bold uppercase tracking-[.14em] text-beg-dim">Help</p>
        <h1 className="mt-2 text-[clamp(32px,7vw,56px)] font-extrabold leading-[1] tracking-[-.04em]">
          The answers, including the limits.
        </h1>
        <p className="mt-3 max-w-[62ch] text-beg-dim">
          The short version: payment links are wallet to wallet; campaign pools and drop pots are held by a BegFi
          payout wallet until paid out; nothing here is a promise of a return.
        </p>
      </header>

      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Help shortcuts">
        <Link href="/how" className="btn-ghost px-4 py-2 text-[13px]">
          How it works
        </Link>
        <Link href="/transparency" className="btn-ghost px-4 py-2 text-[13px]">
          The books
        </Link>
        <Link href="/terms" className="btn-ghost px-4 py-2 text-[13px]">
          Terms
        </Link>
        <Link href="/privacy" className="btn-ghost px-4 py-2 text-[13px]">
          Privacy
        </Link>
      </nav>

      <section className="mt-8 grid gap-2">
        {FAQ.map((item) => (
          <details key={item.q} className="card group p-5 open:border-beg-ink">
            <summary className="cursor-pointer list-none text-[15px] font-extrabold text-beg-ink marker:hidden">
              <span className="flex items-start justify-between gap-3">
                {item.q}
                <span aria-hidden className="mt-0.5 shrink-0 text-beg-dim transition-transform group-open:rotate-45">
                  +
                </span>
              </span>
            </summary>
            <p className="mt-3 text-[14px] leading-relaxed text-beg-dim">{item.a}</p>
          </details>
        ))}
      </section>

      <section className="mt-8 card p-5">
        <h2 className="text-[15px] font-extrabold">Still stuck?</h2>
        <p className="mt-2 text-[13px] text-beg-dim">
          A payout that should have landed has a transaction hash on its page or in your dashboard. Include it when
          you report the problem: a hash can be checked against the chain, a description cannot. The public books show
          the payout wallet, what is owed and whether payouts are paused.
        </p>
        <p className="mt-3 text-[13px]">
          <Link href="/transparency" className="underline decoration-beg-lime decoration-2 underline-offset-2">
            Check the books first
          </Link>{" "}
          <span className="text-beg-dim">— it answers most &ldquo;why didn&rsquo;t I get paid&rdquo; questions.</span>
        </p>
      </section>
    </div>
  );
}
