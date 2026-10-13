import "server-only";

/**
 * ETH/USD, one server fetch with burst cache and a graceful fallback.
 *
 * THE SOURCE. CoinGecko's `simple/price` — the lightest public endpoint that
 * answers exactly one question. It is a read-only market feed; no key, no
 * SDK, no client involvement, so the fetch never happens in a browser.
 *
 * THE CACHE. `revalidate = 60` via the Next fetch cache: one upstream call a
 * minute across ALL token pages and renders, whatever the render rate. A
 * price on a sticker page is not a trade; sixty seconds of staleness is the
 * difference between "current" and "live tick", and this page is the former.
 *
 * THE FALLBACK. An unreachable or throttled source returns null, and the
 * caller renders its existing ETH labels rather than a fabricated number or
 * a broken page. A price feed being down must never change what the page
 * claims — it only decides the currency of what it says.
 */
export async function getEthUsd(): Promise<number | null> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ethereum?: { usd?: number } } | null;
    const usd = body?.ethereum?.usd;
    return typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? usd : null;
  } catch {
    return null;
  }
}

/**
 * A USD label for a price this small.
 *
 * Sub-cent-to-nano prices die in generic formatters: toPrecision(4) prints
 * $0.00000002312 as $2.312e-8 — exponent notation, the exact bug this page
 * shipped once and must not ship twice — and toFixed(2) rounds it to $0.00,
 * which lies about it not being zero. The rule:
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
