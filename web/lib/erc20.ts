/**
 * The ERC-20 surface BegFi needs.
 *
 * Ported from bug-protocol's `lib/erc20.ts`, which carried reads and approvals
 * but NOT `transfer` — and transfer is the single call the whole product is
 * built on (spec §7.2). The `Transfer` event is here for the indexer, which
 * reads it to build the `transfers` table rather than trusting a browser's
 * claim that a send happened.
 */
export const erc20Abi = [
  { type: "function", name: "name", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    /**
     * The send. Wallet to wallet, no router, no approval, no BegFi fee — the
     * sender's wallet calls this directly on the $BEG contract and BegFi never
     * touches the funds (spec §7.1, §7.2).
     */
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

/** 18 decimals is the ERC-20 default and what $BEG uses. */
export const TOKEN_DECIMALS = 18;

/**
 * Parse a human amount ("1000", "1,000", "1.5") into base units.
 *
 * Deliberately strict: returns null rather than a number for anything it does
 * not fully understand. A send screen that silently turns a typo into a
 * different amount is worse than one that refuses.
 */
export function parseAmount(input: string, decimals = TOKEN_DECIMALS): bigint | null {
  const cleaned = input.replace(/,/g, "").trim();
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === "" || cleaned === ".") return null;

  const [whole, fraction = ""] = cleaned.split(".");
  if (fraction.length > decimals) return null;

  const padded = fraction.padEnd(decimals, "0");
  try {
    return BigInt(`${whole || "0"}${padded}`);
  } catch {
    return null;
  }
}

/** Format base units for display, trimming trailing zeros. */
export function formatAmount(value: bigint, decimals = TOKEN_DECIMALS): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;

  const wholeText = whole.toLocaleString("en-GB");
  if (fraction === 0n) return `${negative ? "-" : ""}${wholeText}`;

  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${wholeText}.${fractionText}`;
}
