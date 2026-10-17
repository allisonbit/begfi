import type { Metadata } from "next";
import Link from "next/link";

import { CopyCA } from "@/components/copy-ca";
import { EXPLORER } from "@/lib/chains";
import { TOKEN_CA } from "@/lib/config";

export const metadata: Metadata = {
  title: "How BegFi works",
  description:
    "Ask for crypto, give it away, or run a campaign. One link, under a minute. How Beg pages, Pay Links, Earn campaigns and Drops work, what BegFi holds and what it never touches, and what $BEGFI is.",
  alternates: { canonical: "/how" },
};

/**
 * /how — the page that answers "what is this?" without a wallet.
 *
 * WHY IT EXISTS. The home page sells the four products in cards, the docs
 * explain the machinery to whoever is building it, and nothing in between said
 * how the money actually moves. That gap was filled by whoever was writing copy
 * that week, which is how a site ends up implying a refund it does not have. The
 * custody section below is deliberately the longest part of the page, and every
 * claim on it is one the code makes true.
 */
export default function HowPage() {
  return (
    <div className="safe-x mx-auto max-w-[820px] py-12">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[.14em] text-beg-dim">How it works</p>
        <h1 className="mt-2 text-[clamp(34px,8vw,60px)] font-extrabold leading-[1] tracking-[-.04em]">
          One link. Under a minute.
        </h1>
        <p className="mt-4 max-w-[62ch] text-lg text-beg-dim">
          BegFi is four ways to move crypto with a link: ask for it, request an exact amount, pay people to
          post about your project, or give it away. You do not need an account to pay or claim.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/#claim" className="btn-primary px-5 py-3">
            Claim your link
          </Link>
          <Link href="/earn" className="btn-ghost px-5 py-3">
            Browse Earn
          </Link>
        </div>
      </header>

      <section className="mt-12 grid gap-4">
        <h2 className="text-2xl font-extrabold tracking-[-.03em]">The four products</h2>

        <article className="card p-6">
          <h3 className="text-lg font-extrabold">Beg pages</h3>
          <p className="mt-2 text-[15px] text-beg-dim">
            Claim a username and you get <span className="font-mono text-beg-ink">begfi.io/yourname</span>, a page
            with your avatar, a short bio, your socials, a QR code and a send box. Anyone can send $BEGFI straight
            from their wallet. You can also write a beg: a short public ask, optionally with a goal, which gets its
            own shareable page and a progress bar. The money never passes through BegFi.
          </p>
          <p className="mt-3 text-[14px]">
            <Link href="/begs" className="underline decoration-beg-lime decoration-2 underline-offset-2">
              See the newest begs
            </Link>
          </p>
        </article>

        <article className="card p-6">
          <h3 className="text-lg font-extrabold">Pay Links</h3>
          <p className="mt-2 text-[15px] text-beg-dim">
            A Pay Link is a request with a number on it. Pick an amount (or leave it open), add one line about what
            it is for, and share the link. The payer sees the amount, the memo and a QR; they connect a wallet and
            send. The link shows the total received and marks itself paid when the confirmed transfer covers the
            ask. Who paid stays private.
          </p>
          <p className="mt-3 text-[14px]">
            <Link href="/dashboard/pay-links" className="underline decoration-beg-lime decoration-2 underline-offset-2">
              Create a request
            </Link>
          </p>
        </article>

        <article className="card p-6">
          <h3 className="text-lg font-extrabold">Earn campaigns</h3>
          <p className="mt-2 text-[15px] text-beg-dim">
            A project funds a pool and writes the rule: a post must contain a mention or a hashtag. People submit
            the link to their post, the site checks it, and qualifying entries are paid from the pool
            automatically, once per wallet per day. A campaign pays in its own token, at its own daily budget, and
            has its own leaderboard. You can also run an individual campaign with a budget that is yours.
          </p>
          <ol className="mt-3 grid gap-1.5 text-[14px] text-beg-dim">
            <li>1. Connect a wallet and claim a username.</li>
            <li>2. Find a campaign and read its rule.</li>
            <li>3. Post, submit the link, and get paid if it checks out.</li>
          </ol>
          <p className="mt-3 text-[14px]">
            <Link href="/earn" className="underline decoration-beg-lime decoration-2 underline-offset-2">
              Open Earn
            </Link>
          </p>
        </article>

        <article className="card p-6">
          <h3 className="text-lg font-extrabold">Drops</h3>
          <p className="mt-2 text-[15px] text-beg-dim">
            A drop is a pot with a fixed prize, a cap on how many people can take it, and one prize per wallet and
            per verified X account. Fund it, open it, share the link. A claim is paid automatically and lands in
            seconds. No raffle draw and no waiting list: the first people to claim take the prize, until the pot or
            the cap runs out.
          </p>
          <p className="mt-3 text-[14px]">
            <Link href="/drops" className="underline decoration-beg-lime decoration-2 underline-offset-2">
              See live drops
            </Link>
          </p>
        </article>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-extrabold tracking-[-.03em]">Who holds the money</h2>
        <div className="mt-4 grid gap-3">
          <div className="rounded-2xl border-[1.5px] border-beg-line p-5">
            <p className="text-[13px] font-bold uppercase tracking-[.1em] text-beg-lime">Wallet to wallet</p>
            <p className="mt-2 text-[15px] text-beg-dim">
              Beg pages, tips and Pay Links move $BEGFI from the payer&apos;s wallet to the receiver&apos;s wallet.
              BegFi is not in the middle. It cannot reverse a send, cannot recover money sent to the wrong address,
              and cannot freeze a balance.
            </p>
          </div>
          <div className="rounded-2xl border-[1.5px] border-beg-yellow p-5">
            <p className="text-[13px] font-bold uppercase tracking-[.1em] text-beg-ink">Held until paid out</p>
            <p className="mt-2 text-[15px] text-beg-dim">
              Campaign pools and drop pots are funded to a BegFi payout wallet and paid out from there. That is a
              different promise from a payment link, and the difference matters: the pool is only as safe as that
              wallet, and an unspent remainder stays there. There is no automatic refund. Fund only what you intend
              to give away.
            </p>
            <p className="mt-3 text-[14px]">
              <Link href="/transparency" className="underline decoration-beg-lime decoration-2 underline-offset-2">
                Check the books
              </Link>{" "}
              for the live balance, what is owed, and the switch state.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-extrabold tracking-[-.03em]">How a payout is decided</h2>
        <p className="mt-3 text-[15px] text-beg-dim">
          A payout is a row that says it has not been paid, a lease that stops two sweeps paying it at once, a check
          that the wallet has the token and the gas, and a confirmed transfer before the row is marked sent. Failed
          sends stay visible and are retried. One switch can pause every payout path at once, and hourly
          reconciliation compares what is owed against what the wallet holds and pauses payouts before it raises an
          alarm on a shortfall. The point is that no number on this site is marked paid before the chain says so.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-extrabold tracking-[-.03em]">$BEGFI</h2>
        <p className="mt-3 text-[15px] text-beg-dim">
          $BEGFI is the token this site is named after, on Robinhood Chain. It is not the protocol: beg pages, pay
          links and campaigns all work without holding it, and campaigns can pay in their own token. The address is
          fixed in the app so nobody has to trust a link:
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <CopyCA address={TOKEN_CA} />
          <a
            href={`${EXPLORER}/address/${TOKEN_CA}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[13px] text-beg-dim underline underline-offset-2 hover:text-beg-ink"
          >
            View on the explorer
          </a>
        </div>
        <p className="mt-4 text-[13px] text-beg-dim">
          Nothing here is financial advice. No page on BegFi promises a return, a price or a yield. BegFi is not
          affiliated with Robinhood. Terms are at{" "}
          <Link href="/terms" className="underline underline-offset-2">
            /terms
          </Link>{" "}
          and privacy at{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            /privacy
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
