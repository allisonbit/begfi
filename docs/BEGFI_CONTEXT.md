# BEGFI_CONTEXT.md — the master brief

Read this before touching BegFi. It says what the product is, what it is not, where every
page lives, how money moves, and which rules are not up for revision. When this file and
the code disagree, the code wins and this file gets fixed in the same commit.

`docs/PROJECT_BRAIN.md` is the longer, session-by-session operational record. This file is
the brief: dense, current, and safe to paste into another AI.

---

## 1. What BegFi is

**One sentence:** anyone can ask for crypto, give away crypto, or run a campaign in crypto,
in under a minute, with one link.

**Tagline:** *Everyone begs. BegFi gives begging a payment link.*

BegFi is a money-movement product on **Robinhood Chain**, not a token launchpad, not a
lending protocol, and not a bank. There are four products and one identity:

| Product | What it does | Public route | Owner route |
|---|---|---|---|
| **Beg pages** | A short public ask with an optional goal, a share card and a progress bar | `/begs`, `/beg/<id>`, `/<username>` | `/dashboard/begs` |
| **Pay Links** | A fixed-amount request with a memo, QR and an on-chain paid state | `/pay/<id>` | `/dashboard/pay-links` |
| **Earn / Campaigns** | A funded pool that pays people automatically for posting about a project | `/earn`, `/earn/<slug>` | `/dashboard/campaigns` |
| **Drops** | A giveaway: a funded pot, one fixed prize per claimer, a cap, paid automatically | `/drops`, `/drop/<id>` | `/dashboard/drops` |

Everything shares one identity: a wallet, a username (`begfi.io/<username>`), an optional
linked X account, one dashboard, one ledger and one payout engine.

**The token.** `$BEGFI` is
`0x18823d1f1807ce3bdd90aafb7473928bc9368242` on Robinhood Chain (chainId 4663). The address
is pinned in `web/lib/config.ts` and is deliberately **not** env-overridable: the site must
always read this exact token. The token is not the protocol. Beg pages, pay links and
campaigns work without holding it; campaigns pay in their own chosen token.

**What BegFi is not.** Not affiliated with Robinhood. Not financial advice. Not a promise of
returns, yield, profit or price appreciation. Not a place where anyone should put money they
cannot afford to lose.

---

## 2. Principles

1. **One link, under a minute.** Every product must be usable by someone who arrived from a
   shared link with no account and no context. If a flow needs a tutorial, the flow is wrong.
2. **Non-custodial where it says it is.** A beg, a tip and a pay link move money wallet to
   wallet. BegFi never holds those funds and cannot reverse a transaction. Campaign pools and
   drop pots are different: they are held by a BegFi payout wallet from the moment they are
   funded until they are paid out. The UI says which one a page is.
3. **Confirmed rows, not optimism.** A balance, a paid state, a payout or a leaderboard entry
   comes from a confirmed on-chain row. A failed read renders as "unavailable", never as zero.
4. **Honest empty states.** An empty board is a true statement about the world. A broken
   query is not an empty board.
5. **Append only.** A closed link, a retired drop, a rejected submission and a failed payout
   keep their rows and say what changed. Nothing is silently deleted.
6. **Plain English.** Short sentences. No hype, no promises, no "revolutionary". Say the
   thing, then say why it is that way.
7. **Verify through the interface.** Typecheck and build are the floor. A feature is done
   when the page renders the real data and the money path still works.

---

## 3. Pages and surfaces

Public:

- `/` — live token stats, the four products, the claim-your-link flow.
- `/<username>` — pay page: avatar, bio, socials, X-verified tick, QR, share card, send panel.
- `/begs` — the newest begs. `/beg/<id>` — one beg with goal progress and receipts.
- `/pay/<id>` — one payment request. Shows the ask, memo, QR, total received and whether the
  ask is met. Never shows who paid.
- `/earn` — campaigns taking entries. `/earn/<slug>` — one campaign, its pool and its board.
- `/drops` — live giveaway pots. `/drop/<id>` — claim page with pot arithmetic and winners.
- `/leaderboard` — seven boards: top earners, top begged, top supporters, top givers,
  most active, top campaigns, holders. Each is filterable by last 24 hours / this week / all
  time, except holders, which is a live snapshot. The weekly Beg Battle and the live activity
  feed sit below.
