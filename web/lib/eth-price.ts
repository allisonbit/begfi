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
 * The USD labels for a price and a market cap. Their home is `usd-format.ts`:
 * the chart is a Client Component, and importing anything from this file —
 * even a pure helper — would drag `server-only` into client code and fail the
 * build. Re-exported so server callers keep one import site.
 */
export { usdCompactLabel, usdPriceLabel } from "./usd-format";
