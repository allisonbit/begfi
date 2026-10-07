import type { Metadata } from "next";
import Link from "next/link";
import { HomeHero } from "@/components/home-hero";
import { BEG_CONFIGURED } from "@/lib/config";

export const metadata: Metadata = {
  title: "BegFi — beg boldly, anything helps",
  description:
    "The e-begging protocol. BegFi is a non-custodial $BEG payment link on Robinhood Chain: your link, their $BEG, straight to your wallet. No roadmap to riches, just the audacity to ask. Anything helps 🙏",
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
    <section className="animate-wobble py-8 pb-16">
      <span className="mb-5 inline-block rounded-full border-2 border-beg-ink bg-beg-yellow px-3 py-1 text-[11px] font-bold uppercase tracking-[.06em]">
        Planned, not live
      </span>

      <h2 className="mb-6 text-[clamp(36px,8vw,64px)] font-extrabold uppercase leading-[.95] tracking-[-.03em]">
        Launch a token.
        <br />
        Get paid on every trade.
      </h2>

      <p className="-mt-3 mb-6 max-w-[62ch] text-[13px] text-beg-dim">
        Planned. No contracts are deployed and no token has been launched. The fees below are the
        intended design, not live terms.
      </p>

      <div className="grid gap-3.5 md:grid-cols-2">
        <div className="card p-6 max-md:first:rotate-[-1deg] md:first:-rotate-1">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid size-[46px] place-items-center rounded-xl border-2 border-beg-ink bg-beg-lime font-extrabold text-white shadow-glow">
              B
            </div>
            <div>
              <b className="text-[19px]">$BEG</b>
              <small className="block text-beg-dim">Intended first launch on BegFi</small>
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[64px] font-extrabold leading-none tracking-[-.04em]">5%</span>
            <span className="text-[13px] font-bold text-beg-dim">trading fee</span>
          </div>
          <div className="mt-4 flex h-3 gap-[3px] overflow-hidden rounded-full border-2 border-beg-ink bg-beg-card">
            <i className="block w-full bg-beg-lime" />
          </div>
        </div>

        <div className="card p-6 max-md:last:rotate-[1deg] md:last:rotate-1">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid size-[46px] place-items-center rounded-xl border-2 border-beg-ink bg-beg-yellow font-extrabold text-beg-ink">
              +
            </div>
            <div>
              <b className="text-[19px]">Every other launch</b>
              <small className="block text-beg-dim">Anyone can launch a token</small>
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[64px] font-extrabold leading-none tracking-[-.04em]">3%</span>
            <span className="text-[13px] font-bold text-beg-dim">trading fee</span>
          </div>
          <div className="mt-4 flex h-3 gap-[3px] overflow-hidden rounded-full border-2 border-beg-ink bg-beg-card">
            <i className="block w-full bg-beg-yellow" />
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

/**
 * The pitch, in the page's own words. These are claims about what BegFi *is*,
 * not numbers it cannot prove: no volume, no user count, no projection — the
 * honesty rules in the file header apply to jokes too.
 */
function ManifestoSection() {
  return (
    <section className="animate-wobble py-6">
      <h2 className="mb-6 text-[clamp(30px,6vw,44px)] font-extrabold uppercase leading-[.95] tracking-[-.03em]">
        Why beg onchain?
      </h2>

      <div className="grid gap-3.5 md:grid-cols-3">
        <div className="card p-6 max-md:first:rotate-[-1deg] md:first:rotate-1">
          <div className="mb-3 inline-block rounded-full border-2 border-beg-ink bg-beg-lime px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.06em]">
            BegFi for airdrops
          </div>
          <p className="text-[14px] leading-relaxed">
            Fork a link, drop it under any airdrop thread, and sign. Whoever wants
            to help, helps; straight to your wallet, no middleman taking a cut.
          </p>
        </div>

        <div className="card p-6 max-md:first:rotate-[0.5deg] md:first:-rotate-1">
          <div className="mb-3 inline-block rounded-full border-2 border-beg-ink bg-beg-blue px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.06em] text-white">
            The irl industry
          </div>
          <p className="text-[14px] leading-relaxed">
            IRL begging is a huge industry. Street signs say "will work for
            anything". BegFi just brings it onchain, with receipts.
          </p>
        </div>

        <div className="card p-6 max-md:first:rotate-[-0.5deg] md:first:rotate-2">
          <div className="mb-3 inline-block rounded-full border-2 border-beg-ink bg-beg-yellow px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.06em]">
            Dear VC friends
          </div>
          <p className="text-[14px] leading-relaxed">
            Any VC want to fund my decentralized e-begging protocol? No? Then
            spare some Robinhood ETH. 🙏 Anything helps.
          </p>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <div className="safe-x mx-auto max-w-[1000px]">
      <main>
        <HomeHero />
        <ManifestoSection />
        <LaunchSection />
      </main>

      <footer className="flex flex-wrap justify-between gap-2.5 border-t-[3px] border-beg-ink py-7 pb-12 text-beg-dim">
        <span className="text-2xl font-extrabold tracking-[-0.04em] text-beg-ink">
          beg<span className="text-beg-blue">fi</span>
        </span>
        <span className="text-sm">
          Built on Robinhood Chain, {BEG_CONFIGURED ? "$BEG is live" : "$BEG not launched yet"}
        </span>
      </footer>
    </div>
  );
}
