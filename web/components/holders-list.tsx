import { shortAddress, addressUrl } from "@/lib/chains";
import type { Holder } from "@/lib/holders";

/**
 * The top-holders list on a token page.
 *
 * Every row is reconstructed from that token's own on-chain events — transfers
 * plus curve mints and burns — so a listed wallet really holds what the row
 * says. The creator's wallet is highlighted, not filtered: knowing that the
 * person who launched a coin still holds half of it is exactly the fact a
 * buyer wants in one glance, and hiding it would be misleading in the other
 * direction.
 *
 * Rank is by balance. Percent of total supply keeps two decimals; below a
 * hundredth of a percent the row would be noise, so it is dropped rather than
 * printed as a mirage of precision.
 */
const fmt = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

export function HoldersList({
  holders,
  windowBlocks,
  graduated,
}: {
  holders: Holder[];
  windowBlocks: number;
  graduated: boolean;
}) {
  return (
    <section className="card grid gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[18px] font-extrabold tracking-[-.03em] text-beg-ink">Top holders</h2>
        <span className="text-[11px] text-beg-dim">
          from the last ~{Math.round(windowBlocks / 60_000)} days of onchain transfers
        </span>
      </div>

      <ul className="grid gap-1.5">
        {holders.map((h, i) => {
          const sharePct = h.share * 100;
          return (
            <li
              key={h.address}
              className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-[13px] ${
                h.isCreator ? "border-2 border-beg-ink bg-beg-lime/40" : "bg-beg-bg"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="w-5 shrink-0 text-right font-mono text-[11px] text-beg-dim">
                  {i + 1}
                </span>
                <a
                  href={addressUrl(h.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-mono text-beg-ink underline underline-offset-2"
                  title={h.address}
                >
                  {shortAddress(h.address)}
                </a>
                {h.isCreator ? (
                  <span className="shrink-0 rounded-md border-2 border-beg-ink bg-beg-lime px-1.5 py-0.5 text-[10px] font-extrabold text-beg-ink">
                    Creator
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 font-bold text-beg-ink">
                {sharePct >= 0.01 ? `${fmt.format(sharePct)}%` : ""}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-[11px] text-beg-dim">
        Balances are the ledger of {graduated ? "pool transfers" : "curve buys, sells and transfers"}
        {" "}since launch, read live from the chain — not an exchange's own ranking. A missing row
        means the scan found nothing, never that a holder was hidden.
      </p>
    </section>
  );
}
