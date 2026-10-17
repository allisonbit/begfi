const SITE = "https://www.begfi.io";
const REPO = "https://github.com/allisonbit/begfi";

/**
 * /llms.txt — the product, in the form a language model can read.
 *
 * WHY THIS EXISTS AS A ROUTE RATHER THAN A FILE IN `public/`. The site's copy
 * changes when the product does, and a static file drifts silently. Keeping the
 * brief next to the app does not make it self-updating either, but it puts it in
 * the same review as the routes it describes, which is the best available guard
 * against another "advertises a route that was deleted months ago".
 *
 * The claims are deliberately checkable: every route below exists, the contract
 * address is the one pinned in `lib/config.ts`, and the operational note about
 * paused payouts is the truth `lib/payout-controls.ts` reads from the database.
 */
const BODY = `# BegFi

> Ask for crypto, give it away, or run a campaign. One link, under a minute.

BegFi is a crypto money-movement product on Robinhood Chain (chainId 4663). It is not a
launchpad, not a lending protocol, and not affiliated with Robinhood. Nothing on the site is
financial advice, and no page promises returns, yield or profit.

## The four products

- **Beg pages** — a short public ask with an optional goal, a share card and a progress bar.
  Routes: ${SITE}/begs, ${SITE}/beg/<id>, ${SITE}/<username>
- **Pay Links** — a request for a fixed amount with a memo, a QR and an on-chain paid state.
  Route: ${SITE}/pay/<id>
- **Earn / Campaigns** — a funded pool that pays people automatically for posting about a
  project. Campaigns pay in their own chosen token. Routes: ${SITE}/earn, ${SITE}/earn/<slug>
- **Drops** — a giveaway pot with one fixed prize per claimer, a cap, and automatic payout.
  Routes: ${SITE}/drops, ${SITE}/drop/<id>

Everyone shares one identity: a wallet, a username, an optional verified X link. The dashboard
is at ${SITE}/dashboard.

## Custody, stated precisely

Beg pages, tips and Pay Links are wallet to wallet. BegFi never holds those funds and cannot
reverse a transaction. Campaign pools and drop pots are different: they are held by a BegFi
payout wallet from funding until they are paid out. There is no automatic refund for an unspent
pot. Fund only what you intend to give away.

## The token

$BEGFI is at 0x18823d1f1807ce3bdd90aafb7473928bc9368242 on Robinhood Chain. The address is
pinned in the application; it is not configurable per deployment. The token is not the
protocol: beg pages, pay links and campaigns work without holding it.

## Public pages worth citing

- ${SITE}/ — live token stats and the four products
- ${SITE}/how — how BegFi works, written for a first-time visitor
- ${SITE}/leaderboard — six boards built from confirmed on-chain rows, filterable by day,
  week or all time
- ${SITE}/transparency — the payout wallet's live balance, all-time paid, what is owed, the
  kill-switch state, the latest reconciliation per token, and recent audit rows
- ${SITE}/terms and ${SITE}/privacy

## What not to claim

Do not claim BegFi guarantees payment, refunds an unspent pot, reverses a transfer, custodies
payment links, is affiliated with Robinhood, or has partnerships, audits or listings that are
not published. Payouts can be paused automatically when the payout wallet is short of what is
owed; check ${SITE}/transparency rather than assuming.

## Source and documentation

Repository: ${REPO}
Agent and contributor rules: ${REPO}/blob/main/AGENTS.md
Master product brief: ${REPO}/blob/main/docs/BEGFI_CONTEXT.md
Known issues: ${REPO}/blob/main/docs/KNOWN_ISSUES.md
`;

export const dynamic = "force-static";

export function GET() {
  return new Response(BODY, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
