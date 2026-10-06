import type { Metadata } from "next";
import Link from "next/link";
import { LaunchForm } from "@/components/launch-form";

export const metadata: Metadata = {
  title: "Launch a token",
  description: "Launch a fixed-supply token on Robinhood Chain, paid for and owned by your own wallet.",
};

/**
 * The launch page.
 *
 * BegFi is the front end here, not the protocol: the launch goes through Pons'
 * deployed factory, the launcher's own wallet signs and pays, and BegFi never
 * touches the fee. That is why there is no "connect to launch" step beyond the
 * wallet itself — there is nothing for BegFi to hold.
 *
 * The form reads the fee, the creator-tax ceiling, the economics commitment and
 * the factory's enabled flag live from the contract, so this page cannot drift
 * out of step with the thing it is talking to. Every number in the "how it
 * works" strip below was read off the live factory (config 0) rather than taken
 * from a document: 1,000,000,000 fixed supply, 1% curve fee, 1.68 ETH opening
 * phantom quote, 4.2 ETH graduation, 0.0005 ETH launch fee.
 */
export default function LaunchPage() {
  return (
    <div className="safe-x mx-auto grid max-w-[1000px] gap-12 py-8">
      <div className="mx-auto grid w-full max-w-[560px] gap-6">
        <header>
          <h1 className="text-[clamp(36px,8vw,56px)] font-extrabold leading-[.95] tracking-[-.05em]">
            Launch a token
          </h1>
          <p className="mt-2 text-beg-dim">
            Fixed supply, priced in robinhood ETH from the first block, with a creator tax on every
            trade that is paid to your wallet.
          </p>
        </header>

        <LaunchForm />

        {/*
          Spec §9.5 and §12 both require this, and it is also simply true: BegFi
          does not vet what anyone launches through it, and a launchpad that
          implied otherwise would be lending its name to strangers.
        */}
        <p className="notice">
          Anyone can launch a token here. Tokens are not endorsed by BegFi or by Robinhood, and
          nothing here is financial advice. Check a contract before you trade it — a launch cannot
          be undone.
        </p>

        <p className="text-[13px] text-beg-dim">
          Launches run on Pons&apos; contracts on Robinhood Chain. Read the{" "}
          <Link href="/terms" className="text-beg-ink underline underline-offset-2">
            terms
          </Link>
          .
        </p>
      </div>

      {/*
        What actually happens, in the order it happens. Kept to facts the
        factory itself asserts — nothing here is a promise BegFi makes on Pons'
        behalf.
      */}
      <section className="grid gap-4">
        <h2 className="text-[clamp(22px,5vw,28px)] font-extrabold tracking-[-.03em]">
          How a launch works
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="card grid gap-2">
            <span className="text-[13px] font-bold text-beg-lime">1 — Describe it</span>
            <p className="text-[13px] text-beg-dim">
              Name, ticker, logo, optional socials — and a 3% creator tax that goes to your wallet
              on every trade, for the life of the token.
            </p>
          </div>
          <div className="card grid gap-2">
            <span className="text-[13px] font-bold text-beg-lime">2 — Sign and pay the fee</span>
            <p className="text-[13px] text-beg-dim">
              One transaction from your wallet: the 0.0005 ETH launch fee plus gas. BegFi never
              touches it. The token is created with a fixed supply of 1,000,000,000.
            </p>
          </div>
          <div className="card grid gap-2">
            <span className="text-[13px] font-bold text-beg-lime">3 — It trades on the curve</span>
            <p className="text-[13px] text-beg-dim">
              Priced against robinhood ETH immediately. Traders pay the 1% curve fee plus your 3%,
              which accrues to you in Pons&apos; escrow — claim it any time from{" "}
              <Link href="/dashboard/launches" className="text-beg-ink underline underline-offset-2">
                Dashboard → Launches
              </Link>
              . The pool graduates at 4.2 ETH.
            </p>
          </div>
        </div>
      </section>

      <section className="card-hover card flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[17px] font-bold text-beg-ink">See what others have launched</p>
          <p className="mt-1 text-[13px] text-beg-dim">
            Every token this factory has produced recently, on one page.
          </p>
        </div>
        <Link href="/explore" className="btn-primary shrink-0">
          Explore
        </Link>
      </section>
    </div>
  );
}
