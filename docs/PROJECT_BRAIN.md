# PROJECT_BRAIN.md — read this first, every session

BegFi is a crypto money-movement platform. One link, any EVM chain, under a minute.

**One sentence:** *Anyone can ask for crypto, give away crypto, or run a campaign in crypto, in under a
minute, with one link.*

Master plan: `~/Downloads/BEGFI_IMPLEMENTATION_PLAN.md` (the source document this repo's `/docs` folder
serves). Where this file and that document disagree about **what already exists**, this file wins — it is
written from the actual code, not the plan's assumptions.

---

## 1. The four products (target shape)

| # | Product | Route (target) | Status |
|---|---------|----------------|--------|
| 1 | **Drops** (giveaways) | `/drop/<id>` | **Live.** Pots funded on-chain, one fixed prize per claimer, paid automatically by the shared sweep. Plan + record: `docs/DROPS.md`. |
| 2 | **Pay Links** (payment gateway) | `/pay/<id>` + `/username` | **Live.** `/username` (non-custodial pay page with QR) plus fixed-amount request links at `/pay/<id>` with a memo, QR, share text and on-chain settlement. "Pay with anything" conversion is not built. |
| 3 | **Campaigns** (Earn) | `/earn`, `/earn/<slug>` | **Live and paying automatically.** Individual + project campaigns, deposits, daily payouts, leaderboards. |
| 4 | **Beg Pages** (original) | `/username`, `/beg/<id>`, `/begs` | **Live.** The oldest product, still the cleanest money path. |

Everything shares one identity (wallet + username + linked X), one dashboard, one leaderboard, and — since
migration 0022 — **one payout ledger for BegFi's own pool, every campaign and every drop** (0029 added
`earn_payouts.drop_id`).

## 2. What is actually live today (verified against the code)

**Products**
- `/username` pay page: avatar, bio, socials, X-verified tick, QR + downloadable share card
  (`/api/qr/[username]`), non-custodial `$BEGFI` send. This is the "payment link" the whole site is named for.
- **Pay Links** — fixed-amount request links (`/pay/<id>`, migration 0024): an amount, a memo, a QR
  (`/api/qr/pay/[id]`), share text and a per-link OG card. Non-custodial by construction: the row is an ASK
  (no balance, no deposit address, no `paid` flag) and settlement is DERIVED from the indexer's confirmed
  transfers in `lib/pay-links.ts`. `/dashboard/pay-links` creates, lists, copies and closes them. The public
  page shows the total received and whether the ask is met, never who paid (D-036, D-037).
- **Drops** — migration 0029, `/drops` + `/drop/<id>` + `/dashboard/drops`. A pot of one token, a fixed prize
  per claim and a cap on how many people can take it, funded from the funder's OWN wallet and paid out by the
  same sweep that pays campaigns. **The first product built ON the money engine instead of beside it** (D-021,
  implemented): same distributor wallet, same `begfi.earn_payouts` ledger (one new `drop_id` column), same lease
  atom on `drop_claims`, same gas floor, kill switch, gas/low-balance alerting and hourly reconciliation. What
  is genuinely new is ATTRIBUTION (`drop_fundings`: an intent naming the funder's wallet, the drop and the
  amount, credited only when a transfer matches it) and the cross-product token lease (`begfi.pool_tokens`, one
  payout token = one live pool across campaigns AND drops, enforced by a trigger). One prize per wallet and one
  per VERIFIED X account, both unique indexes; device fingerprinting was deliberately not revived (D-055).
  Details, money rules and the two pre-existing bugs the build surfaced: `docs/DROPS.md`.
- Beg pages with goals and progress (`/beg/<id>`, `/begs`), tip receipts (`/t/[tx]` + its OG card).
- Earn: individual campaigns and **project campaigns** with their own pools, deposits credited from
  on-chain transfers, per-UTC-day reward cycles, automatic daily payouts, a pending-verification queue,
  and review actions for the allowlisted admin wallet.
- **The launchpad was removed** (commit `4da54cd`): `/launch`, `/token/[address]`, `/beg-to-launch`,
  `/dashboard/launches`, `/dashboard/fees` and `/api/launch` no longer exist. On 2026-10-15 the leftovers went
  too: **`/explore` is deleted**, along with its nav tab, footer link, sitemap entry and the modules it
  orphaned (`format.ts`, `watch-star.tsx`, `fees-history.ts`). `curve.ts` and `pons.ts` are **kept on purpose**
  — the 15-minute indexer imports them to scan trades, so deleting them by name would have broken a live cron.
  The `trades` table, the watchlist and that scan are the remaining remnant, tracked as `KNOWN_ISSUES.md` #16.
- Robinhood Chain ($BEGFI) live token: market cap, price, volume, liquidity, holders, fees on the home page,
  all keyed off the single pinned `TOKEN_CA`. This is the real, live half of what the launchpad used to do.
- **Dashboard shell** (`components/dashboard-shell.tsx`): sticky sidebar from `md` up and a scrolling tab row
  on phones, with the Admin group only for an admin wallet. Sections list only pages that exist (D-033).
