import Link from "next/link";

import { CopyCA } from "@/components/copy-ca";
import { StatsRefresher } from "@/components/stats-refresher";
import { EXPLORER } from "@/lib/chains";
import { TOKEN_CA, TOKEN_CONFIGURED } from "@/lib/config";
import { usdCompactLabel, usdPriceLabel } from "@/lib/usd-format";
import { getTokenStats } from "@/lib/token-stats";
import type { TokenStats as Stats } from "@/lib/token-stats";

/**
 * The home page's $BEGFI stats strip — now live, on the relaunched token.
 *
 * ONE SWITCH. Everything hangs off TOKEN_CA in lib/config.ts. The strip
 * re-renders about every 45 seconds through <StatsRefresher>, and every read
 * inside the data module is cached at 30s+, so this stays inside the polled
 * cadence without ever multiplying into the public endpoints' rate limits.
 *
 * EVERY CARD CAN BE DARK. A stat that did not fetch shows "Unavailable" —
 * exactly that stat, and only that stat. The page never prints a zero or a
 * guess for a number it failed to read, and never a number the chain and the
 * market feed do not both back.
 *
 * THE 1%. The token carries no transfer tax; the 1% is the launch pool's
 * swap fee (75% creator / 25% platform), and the fees card is fed from the
 * launch contracts' own FeesDistributed events — on-chain math, not a stored
 * figure.
 */

/** The address row: Copy CA, explorer link, and the "verified on-chain" pin. */
function TokenActions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CopyCA address={TOKEN_CA} />
      <a
        href={`${EXPLORER}/address/${TOKEN_CA}`}
        target="_blank"
        rel="noreferrer noopener"
        className="rounded-full border-[1.5px] border-beg-ink bg-beg-card px-3 py-1 text-[12px] font-bold text-beg-ink hover:bg-beg-lime"
      >
        View on explorer
      </a>
      <a
        href={`${EXPLORER}/address/${TOKEN_CA}?tab=contract_code`}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 rounded-full bg-beg-lime px-3 py-1 text-[12px] font-bold text-beg-ink"
      >
        ✔ Verified on-chain
      </a>
      <code className="ml-1 font-mono text-[12px] text-beg-dim" title={TOKEN_CA}>
        {TOKEN_CA.slice(0, 6)}…{TOKEN_CA.slice(-3)}
      </code>
    </div>
  );
}

/** A dark card, and a note that says why — never a fake number. */
function UnavailableCard({ label, note }: { label: string; note?: string }) {
  return (
    <div className="card p-6 max-md:last:rotate-0">
      <div className="text-[13px] text-beg-dim">{label}</div>
      <div className="mt-1 text-[30px] font-extrabold tracking-[-.04em] text-beg-ink/25">—</div>
      <p className="mt-2 text-[12px] text-beg-dim">{note ?? "Unavailable right now — back with the next refresh."}</p>
    </div>
  );
}

export async function TokenStats() {
  if (!TOKEN_CONFIGURED) {
    return (
      <section className="animate-wobble py-8 pb-16">
        <span className="mb-5 inline-block rounded-full border-2 border-beg-ink bg-beg-yellow px-3 py-1 text-[11px] font-bold uppercase tracking-[.06em]">
          Coming soon
        </span>

        <h2 className="mb-6 text-[clamp(32px,7vw,56px)] font-extrabold uppercase leading-[.95] tracking-[-.03em]">
          The token.
          <br />
          Live stats, day one.
        </h2>

        <p className="-mt-2 mb-7 max-w-[62ch] text-[14px] text-beg-dim">
          $BEGFI is relaunched with a 1% pool fee. The stats go live the moment
          the contract's address is set — nothing here shows a number that does
          not exist yet.
        </p>

        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {["Market cap", "Price", "Fees collected", "24h volume", "Liquidity", "Holders"].map((label) => (
            <UnavailableCard key={label} label={label} note="Not set yet." />
          ))}
        </div>
      </section>
    );
  }

  const stats: Stats | null = await getTokenStats();

  if (!stats) {
    return (
      <section className="animate-wobble py-8 pb-16">
        <span className="mb-5 inline-block rounded-full border-2 border-beg-ink bg-beg-yellow px-3 py-1 text-[11px] font-bold uppercase tracking-[.06em]">
          $BEGFI
        </span>
        <h2 className="text-[clamp(32px,7vw,56px)] font-extrabold uppercase leading-[.95] tracking-[-.03em]">
          Live stats
        </h2>
        <p className="notice mt-6">
          The feed had nothing to read for the token just now — every card below stays dark until it
          can be real again.
        </p>
        <div className="mt-6 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {["Market cap", "Price", "Fees collected", "24h volume", "Liquidity", "Holders"].map((label) => (
            <UnavailableCard key={label} label={label} note="Unavailable — the feed is not answering." />
          ))}
        </div>
        <TokenActions />
        <StatsRefresher />
      </section>
    );
  }

  const change = stats.change24hPct;
  const changeLabel = change === null ? null : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
  const changeUp = (change ?? 0) >= 0;

  return <LiveStats stats={stats} />;
}

