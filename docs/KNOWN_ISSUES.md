# KNOWN_ISSUES.md

Bugs and risks, most severe first. Each entry says what is wrong, how it was found, and what the fix is.
**Anything marked ⚠️ MONEY is a fund-safety issue and must be fixed before real volume, or before the next
product that reuses the same path.**

---

## ⚠️ MONEY #1 — One distributor key holds every distributable token

**What.** Earn and campaign pools — **and now every drop pot** — are funded to a single EOA. Its key is one Vercel secret
(`DISTRIBUTOR_PRIVATE_KEY`). One key compromise, one bad deploy, or one leaked env dump loses every pool
balance at once. `earn-distributor.ts` documents this honestly ("no smart contract, no escrow") but the
operational consequence is that BegFi is a single-signature treasury.

**Evidence.** `web/lib/earn-distributor.ts` header rules 1 and 2; `distributorAddress()` derives the only
receiving address in the system.

**Fix.** Phase 1: separate hot payout wallet (small float) from a cold treasury, a sweep-to-cold action,
and per-chain gas wallets. Then move the receiving side behind per-pool addresses (see #2). Longer term,
the audited-escrow swap the plan allows for.

## ⚠️ MONEY #2 — Campaign deposits are attributed by token, so two campaigns sharing a token collide — **GUARDED 2026-10-16**

**What.** Deposits are credited by looking for `Transfer(to = distributor)` events **per token**, then
attributing the whole batch to **the first campaign found with that token address**:

```ts
const campaignId = (campaigns as {...}[]).find((c) => c.token_address.toLowerCase() === token)!.id;
```

Two campaigns paying in the same token — the normal case, since projects pay in their own token and multiple
campaigns will run on the same popular one — mean all deposits for that token credit one campaign's pool
and none credit the other's. Worse, if a campaign's token is `$BEGFI` itself, BegFi's own Earn top-ups land
at the same address and are credited to that campaign's pool, while the funds-arrival sweep simultaneously
treats them as BegFi's own pool money: **one transfer counted into two pools.**

**Evidence.** `web/lib/campaign-distributor.ts:102-152` (`creditCampaignDeposits`), and
`campaign_deposits` requiring a `campaign_id` while the transfer carries no campaign reference
(`supabase/migrations/0022_campaigns.sql:79`).

**Fix.** This is exactly what the plan's "one deposit address per pool" (§3.2) solves. Until then, at
minimum: reject a new campaign whose payout token already has an active campaign (a hard collision guard),
and never allow `$BEGFI` as a campaign payout token.

**Guarded 2026-10-16.** Both minimums are in place, at two levels:

- **The database refuses it.** `campaigns_active_token_idx` (migration 0025) is a PARTIAL unique index on
  `campaigns (token_address) where status = 'active'` — partial because ending a campaign must free its token
  for the next one, and an index rather than a check because two concurrent creates would beat any API-level
  test. This migration FAILS LOUDLY if such a pair already exists, which is correct: ambiguous data about
  whose money is whose needs a human decision, not a migration.
- **The API explains it.** `createCampaign` (`web/lib/campaigns.ts`) refuses a token that an active campaign
  already pays in, naming the campaign that holds it, and refuses `$BEGFI` outright — with the reason, because
  an index answers with a Postgres error string.

**What remains.** The root cause is unchanged: every pool deposits to ONE address, so attribution is still
inferred from the transfer rather than separated by address, and the guard is a substitute for that, not a
fix. Per-pool deposit addresses remain Phase 1 (`ROADMAP.md` §3.2). Until then a campaign that ends and a new
one that claims its token inherits the same inference — correct, but only because the ended campaign can no
longer be credited.

**Extended by Drops, 2026-10-16.** The guard now spans BOTH products: `begfi.pool_tokens` (migration 0029)
is a lease claimed by a trigger on `campaigns` and on `drops`, so a drop cannot take a token an active
campaign is paying in, and a campaign cannot take a token a live drop holds. A drop's deposits are credited by
INTENT instead of by token (D-056), which is a second, independent attribution path — it does not need the
lease to be unambiguous, but the lease is still what keeps two pools from sharing one token's float.

## ⚠️ MONEY #3 — No reconciliation of ledger totals against on-chain balances — **FIXED 2026-10-16**

**What.** There is real reconciliation **for in-flight transactions** (a sent-but-unconfirmed hash is
settled on the next run) — that is a different thing. Nothing compares *sum(deposits) − sum(payouts)* for a
pool against the distributor's live balance. If the indexer misses a window, if a write fails silently
(`catch { continue }` in the deposit scan), or if a token's transfer tax eats part of a payout, the drift is
invisible until someone complains.

**Evidence.** `reconcileInFlight` / `reconcileCampaignInFlight` only; no balance comparison anywhere.
The deposit scan's error path is a bare `continue`.

**Fix.** Phase 1 hourly job: per token per pool, compare ledger totals to the observed on-chain balance, and
**pause payouts and alert** on a mismatch beyond a tolerance.

**Fixed 2026-10-16.** `/api/cron/reconcile` (bearer-gated like every cron route) runs every hour from
`.github/workflows/reconcile.yml` — Vercel Hobby's two cron slots are already spent, so this uses the same
scheduler-outside-Vercel path the indexer does. Per token it computes obligations — credited deposits minus
confirmed payouts for campaigns, plus BegFi's ALREADY-PROMISED rewards (approved submissions with no payout
tx), NOT the day's remaining pool budget, which nobody has been promised — and compares them to the
distributor's live `balanceOf`, writing one row per token to `begfi.reconciliation_runs` (migration 0025,
append-only, no client-readable policy at all). On a shortfall it flips the kill switch **before** belling every admin
wallet, and it keeps running while payouts are paused. The admin payouts console renders the latest check per
token and the last eight runs before anything else on the page.

