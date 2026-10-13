import type { Metadata } from "next";
import Link from "next/link";
import { CommunityLinks } from "@/components/community-links";
import { CopyText } from "@/components/copy-text";
import { LevelChip } from "@/components/level-chip";
import { RobinhoodFeather } from "@/components/robinhood-feather";
import { BEG_TOKEN_ADDRESS } from "@/lib/config";
import { formatAmount } from "@/lib/erc20";
import { addressUrl } from "@/lib/chains";
import { getLevelForWallet } from "@/lib/level";
import { getOverview } from "@/lib/dashboard";
import { getProfile } from "@/lib/session";

export const metadata: Metadata = {
  title: "Earn",
  description:
    "Three honest ways to get paid on BegFi: ask at your own link, beg a token launch into existence, and launch a token that pays a creator tax on every trade.",
};

export const dynamic = "force-dynamic";

/**
 * /earn — the page that answers "how do I actually get paid here?".
 *
 * It describes the three ways money moves on this protocol. Every way points at
 * a thing that already exists (your link, a beg-to-launch, a launch plus the fee
 * escrow), and every number it shows — when the reader is signed in — is read
 * from confirmed on-chain rows, so an earnings page is not a tiered promise in
 * disguise: there are no points, streaks or airdrop checkpoints, because BegFi
 * has nothing to grant.
 */

/** Ways to earn, each of them a real destination that exists today. */
const WAYS = [
  {
    n: "1",
    tint: "bg-beg-lime",
    title: "Ask at your own link.",
    body: "Claim a username, share the link anywhere a street sign would go, and anyone who sends does it wallet-to-wallet — $BEGFI lands straight in your wallet. BegFi never holds it and never takes a cut of a send.",
    href: "/dashboard/begs",
    cta: "Write your begs",
  },
  {
    n: "2",
    tint: "bg-beg-blue",
    title: "Beg a launch into existence.",
    body: "Open a goal ask for a token you have not launched yet. Supporters send real $BEGFI toward it while the ask is open, the page shows every confirmed transfer, and you close it by actually launching.",
    href: "/beg-to-launch",
    cta: "Open an ask",
  },
  {
    n: "3",
    tint: "bg-beg-yellow",
    title: "Launch a token. Get paid on every trade.",
    body: "Every launch through the pad sets a creator tax — 3% on a standard launch — that accrues to your wallet as the token trades, claimable from the fee escrow whenever you like. No cap, no lockup: it earns as long as the token trades.",
    href: "/launch",
    cta: "Launch a token",
  },
] as const;

