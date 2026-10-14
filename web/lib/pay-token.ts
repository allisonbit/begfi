import { BEG_TOKEN_ADDRESS } from "@/lib/config";

/**
 * Pay-with-any-token — the "send in any token, it swaps into $BEGFI that
 * reaches the recipient" flow.
 *
 * WHAT EXISTS ON ROBINHOOD CHAIN (checked October 2026, chain id 4663):
 *
 *  - Uniswap V2/V3/V4 and the Universal Router are officially deployed
 *    (github.com/Uniswap/contracts deployments/4663.md; Universal Router is
 *    0x204FAca1764B154221e35c0d20aBb3c525710498);
 *  - 1inch documents Swap API support for chain 4663
 *    (business.1inch.com/whats-new/robinhood-chain-support), as does
 *    KyberSwap's aggregation router
 *    (docs.kyberswap.com/developer-guide/aggregator-api, router
 *    0x6131B5fae19EA4f9D964eAc0408E4408b66337b5);
 *  - the principal base pair on the chain is WETH/USDG; pool inventory is
 *    thin and changes (docs.robinhood.com/chain/connecting/).
 *
 * WHY STILL "COMING SOON". $BEGFI is live and the pool has real liquidity —
 * but a live pool is not a quoting pipeline. Showing rate, slippage and fees
 * before a confirm means a server-side quote source (1inch/KyberSwap Swap API
 * with a key, wired server-side) actually answering requests for this pair.
 * Until that is built and can answer, the only honest UI is "coming soon":
 * a number shown from guesswork is worse than none.
 *
 * LIGHTING IT UP LATER. `payTokenState` is the single switch. When a real
 * quote source answers, the state turns available and the send flow becomes:
 * pick token → server quote (rate, slippage, fee) → confirm → swap through
 * the aggregator router with the recipient as receiver of $BEGFI.
 */
export type PayTokenState = { available: false; note: string };

export function payTokenState(): PayTokenState {
  // $BEGFI's address is configured (TOKEN_CA); what is missing is the real
  // quote source behind an `available: true` branch. Every later condition
  // goes here, each with its own reason. No branch returns true until code
  // that can really produce rate, slippage and fee numbers is written.
  const tokenConfigured = BEG_TOKEN_ADDRESS !== null;
  if (!tokenConfigured) {
    return {
      available: false,
      note: "Coming soon — pay in any token and it swaps into $BEGFI before it reaches the recipient. It goes live once a real quote source is wired for the token.",
    };
  }
  return {
    available: false,
    note: "Coming soon — $BEGFI is live, and paying in another token will swap into it before it reaches the recipient. Once the quote source is wired, the rate, slippage and fees show here before you confirm.",
  };
}
