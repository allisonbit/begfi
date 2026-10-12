import "server-only";

import { createPublicClient, http, parseAbi, parseAbiItem } from "viem";
import { robinhoodChain } from "@/lib/chains";
import { ponsCurveAbi } from "@/lib/curve";
import { PONS_FACTORY, ponsFactoryAbi } from "@/lib/pons";

/**
 * Top holders of a launched token, from the chain.
 *
 * HOW A BALANCE IS RECONSTRUCTED WITHOUT A TOKEN_STATE INDEX: every balance is
 * the sum of Transfer events (in minus out) since launch, and on a Pons curve
 * the additional piece is the trades: `CurveBuy` mints tokens to the recipient
 * and `CurveSell` burns from the seller, and neither goes through Transfer of
 * the token from someone else, so the two must be combined.
 *
 * That is three log scans per token — token Transfer, curve buys, curve sells
 * — bounded by a block window, because the public RPC refuses unbounded
 * ranges. This is honest work, and heavy. It is called with `cache()` from the
 * token page only, once per render, and the token's Launch record supplies the
 * curve so no guessing is involved.
 *
 * MINTED-SUPPLY RULE: factory launches mint the full configured supply to the
 * curve (that is the entire point of a bonding-curve launch: 1B tokens, none
 * premined). So `totalSupply` from the ERC-20 contract, which the token page
 * already reads, is the denominator — not a sum of our reconstructed deltas.
 */
const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/**
 * How far back the scan reaches. Matched to the launch scan in the dashboard:
 * a long-running token with quiet volume is fine, a very old token with huge
 * volume could theoretically be cut off — the page says the window, so the
 * figure it shows is never a silent truncation.
 */
const WINDOW = 2_000_000n;

const ZERO = "0x0000000000000000000000000000000000000000";

export type Holder = {
  address: string;
  balance: bigint;
  /** Fraction of supply, 0..1. Computed after balances are summed. */
  share: number;
  /** True when this address minted the token (the launch receipt's deployer). */
  isCreator: boolean;
};

export async function getTopHolders(
  token: string,
  curve: string,
  totalSupply: bigint,
  creator: string,
  max = 10,
): Promise<{ holders: Holder[]; windowBlocks: number; truncated: boolean }> {
  const client = createPublicClient({ chain: robinhoodChain, transport: http() });

  const head = await client.getBlockNumber();
  const from = head > WINDOW ? head - WINDOW : 0n;

  const [transfers, buys, sells] = await Promise.all([
    client.getLogs({
      address: token as `0x${string}`,
      event: transferEvent,
      fromBlock: from,
      toBlock: head,
    }),
    client.getLogs({
      address: curve as `0x${string}`,
      event: parseAbiItem(
        "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
      ),
      fromBlock: from,
      toBlock: head,
    }),
    client.getLogs({
      address: curve as `0x${string}`,
      event: parseAbiItem(
        "event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)",
      ),
      fromBlock: from,
      toBlock: head,
    }),
  ]);

  /**
   * Balances accumulate as deltas per address. A map keeps three event
   * streams in one ledger without predefining addresses: wallets appear when
   * the chain first mentions them.
   *
   * Sell burns FROM the seller; Buy mints TO the recipient. Neither event
   * carries a Transfer of the token, so both must be applied as deltas here.
   */
  const ledger = new Map();
  const apply = (addr: string | undefined, delta: bigint) => {
    if (!addr) return;
    const a = addr.toLowerCase();
    if (a === ZERO) return;
    ledger.set(a, (ledger.get(a) ?? 0n) + delta);
  };

  for (const log of transfers) {
    const fromAddr = log.args.from?.toLowerCase();
    const to = log.args.to?.toLowerCase();
    const value = (log.args as { value?: bigint }).value ?? 0n;
    apply(fromAddr, -value);
    apply(to, value);
  }

  for (const log of buys) {
    // CurveBuy: buyer, recipient, quoteIn, tokensOut, ...
    if (log.args.recipient && log.args.tokensOut !== undefined) {
      apply(log.args.recipient, log.args.tokensOut);
    }
  }

  for (const log of sells) {
    // CurveSell: seller, recipient, tokensIn, quoteOut, ...
    if (log.args.seller && log.args.tokensIn !== undefined) {
      apply(log.args.seller, -log.args.tokensIn);
    }
  }

  const creatorLower = creator.toLowerCase();

  const sorted = [...ledger.entries()]
    .filter(([, bal]) => bal > 0n)
    .sort((a, b) => (a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0))
    .slice(0, max);

  const holders: Holder[] = sorted.map(([address, balance]) => ({
    address,
    balance,
    share: totalSupply > 0n ? Number(balance) / Number(totalSupply) : 0,
    isCreator: address === creatorLower,
  }));

  return {
    holders,
    windowBlocks: Number(head - from),
    truncated: sorted.length === max,
  };
}

/**
 * Whether a token has already graduated, from the factory record. Used to
 * label the holders list (a graduated token's holders all come from pool
 * transfers; an on-curve token's include curve buys and sells).
 */
export async function isGraduated(token: string): Promise<boolean | null> {
  const client = createPublicClient({ chain: robinhoodChain, transport: http() });
  try {
    const record = await client.readContract({
      abi: ponsFactoryAbi,
      address: PONS_FACTORY,
      functionName: "getLaunchedToken",
      args: [token as `0x${string}`],
    });
    return record.phase !== 0;
  } catch {
    return null;
  }
}
