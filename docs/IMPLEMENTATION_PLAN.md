# IMPLEMENTATION_PLAN.md — the master plan against the code

This is the working plan for the full BegFi build. It follows the master document section by
section, says what is actually live, and separates work that can ship now from work that needs
an explicit decision because it moves money. `ROADMAP.md` remains the longer audit and backlog;
this file is the order of work.

**Rule inherited from the master plan and from `AGENTS.md`:** payout logic, wallet and key
handling, fee percentages, ledger schema, and anything that moves funds are **ask-first**.
Everything else (UI, pages, search, docs, read-only boards, copy, SEO) can ship without a
meeting.

---

## 1. Status against the master plan

Legend: **LIVE** · **PARTIAL** · **MISSING** · **ASK-FIRST** (moves money or keys)

| Plan | Requirement | Status | Reality |
|---|---|---|---|
| §2 | Ethereum, Base, Robinhood Chain | **MISSING** | Robinhood only, chainId 4663, hardcoded in `web/lib/chains.ts`. |
| §2 | `chains` as config, not code | **MISSING / ASK-FIRST** | A chain is a code constant today; adding one touches RPC, tokens and the payout path. |
| §2 | ERC-20 autodiscovery + validation | **PARTIAL** | Address and decimals read from the contract (`lib/erc20.ts`); no fee-on-transfer, rebasing or blacklist screen. |
| §3.2 | No escrow, backend payout wallet | **LIVE** | Documented single-key model. |
| §3.2 | One deposit address per pool | **MISSING / ASK-FIRST** | Every pool deposits to one distributor address; attribution is inferred. This is the root cause in `KNOWN_ISSUES.md` #2. |
| §3.2 | Ledger first (deposit/payout/fee/refund) | **LIVE for deposit/payout** | Migration 0030 adds `begfi.ledger`, written by triggers on the three source tables and backfilled. `fee` and `refund` are allowed kinds with no writer yet. |
| §3.2 | Confirmations before credit | **LIVE** | Indexer credits confirmed transfers. |
| §3.2 | Queue, retries, dead-letter | **PARTIAL** | In-loop retries, attempt cap, failed rows visible; bounded by the 60s function. |
| §3.2 | Hourly reconciliation | **LIVE** | `/api/cron/reconcile`, per token, pauses on shortfall. |
| §3.2 | Kill switch (global/chain/pool) | **PARTIAL** | Global switch live and fails closed; per-pool via campaign status; no per-chain switch yet. |
| §3.3 | Wallet sign-in, username, X link | **LIVE** | SIWE-style, username claims, X verification. |
| §3.3 | Project accounts | **MISSING** | Campaigns belong to a profile; there is no project entity or project dashboard. |
| §3.4 | One claim per wallet / per X | **LIVE** | Unique indexes on `drop_claims` (wallet and verified handle). |
| §3.4 | Captcha, behaviour signals | **PARTIAL** | DB rate limits; no captcha. |
| §3.5 | Fees configurable and shown | **PARTIAL / ASK-FIRST** | No platform fee setting for new pools; the removed launchpad tracked its own fees. |
| §4 | Giveaways create → fund → share → claim | **LIVE** | One fixed prize per claim, cap, deadline, auto payout, owner controls. |
| §4 | Claim modes (percentage, random, first-N) | **MISSING / ASK-FIRST** | Schema and sweep assume one fixed prize. |
| §4 | Refund of unspent pot | **MISSING / ASK-FIRST** | No refund path; copy says the remainder stays in the wallet. |
| §4 | Per-drop OG card | **MISSING** | This round adds it. |
| §4 | Custom branding, requirements (follow/like) | **PARTIAL** | Name, description, token, prize, cap, closing time; no theme, banner or social gates. |
| §5 | Username pay page, QR, send | **LIVE** | Wallet-to-wallet; amount presets in the send panel. |
| §5 | Request links, memo, QR, paid state | **LIVE** | `/pay/<id>`, settlement derived from confirmed transfers. |
| §5 | Receipts / status page | **LIVE** | `/pay/<id>` status and `/t/<tx>` receipts. |
| §5 | Multi-chain / multi-token acceptance | **MISSING** | Robinhood and $BEGFI only; conversion estimate not built. |
| §5 | Business mode, API, webhooks | **MISSING** | No public API or embed. |
| §6 | Individual + project campaigns | **PARTIAL** | Both campaign shapes exist; project identity does not. |
| §6.3 | Task types beyond "post with required text" | **MISSING / ASK-FIRST** | One verifier rule; adding like/retweet/follow needs a verification provider and payout rules. |
| §6.4 | Pluggable verifier | **PARTIAL** | `campaign-verify` is one module; not swappable by config. |
| §6.5 | Automatic daily payouts, one per wallet/day | **LIVE** | Sweep + lease + ledger. |
| §7 | Beg pages, goals, socials, supporter wall | **PARTIAL** | Goals, progress, socials, level, feed; themes and a dedicated wall are thin. |
| §8 | Public leaderboards, filters, activity | **LIVE (extended this round)** | Seven boards with last-24h/week/all, Beg Battle, live feed with creation events and drop wins. |
| §9.1 | Sidebar + mobile tab bar, top bar | **PARTIAL** | Sidebar + mobile row + bottom dock exist; top bar has no search or chain selector (chain selector would lie until multi-chain). |
| §9.2 | Full menu incl. Projects, Help | **PARTIAL** | Overview, My begs, Earn, Campaigns, Drops, Pay links, Leaderboards, Activity, Notifications, Profile, Settings live; Projects and Help missing (Help added now). |
| §9.3 | Design system, skeletons, empty/error | **PARTIAL** | Tokens in `globals.css`; loading/404/error added; not every page audited. |
| §10 | Schema as specified | **PARTIAL** | Coherent but different: profiles, campaigns, drops, pay_links, earn_payouts. No `projects`, `chains`, generic `ledger`, `tokens`. |
| §11 | Brain files + decisions + changelog | **LIVE** | This folder, `BEGFI_CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`. |
| §12 | Admin panel | **PARTIAL** | Payout console with switch, reconciliation, failures, ledger; no chain monitor or moderation queue. |
| §13 | Security checklist | **PARTIAL** | Server-only secrets, wallet auth, rate limits, audit log; external review and per-chain pause missing. |
| §14 | SEO, OG, analytics, distribution | **PARTIAL** | Sitemap/robots/manifest/analytics/OG cards; drops were the one shareable route without a card. |
| §15 | Phases 0–6 | **IN PROGRESS** | Phases 0, 2, 3 and most of 5 are live; Phase 1 needs custody decisions; 4 needs projects; 6 is unstarted. |

