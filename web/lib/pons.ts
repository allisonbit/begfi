import { parseAbi } from "viem";

/**
 * Pons V2 — the launch pad BegFi runs on top of.
 *
 * BegFi does not deploy its own launch contracts. Every launch goes through
 * Pons' deployed factory (spec §9.1), and this file is the whole of BegFi's
 * knowledge of it: one address, one ABI, and the constants that were read off
 * the live contract rather than copied from a document.
 *
 * WHY V2 AND NOT V1. Checked on-chain on 2026-10-02: V2's factory reports
 * `launchEnabled() == true`, and V1's active factory reports `false`. Both have
 * bytecode deployed, so a version cannot be told from "does it exist" — it has to
 * be asked. V1 is switched off and its launches would revert.
 */

/** Pons V2 launch factory, Robinhood Chain mainnet (4663). */
export const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" as const;

/**
 * The one launch configuration the factory currently exposes
 * (`launchConfigCount() == 1`). Its terms, read from `getLaunchConfig(0)`:
 *
 *   supply               1,000,000,000
 *   curveFeeBps          100        (1% on the curve)
 *   phantomQuote         1.68 ETH   (virtual reserve that sets the opening price)
 *   graduationThreshold  4.2 ETH
 *   tickSpacing          200
 *   enabled              true
 */
export const LAUNCH_CONFIG_ID = 0n;

/**
 * Native ETH as the quote asset.
 *
 * This is the "native launch": the token is priced and traded directly against
 * robinhood ETH rather than a paired ERC-20. It is what almost every real launch
 * on this factory uses — 125 of roughly 140 in a recent 20,000-block window.
 *
 * A counter-intuitive detail worth recording: `approvedPairTokens(address(0))`
 * reads FALSE, and those 125 launches still succeeded. The zero address is
 * special-cased inside the factory, so a form that gated itself on that mapping
 * would refuse to do the thing everybody else is doing.
 */
export const NATIVE_PAIR = "0x0000000000000000000000000000000000000000" as const;

/** The launch fee, in wei (0.0005 ETH). Read live at launch time; this is the fallback. */
export const LAUNCH_FEE_FALLBACK = 500_000_000_000_000n;

/** Pons caps the creator tax at 10% (`maxCreatorTaxBps()`). */
export const MAX_CREATOR_TAX_BPS = 1_000n;

/**
 * BegFi's creator tax on standard launches, in basis points: 3%.
 *
 * Spec §9.2. This is charged ON TOP of the factory's own 1% curve fee, so a
 * trader pays about 4% total on a standard launch — which is the number the
 * terms and the launch form should show, not the 3% alone.
 */
export const STANDARD_CREATOR_TAX_BPS = 300n;

/** BegFi's creator tax on the $BEG launch itself: 5%, all of it to the dev wallet. */
export const GENESIS_CREATOR_TAX_BPS = 500n;

/**
 * The factory ABI, as the members BegFi actually uses.
 *
 * Written as a human-readable fragment rather than a copied JSON blob so it can
 * be read against the contract: every entry here was verified against the
 * deployed factory's own ABI, and the struct field order in `launchToken` is
 * load-bearing — a reordered tuple encodes to valid calldata that the factory
 * will happily misread.
 */
export const ponsFactoryAbi = parseAbi([
  // The launch itself. Payable: the fee goes with the call.
  "function launchToken((string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, bytes32 expectedEconomics, bytes32 salt) params, uint256 launchConfigId, address pairToken, address[] snipeTaxExemptions) payable returns (address token, address curve)",

  /**
   * The commitment to a set of launch economics, returned as a hash.
   *
   * `token` is `bytes32` — the factory compares it against what it computes at
   * launch, so it has to be fetched for the exact (config, pair) pair being used.
   * Calling this is the only correct way to fill the field.
   */
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",

  "function launchFee() view returns (uint256)",
  "function launchEnabled() view returns (bool)",
  "function maxCreatorTaxBps() view returns (uint256)",
  "function launchConfigCount() view returns (uint256)",

  /** Whether this wallet is permitted to launch right now. */
  "function canLaunch(address launcher) view returns (bool)",

  /** Config terms, for showing a launcher what they are actually getting. */
  "function getLaunchConfig(uint256 id) view returns (uint256 supply, uint256 curveFeeBps, uint256 phantomQuote, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, bool enabled)",

  /**
   * A launched token's record — the `curve` field is the address a buy goes
   * through, which is what the buy panel needs.
   */
  "function getLaunchedToken(address token) view returns ((address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists))",

  /** Where creator fees accumulate. Read it rather than hardcoding. */
  "function feeEscrow() view returns (address)",

  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
]);
