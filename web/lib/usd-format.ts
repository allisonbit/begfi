/**
 * USD formatting, deliberately client-safe.
 *
 * SPLIT FROM `eth-price.ts`. The formatters live next to the feed there, but
 * that module imports `server-only`, and a Client Component that so much as
 * imports a helper from it fails the Turbopack build ("'server-only' cannot
 * be imported from a Client Component module"). Labels are pure arithmetic —
 * they need no feed — so they live here: the server keeps its guard, and the
 * chart can convert the same price with the same rules.
 *
 * THE RULES. Sub-cent-to-nano prices die in generic formatters:
 * toPrecision(4) prints $0.00000002312 as $2.312e-8 — exponent notation, the
 * exact bug this page shipped once and must not ship twice — and toFixed(2)
 * rounds it to $0.00, which lies about it not being zero.
 *
 *   >= $1        ordinary currency, two decimals.
 *   >= $0.01     four significant figures.
 *   < $0.01      decimal places matched to where the digits actually start,
 *                capped at 12, trailing zeros trimmed. Zero stays $0.
 */
export function usdPriceLabel(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return "—";
  if (usd === 0) return "$0";
  if (usd >= 1) return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (usd >= 0.01) return `$${usd.toPrecision(4)}`;
  const decimals = Math.min(12, Math.max(2, Math.ceil(-Math.log10(Math.abs(usd))) + 3));
  return `$${usd.toFixed(decimals).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")}`;
}

/** A USD label for a market-cap-sized figure: $1.2K, $4.4M, $2.1B. */
export function usdCompactLabel(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return "—";
  const abs = Math.abs(usd);
  const trim = (x: number) => (Math.abs(x) >= 100 ? Math.round(x).toString() : Number(x.toFixed(1)).toString());
  if (abs >= 1e12) return `$${trim(usd / 1e12)}T`;
  if (abs >= 1e9) return `$${trim(usd / 1e9)}B`;
  if (abs >= 1e6) return `$${trim(usd / 1e6)}M`;
  if (abs >= 1e3) return `$${trim(usd / 1e3)}K`;
  return usdPriceLabel(usd);
}
