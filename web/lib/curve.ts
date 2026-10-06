import { formatUnits, parseAbi } from "viem";

/**
 * The Pons V2 bonding curve — where a launched token is actually bought and sold
 * before it graduates.
 *
 * The curve address is not a constant: every launch gets its own. It comes from
 * `ponsFactory.getLaunchedToken(token).curve` and has to be read per token.
 *
 * THE MATH BELOW IS A REIMPLEMENTATION of Pons' `PonsV2BondingCurveMath`, taken
 * from their MIT-licensed source. It is here because the curve exposes NO
 * external quote function — pricing is internal — so a UI that wants to show
 * "you get about this many tokens" has to do the arithmetic itself.
 *
 * It is an ESTIMATE, and the UI must say so. Two reasons it can differ from what
 * the transaction actually returns: the reserves move between the quote and the
 * block landing, and the library applies no phantom-reserve offsetting of its own
 * — the caller supplies pre-adjusted reserves, and whether `getReserves()` is
 * exactly what `buy` passes is not something this file can prove. The slippage
 * bound is what actually protects the trader; the estimate is a courtesy.
 */

/** Pons' curve ABI, as the members BegFi uses. */
export const ponsCurveAbi = parseAbi([
  /**
   * Buy tokens with the quote asset.
   *
   * `msg.value` MUST equal `quoteIn` for a native launch — this is payable, and
   * the contract checks the two agree. `minTokensOut` is the slippage bound: the
   * transaction reverts rather than filling at a worse price.
   */
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",

  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",

  /** The reserves a quote is computed against. */
  "function getReserves() view returns (uint256 quoteReserve_, uint256 tokenReserve_)",

  "function tokenReserve() view returns (uint256)",
  "function sellableTokens() view returns (uint256)",
  "function readyToGraduate() view returns (bool)",
  "function isNativeQuote() view returns (bool)",

  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
]);

const BASIS_POINTS = 10_000n;

/**
 * How many tokens come out for a given amount in.
 *
 * Straight from the library, and integer-only at every step:
 *
 *   amountInWithFee = amountIn * (10_000 - feeBps)
 *   amountOut       = amountInWithFee * reserveOut / (reserveIn * 10_000 + amountInWithFee)
 *
 * `feeBps` is the curve fee, NOT including the creator tax — the library only
 * knows the fee it is given, and the tax is accounted separately by the curve.
 *
 * BigInt throughout and no Math.floor: the intermediate products overflow a
 * double well before these amounts do, and a float here would produce a number
 * that is wrong in the last digits, in the direction of the user.
 */
export function getAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: bigint,
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  if (feeBps >= BASIS_POINTS) return 0n;

  const amountInWithFee = amountIn * (BASIS_POINTS - feeBps);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * BASIS_POINTS + amountInWithFee;

  return numerator / denominator;
}

/**
 * The minimum output a trader will accept, from a slippage tolerance.
 *
 * `slippageBps` is the tolerance: 100 = 1%. Rounded DOWN, so a tighter bound is
 * never accidentally loosened by rounding.
 */
export function minOutFor(quoted: bigint, slippageBps: bigint): bigint {
  const tolerance = BASIS_POINTS - slippageBps;
  return (quoted * tolerance) / BASIS_POINTS;
}

/**
 * The price of one token in ETH, for display.
 *
 * Returns a plain string rather than a number: a price with 18 decimals does not
 * survive a double, and the value is only ever going to be shown.
 */
export function pricePerToken(reserveIn: bigint, reserveOut: bigint): string {
  if (reserveOut === 0n) return "n/a";

  // Scale up before dividing so the result keeps meaningful precision.
  const SCALE = 10n ** 18n;
  const scaled = (reserveIn * SCALE) / reserveOut;
  const whole = scaled / SCALE;
  const fraction = (scaled % SCALE).toString().padStart(18, "0").replace(/0+$/, "");

  const text = fraction ? `${whole}.${fraction}` : whole.toString();
  // Below a gwei the number stops being readable and starts being noise.
  return scaled < 10n ** 9n ? "<0.000000001" : text;
}

/**
 * An ETH amount for display, trimmed to something readable.
 *
 * Display only: a double rounds the last digits, which is fine for a number
 * someone reads and never trades on.
 */
export function formatEth(value: bigint): string {
  const n = Number(formatUnits(value, 18));
  if (n === 0) return "0";
  if (n >= 1000) return n.toFixed(0);
  if (n >= 1) return n.toFixed(3);
  return n.toFixed(4);
}
