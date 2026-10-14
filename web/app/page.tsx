import type { Metadata } from "next";
import { HomeHero } from "@/components/home-hero";
import { TokenStats } from "@/components/token-stats";
import { RobinhoodFeather } from "@/components/robinhood-feather";

export const metadata: Metadata = {
  title: "BegFi: the e-Begging protocol",
  description:
    "Ask onchain. Get paid. BegFi is the e-Begging protocol on Robinhood Chain: claim your link and receive $BEGFI straight to your wallet. No roadmap to riches, just the audacity to ask. Anything helps 🙏",
};

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
        <TokenStats />
      </main>

      <footer className="flex flex-wrap justify-between gap-2.5 border-t-[3px] border-beg-ink py-7 pb-12 text-beg-dim">
        <span className="text-2xl font-extrabold tracking-[-0.04em] text-beg-ink">
          beg<span className="text-beg-logo">fi</span>
          <RobinhoodFeather className="ml-[0.1em] text-beg-logo" />
        </span>
        <span className="text-sm">Built on Robinhood Chain</span>
      </footer>
    </div>
  );
}
