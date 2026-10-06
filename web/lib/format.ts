/**
 * Display formatting shared across pages.
 *
 * These are presentation-only helpers: every input is a string or bigint that
 * has already been read exactly on-chain, and the only thing lost here is
 * digits nobody reads on a sticker card.
 */

/**
 * A token amount for market-cap-style display: "$1.2K" / "$34M".
 *
 * K/M/B suffixes, one decimal. Straight Number math is fine — an MC figure is
 * read, never traded on, and MC.sign * 2**1024 arithmetic is a bug class the
 * string path in `formatEth` exists to avoid for prices people quote with.
 */
export function compactAmount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trim(value / 1e9)}B`;
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e3) return `${trim(value / 1e3)}K`;
  return trim(value);
}

function trim(n: number): string {
  const rounded = Math.abs(n) >= 100 ? Math.round(n) : Number(n.toFixed(1));
  // -0 reads badly and means nothing.
  return (rounded === 0 ? 0 : rounded).toString();
}

/** USD shorthand: "$19K". Non-negative-only by construction; kept simple. */
export function usdCompact(value: number): string {
  return `$${compactAmount(value)}`;
}

/**
 * How long since a timestamp, in review-scale words: "3d", "5h", "12m".
 *
 * Days keep one decimal below ten (odys-style "37d" age chips); beyond that
 * nobody cares about the fractional day.
 */
export function ageWords(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.floor((now - then) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = (now - then) / 86400000;
  if (days < 10) return `${days.toFixed(1).replace(/\.0$/, "")}d`;
  return `${Math.floor(days)}d`;
}