---

## 2. What this round ships (no money path touched)

1. **Top Givers board.** The plan asks for it and the data already exists in
   `campaign_deposits` and `drop_deposits`. Ranked by confirmed funded amount, with draft
   campaigns excluded so test money cannot top a public board.
2. **A live feed that includes creation, not only payment.** New drops and new campaigns join
   payouts and transfers; drop prizes stop being mislabelled as BegFi-pool earnings.
3. **Search.** `/search` across usernames, campaigns and drops, reachable from the top bar.
   Public data only, no new query surface on private tables.
4. **A Help page.** `/help` answers the questions the product keeps being asked: what BegFi
   holds, what it never holds, how a drop pays, who can claim, what happens to an unspent pot,
   what the token is. Linked from the footer and the sitemap.
5. **A per-drop share card.** The one shareable route without an OG image gets one, because
   the card is the distribution channel. `KNOWN_ISSUES.md` #20 closes.
6. **Your own row on the boards.** A signed-in visitor sees their rank highlighted when they
   are on the visible board, without leaking their session to anyone else.

Everything here is read-only or copy.

---

## 3. The money phase — needs your explicit yes

These are the items that would make the plan's acceptance checks true, and none of them should
be built without a decision recorded in `docs/DECISIONS.md`.

### 3.1 Per-pool deposit addresses (highest value)

One HD wallet, one derived address per pool (`m/44'/60'/0'/0/<poolIndex>`), stored on the pool
row. The indexer credits exactly what arrives at that address, so attribution stops being
inferred from token and amount. This closes the root cause of `KNOWN_ISSUES.md` #2 and makes
refunds possible. **Risks:** key derivation and backup, address reuse, a new deposit address for
every campaign/drop, and the reconciliation model changes from per-token to per-pool.

### 3.2 Generic ledger

One append-only `ledger` table with `kind ∈ {deposit, payout, fee, refund}`, `pool_id`,
`chain_id`, token, amount, tx, status. Balances computed from it. The current product-level
tables would become views or stay as detail rows. **Risk:** migrating live money history; a
reconciliation pass is mandatory before switching reads.

**Built (2026-10-17).** `supabase/migrations/0030_ledger.sql` creates `begfi.ledger` with
`kind ∈ {deposit, payout, fee, refund}` and `pool_kind ∈ {campaign, drop, pool}`. Triggers on
`campaign_deposits`, `drop_deposits` and `earn_payouts` write the row in the same transaction,
keyed by `source_key`, so a replay inserts nothing; the migration backfills history. The
reconcile route compares the ledger against the three source tables on every run and records
`ledger.mismatch` when they disagree. Campaign pool balances (`lib/campaigns.ts`) now read the
ledger, falling back to the source tables when the read fails; on live data the figures were
identical. Drop pots deliberately stay on the source reads: their repair term depends on
`earn_payouts.submission_ids`, which maps a settled payout back to the claims it covered and
which the ledger does not carry. **Still open:** `chain_id` is absent because the source tables
do not carry one yet, and `fee` and `refund` have no writer. None of that changes a balance
today; both are required before refunds.

### 3.3 Hot/cold split and key storage

A small hot wallet per chain, a cold treasury, a sweep-to-cold action, and keys in a KMS or
encrypted store rather than one Vercel env value. **Risk:** this is the single-key failure in
`KNOWN_ISSUES.md` #1; changing it needs an operational runbook and a recovery drill, not just
code.