- **Analytics**: `lib/analytics.ts` + `components/analytics.tsx`, mounted in the root layout. Blank
  `NEXT_PUBLIC_GA_ID` loads nothing at all; events carry no wallet address and no username (D-031).
- **SEO floor**: dynamic `sitemap.xml` (visible profiles, begs, non-draft campaigns), `robots.txt`, and a PWA
  manifest. Receipts are deliberately excluded from the sitemap (D-025). Pay links are excluded too: a request
  link is shared directly with the person who should pay it, not searched for.
- **Pay Links settle and bell at index time**: the 15-minute indexer decides from the transfers it just
  wrote whether a request was paid, records the settling transaction on the row and bells its owner (D-048).
  "Paid" is a column, not a render-time guess.
- **`begfi.ledger` (0030)** — one append-only row per campaign deposit, drop deposit and confirmed payout,
  written by triggers in the same transaction as the row it describes and keyed by `source_key` so a replay
  inserts nothing. `kind` also allows `fee` and `refund`, neither of which has a writer yet. The reconcile
  route compares it to the three source tables and audits `ledger.mismatch` on disagreement. Campaign pool
  balances read the ledger (`lib/ledger.ts`) with a source-table fallback; drop pots keep their source reads
  because `earn_payouts.submission_ids` carries the claim repair set.
- **`begfi.audit_log` (0028)** — every switch flip, automatic pause, sweep and reconciliation writes a row,
  read by the admin console and published in short on `/transparency`. The writer never throws (D-052).
- **`/transparency`** — the books, public: the payout wallet's live balance, all-time paid, what is owed now,
  the switch state and reason, the latest reconciliation per token, and the recent audit rows. In the footer,
  in the sitemap, and verified rendering the current shortfall out loud (D-053).