**What remains.**
- It is per TOKEN, not per pool, because there is only one deposit address — a campaign whose token is shared
  with an ended campaign's leftover float still cannot be isolated. Per-pool addresses close this (Phase 1).
- Extra float is normal and is not alarmed on; a shortfall is. So a wrong-but-generous set of books reads as
  `ok`. The drift that matters — the wallet not covering what is owed — is what it catches.
- Nothing measures per-transaction effects yet (a transfer tax eating part of a payout shows up as drift on
  the NEXT run, not as a per-send error). Balance-delta crediting is the Phase 1 item that fixes it.

## ⚠️ MONEY #4 — No global kill switch — **FIXED 2026-10-16**

**What.** A campaign can be `paused`, and Earn has a pause flag, but there is no single control that stops
all payouts (globally, per chain, or per pool) in one action. The plan (§3.2) requires it. During an
incident, "pause them one at a time through the database" is not an incident response.

**Evidence.** Only `campaigns.status = 'paused'` and the Earn pause check in
`web/app/api/earn/submit/route.ts:53`.

**Fix.** One `admin_settings` row read at the top of every sweep, plus a UI lever. Small change, large
risk reduction.

**Fixed 2026-10-16.** `begfi.payout_controls` (migration 0025) is a singleton row, publicly readable as a
STATUS (the UI must be able to say "payouts are paused" instead of drawing a claim button that will fail) and
writable only through `/api/admin/payouts`, which checks the signed-in wallet against the admin allowlist.
It is read at the top of both sweeps and on the claim, Earn-submit and campaign-submit paths
(`lib/payout-controls.ts`), so one UPDATE stops all money. The lever is the first card on
`/dashboard/earn/payouts`: pausing takes two clicks and asks for a REASON first (that reason is what earners
read), resuming takes one, and every admin wallet is belled on every flip.

**What remains.** It is global only. The plan asks for per-chain and per-pool pause as well; per-campaign
pause already existed, and per-chain becomes meaningful when there is more than one chain. The pause is also
read from the same database that the sweeps read — a Supabase outage parks the sweeps anyway, which is why
failing closed costs nothing extra in practice (D-038).

## #5 — Campaign scan is capped at 60 campaigns, unbounded in address

**What.** `creditCampaignDeposits` loads `.limit(TOKENS_PER_SCAN)` (60) non-draft campaigns, so past 60
campaigns the later ones stop having deposits credited — their pools never fill. The same query uses a
`.limit(10_000)` elsewhere for pool totals, which will truncate at scale too.