/** The live strip, computing its own change label from the snapshot. */
function LiveStats({ stats }: { stats: Stats }) {
  const change = stats.change24hPct;
  const changeLabel = change === null ? null : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
  const changeUp = (change ?? 0) >= 0;
  return (
    <section className="animate-wobble py-8 pb-16">
      <span className="mb-5 inline-block rounded-full border-2 border-beg-ink bg-beg-lime px-3 py-1 text-[11px] font-bold uppercase tracking-[.06em]">
        ${stats.symbol ?? "BEGFI"} · 1% tax
      </span>

      <h2 className="mb-6 text-[clamp(32px,7vw,56px)] font-extrabold uppercase leading-[.95] tracking-[-.03em]">
        Live stats.
        <br />
        Straight from the market.
      </h2>

      <TokenActions />

      <div className="mt-6 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        <div className="card p-6 max-md:first:rotate-[-1deg] md:first:-rotate-1">
          <div className="text-[13px] text-beg-dim">Market cap</div>
          <div className="mt-1 text-[34px] font-extrabold tracking-[-.04em] text-beg-ink">
            {stats.mcapUsd !== null ? usdCompactLabel(stats.mcapUsd) : "Unavailable"}
          </div>
          <p className="mt-2 text-[12px] text-beg-dim">From the live pool supply and price.</p>
        </div>

        <div className="card p-6">
          <div className="text-[13px] text-beg-dim">Price</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5">
            {stats.priceUsd !== null ? (
              <>
                <span className="text-[34px] font-extrabold tracking-[-.04em] text-beg-ink">
                  {usdPriceLabel(stats.priceUsd)}
                </span>
                {changeLabel !== null ? (
                  <span className={`text-[15px] font-bold ${changeUp ? "text-[#0a8f4c]" : "text-[#d33]"}`}>
                    {changeLabel} 24h
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-[34px] font-extrabold tracking-[-.04em] text-beg-ink/25">—</span>
            )}
          </div>
          <p className="mt-2 text-[12px] text-beg-dim">
            {stats.priceUsd !== null
              ? "24h change from the deepest pool."
              : "Unavailable right now — back with the next refresh."}
          </p>
        </div>

        <div className="card p-6 max-md:first:rotate-[1deg] md:first:rotate-1">
          <div className="text-[13px] text-beg-dim">Fees collected</div>
          <div className="mt-1 text-[34px] font-extrabold tracking-[-.04em] text-beg-ink">
            {stats.feesUsd !== null ? (
              usdCompactLabel(stats.feesUsd)
            ) : (
              <span className="text-beg-ink/25">—</span>
            )}
          </div>
          <p className="mt-2 text-[12px] text-beg-dim">
            {stats.feesUsd !== null
              ? `1% pool fee (75% creator / 25% platform)${stats.feesFeeTokenLabel ? ` — ${stats.feesFeeTokenLabel} collected on-chain` : ", counted from on-chain fee events"}.`
              : "1% pool fee, counted from on-chain fee events — the ledger has nothing for this token yet."}
          </p>
        </div>

        <div className="card p-6 max-md:first:rotate-[-0.5deg] md:first:-rotate-1">
          <div className="text-[13px] text-beg-dim">24h volume</div>
          <div className="mt-1 text-[30px] font-extrabold tracking-[-.04em] text-beg-ink">
            {stats.volume24hUsd !== null ? usdCompactLabel(stats.volume24hUsd) : "Unavailable"}
          </div>
          <p className="mt-2 text-[12px] text-beg-dim">All pools, one day.</p>
        </div>

        <div className="card p-6">
          <div className="text-[13px] text-beg-dim">Liquidity</div>
          <div className="mt-1 text-[30px] font-extrabold tracking-[-.04em] text-beg-ink">
            {stats.liquidityUsd !== null ? usdCompactLabel(stats.liquidityUsd) : "Unavailable"}
          </div>
          <p className="mt-2 text-[12px] text-beg-dim">Pooled across every market.</p>
        </div>

        <div className="card p-6 max-md:first:rotate-[0.5deg] md:first:rotate-1">
          <div className="text-[13px] text-beg-dim">Holders</div>
          <div className="mt-1 text-[30px] font-extrabold tracking-[-.04em] text-beg-ink">
            {stats.holders !== null ? stats.holders.toLocaleString("en-US") : "Unavailable"}
          </div>
          <p className="mt-2 text-[12px] text-beg-dim">
            {stats.holders !== null ? "Live holder count." : "Holder feed not answering — back when it is."}
          </p>
        </div>
      </div>
    </section>
  );
}