export default async function EarnPage() {
  const profile = await getProfile();

  /* Real reads, only when there is a wallet behind the session. */
  const [overview, level] = profile
    ? await Promise.all([getOverview(profile.wallet_address), getLevelForWallet(profile.wallet_address)])
    : [null, null];

  return (
    <div className="safe-x mx-auto max-w-[1000px] py-10">
      <header className="max-w-[700px]">
        <h1 className="text-[clamp(36px,8vw,72px)] font-extrabold uppercase leading-[.95] tracking-[-.04em]">
          Earn.
          <span aria-hidden className="caret" />
        </h1>
        <p className="mt-3 text-xl text-beg-dim">
          The e-Begging protocol pays three ways. Nothing is locked, granted or
          promised — it all lands in your wallet.
        </p>
      </header>

      {/* Your earnings, from the indexer's confirmed rows. Signed in only. */}
      <section className="mt-8">
        {profile && overview ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="$BEGFI received" value={formatAmount(BigInt(overview.totalReceived))} glow />
            <Stat label="Supporters" value={String(overview.supporters)} />
            <div className="card">
              <div className="text-[13px] text-beg-dim">Creator level</div>
              <div className="mt-2">
                {level ? <LevelChip level={level.name} /> : <span className="text-[15px] font-bold text-beg-ink">—</span>}
              </div>
              <Link href="/dashboard" className="mt-2 inline-block text-[12px] text-beg-dim underline underline-offset-2 hover:text-beg-ink">
                See your dashboard
              </Link>
            </div>
          </div>
        ) : (
          <div className="card grid gap-2 p-6 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <b className="text-[17px] text-beg-ink">Claim a link and the numbers start</b>
              <p className="mt-1 max-w-[52ch] text-[13px] text-beg-dim">
                Sign in with your wallet here, claim a username, and this page tracks what
                reached you — confirmed transfers only, never a promise.
              </p>
            </div>
            <Link href="/#claim" className="btn-primary justify-self-start px-6 py-3 text-[15px] sm:justify-self-end">
              Sign in &amp; claim
            </Link>
          </div>
        )}
      </section>

      {/* The three ways. */}
      <section className="mt-4 grid gap-3.5 md:grid-cols-3">
        {WAYS.map((way) => (
          <div key={way.n} className="card flex flex-col p-6">
            <div
              className={`mb-4 grid size-[40px] place-items-center rounded-xl border-2 border-beg-ink font-extrabold text-beg-ink ${way.tint}`}
            >
              {way.n}
            </div>
            <b className="text-[17px] leading-snug text-beg-ink">{way.title}</b>
            <p className="mt-2 flex-1 text-[13.5px] leading-relaxed text-beg-dim">{way.body}</p>
            <Link
              href={way.href}
              className="btn-ghost mt-4 w-fit px-4 py-2 text-[13px] font-bold text-beg-ink"
            >
              {way.cta} <span aria-hidden>→</span>
            </Link>
          </div>
        ))}
      </section>

      {/* The token itself: live now, with the address anyone needs to trade it. */}
      {BEG_TOKEN_ADDRESS ? (
        <section className="mt-4 card grid gap-3 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border-2 border-beg-ink bg-beg-lime px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.06em] text-beg-ink">
              Live on Robinhood Chain
              <RobinhoodFeather className="ml-1 text-beg-logo" />
            </span>
            <b className="text-[17px] text-beg-ink">$BEGFI</b>
          </div>
          <CopyText text={BEG_TOKEN_ADDRESS} />
          <div className="flex flex-wrap gap-2 text-[13px]">
            <Link href={`/token/${BEG_TOKEN_ADDRESS}`} className="rounded-full border-[1.5px] border-beg-line px-4 py-2 text-beg-dim hover:border-beg-lime hover:text-beg-ink">
              Trade $BEGFI →
            </Link>
            <a href={addressUrl(BEG_TOKEN_ADDRESS)} target="_blank" rel="noreferrer noopener" className="rounded-full border-[1.5px] border-beg-line px-4 py-2 text-beg-dim hover:border-beg-lime hover:text-beg-ink">
              View on explorer ↗
            </a>
          </div>
          <p className="text-[12px] text-beg-dim">
            The contract address is the one fact among many: whoever sends, anywhere on
            BegFi, sends this token. Verify it against the explorer before sending anything.
          </p>
        </section>
      ) : null}

      {/* Follow along. */}
      <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border-[3px] border-beg-ink bg-beg-card p-6">
        <div>
          <b className="text-[17px] text-beg-ink">Follow the beg</b>
          <p className="mt-1 text-[13px] text-beg-dim">Asks, launches and the occasionally-shameless plea, on the timeline.</p>
        </div>
        <CommunityLinks />
      </section>

      <p className="mt-4 max-w-[70ch] text-[12px] text-beg-dim">
        Nothing here is financial advice. Begs are asks, not owed anything; a blockchain
        send cannot be undone. BegFi is not affiliated with Robinhood.
      </p>
    </div>
  );
}

function Stat({ label, value, glow = false }: { label: string; value: string; glow?: boolean }) {
  return (
    <div className="card">
      <div className="text-[13px] text-beg-dim">{label}</div>
      <div className={`mt-1 text-[36px] font-extrabold tracking-[-.04em] text-beg-ink ${glow ? "text-glow" : ""}`}>{value}</div>
    </div>
  );
}