**Evidence.** `web/lib/campaign-distributor.ts:43,112-116,215`; `web/lib/campaigns.ts:128`.

**Fix.** Paginate the campaign query, and make the scan window per-campaign-cursor rather than global.

## #6 — X verification rests on reading a post, not an API

**What.** Verification reads the post text to confirm the required mention. There are no API keys and no
OAuth. That is cheap and works — until X changes its markup, rate-limits the read, or blocks it. Post-URL
uniqueness prevents reuse, but the *check* itself is fragile.

**Evidence.** `web/app/api/profile/x-verify/route.ts` (`readPost`), and the pending-verification queue in
Earn.

**Fix.** Phase 4's pluggable verifier: one interface, three implementations (official API ⇄ third-party ⇄
manual queue), chosen per task type by cost. A read failure must degrade to `pending`, never to an
auto-approve.

## #7 — No bot protection on submission beyond rate limits and device limits

**What.** `rate_limits` + `check_rate_limit` and the device-limit migration exist. There is no captcha, no
behavioural signal, no cluster detection (many wallets funded from one source, simultaneous claims). The
plan (§3.4) asks for all of it.

**Evidence.** `supabase/migrations/0001_begfi_schema.sql:255-328`,
`supabase/migrations/0014_earn_device_limits.sql`; no captcha code anywhere.

**Fix.** Captcha on claim/submit plus a suspicious-activity queue. Combine with `DECISIONS.md` D-018
(per-X-account uniqueness), because fresh wallets are free and that is the cheapest attack.

## #8 — Per-X-account claim uniqueness is not enforced

**What.** Per-wallet uniqueness is enforced by unique indexes and is airtight. The X-account half of the
plan's "one claim per wallet **and** per X account" (§3.4) is not enforced at the schema level.

**Evidence.** Indexes in `0021`/`0022` are all wallet- or post-scoped.

**Fix.** Add an `x_user_id` column with a unique index per pool/campaign/cycle, once X linking is
mandatory on the claim path.

## #9 — No sitemap, robots or manifest — **FIXED 2026-10-15**

**What it was.** `web/app` had no `sitemap.ts`, no `robots.ts`, no `manifest.ts`. BegFi's distribution model
is shareable links (`/username`, `/beg/<id>`, `/earn/<slug>`), none of it was advertised to a crawler, and
the app could not be installed to a home screen.

**Fixed.** All three now exist and were verified live: `/robots.txt` 200, `/sitemap.xml` 200 (331 URLs —
324 profile pages plus the static routes) and `/manifest.webmanifest` 200; `next build` exit 0, with
`/sitemap.xml` dynamic and the other two prerendered. The sitemap runs on the anon RLS client, so the
`is_hidden` policy is the guard rather than a filter that can be forgotten.

**What remains.** Submit the sitemap in Search Console and Bing Webmaster Tools, which needs accounts, not
code. And see #14: the 324 profiles it now publishes are ~262 accounts created in a single day with almost no
activity behind them.

## #14 — The product is almost entirely unused — and as of 2026-10-15, we know why

> **USER DETERMINATION (2026-10-15): the accounts are real, just early.** They are not test debris and are not
to be purged. The empty tables are therefore a *product* problem, and the cause turned out to be a bug — the
`BegComposer` component had no importer, explained below.


**What.** Read with the service role on 2026-10-15 (counts are ground truth, not RLS-filtered):

| table | rows | table | rows |
|---|---|---|---|
| profiles | **324** | earn_claims | 161 |
| begs | **0** | earn_submissions | 159 |
| transfers | **16** | earn_payouts | 118 |
| campaigns | **1 (draft)** | notifications | 26 |
| campaign_submissions | 2 | trades | 0 |
| campaign_deposits | 1 | launches | 1 |
| transfer_messages | 0 | | |

Profile creation by UTC day: 2026-10-11 (1), 10-13 (9), 10-14 (52), **10-15 (262)**. None are hidden and
**none are X-verified**. There is not a single beg in the product that BegFi is named after, the only
campaign is a draft, and the whole site has 16 indexed transfers.