**Partly built (2026-10-17).** `lib/kms-signature.ts` and `lib/distributor-signer.ts` let the
payout wallet sign through AWS KMS: the server sends a 32-byte digest, KMS returns DER, and the
module produces a low-s signature with the right recovery bit, checked against
`DISTRIBUTOR_ADDRESS`. The env private key remains as the fallback, so this is a migration path
rather than a removal. **Still open:** the hot/cold split, a sweep-to-cold action, key rotation,
and a recovery drill. KMS removes the key from the process but not the concentration of funds in
one address. The KMS call is injected, so Google Cloud KMS could use the same module, but only
AWS is wired.

### 3.4 Refunds and claim modes

Refund the unspent pot to the funder on end; allow percentage / random / first-N prize modes.
Both depend on 3.1 being exact, and both change the payout sweep. **Risk:** a refund path is a
new way money leaves the wallet and must be reconciled and idempotent.

### 3.5 Multi-chain

A `chains` row per network, a token registry, per-chain gas wallets, and an indexer per chain.
**Risk:** every payout path currently assumes chainId 4663 and $BEGFI. Adding Base/Ethereum is a
Phase 1 project, not a selector in the header.

**Recommended order:** 3.1 → 3.2 → reconciliation → 3.4 → 3.3 → 3.5. The first two make the
rest safe; the third is operational and should be rehearsed before it is needed.

---

## 4. My additions beyond the master plan

These are here because they remove a specific reason a person fails at crypto. The first six
are scheduled; the rest are backlog with a reason.

1. **A plain-language safety verdict before funding** — read the token's transfer tax, owner
   powers and mint authority, simulate a round trip, and print one amber/red line. Protects the
   funder and the claimer; the most credible trust feature BegFi can add.
2. **Sponsored first claim / first payment** — a paymaster on the claim and pay path only, with
   a daily cap. The first transaction is the one that loses the user.
3. **`@username` as an address everywhere** — no `0x` in a share line or a payer's field.
4. **Dollar-denominated pots** — "$50 of whatever token" quoted at funding time. Token amounts
   are unreadable to normal people; dollars are not.
5. **Receipts for campaign and drop payouts** — `/t/[tx]` already proves a tip; every payout
   should have the same public proof.
6. **PWA install + offline shell** — an icon on the home screen is the honest prerequisite for
   a store listing, and the manifest already exists.
7. **A public "what is funded" page per pool** — deposits, payouts, remaining, with explorer
   links. Claimers trust a pot they can audit; `/transparency` is the platform-wide version.
8. **A claim/rescue path for a stuck payout** — if a transfer is sent but unconfirmed past the
   window, surface it on the page and the admin queue instead of leaving the claimer to guess.
9. **A share card per payout, not only per pot** — the winner's post is the ad. One image with
   the prize and the transaction, generated server-side.
10. **A "no wallet yet" claim path** — embedded wallet or a generated address the claimer can
    later withdraw from; Telegram giveaway winners will not install MetaMask at the door.
11. **A single "your money" page** — received, earned, claimable, funded, refundable, in one
    place, with the next action on each line.
12. **A moderation queue that names the rule** — flagged wallet, duplicate post, draft campaign.
    A blocklist without a reason is a support ticket waiting to happen.
13. **A weekly self-review** — run the audit, rank the ten weakest pages, fix the top three,
    write the list in `docs/CHANGELOG.md`. The plan asks for this; a calendar entry is not a
    process.
14. **One primary action per screen** — audit every page for a single next step; where there
    are three competing CTAs, remove two.

---

## 5. Acceptance checks for this round

- `/leaderboard?tab=givers` ranks confirmed funders and excludes draft campaigns.
- `/leaderboard` activity includes a new drop and a new campaign, and a drop prize says
  "won in <drop>", not "BegFi pool".
- `/search?q=...` returns usernames, campaigns and drops, and an empty query explains itself.
- `/help` renders, is in the footer and the sitemap, and every custody sentence matches
  `BEGFI_CONTEXT.md`.
- `/drop/<id>` unfurls with an image: HTTP 200, `image/png`, 1200×630.
- A signed-in visitor's row is marked on the board they appear on; signed-out output contains
  no username from a session.
- `npm run typecheck`, `npm run build`, and the 32 contract tests pass.
- Nothing in `web/lib/*distributor*`, `payout-controls`, `earn_payouts`, or the wallet config
  changed.

## 6. What is not done, stated plainly

- The ledger exists and is verified equal to its sources, but no page reads it yet; the
  source tables still compute every displayed balance. No payout, wallet, key or fee code
  changed in this round.
- The named holder list from the explorer is unverified from this machine; the fallback is.
- Signed-in pages were compiled and gated, not visually reviewed with a wallet.
- No end-to-end payout was exercised: the distributor wallet holds 0 against 210,000 owed, and
  payouts are paused. That is the first operational blocker, before any feature below.
