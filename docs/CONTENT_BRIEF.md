# CONTENT_BRIEF.md — copy-paste brief for content

Keep this short enough to paste into a content tool. Update §6 with every release.

---

## 1. What BegFi is

BegFi is a crypto money-movement product on Robinhood Chain. Anyone can ask for crypto, give
it away, or run a campaign in crypto, in under a minute, with one link.

Four products, one identity (wallet + username + optional linked X):

- **Beg pages** — a short public ask with a goal and a share card. `begfi.io/@username`
- **Pay Links** — a request for a fixed amount with a memo, a QR and a paid state. `/pay/<id>`
- **Earn / Campaigns** — a funded pool that pays people automatically for posting about a
  project. `/earn`
- **Drops** — a giveaway pot with one fixed prize per claimer and a cap, paid automatically.
  `/drops`

## 2. How Earn works (short version)

A project funds a pool and writes the rule: the post must contain a mention or hashtag. People
submit a post link, the site checks it, and qualifying entries are paid automatically from the
pool. Campaigns pay in their own token. There is a per-wallet limit per day, and a campaign
has its own leaderboard.

Be precise about custody: **campaign pools and drop pots are held by a BegFi payout wallet
from funding until payout.** Payment links and tips are wallet to wallet.

## 3. Official wording

- **Tagline:** Everyone begs. BegFi gives begging a payment link.
- **One-liner:** Ask for crypto, give it away, or run a campaign. One link, under a minute.
- **Custody:** Payments are wallet to wallet — BegFi never holds them and cannot reverse a
  transaction. Campaign pools and drop pots are held by a BegFi payout wallet until they are
  paid out.
- **Token:** $BEGFI is on Robinhood Chain at
  `0x18823d1f1807ce3bdd90aafb7473928bc9368242`. The token is not the protocol.
- **Not affiliated:** BegFi is not affiliated with Robinhood.

## 4. What is live now

Beg pages, Pay Links (fixed amount, memo, QR, paid state), Earn campaigns with automatic daily
payouts, Drops, public leaderboards (six boards, day/week/all-time), the public books at
`/transparency`, wallet sign-in with usernames and X verification, and the dashboard.

**Operational honesty:** payouts can be paused by reconciliation when the payout wallet is
short. Do not claim people are being paid "right now" without checking `/transparency`. The
indexer can lag the chain, so a paid link may take time to show as paid.

## 5. What NOT to say

No promises of returns, profit, yield, APY, price appreciation or "passive income". No
"guaranteed", "risk-free", "to the moon", "revolutionary". No claim that BegFi can refund an
unspent pot, reverse a transfer, or recover a wrong-wallet send. No claim that BegFi is a bank,
a custodian for payment links, or affiliated with Robinhood. Do not invent partnerships,
audits, listings or users.

## 6. What's new (update this section every release)

**2026-10-17**

- The leaderboard is now six boards: top earners, top begged, top supporters, most active, top
  campaigns and holders. Every board filters by today, this week or all time (holders is a
  live snapshot).
- Pay Links have amount presets (5 / 20 / 100 / 500, or any amount) so a request takes one tap.
- `docs/BEGFI_CONTEXT.md`, `AGENTS.md`, `CLAUDE.md` and `/llms.txt` now give outside AI tools a
  single accurate brief. `/how` explains the product to a first-time visitor.

**2026-10-16**

- Drops shipped: a funded pot, one prize per wallet and per verified X account, automatic
  payout, owner controls.
- Pay Links shipped: fixed amount, memo, QR, share text, settlement from confirmed transfers.
- The launchpad was already removed; nothing new launches a token.

## 7. Voice

Internet-native, blunt, kind. Lowercase energy in headlines, plain sentences in the body. Joke
about begging, never about the person begging. Say the thing, then say why. Short. No brand
voice, no hype, no throat clearing.
