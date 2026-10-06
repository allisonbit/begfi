import type { Metadata } from "next";
import Link from "next/link";
import { HomeHero } from "@/components/home-hero";
import { BEG_CONFIGURED } from "@/lib/config";

export const metadata: Metadata = {
  title: "BegFi",
  description:
    "Your link. Their $BEG. Straight to your wallet. A non-custodial payment link on Robinhood Chain.",
};

/**
 * The launch section describes a product that does not exist yet, and says so.
 *
 * Spec §9.2 defines the fee model, and it is worth stating, because it is a
 * promise the product intends to keep. What it is NOT is live terms: no
 * contracts are deployed, no token has launched, and there is no form here that
 * could deploy anything. The wording below draws that line explicitly rather
 * than leaving a reader to infer it from a disabled button.
 */
function LaunchSection() {
  return (
    <section className="py-8 pb-16">
      <h2 className="mb-6 text-[clamp(36px,8vw,64px)] font-extrabold uppercase leading-[.95] tracking-[-.03em]">
        Launch a token.
        <br />
        Get paid on every trade.
      </h2>

      <p className="-mt-3 mb-6 max-w-[62ch] text-[13px] text-beg-dim">
        Planned. No contracts are deployed and no token has been launched. The fee splits below are the
        intended design, not live terms.
      </p>

      <div className="grid gap-3.5 md:grid-cols-2">
        <div className="card p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid size-[46px] place-items-center rounded-2xl bg-beg-lime font-extrabold text-beg-bg shadow-glow">
              B
            </div>
            <div>
              <b className="text-[19px]">$BEG</b>
              <small className="block text-beg-dim">Intended first launch on BegFi</small>
            </div>
          </div>
          <div className="flex h-3 gap-[3px] overflow-hidden rounded-full">
            <i className="block w-full bg-beg-lime" />
          </div>
          <div className="mb-3.5 mt-2 flex justify-between text-xs text-beg-dim">
            <span>5% trading fee</span>
            <span>100% to the dev wallet</span>
          </div>
        </div>

        <div className="card p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid size-[46px] place-items-center rounded-2xl bg-beg-ink font-extrabold text-beg-bg">
              +
            </div>
            <div>
              <b className="text-[19px]">Every other launch</b>
              <small className="block text-beg-dim">3% trading fee, split three ways</small>
            </div>
          </div>
          <div className="flex h-3 gap-[3px] overflow-hidden rounded-full">
            <i className="block w-1/3 bg-beg-lime" />
            <i className="block w-1/3 bg-white" />
            <i className="block w-[34%] bg-[#5b6370]" />
          </div>
          <div className="mb-3.5 mt-2 flex justify-between text-xs text-beg-dim">
            <span>1% BegFi</span>
            <span>1% $BEG growth fund</span>
            <span>1% launcher</span>
          </div>
        </div>
      </div>

      {/*
        No launch form. A form that cannot submit is a promise the page cannot
        keep, and the honest version of "not yet" is a sentence, not a dead input.
      */}
      <p className="notice mt-3.5">
        The launch form is at{" "}
        <Link href="/launch" className="text-beg-ink underline underline-offset-2">
          /launch
        </Link>
        .
      </p>
    </section>
  );
}

export default function HomePage() {
  return (
    <div className="safe-x mx-auto max-w-[1000px]">
      <main>
        <HomeHero />
        <LaunchSection />
      </main>

      <footer className="flex flex-wrap justify-between gap-2.5 border-t border-beg-line py-7 pb-12 text-beg-dim">
        <span className="text-2xl font-extrabold tracking-[-0.04em] text-beg-ink">
          beg<span className="text-beg-lime">fi</span>
        </span>
        <span className="text-sm">
          Built on Robinhood Chain, {BEG_CONFIGURED ? "$BEG is live" : "$BEG not launched yet"}
        </span>
      </footer>
    </div>
  );
}