- **Public money totals are definer aggregates**: `received_since` (beg progress, pay-link totals) and
  `public_wallet_totals` (a profile's received total and supporter count) return ONE number to anyone, granted
  to `anon`. The `profile_stats` view also exists, `security_invoker`, for the leaderboard's exact ordering with
  the service role — which is why public totals do not come from it (D-045).
- **Seven public leaderboards** (`/leaderboard`): top earners, top begged, top supporters, top givers,
  most active, top campaigns and holders. The first six filter by last 24 hours, this week (Monday 00:00
  UTC) and all time; holders is a live snapshot. Top givers ranks wallets by distinct pools funded, not by a
  sum across tokens, and excludes draft campaigns. Top earners reads the payout ledger; top begged reads confirmed
  support transfers with the payout and fee wallets excluded, so earnings and begging are not the same number twice;
  campaigns rank by distinct people paid and keep each total in its own token; holders comes from the
  chain's explorer with the market feed's count and concentration as an honest fallback. Weekly **Beg
  Battles** (Monday 00:00 UTC reset) and the live activity feed sit below the boards.
- Notifications bell (kinds: `beg`, `fees`, `launch`, `graduation`, `move`, `claim`, `digest`,
  `earn_payout`, `campaign_payout`, `campaign_pool_low`, `payouts_paused`, `reconcile_alert`, `pay_link_paid`,
  `low_gas`, `drop_reward`, `drop_payout`, `drop_funded`), a full `/dashboard/notifications` inbox, and the
  activity feed. The watchlist still has an API and a cron path but no surface after 2026-10-17, when the
  launchpad remnant was removed from the Overview (`KNOWN_ISSUES.md` #16).

**The money engine (this is the part that matters)**
- **No smart-contract escrow.** Earn and campaign pools are funded to wallets controlled by the backend and
  paid out automatically by an EOA whose key is the single server secret `DISTRIBUTOR_PRIVATE_KEY`.
- Triggers: daily Vercel cron (`/api/cron/earn-payouts`, whose function now runs three timed slices — earn,
  campaigns, drops), a funds-arrival sweep fired by the indexer when a transfer to the distributor is seen,
  and an admin "run a sweep now" button. A claim fires the drop sweep itself, so a prize lands in seconds.
- No-double-payment is enforced in two independent layers: money truth (`payout_tx IS NULL` eligibility, set
  only after on-chain confirmation) and send truth (an atomic `claimed_at` **lease** on submission rows).
- Balance ceiling: the sweep reads the distributor's live token balance before each send and holds a native-gas
  floor; `MAX_PAYOUTS_PER_RUN = 40`, `MAX_ATTEMPTS = 10`, 10-minute lease and tx-drop windows.
- **Global kill switch** (`begfi.payout_controls`, migration 0025): one row read at the top of both sweeps
  and on the claim and submit paths, flipped from `/dashboard/earn/payouts` or `/api/admin/payouts`. It fails
  CLOSED — an unreadable row parks every payout path (D-038).
- Reconciliation now exists in BOTH forms. For in-flight transactions, a sent-but-unconfirmed hash is settled
  on the next run (unchanged). For the books: `/api/cron/reconcile`, hourly via
  `.github/workflows/reconcile.yml`, compares each token's obligations against the distributor's live balance,
  records one row per token in `begfi.reconciliation_runs`, and on a shortfall pauses payouts BEFORE it bells
  the admins (D-040–D-042). Its limits are stated in the code and in `KNOWN_ISSUES.md` #3.
- Two active campaigns can no longer share a payout token, and `$BEGFI` can no longer be a campaign's token
  — the collision in `KNOWN_ISSUES.md` #2 is now unreachable, though the shared deposit address that makes it
  possible is still Phase 1 work (D-043). Since 0029 the lease is a TABLE (`begfi.pool_tokens`) claimed by a
  trigger on `campaigns` **and** on `drops`, so the rule spans both products: a drop cannot take a token an
  active campaign is paying in, and a campaign cannot take a token a live drop holds.

**Infrastructure**
- `web/` — Next.js 16 App Router, React 19, Tailwind 4, wagmi + viem + RainbowKit. Vercel Root Directory = `web`.
- Supabase project `spgijqgogjugqtjtvunb`, schema **`begfi`** (not `public`), migrations `0001`–`0029`
  applied with `npm run migrate` (`scripts/migrate.js`). That script re-runs EVERY file in order, so an older
  migration whose object changed type later must be edited in place — a later file that changes a view column or
  a return type aborts the whole run at the earlier one (D-047).
- Indexer: `/api/cron/indexer`, called every 15 minutes by `.github/workflows/indexer.yml` (Vercel Hobby
  allows one cron a day — the workflow is the honest workaround, and the copy on the site says so).
- Reconciliation: `/api/cron/reconcile`, hourly by `.github/workflows/reconcile.yml`, same bearer-token
  contract as the indexer. It also watches the payout wallet's GAS (`gasFloor`, ten sends' worth) and bells
  when low. Both workflows need the `CRON_SECRET` repository secret; without it they fail at the guard rather
  than calling unauthenticated.
- **The indexer is currently far behind the chain** (~496k blocks on 2026-10-16, 2,000 blocks per 15-minute
  run), so every index-driven fact — pay-link settlement and its bell included — is late by that lag.
  Measured and tracked as `KNOWN_ISSUES.md` #19; the fix is multi-window scans per run.
- `contracts/` — BegSplitter + clone factory, Hardhat tests in `test/` (32 splitter tests).
- Site: `begfi.io`. Counted 2026-10-16 after Drops: 29 SQL migrations, 47 components, 35 lib modules,
  29 API routes and 23 pages (6 of them with their own OG card).
- **Payouts are currently PAUSED**, set automatically by the first reconciliation run on 2026-10-16: the
  distributor wallet holds 0 $BEGFI while 210,000 $BEGFI is owed to approved submissions. Funding the wallet is
  what resumes them (`/dashboard/earn/payouts` → Resume).

## 3. Tech decisions that are already made (do not relitigate)

- **English-only copy** everywhere on the site.
- **Robinhood Chain only** right now (`SUPPORTED_CHAINS = [robinhoodChain]`, chainId 4663). The plan wants
  Ethereum + Base added — that is a **phase**, not a patch.
- `$BEGFI` CA is **pinned in code** (`web/lib/config.ts`), never env-overridable, and the footer only claims
  the token is live once `TOKEN_CA` is set.
- Every address in `config.ts` resolves a bad value to `null`, and the UI must say "not configured" rather
  than render a control that cannot work.
- Server-only secrets use no `NEXT_PUBLIC_` prefix. `.env` is refused by the pre-commit hook by name and content.
- **The payout signer is chosen by configuration, not by import.** `lib/distributor-signer.ts` returns
a KMS-backed account when `AWS_KMS_KEY_ID`, `AWS_REGION` and `DISTRIBUTOR_ADDRESS` are all set, else an
account from `DISTRIBUTOR_PRIVATE_KEY`, else nothing. Every money path calls it; no route reads the key
directly. `DISTRIBUTOR_ADDRESS` is public and is checked against each signature, so a key/address
mismatch fails at signing rather than sending from an unfunded wallet. AWS KMS does not derive BIP32
children: one key signs for one address, which is why per-pool deposit addresses are still open.

## 4. Guardrails for an autonomous session (from the plan, §11)

**Free to do without asking:** UI, pages, navigation, copy, SEO, analytics, docs, tests, refactors that
preserve behaviour.

**MUST ASK FIRST:** payout logic, wallet and key handling, fee percentages, the ledger schema, anything that
moves funds, and adding a real-money custodial path (drops with per-pool deposit addresses).

## 5. The working loop

1. Read `PROJECT_BRAIN.md`, `ROADMAP.md`, `KNOWN_ISSUES.md`.
2. Audit the live site against the plan (route table in §2 is the baseline).
3. Pick the highest-impact item that is safe under §4.
4. Build it, then **verify it through the interface a user uses** (typecheck, build, fetch the route).
5. Update `docs/` — `CHANGELOG.md` for what changed, `DECISIONS.md` for why, `KNOWN_ISSUES.md` for what broke.
6. Report what changed and what is next.

**Non-negotiable:** everything listed in §2 must keep working. This platform pays people real money; a
regression in the payout path is worse than a missing feature.
