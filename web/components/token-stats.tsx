import { TOKEN_CA, TOKEN_CONFIGURED } from "@/lib/config";
import { usdCompactLabel, usdPriceLabel } from "@/lib/usd-format";
import { getTokenStats } from "@/lib/token-stats";
import type { TokenStats } from "@/lib/token-stats";

/**
 * The home page's $BEGFI stats strip.
 *
 * ONE SWITCH. Everything here hangs off TOKEN_CA in lib/config.ts — the one
 * value to change when the relaunched token ships. Until it is set (or until
 * the feed answers for it) the strip renders its clean "coming soon" cards:
 * no fake numbers, no placeholder shapes pretending to be data.
 *
 * Every card says what it is even when it is empty, so an unset state reads
 * as "waiting", not as broken.
 */
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
          $BEGFI is relaunching with a 2% tax. The stats below go live the moment
          the new contract is on the chain — nothing here shows a number that
          does not exist yet.
        </p>

        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Market cap", "Not set yet"],
            ["Price", "Not set yet"],
            ["Fees collected", "2% tax, counted live"],
            ["24h volume", "Not set yet"],
            ["Liquidity", "Not set yet"],
            ["Holders", "Not set yet"],
          ].map(([label, note]) => (
            <div key={label} className="card p-6 max-md:last:rotate-0">
              <div className="text-[13px] text-beg-dim">{label}</div>
              <div className="mt-1 text-[30px] font-extrabold tracking-[-.04em] text-beg-ink/25">—</div>
              <p className="mt-2 text-[12px] text-beg-dim">{note}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const stats: TokenStats | null = await getTokenStats();

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
          The feed had nothing to read for the token just now. When the market
          wakes up, the numbers come back with it.
        </p>
      </section>
    );
  }

  const change = stats.change24hPct;
  const changeLabel = change === null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
  const changeUp = (change ?? 0) >= 0;

  return (
    <section className="animate-wobble py-8 pb-16">
      <span className="mb-5 inline-block rounded-full border-2 border-beg-ink bg-beg-lime px-3 py-1 text-[11px] font-bold uppercase tracking-[.06em]">
        ${stats.symbol ?? "BEGFI"} · 2% tax
      </span>

      <h2 className="mb-6 text-[clamp(32px,7vw,56px)] font-extrabold uppercase leading-[.95] tracking-[-.03em]">
        Live stats.
        <br />
        Straight from the market.
      </h2>

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        <div className="card p-6 max-md:first:rotate-[-1deg] md:first:-rotate-1">
          <div className="text-[13px] text-beg-dim">Market cap</div>
          <div className="mt-1 text-[34px] font-extrabold tracking-[-.04em] text-beg-ink">
            {usdCompactLabel(stats.mcapUsd)}
          </div>
          <p className="mt-2 text-[12px] text-beg-dim">From live pool data.</p>
        </div>

        <div className="card p-6">
          <div className="text-[13px] text-beg-dim">Price</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5">
            <span className="text-[34px] font-extrabold tracking-[-.04em] text-beg-ink">
              {usdPriceLabel(stats.priceUsd)}
            </span>
            <span className={`text-[15px] font-bold ${changeUp ? "text-[#0a8f4c]" : "text-[#d33]"}`}>
              {changeLabel} 24h
            </span>
          </div>
          <p className="mt-2 text-[12px] text-beg-dim">24h change from the deepest pool.</p>
        </div>

        <div className="card p-6 max-md:first:rotate-[1deg] md:first:rotate-1">
          <div className="text-[13px] text-beg-dim">Fees collected</div>
          <div className="mt-1 text-[34px] font-extrabold tracking-[-.04em] text-beg-ink/25">
            {stats.feesUsd !== null ? usdCompactLabel(stats.feesUsd) : "—"}
          </div>
          <p className="mt-2 text-[12px] text-beg-dim">
            2% tax on the token, counted as it is collected.
          </p>
        </div>

        <div className="card p-6 max-md:first:rotate-[-0.5deg] md:first:-rotate-1">
          <div className="text-[13px] text-beg-dim">24h volume</div>
          <div className="mt-1 text-[30px] font-extrabold tracking-[-.04em] text-beg-ink">
            {usdCompactLabel(stats.volume24hUsd)}
          </div>
          <p className="mt-2 text-[12px] text-beg-dim">All pools, one day.</p>
        </div>

        <div className="card p-6">
          <div className="text-[13px] text-beg-dim">Liquidity</div>
          <div className="mt-1 text-[30px] font-extrabold tracking-[-.04em] text-beg-ink">
            {usdCompactLabel(stats.liquidityUsd)}
          </div>
          <p className="mt-2 text-[12px] text-beg-dim">Pooled across every market.</p>
        </div>

        <div className="card p-6 max-md:first:rotate-[0.5deg] md:first:rotate-1">
          <div className="text-[13px] text-beg-dim">Holders</div>
          <div className="mt-1 text-[30px] font-extrabold tracking-[-.04em] text-beg-ink">
            {stats.holders !== null ? stats.holders.toLocaleString("en-US") : "—"}
          </div>
          <p className="mt-2 text-[12px] text-beg-dim">
            {stats.holders !== null ? "Live holder count." : "Holder feed not answering — back when it is."}
          </p>
        </div>
      </div>
    </section>
  );
}