**Why there were no begs — and it was a bug, not a behaviour.** `BegComposer` is the only caller of
`/api/beg`, and **nothing imported `BegComposer`**. The component was written, wired to the API, and never
mounted. Worse, `/begs` showed a prominent **"Write a beg"** button that linked to `/dashboard`, and the
dashboard's own empty state said *"Write one and it shows up here"* — with no way to write one anywhere in
the product. So real people signed in, pressed the button that promised the product's core action, and
reached a page with no composer on it. The zero was a broken funnel, not an absence of demand.

**Fixed 2026-10-15.** `BegComposer` is mounted on `/dashboard/begs` under a "Write a beg" heading, next to the
list of your begs, and `/begs` now links straight there. Verified: `tsc --noEmit` exit 0, `next build` exit 0,
`/begs` serves 200 and its button resolves to `/dashboard/begs`. **Not verified end to end** — posting a beg
needs a signed-in wallet session this environment does not have, so the first thing to do after the next
deploy is sign in and post one.

**Still open.**
- Nothing reacts to a burst of empty signups. `DECISIONS.md` D-028 keeps the rows, so this is a monitoring gap
  rather than an incident: alert on signup spikes with zero subsequent activity, and consider gating public
  listing on a first action.
- `transfers` reads as 0 for an anonymous client and 16 with the service role, because the RLS policy scopes
  transfers to the owner. Correct behaviour — recorded so the next audit does not mistake a policy for an
  outage, as this one nearly did.

**Evidence.** Service-role counts above; `profiles.created_at` histogram; `campaigns.status = 'draft'` for the
only campaign; and `grep -rn "/api/beg"` (one caller) against `grep -rn "BegComposer"` (no importers) taken
before the fix.

## #10 — No analytics, so no funnel is measurable — **mechanism FIXED 2026-10-15**

**What it was.** Nothing in the code emitted an event. The plan's §14 event list could not be measured, so no
product decision here could be evidence-based.

**Fixed.** `web/lib/analytics.ts` (env-gated, typed event union, no PII) plus `web/components/analytics.tsx`
(GA4 loader, client-side page views) mounted in the root layout. `NEXT_PUBLIC_GA_ID` blank ⇒ nothing loads at
all, which is why it is safe on the money path. Verified both ways: with the ID set, the gtag loader and its
config appear in the served HTML; with it blank, the HTML contains zero `googletagmanager` and zero
`dataLayer` references. Events wired: `beg_posted`, `username_claimed`, `campaign_created`,
`campaign_joined`.

**What remains.** Create the GA4 property and set the ID (an account, not code), submit the sitemap in Search
Console, and wire the rest of the plan's funnel events (`drop_*`, `payment_sent`) as those screens ship.

## #11 — Admin is one allowlisted wallet with ad-hoc routes — **partly addressed 2026-10-16 (twice)**

**What.** Admin ability equals control of `GENESIS_LAUNCHER_WALLET` (defaulted in code). There is no admin
panel, no role model, no audit log, no wallet/gas monitor, no moderation queue. The plan's §12 is unbuilt.

**Evidence.** `web/lib/config.ts` (`GENESIS_LAUNCHER_WALLET`), admin-gated `/api/earn/review`.

**Fix.** Phase 1 minimal panel: reconciliation view, payout queue, pause levers. An `audit_log` table for
every admin and money action (plan §13).

**Further addressed, later on 2026-10-16.** `begfi.audit_log` (migration 0028) now exists and is
written by the code that performs each action — switch flips and resumes, the automatic pause, every
reconciliation run, the daily sweep, an admin's manual sweep — and it is read publicly on
`/transparency`. What is still missing: the writer deliberately never throws, so a failed insert is a
silent hole in the record; admin routes other than the payout ones (`/api/earn/review`, the campaign
verifier) do not write audit rows at all; and there is still no role model beyond the env allowlist,
which can resolve to a wallet with no profile (the alert-recipient bug fixed today, which is itself
evidence for how thin an allowlist is as a control).