- `/transparency` — the books: payout wallet balance, all-time paid, owed now, switch state,
  latest reconciliation, recent audit rows.
- `/how` — what BegFi is and how each product works, written for a first-time visitor.
- `/help` — the operational FAQ: custody, why a claim did not pay, unspent pots, the X tick.
- `/search` — public people, campaigns and drops. Begs, pay links and receipts are not
  searchable on purpose.
- `/terms`, `/privacy` — plain-language terms and privacy.
- `/t/<tx>` — a tip receipt with its own OG card.
- `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/llms.txt` — machine-readable floors.

Signed-in:

- `/dashboard` — overview: earnings, claimable amounts, recent activity, quick actions.
- `/dashboard/begs`, `/pay-links`, `/campaigns`, `/drops`, `/activity`, `/notifications`, `/profile`,
  `/settings`. Settings owns the one real account switch: hiding the public profile.
- `/dashboard/earn` and `/dashboard/earn/payouts` — admin only: review queue, kill switch,
  reconciliation, failed payouts, ledger.
- `/login`, `/signup` — wallet sign-in and username claim. Usernames are reserved-word checked.

The dashboard shell is `web/components/dashboard-shell.tsx`: a sticky sidebar from `md` up
and a scrolling section row on phones. The global dock is
`web/components/site-nav.tsx` (Begs / Drops / Earn / Board / You).

---

## 4. Architecture

```
web/                    Next.js 16 App Router, React 19, Tailwind 4
  app/                  routes; a page.tsx renders, a route.ts is a door
  components/           UI, all client components that need state
  lib/                  decisions, pure where possible; server reads here
  supabase/migrations/  0001–0029, applied in order, never edited after landing
contracts/              BegSplitter + clone factory; Hardhat tests in test/
scripts/                migrate.js, push-env.js, pre-commit secret guard
docs/                   the brain files
```

- **Database:** Supabase, schema **`begfi`** (not `public`). The schema must be listed under
  Settings → API → Exposed schemas or PostgREST answers 404 to every call.
- **Auth:** wallet signature (SIWE-style) in `lib/wallet-auth.ts`; a session is a signed
  cookie. X linking is a separate verification; only a verified handle earns the tick.
- **Chain access:** viem + wagmi + RainbowKit, `lib/chains.ts`. Robinhood Chain only today.
- **Secrets:** `DISTRIBUTOR_PRIVATE_KEY` (the payout wallet), `SUPABASE_SERVICE_ROLE_KEY`,
  `CRON_SECRET`, X verification values. None is `NEXT_PUBLIC_`. `.env` files are refused by
  the pre-commit hook by name and content.
- **Cron:** the indexer runs every 15 minutes from `.github/workflows/indexer.yml`; the hourly
  reconciliation from `reconcile.yml`; the daily payout sweep from Vercel cron
  (`/api/cron/earn-payouts`, which runs earn, campaigns and drops in one function). Vercel
  Hobby allows one daily cron, which is why the indexer and reconciliation live in GitHub
  Actions.
- **Env:** documented in `web/.env.example`. A blank or malformed address resolves to `null`
  in `lib/config.ts` and the UI says "not configured yet" instead of drawing a dead control.

---

## 5. How money moves

**Begs, tips, pay links.** Payer's wallet → payee's wallet, directly. The site never holds it.
The indexer records the confirmed `Transfer`; pay-link settlement is derived from those rows,
so "paid" is a fact about the chain rather than a flag somebody set.

**Campaigns and Drops.** The funder sends the pool to the **distributor wallet** and registers
the intent (a campaign is attributed by token; a drop by a `drop_fundings` row naming the
funder, drop and amount). When a submission or claim qualifies:

1. Eligibility is `payout_tx IS NULL` — a state, not a boolean.
2. The sender takes an atomic lease so two sweeps cannot pay the same row twice.
3. The sweep checks the live token balance and a native-gas floor.
4. A transfer is sent; only a confirmed transfer sets `payout_tx`.
5. The row lands in `begfi.earn_payouts` — one ledger for BegFi's pool, every campaign and
   every drop.
6. Failed sends stay `failed`, are retried by the next sweep, and stay visible in the admin
   console. Nothing is marked paid before it is.

Guardrails: a **global kill switch** (`begfi.payout_controls`) read at the top of every money
path, which **fails closed**; `MAX_PAYOUTS_PER_RUN = 40`; `MAX_ATTEMPTS = 10`; a 10-minute
lease and tx-drop window; hourly reconciliation that compares obligations to the live balance
and pauses payouts before it alerts on a shortfall; and one payout token per live pool across
campaigns and drops.

**Current operational state (check before claiming anything works):** payouts were paused
automatically when reconciliation found the distributor wallet holding 0 $BEGFI against money
owed. Funding the wallet and resuming from `/dashboard/earn/payouts` is the fix. The indexer
is also behind the chain, so index-driven facts (pay-link settlement, bells) are late; see
`docs/KNOWN_ISSUES.md` #19. Do not describe either as solved unless you have checked.

---

## 6. Removed, and not wanted back

- **The launchpad.** `/launch`, `/token/[address]`, `/beg-to-launch`, `/dashboard/launches`,
  `/dashboard/fees` and `/api/launch` were removed in `4da54cd`. `/explore` was deleted with
  its nav tab, footer link and sitemap entry on 2026-10-15. Do not reintroduce them. The
  `trades` table and the indexer's trade scan are the remaining remnant, tracked in
  `KNOWN_ISSUES.md` #16.
- **Device fingerprinting.** Removed on purpose: shared phones, campus NAT and family
  connections told honest people "come back tomorrow" for somebody else's sin. Drops use one
  prize per wallet and per **verified X account** instead. Do not revive it.
- **Smart-contract escrow.** Pools are held in the backend payout wallet. This is a known,
  documented single-key risk (`KNOWN_ISSUES.md` #1), not an oversight. A change here needs an
  explicit decision and a security review.
- **Refunds for unspent pots.** They do not exist. The remainder stays in the payout wallet,
  and the dashboard, footer and docs say so rather than implying otherwise. Do not promise a
  refund in copy.
- **Financial claims.** No APY, no "guaranteed", no price targets, no "investment". Content
  must never promise returns.

---

## 7. Tone of voice

Internet-native, blunt, and kind. Lowercase energy in headlines, plain sentences in the body.
Jokes are allowed; hype is not. The product makes fun of begging and never of the person
begging. Write like a person explaining a thing they built, not like a brand launching.

**Say:** "Send $BEGFI straight to their wallet." · "Nobody has been paid yet. That is a real
empty board, not a broken one." · "The explorer didn't answer, so there is no holder list."

**Never say:** "Revolutionary." "Passive income." "Guaranteed." "To the moon." "Risk-free."
"Earn up to X%." "BegFi is a bank." Anything that implies BegFi can reverse a transfer or
return an unspent pot.

**Official wording:**

- Tagline: *Everyone begs. BegFi gives begging a payment link.*
- One-liner: *Ask for crypto, give it away, or run a campaign. One link, under a minute.*
- Custody line: *Payments are wallet to wallet — BegFi never holds them. Campaign pools and
  drop pots are held by a BegFi payout wallet until they are paid out.*
- Token line: *$BEGFI is on Robinhood Chain. It is not the protocol and it is not a promise.*

---

## 8. Before you finish a change

1. `cd web && npm run typecheck` is clean.
2. `cd web && npm run build` succeeds.
3. The pages you touched were loaded against real data, not just compiled.
4. `docs/CHANGELOG.md` records the change in plain English, with today's date.
5. `docs/PROJECT_BRAIN.md`, `docs/KNOWN_ISSUES.md` and this file are corrected if the code
   moved under them.
6. Any money-path change was not made without an explicit decision and a security review.
7. Anything you could not verify is stated as unverified, not implied to be done.
