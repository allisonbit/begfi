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
 * SO WHY STILL "COMING SOON". A router is not a route. Swapping ANY token into
 * $BEGFI needs a pool or an RFQ quoting that exact pair, and $BEGFI is not live
 * yet — no contract address configured, therefore no pools, therefore no real
 * rate, slippage or fee number exists to show. The spec is explicit: show the
 * rate before confirming, never fake numbers. Until the token ships and a live
 * route source answers quotes for it, the only honest UI is "coming soon".
 *
 * LIGHTING IT UP LATER. `payTokenState` is the single switch. When the token
 * is configured and a real quote source (1inch or KyberSwap's API, server-side
 * with a key) is added, the two states below turn available and the send flow
 * becomes: pick token → server quote (rate, slippage, fee) → confirm → swap
 * through the aggregator router with the recipient as receiver of $BEGFI.
 * Nothing in the UI needs to guess at values in the meantime.
 */
export type PayTokenState = { available: false; note: string };

export function payTokenState(): PayTokenState {
  // No $BEGFI address ⇔ no pools to route through ⇔ no real quote to show.
  // Every later availability condition goes here, each with its own reason.
  // The function stays honest by construction: there is no `available: true`
  // branch until the code that can really produce rate, slippage and fee
  // numbers is written behind one.
  if (!BEG_TOKEN_ADDRESS) {
    return {
      available: false,
      note: "Coming soon — pay in any token and it swaps into $BEGFI before it reaches the recipient. Robinhood Chain has swap routers, but a rate and slippage preview can only be shown once $BEGFI is live with pools to route through. Until then nothing here is quoted, because nothing real exists to quote.",
    };
  }
  // Not yet — the type narrowing above happens to cover every current code
  // path, but the exhaustive return keeps that a fact the compiler checks
  // rather than an assumption.
  return {
    available: false,
    note: "Coming soon — pay in any token and it swaps into $BEGFI before it reaches the recipient.",
  };
}
