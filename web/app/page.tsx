import type { Metadata } from "next";
import Link from "next/link";
import { HomeHero } from "@/components/home-hero";
import { RobinhoodFeather } from "@/components/robinhood-feather";
import { BEG_CONFIGURED } from "@/lib/config";

export const metadata: Metadata = {
  title: "BegFi: the e-Begging protocol",
  description:
    "Ask onchain. Get paid. Launch tokens. BegFi is the e-Begging protocol on Robinhood Chain: claim your link, receive $BEGFI straight to your wallet, and launch a token from the same app. No roadmap to riches, just the audacity to ask. Anything helps 🙏",
};

/**
 * The launch section describes live terms. Standard launch is open to every
 * wallet on the shared factory (launch fee 0.0005 ETH, creator tax paid to the
 * launcher). Genesis mode stays reserved for the dev wallet. The copy states
 * exactly what is live rather than promising what is not.
 */
function LaunchSection() {
  return (
    <section className="animate-wobble py-8 pb-16">
      <span className="mb-5 inline-block rounded-full border-2 border-beg-ink bg-beg-lime px-3 py-1 text-[11px] font-bold uppercase tracking-[.06em]">
        Live now
      </span>

      <h2 className="mb-6 text-[clamp(36px,8vw,64px)] font-extrabold uppercase leading-[.95] tracking-[-.03em]">
        Launch a token.
        <br />
        Get paid on every trade.
      </h2>

      <p className="-mt-3 mb-6 max-w-[62ch] text-beg-dim text-[13px]">
        The launch pad is live. Every other person can launch, connect a wallet
        and pick standard. Genesis stays reserved for the dev wallet.
      </p>

      <div className="grid gap-3.5 md:grid-cols-2">
        <div className="card p-6 max-md:first:rotate-[-1deg] md:first:-rotate-1">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid size-[46px] place-items-center rounded-xl border-2 border-beg-ink bg-beg-lime font-extrabold text-beg-ink shadow-glow">
              B
            </div>
            <div>
              <b className="text-[19px]">$BEGFI</b>
              <small className="block text-beg-dim">The genesis launch, dev wallet only</small>
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
              <small className="block text-beg-dim">Open to everyone, launch a token today</small>
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
        The launch form lives on /launch. Standard mode is open to every wallet;
        the fee is charged by the factory, not collected here.
      */}
      <p className="notice mt-3.5">
        The launch form is on the{" "}
        <Link href="/launch" className="text-beg-ink underline underline-offset-2">
          Launch page
        </Link>
        . Every other person can launch, today.
      </p>
    </section>
  );
}

/**
 * The pitch, in the timeline's own words.
 *
 * "BegFi" is already a word on Crypto Twitter: the meta of asking openly for
 * airdrops and spare change, born under a mega airdrop, celebrated and shamed
 * at once. The copy below speaks that language on purpose — CT lore, B2E, the
 * street sign — while keeping the honesty rules: lore is attributed as lore,
 * and no number is claimed that the protocol cannot prove.
 */
function ManifestoSection() {
  return (
    <section className="animate-wobble py-6">
      <h2 className="mb-2 text-[clamp(30px,6vw,44px)] font-extrabold uppercase leading-[.95] tracking-[-.03em]">
        The begfi meta.
      </h2>
      <p className="mb-6 max-w-[60ch] text-[13px] text-beg-dim">
        Started as a joke on the timeline. Became the whole game. BegFi is that
        ask, onchain, at your own link.
      </p>

      <div className="grid gap-3.5 md:grid-cols-3">
        <div className="card p-6 max-md:first:rotate-[-1deg] md:first:rotate-1">
          <div className="mb-3 inline-block rounded-full border-2 border-beg-ink bg-beg-lime px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.06em]">
            How it started
          </div>
          <p className="text-[14px] leading-relaxed">
            CT coined it by begging under a mega airdrop. Then one anon simply
            asked, and got $250,000. The tl swore it was shameful, the tl kept
            asking.
          </p>
        </div>

        <div className="card p-6 max-md:first:rotate-[0.5deg] md:first:-rotate-1">
          <div className="mb-3 inline-block rounded-full border-2 border-beg-ink bg-beg-blue px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.06em] text-beg-ink">
            Beg to earn
          </div>
          <p className="text-[14px] leading-relaxed">
            Crypto was always B2E: beg to earn. The street signs say "will work
            for anything". BegFi is that sign, onchain, with receipts, and no
            middleman taking a cut.
          </p>
        </div>

        <div className="card p-6 max-md:first:rotate-[-0.5deg] md:first:rotate-2">
          <div className="mb-3 inline-block rounded-full border-2 border-beg-ink bg-beg-yellow px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.06em]">
            The ask
          </div>
          <p className="text-[14px] leading-relaxed">
            No roadmap to riches. Any VCs want to fund my decentralized
            begging protocol? No? Then spare some Robinhood ETH 🙏 Anything
            helps.
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
          beg<span className="text-beg-logo">fi</span>
          <RobinhoodFeather className="ml-[0.1em] text-beg-logo" />
        </span>
        <span className="text-sm">
          Built on Robinhood Chain, {BEG_CONFIGURED ? "$BEGFI is live" : "$BEGFI not launched yet"}
        </span>
      </footer>
    </div>
  );
}
