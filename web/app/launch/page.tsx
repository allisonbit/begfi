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
 * The form reads the fee, the creator-tax ceiling and the economics commitment
 * live from the factory, so this page cannot drift out of step with the
 * contract it is talking to.
 */
export default function LaunchPage() {
  return (
    <div className="mx-auto max-w-[1000px] px-5">

      <main className="mx-auto grid max-w-[560px] gap-6 py-10">
        <header>
          <h1 className="text-[clamp(36px,8vw,56px)] font-extrabold leading-[.95] tracking-[-.05em]">
            Launch a token
          </h1>
          <p className="mt-2 text-beg-dim">
            Fixed supply, paired against robinhood ETH, owned by your wallet from the first block.
          </p>
        </header>

        <LaunchForm />

        {/*
          Spec §9.5 and §12 both require this, and it is also simply true: BegFi
          does not vet what anyone launches through it, and a launchpad that
          implied otherwise would be lending its name to strangers.
        */}
        <p className="rounded-2xl border-[1.5px] border-beg-line p-4 text-[13px] text-beg-dim">
          Anyone can launch a token here. Tokens are not endorsed by BegFi or by Robinhood, and nothing
          here is financial advice. Check a contract before you trade it — a launch cannot be undone.
        </p>

        <p className="text-[13px] text-beg-dim">
          Launches run on Pons&apos; contracts on Robinhood Chain. Read the{" "}
          <Link href="/terms" className="text-beg-ink underline underline-offset-2">
            terms
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