**Partly addressed 2026-10-16.** `/dashboard/earn/payouts` now opens with the kill switch and the
reconciliation history, followed by the failed-payout queue (every failed row with its last error and attempt
count) and the payout ledger with explorer links — the "minimal panel" the fix names. It is still one
allowlisted wallet and there is still no `audit_log` table: a switch flip records WHO (in `paused_by`) and
when, but nothing else an admin does is recorded, and there is no role model, no wallet/gas monitor and no
moderation queue. `/api/earn/review` and the campaign verify route remain ad-hoc.

## #13 — The launchpad's read side outlived the launchpad — **FIXED 2026-10-15 (README still stale)**

**What it was.** Commit `4da54cd` removed the launchpad's routes (`/launch`, `/token/[address]`,
`/beg-to-launch`, `/dashboard/launches`, `/dashboard/fees`, `/api/launch`, `/api/launch-beg`) but left:

- `/explore` in the navigation, still listing tokens from the `launches`/`trades` tables and pricing them from
  the curve — while its own comment said a token appears there "only if `/api/launch` recorded it", a route
  that no longer existed. The catalog could never gain a row again.
- `format.ts`, `watch-star.tsx` and `fees-history.ts` imported by nothing, plus `curve.ts`, `pons.ts`,
  `dashboard.ts` and the fee/token-chart panels still in use by other surfaces.
- `README.md` documenting `/launch` and `/token/[address]` as existing routes. **Documentation drift a human
  reads and trusts** — which is how it became an error in this very audit, twice (see D-027).

**Fixed.** `/explore` deleted along with its nav tab, its footer link and its sitemap entry; `format.ts`,
`watch-star.tsx` and `fees-history.ts` deleted. A module-reachability scan decided what actually went, which
is why `curve.ts` and `pons.ts` were **kept** — the 15-minute indexer imports them. Verified: `/explore` serves
404, the sitemap contains 0 explore entries, every internal `href` still resolves, and `next build` is clean.
`dashboard-tabs.tsx` and `dashboard-nav.tsx` were removed with the app-shell work that superseded them.

**What remains.** `README.md` has not been corrected — it is a documentation change in a file whose whole
route list needs a pass, and it should be fixed with the next README edit rather than in isolation. The
server-side remnant (trade indexer + watchlist) is tracked as #16.

## #16 — The trade indexer still scans for a product that no longer exists

**What.** `/explore` and the launchpad were removed, but `indexTrades` in `/api/cron/indexer` still reads the
Pons factory and writes `begfi.trades`, and `/api/watchlist` plus the dashboard's `WatchlistPanel` still list
those tokens. `trades` holds 0 rows and `launches` holds 1.

**Why it is not just deleted.** It is live code on a cron, not an orphaned module: removing the scan changes
what the indexer does every 15 minutes, and the watchlist is a feature a user can currently see. That is a
product decision, not dead-code cleanup — so it is recorded rather than done.

**Evidence.** `web/app/api/cron/indexer/route.ts` (`indexTrades`, `ponsFactoryAbi`), `web/app/api/watchlist`,
`web/components/watchlist-panel.tsx`, and the service-role counts (`trades` 0, `launches` 1).

**Fix.** Decide one way: either drop the scan and the watchlist together (completing the launchpad removal),
or keep both as a read-only record of launched tokens and say so in the copy. `curve.ts` and `pons.ts` stay in
the tree either way until that decision, because the indexer genuinely imports them.

## #12 — Copy promises that depend on configuration that may be absent

**What.** Several UI paths are honest about being unconfigured by design (`config.ts` resolves bad values to
`null` and the rule is "say not configured"). That rule is easy to violate in a new page and there is no
test enforcing it. Nothing automatically catches a page that renders a control which cannot work.

**Fix.** A lint-style review item (§9.3 audit) rather than a code fix; record any violation found with the
route name.

## ⚠️ MONEY #18 — The site's token was never configured, so every "received" number read 0 — **FIXED 2026-10-16**

