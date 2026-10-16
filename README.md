# BegFi

Everyone begs. BegFi gives begging a payment link.

A **non-custodial `$BEGFI` payment link on Robinhood Chain**, plus paid campaigns. You claim
`begfi.io/<username>`, anyone can open that link and send you `$BEGFI` wallet-to-wallet, you can request an
exact amount with a link that carries the memo (`/pay/<id>` — the payer's wallet goes straight to yours), you
can write a "beg" that generates its own shareable page, and a project can fund a pool that pays people
automatically for posting about it.

**`docs/` is the source of truth for what this product is and where it is going.** Read
[`docs/PROJECT_BRAIN.md`](docs/PROJECT_BRAIN.md) first — it is written from the code rather than from this
file, and it is updated when the code changes. The other brain files are
[`ROADMAP.md`](docs/ROADMAP.md) (phases and the audit), [`DECISIONS.md`](docs/DECISIONS.md),
[`CHANGELOG.md`](docs/CHANGELOG.md), [`KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md), [`SECURITY.md`](docs/SECURITY.md)
and [`DISTRIBUTION.md`](docs/DISTRIBUTION.md).

> **A note on this file.** It previously advertised `/launch` and `/token/[address]` as routes, months after
> the launchpad was removed in `4da54cd` — and that stale claim produced two wrong statements in an audit.
> If a change removes a route, delete it from this file in the same commit.

## Layout

```
web/                     Next.js 16 app — Vercel Root Directory points here
  app/                   pages: /, /[username], /begs, /beg/[id], /pay/[id], /earn, /earn/[slug],
                         /leaderboard, /t/[tx], /dashboard/*, /terms, /privacy
                         api: admin, auth, beg, campaign, cron, earn, message, notifications,
                              pay, profile, qr, username, watchlist
  components/            the UI, incl. dashboard-shell (sidebar + phone tabs)
  lib/                   chains, ERC-20, config, Supabase clients, wallet sign-in,
                         the payout distributors, pay-links, payout-controls, analytics
contracts/               BegSplitter, its clone factory, and a local-only TestToken
test/                    Hardhat tests for the splitter (32 passing)
supabase/migrations/     schema, RLS and seed data for the `begfi` schema (0001–0025)
scripts/                 migrate.js (applies migrations), push-env.js (Vercel env),
                         hooks/ (the pre-commit secret guard)
docs/                    the product brain — read PROJECT_BRAIN.md first
```

## Running it

```sh
npm install                 # repo root: Hardhat + OpenZeppelin
npm test                    # 32 splitter tests
npm run migrate             # applies supabase/migrations to the `begfi` schema

cd web && npm install       # app dependencies (.npmrc sets legacy-peer-deps — see that file)
cp .env.example .env.local  # then fill in, at minimum, the Supabase and wallet-auth values
npm run dev
```

`web/.env.example` documents every variable. The two REQUIRED groups are Supabase and wallet sign-in;
everything else degrades to an honest "not configured yet" state rather than a broken-looking control
(see `web/lib/config.ts`, which resolves every malformed address to `null` and requires the UI to say so).

**One step that is easy to miss:** the `begfi` schema must be listed under **Settings → API → Exposed
schemas** in the Supabase dashboard. Without it PostgREST answers 404 for every call no matter how the RLS is
written.

### Local testing, and what broke about it

`npx hardhat node` runs at **chainId 4663 — the same chain id as mainnet** — so a local run exercises the
identical code path rather than a parallel network that has to be kept in step with the real one.

The old recipe here set `NEXT_PUBLIC_BEG_TOKEN_ADDRESS` to a locally deployed `TestToken`. **That no longer
works**: `$BEGFI`'s contract address is pinned in `web/lib/config.ts` (`TOKEN_CA`) and is deliberately not
env-overridable, so the app always reads the real token. Local end-to-end testing of the *send* flow
therefore needs the chain forked at the pin, not a test token — this is the direct cost of the "always this
exact CA" decision (`docs/DECISIONS.md` D-002), recorded rather than papered over.

`TestToken` has an open `mint` — it is a faucet, and it must never exist on a chain where it could be
mistaken for `$BEGFI`. The deploy script refuses to deploy it to mainnet.

## Current state

**Built, running, and verified**

- **`/[username]` pay page** — avatar, bio, socials, X-verified tick, QR plus a downloadable share card, and
  the non-custodial `$BEGFI` send flow. Wallet-to-wallet: BegFi never holds these funds.
- **Pay Links** — `/pay/<id>`: a fixed amount with a memo, a QR (`/api/qr/pay/<id>`), share text and its own
  OG card. The row is an ASK, never money — the payer's wallet sends straight to the owner's, and "paid" is
  derived from the indexer's confirmed transfers rather than stored, so no row of ours can claim money that
  did not arrive. `/dashboard/pay-links` creates, copies, closes and opens them.
- **Begs** — `/begs` feed, `/beg/[id]` pages with goals and progress, generated share images, and `/t/[tx]`
  tip receipts framed as something worth posting.
- **Earn / campaigns** — individual and project campaigns with their own pools, deposits credited from
  confirmed on-chain transfers, per-UTC-day reward cycles, **automatic payouts** with no manual approval, a
  pending-verification queue, and review actions for the allowlisted admin wallet. Two independent
  no-double-payment layers: `payout_tx IS NULL` for money truth and an atomic `claimed_at` lease for send
  truth.
- **`$BEGFI` is live** on Robinhood Chain (4663), launched 2026-10-14 via runitup.gg. Home-page stats (market
  cap, price, volume, liquidity, holders, fees) read from real market and on-chain sources, all keyed off the
  single pinned `TOKEN_CA`.
- **Money safety controls** — a **global payout kill switch** (`begfi.payout_controls`, one lever on
  `/dashboard/earn/payouts`, read at the top of every sweep, claim and submit; it fails closed on an unreadable
  row) and an **hourly reconciliation job** (`/api/cron/reconcile` via `.github/workflows/reconcile.yml`) that
  compares each token's obligations against the distributor's live on-chain balance, records the result in
  `begfi.reconciliation_runs`, and pauses payouts automatically on a shortfall before it alerts a human.
- **Dashboard** — a sidebar from `md` up and a tab row on phones, over Overview, Begs, Pay Links, Campaigns,
  Activity and Profile, with Admin sections for an admin wallet only.
- **Leaderboard** (all-time and weekly) with levels, streaks and weekly Beg Battles; notifications bell;
  activity feed; watchlist.
- **Indexer** at `/api/cron/indexer`, called every 15 minutes by `.github/workflows/indexer.yml` — Vercel's
  Hobby plan allows one cron a day, so the workflow is the honest workaround and the site's copy says so.
- **Growth plumbing** — dynamic `sitemap.xml`, `robots.txt`, a PWA manifest, per-page Open Graph images, and
  env-gated analytics (blank `NEXT_PUBLIC_GA_ID` loads nothing at all).
- **`BegSplitter` + factory** — 32 Hardhat tests passing, including the negative cases: a stranger cannot
  claim, the launcher cannot reach the treasury's share, a non-controller cannot touch the growth fund,
  rounding never strands a wei, and no function in the ABI changes the split.
- **Schema with RLS** — `profile_stats` is created `security_invoker`; without it a view bypasses RLS on the
  tables underneath and would leak hidden profiles and the whole transfer graph.

**Not built yet**

- **Drops/giveaways**, **multi-chain** (Ethereum, Base), the **rest of the admin panel** (audit log, wallet
  monitor, moderation) and the **campaign verifier** as a swappable module. Phases and priorities:
  `docs/ROADMAP.md`.

**Blocked or risky on things outside the code**

1. **Held funds run through one hot key.** Earn and campaign pools are funded to a wallet controlled by the
   backend and paid out automatically by an EOA whose key is the server secret `DISTRIBUTOR_PRIVATE_KEY`.
   There is no escrow (the plan's §3.2 model) and no hot/cold split, so one leaked key still loses every pool
   at once. The two controls that do not require new custody shipped on 2026-10-16 — a global kill switch and
   hourly ledger-versus-chain reconciliation — and the remaining exposure is tracked in
   `docs/KNOWN_ISSUES.md` #1 and `docs/SECURITY.md`.
2. **The splitter is unaudited, and the Pons fee path is unfinished.** Pons V2 holds creator fees in a fee
   escrow (`0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e`) that the recipient claims from, rather than pushing
   them to the recipient, so `BegSplitter.receive()` may never see a wei. Finishing it needs that contract's
   ABI. Read the note at the top of `contracts/BegSplitter.sol` before deploying it anywhere that matters.
3. **An audit is a hard gate** before any mainnet deployment of the splitter.

## Conventions worth knowing

- **No fake data, anywhere.** No invented users, balances, totals or addresses. An unconfigured feature says
  it is unconfigured rather than rendering a control that cannot work.
- **A call to action links to a page that renders the thing it promises.** `/begs` used to advertise "Write a
  beg" with a button leading to a page that had no composer — which is how a database with hundreds of real
  accounts held zero begs (`docs/DECISIONS.md` D-030).
- **The code comments explain why, not what.** The reasoning is the part that is expensive to rediscover;
  keep it.
- **Supabase for records and files.** Never Vercel Blob.
- **Server secrets never carry the `NEXT_PUBLIC_` prefix**, and `.env` is refused by the pre-commit hook by
  both name and content (`scripts/hooks/pre-commit`).
- **`web/.npmrc` sets `legacy-peer-deps`.** RainbowKit 2.2.11 declares a wagmi 2 peer and this app runs wagmi
  3. The reason, and the build failure that ruled out the alternative, are in that file.