**What.** `begfi.app_config.beg_token_address` decides which transfers count as money for the whole product:
`received_since` (beg progress) and `profile_stats` (a profile's received total) both filter on it. It is
seeded as `''` in migration 0001 and **nothing in the codebase ever wrote it** — the seed comment says the
value is set once `$BEG` has actually launched. $BEGFI launched on 2026-10-14. The row stayed blank.

**The consequence, which is the expensive kind:** every beg progress bar, every beg OG card, every profile's
"received" total and (once it existed) every pay link's received total summed to zero — no error, no 500, just
a number that told users the product did not work. A beg could be fully funded and still show an empty bar.

**How it was found.** Not by inspection: a verification script for the new pay-link page asserted a NON-ZERO
received total for a wallet with a confirmed 10,000 $BEGFI transfer in `transfers`, and got 0. The assertion
that failed was the one written to prove the feature worked.

**Fixed, twice over.** Migration 0026 sets the row to the pinned contract, and — the actual defect — the
15-minute indexer now upserts `beg_token_address` from `BEG_TOKEN_ADDRESS` on every run, so the config row and
the rows it filters cannot disagree again. *A config row that only a human remembers to update is a config row
that will be wrong again.*

**Fixed WITH it, because setting the value exposed them:**
- `received_since` returned `numeric`, so the first real amount it ever returned crossed PostgREST as a
  float64 and reached JavaScript as `1e+22` — `BigInt("1e+22")` throws, and the pay page 500'd on its first
  non-zero total. It now returns TEXT, as `earn_refill_pool` has since migration 0013.
- `profile_stats.total_received` had the same shape; it now has a text column for display and a numeric
  `total_received_units` for the leaderboard's ORDER BY (ranking text would put "9" above "10000").
- The view is `security_invoker` (correctly), which meant a PUBLIC profile showed "0 $BEGFI received from 0
  supporters" to every signed-out visitor while the leaderboard showed the same wallet's real total. Public
  totals now come from `public_wallet_totals`, a definer aggregate granted to `anon` — the same mechanism
  migration 0007 established for beg progress, returning one number and nothing else.

**Verified after the fix:** a signed-out fetch of `/kitakeshi` renders "10,000 $BEGFI received from 1
supporter", matching the leaderboard exactly; `/begs`, `/leaderboard` and a profile OG card all 200; the whole
migration set replays cleanly from an empty database order.

**What remains.** Other readers of that config row should be audited the same way — anything that compares
against `app_config` instead of the pinned constant is a second place the two can disagree (see D-047 for the
related migration-replay rule this surfaced).

## #19 — The indexer is far behind the chain, so every index-driven fact is late — **FOUND 2026-10-16**

**What.** `/api/cron/indexer` advances its cursor by `BLOCK_WINDOW` = 2,000 blocks per run, on a
15-minute schedule. Measured on 2026-10-16: the cursor stood at block **89,148,875** while the head was
near **89,645,109** — roughly **496,000 blocks behind**, or about **248 runs (≈2.6 days)** of scanning
just to reach the present, assuming the chain adds fewer than 2,000 blocks per 15 minutes. If it adds
more, the gap grows forever.

**Why it matters to money.** Everything the site "detects" is a consequence of this scan: `transfers`
rows (and therefore beg progress, profile totals and the pay-link settlement + bell shipped today),
campaign deposit crediting, and the funds-arrival trigger that fires a payout sweep. A payment that is
not scanned is not settled, not belled, and not credited — the page is not wrong, it is late, and late
is indistinguishable from broken to the person waiting.

**Evidence.** `web/app/api/cron/indexer/route.ts` (`BLOCK_WINDOW`, `CONFIRMATIONS`, the single
`indexTransfers` call per run); `app_config.index_cursor_block` vs a live `eth_blockNumber` read; the
newest `transfers.block_time` (2026-10-15 10:17) against a chain head two days newer.

**Fix (not done).** Scan several windows per run inside one time budget — a bounded loop that keeps
going while there is room in the 60-second function — so a run catches up faster than the chain moves.
The public RPC already serves wide ranges, which is why the window was not simply raised in place. Until
then, this lag is the honest ceiling on how "live" the product is.

## #17 — Pay-link settlement is matched against a bounded window of recent transfers — **FIXED 2026-10-16**

**Fixed.** The indexer now records the settling transfer ON THE ROW (`settled_tx`, `settled_amount`,
`settled_at`, migration 0027) at the moment it indexes the payment that met the ask, and bells the
owner once. The page and the dashboard read that column; the window search below remains only as a
fallback for requests paid before the column existed. Verified by re-scanning a window containing a
real 10,000 $BEGFI transfer: the request settled, one bell was written, and a second scan of the same
window wrote neither again.

### (the original entry, kept for the record)

**What.** `settlementFor` (`web/lib/pay-links.ts`) decides whether an ask was met by looking at the most
recent 50 transfers to the owner for that token after the link was created. A link whose ask was met earlier
than that window still shows the correct TOTAL received (an aggregate, computed in the database by
`received_since`), but its badge reads "waiting" rather than "paid".

**Why it is bounded rather than unbounded.** Reading every transfer to a wallet since a link's creation is an
unbounded scan on a public page, and the page must render for a crawler. 50 is stated in the code rather than
hidden, and the page leads with the total for exactly this reason — the number that is always right is the
one given prominence (D-037).

**Fix.** Store the settling transfer on the row at INDEX time: when a confirmed transfer meets an active
link's ask, write the tx hash to `pay_links` (or a `pay_link_settlements` row) so "paid" is a fact read from
one row instead of a window search. Belongs with the Phase 1 indexer pass, next to balance-delta crediting.

## #20 — A drop deposit that matches no funding intent is credited nowhere

**What.** A drop's money is attributed by intent (D-056): the funder registers `(their wallet, the drop, the
amount)` and the scan credits transfers that match it. A transfer to the payout address that matches no open
intent — never registered, or sent from a wallet other than the one the intent names — is credited to no pot.
It sits in the wallet until the funder registers the intent for it (`drop_fundings` keeps a matched intent
matchable for 24 hours precisely so a late registration still lands).

**Why it is the design and not a bug.** With one shared deposit address there is no safe way to attribute an
unannounced transfer: guessing would credit somebody else's giveaway with your money. The honest failure is
"not yet credited", and the page says the pot is unfunded rather than showing a number nobody can prove.

**What is missing.** Nothing TELLS the funder. A bell or dashboard line saying "a transfer from this wallet
arrived that no pot claims — register the deposit to credit it" would close the loop, and the reconcile job
already sees the surplus (it only alarms on a shortfall, so extra float is silent). Fix: match recent
unattributed transfers against the funder's own wallets at funding time, and surface the surplus per token on
`/transparency`.

**Evidence.** `creditDropDeposits` (`web/lib/drop-distributor.ts`), migration 0029's header, D-056. Live
review of the drop page with a fixture: the pot read 2,000 until the deposit row existed, then the credited
figure appeared — the ledger never guesses.

## #21 — An unspent drop pot (and an unspent campaign pool) has no automated return path

**What.** A drop's pot is spent as prizes are claimed. Whatever is left when the drop ends — the cap reached,
the window closed, or the owner simply stopped sharing it — **stays in the shared payout wallet**. There is no
refund function, no per-pool address to sweep, and nothing that computes what a given pool's remainder is.
Campaigns are in the same position (the footer's old claim that unspent pool funds are returned was not
backed by any code path).

**Why it is not a five-line fix.** The payout wallet holds every pool's float at one address, so "return the
remainder" needs either per-pool deposit addresses (then each pool's float can be moved as a unit) or a signed
refund transaction with an amount the database can prove is unspent. Both are the Phase 1 custody work
(`ROADMAP.md` §3.2), and the second is a payment path, which is exactly what `PROJECT_BRAIN.md` §4 says needs
a human decision.

**What was done instead.** The copy stopped implying a refund: `/dashboard/drops`, the footer and
`docs/DROPS.md` all say the remainder stays in the wallet, and D-062 records the decision. Over-promising a
refund is worse than not offering one, because people fund differently when they expect the money back.

**Evidence.** No `refund` code path anywhere (`grep -ri refund web/ supabase/`); migration 0029's header;
D-019 (the intent, still unbuilt) vs D-062 (what the product says today).

## #22 — A drop's sybil resistance is identity only: wallet + verified X + the cap

**What.** One person with many wallets can take many prizes unless they are X-verified (unique per drop). The
caps a drop has are real but narrow: unique wallet, unique verified X handle (partial index), the owner's
`max_claims`, and the pot itself. There is no captcha, no funding-graph clustering, no behavioural signal, no
review queue — the plan's §3.4 list.

**Why the obvious lever was not pulled.** Per-device limits existed (migration 0014) and were REMOVED on
purpose: they punished shared hardware and told honest wallets "come back tomorrow". D-055 records that drops
do not revive them. The consequence is stated rather than hidden — a drop is farmable by a determined person
with unverified wallets, and the honest ceiling today is what the site can actually check.

**Fix.** Captcha on the claim path (env-gated like analytics), clustering wallets by funding source, and an
admin queue for drops whose claim pattern looks like a farm. All three are Phase 6 in the plan; Drops just
makes the need visible.

**Evidence.** `drop_claims` indexes (0029: wallet, partial X), no captcha code anywhere,
`KNOWN_ISSUES.md` #7 (the same gap for Earn).

## #24 — A money column read without `::text` silently loses its last digits

**What.** A `numeric(78,0)` column crossing PostgREST becomes a JSON number, and a float64 mantissa is 53
bits, so a 24-digit base-unit amount comes back **rounded**. `pay_links.amount` holding exactly
1,000,000 $BEGFI (1e24 wei) arrived as `999999999999999983222784`, and the page did the only thing it could
with that: printed `999,999.999999999983222784 $BEGFI`.

**Why it was a money bug, not a typo.** The pay page feeds that value through `formatAmount` into the send
panel as the **locked** amount. A payer following the prefill would send 999,999.999999999983222784 — which
is *less* than the ask — and the indexer's `paid >= ask` test then never settles the request and never rings
the bell. The request worked perfectly and could never be completed.

**Fixed 2026-10-16 (two sites, both verified on the live site).** `lib/pay-links.ts` (both reads) and
`begs.goal` (`lib/queries.ts` + `app/beg/[id]/page.tsx`) now select `::text`. Verified through the pages:
the pay link reads **1,000,000 $BEGFI** and the beg reads **Goal 100,000 $BEGFI**, where both previously
printed 18-digit float noise.

**Still open — the same class, elsewhere.** `campaigns.daily_budget` is read through `select("*")` in
`lib/campaigns.ts`, and `transfers.amount` is read bare in the display and sum paths (`receipts.ts`,
`dashboard.ts`, `leaderboard.ts`, `battles.ts`, `level.ts`, `queries.ts`). Those are display-and-total bugs
rather than wrong-payment bugs — nothing there feeds a send — but a leaderboard total that is off by a few
hundred wei, or a campaign budget that prints as 5,000,000.000000000012582912, is still the site lying about
money.

**Fix.** Select `::text` and convert with `BigInt` at the boundary; never `select("*")` on a table with a
money column (D-063); use `exactAmount()` (`lib/pay-links.ts`) where a cast is impossible — it returns null
rather than inventing digits that have already been lost.

**Evidence.** The two pages before and after, and the remaining site list from
`grep -rn 'select(' web/lib web/app | grep -v '::text'`. Regression here is silent by construction: nothing
throws, the number just quietly stops being the number.

## #23 — A drop pot is credited by the indexer, which is far behind the chain

**What.** A deposit is confirmed when the indexer scans the block that contains it. The indexer is measured at
~496k blocks behind (entry #19), so the honest freshness of a credit is "the next indexer run, or the moment
the funder presses *I've sent it — check*". The claim path has the mirror-image property: a prize is paid by a
sweep fired on the claim, so the MONEY side is fast while the DETECTION side is as slow as the indexer.

**What was built to soften it.** The funding route's `check` action runs the same matcher over a recent block
window on demand (`checkDropFunding`), which is what makes a freshly funded drop claimable in seconds rather
than hours. It is an accelerator, not a guarantee: a window too small to contain the transfer returns "not
found yet" and the indexer still credits it on its next pass.

**Fix.** Same as #19 — multi-window scans inside one time budget, so the indexer catches up faster than the
chain moves. Until then, drops inherit the site's real clock.

**Evidence.** `checkDropFunding` (`web/lib/drop-distributor.ts`), `FUNDING_LOOKBACK_BLOCKS`, #19's
measurements.
