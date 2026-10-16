# CHANGELOG.md

Newest first. Reconstructed from the repository's commit history plus what was verified at the time.
Format: what changed, and why it mattered.

---

## 2026-10-16 (later) — Session: the payment bell, gas alerting, the audit log, and the books

**Shipped — the pay-link payment bell, raised from the transfer the indexer already
confirms.** `settlePayLinks` (`web/lib/pay-links.ts`) runs inside `indexTransfers`, on the rows
that were just written: one confirmed transfer, decided once, by the run that recorded it, so
there is no second watcher looking for payments. A transfer that covers a request's ask settles
it (atomically, `where settled_tx is null`) and bells its owner; an open-ended request is belled
by any payment; a **partial** payment toward a fixed ask is recorded but NOT belled, because
asserting "paid toward this request" would be a guess about the payer's intent. Migration 0027
adds `settled_tx` / `settled_amount` / `settled_at` to `pay_links` and the `pay_link_paid` and
`low_gas` notification kinds. **This also closes `KNOWN_ISSUES.md` #17**: "paid" is now read from
the row the indexer wrote instead of being guessed from the most recent 50 transfers at render
time — and the dashboard's Paid badge is free for every request, not just the newest twelve.
Verified through the real indexer: cursor rewound so a run re-scanned the window holding a real
10,000 $BEGFI transfer, and the run settled the request, wrote one bell (`10,000 $BEGFI arrived`,
href `/pay/<id>`, payload carrying the tx) and, on a second re-scan of the same window, settled
nothing and belled nothing again.

**A hidden profile's payment is now indexed when it has an active request.** Transfers are
indexed for visible profiles only; a private account's `/pay/<id>` could therefore never settle,
because the transfer answering it was never read. An active request is an explicit ask, and the
ask is the consent the hidden-profile rule was protecting.

**Fixed — alerts had no recipient.** The admin allowlist is an env list that routinely resolves
to a wallet nobody signed in with, so `adminProfileIds` returned zero profiles and a money alarm
reached nobody. The payout wallet itself is now a candidate recipient (it has the operator's
profile), the job reports `alerted: N`, and when that count is 0 it writes an
`alert.undelivered` audit row saying so out loud. Verified: `alerted: 1` and the alarm landed on
  a real profile with "BEGFI: owed 210,000, held 0 — short 210,000".

**Shipped — low-gas alerting.** The reconciliation job now reads the payout wallet's native
balance and compares it to the sweep's OWN floor (`gasFloor` in `lib/earn-distributor.ts`: ten
sends' worth), belling once an hour at most while it is under. It alerts and does NOT pause: no
gas already stops sends at the moment of sending. First real reading: 0.00087 ETH against a
0.000049 ETH floor — **not low**, which corrects an earlier claim in this session's summary that
the wallet was nearly out of gas.

**Shipped — `begfi.audit_log` (migration 0028) and the actions that write to it.** Append-only,
service-role only (no client-readable policy, like `reconciliation_runs`), read by the admin
console. Written by the code that did the thing: switch flips and resumes, the automatic pause,
every reconciliation run and its gas verdict, the daily sweep, and an admin's manual sweep. The
writer never throws — a switch that has already stopped payouts must not roll back because its
record failed to insert — and that hole is stated in the module and in `KNOWN_ISSUES.md` #11.

**Shipped — `/transparency`, the books, published** (roadmap improvement #7). Live payout-wallet
balance, gas on hand, all-time paid, owed right now, the switch's state and reason in the
console's own words, the latest reconciliation run per token (owed vs held vs chain), and the
last actions from the audit log. It renders the ugly truth as readily as a good one — its first
version went live saying "Paused — no money is leaving" and "Short" — because a transparency
page that only looks good when things are good is a marketing page with a ledger in it. Linked
from the footer, listed in the sitemap, HTTP 200 and verified rendering live.

**Found while testing, and left as a documented limitation — the indexer is far behind the
chain.** `KNOWN_ISSUES.md` #19: the cursor stood at block 89,148,875 against a head near
89,645,109 (≈496,000 blocks), and each run advances 2,000 blocks. Every index-driven feature —
including this new bell — is therefore late by that lag, and if the chain produces more than
2,000 blocks per 15-minute run it never catches up. Measured, not guessed; the fix (multi-window
scans inside one run, with a time budget) is not in this session.

---

## 2026-10-16 — Session: Pay Links, the payout kill switch, reconciliation, and two silent-zero bugs

**Shipped — Pay Links (Phase 3, the non-custodial product that needed no new money handling).**

- `supabase/migrations/0024_pay_links.sql` — a `pay_links` row holds an ASK (amount, memo, token, `is_active`),
  never money: no balance, no deposit address, no `paid` flag. Public read; owner-only insert/update; no delete.
- `web/lib/pay-links.ts` — settlement is DERIVED from the indexer's confirmed transfers, so there is no state
  machine that can disagree with the chain. The public total is `received_since`; the settling transfer is
  matched in a bounded recent window (stated in code, `KNOWN_ISSUES.md` #17).
- `/pay/<id>` page + per-link OG card + `/api/qr/pay/<id>` (PNG, `?download=1`, `?card=1` share card) — the
  payer needs no account and sends through the SAME `SendPanel` the profile page uses, so the wrong-network,
  no-gas and irreversible-send guards are identical by construction rather than by copying.
- `/dashboard/pay-links` — create, copy, close and open links, plus `POST /api/pay` (owner from the session).
- **Verified end to end through the URLs a payer uses** (a temporary row, deleted afterwards): page 200 with
  memo + amount + owner; QR PNG with correct magic bytes; `?card=1` share card; `?download=1` attachment;
  OG card; and BOTH settlement branches against real indexed transfers — an ask met by a confirmed 10,000
  $BEGFI transfer reads "Paid" and links that exact tx, a fresh ask reads "Waiting" with a stated zero,
  and a retired link keeps its money, its tx and its closed notice.

**Fixed, and it was the bug that made the feature's own test fail — #18: the site's token was never in
`app_config`.** `beg_token_address` is seeded `''` in 0001 and nothing ever wrote it, so `received_since` and
`profile_stats` compared every transfer against an empty string: every beg progress bar, every OG card and
every profile total read **0**, forever, silently. Migration 0026 sets it to the pinned contract AND the
indexer now syncs that row from `BEG_TOKEN_ADDRESS` every 15 minutes — the actual fix, because a config row
only a human updates will be wrong again. Setting it exposed two more: `received_since` and
`profile_stats.total_received` returned `numeric`, which crosses PostgREST as a float64 (`BigInt("1e+22")`
throws — the pay page 500'd on its first real total, exactly as migration 0013 had warned for a sibling
function); and because the view is `security_invoker`, a signed-out visitor saw "0 $BEGFI received" on every
public profile while the leaderboard showed the real number. Both now return exact TEXT, and public totals
come from a definer aggregate. Verified after: `/kitakeshi` renders "10,000 $BEGFI received from 1 supporter"
to a signed-out visitor, matching the leaderboard.

**Fixed by that verification — a retired pay link still offered a send panel.** The page keyed the send panel
off the derived settlement status, and "paid" deliberately beats "closed" there, so a closed link that had
been paid invited more money to a request its owner had retired. It now keys off the link's own `is_active`.
Found by asserting the closed case rather than by reading the code.

**Shipped — the two money-safety controls the plan asks for, with the user's explicit approval.**

- `begfi.payout_controls` (0025) — the global KILL SWITCH, one row read at the top of both sweeps and on the
  claim, Earn-submit and campaign-submit paths; flipped from `/dashboard/earn/payouts` or `/api/admin/payouts`
  (admin-allowlist gated server-side). It fails CLOSED — an unreadable row parks every payout path — which is
  the deliberate opposite of every other control here, because the moment you need the switch is the moment
  the database is misbehaving (D-038). Pausing takes two clicks and asks for a reason first; resuming takes
  one; every admin wallet is belled on every flip.
- `/api/cron/reconcile` + `.github/workflows/reconcile.yml` — hourly comparison of each token's obligations
  (campaign deposits minus confirmed payouts, plus BegFi's already-promised rewards) against the distributor's
  live on-chain balance, one row per token in `reconciliation_runs`. Drift pauses payouts FIRST and bells the
  admins second, and the job keeps running while paused. Every read that fails or is capped reports
  `unreadable` rather than `ok` (D-041).
- `/dashboard/earn/payouts` now OPENS with the switch and the reconciliation history, above the failed-payout
  queue and the ledger — the stop button is the first thing on the page during an incident, not one scroll
  down.
- Two active campaigns can no longer share a payout token (partial unique index `campaigns_active_token_idx`),
  and `$BEGFI` can no longer be a campaign's token — `createCampaign` says why in words a project owner can
  act on, because an index answers with a Postgres error string (D-043).

**Verified, and it immediately earned its place:** the first real run of the reconciliation job found the
payout wallet holding **0 $BEGFI against 210,000 $BEGFI already promised** to 21 approved submissions (owed
submissions whose rewards were never sent), and paused payouts by itself with that reason attached. The zero
balance was then confirmed independently over a second RPC. This is a live funding gap, not a code defect:
**the distributor wallet needs $BEGFI (and gas) before payouts can resume** — resuming with an empty wallet
would only produce failed sends. `earn_settings.pool_remaining` still advertises a funded daily pool, which is
now flagged as a budget note on the reconciliation row (`KNOWN_ISSUES.md` #3, #4).

**Also:** `next build` exit 0 with every new route present (`/pay/[id]`, `/pay/[id]/opengraph-image`,
`/api/pay`, `/api/qr/pay/[id]`, `/dashboard/pay-links`, `/api/admin/payouts`, `/api/cron/reconcile`);
`tsc --noEmit` clean; migrations 0001–0026 replayed with `npm run migrate` and applied; and the migration
replay caught its own rule — a file that changes a view column or a return type must be changed in the
EARLIER migration too, or the run aborts there (`KNOWN_ISSUES.md` follow-up, D-047).

---

## 2026-10-15 — Session: plan intake, audit, docs brain

**Added**
- `docs/` — the self-improving setup the master plan asks for in §11: `PROJECT_BRAIN.md`, `ROADMAP.md`
  (with the code-accurate audit in Part A and 14 added improvements in Part C), `DECISIONS.md`,
  `CHANGELOG.md`, `KNOWN_ISSUES.md`, `SECURITY.md`, `DISTRIBUTION.md`.

**Shipped** (Phase 0's SEO floor — the one item on the plan that was pure upside and touched no money path)
- `web/app/sitemap.ts` — dynamic: static routes plus every visible profile, beg and non-draft campaign, from
  the anon RLS client so the `is_hidden` policy is the guard. Live: 331 URLs (324 profiles + 7 static).
- `web/app/robots.ts` — allows everything except `/dashboard` and `/api/`, and points at the sitemap.
- `web/app/manifest.ts` — installable PWA identity using the icons and colours the app already ships.
- Verified: `tsc --noEmit` exit 0; `next build` exit 0 (`/sitemap.xml` dynamic, robots and manifest
  prerendered); all three fetched live with HTTP 200 and correct bodies at their real paths.

**Shipped — the dashboard app shell (Phase 0, final item).** `components/dashboard-shell.tsx`: a sticky
sidebar on `md` and above (grouped sections with icons, an Admin group only for an admin wallet, a "Write a
beg" CTA, and a link to the user's public page via `linkFor`), and the scrolling tab row on phones. The
sidebar adds `/dashboard/profile`, which had never been in the navigation at all — the page existed and was
reachable only by typing its URL. `dashboard-tabs.tsx` and the already-dead `dashboard-nav.tsx` are deleted,
nothing left as unused siblings. The active section is the **longest matching href**, so the nested
`/dashboard/earn/payouts` lights up one entry instead of two. Verified visually at 1300px and 390px and on
the nested admin route; after the temporary preview bypass was removed, `tsc --noEmit` and `next build` were
both re-run (exit 0) and `/dashboard` was fetched again to confirm the sign-in gate returns and the rail is
not drawn for a signed-out visitor.

**Fixed — the product's core action was unreachable.** `BegComposer` was the only caller of `/api/beg`, and
nothing imported it: no one could write a beg anywhere on the site. `/begs` advertised "Write a beg" with a
button to `/dashboard`, which had no composer either, and the dashboard's empty state said "write one and it
shows up here". That is why a database with hundreds of real accounts held zero begs. Now mounted on
`/dashboard/begs` under a "Write a beg" heading, with `/begs` linking straight there. This single import is
worth more than any feature on the roadmap, because every other feature depends on the funnel starting.

**Removed — the launchpad's leftovers (`/explore`).** Deleted the route, its nav tab, its footer link and its
sitemap entry, plus the two modules it orphaned (`lib/format.ts`, `components/watch-star.tsx`) and the
already-dead `lib/fees-history.ts`. **Kept** `curve.ts` and `pons.ts`: the live indexer still scans trades with
them. The module-reachability scan decided what went, not the file names. `trades`/watchlist follow-up:
`KNOWN_ISSUES.md` #16.

**Added — analytics.** `lib/analytics.ts` + `components/analytics.tsx`, mounted in the root layout: env-gated
(blank `NEXT_PUBLIC_GA_ID` ⇒ zero `googletagmanager`, zero `dataLayer` in the served HTML, verified both
ways), typed events incl. the plan's `drop_*` names, manual page views for client-side navigation, no PII.
Wired to `beg_posted`, `username_claimed`, `campaign_created`, `campaign_joined`. `NEXT_PUBLIC_GA_ID`
documented in `web/.env.example`.

**Corrected — an untrue sentence in the footer.** It read "BegFi never holds your funds and cannot reverse a
transaction" on every page. That is true of payment links and tips and **false of campaign pools**, which sit
in a BegFi-controlled wallet from funding to payout. The copy now says which is which, and names the refund
rule. A trust claim that a funder can disprove with one on-chain lookup is worse than no claim.

**Found (not fixed — recorded)**
- The site is nearly unused: 324 profiles (262 created 2026-10-15), 0 begs, 1 *draft* campaign, 16 transfers,
  0 X-verified accounts, against 161 earn claims and 118 payouts. Per the user, these accounts are real and
  early — so the cause was the missing composer, above.
- `README.md` still documents `/launch` and `/token/[address]`, both deleted in `4da54cd`. `KNOWN_ISSUES.md` #13.
- The trade indexer and watchlist still serve the removed launchpad. `KNOWN_ISSUES.md` #16.
- `components/copy-text.tsx` and `components/dashboard-nav.tsx` remain imported by nothing.
- No global payout kill switch, and no hourly ledger-vs-chain reconciliation.
- One hot EOA (`DISTRIBUTOR_PRIVATE_KEY`) holds all distributable funds; all campaigns share one deposit
  address. See `KNOWN_ISSUES.md` #1 and #2.

**Nothing that pays people was touched.** No money-path code changed in this session.

## Earlier (from commit history, most recent first)

- **Prefilled compose intent on campaign pages.** One click opens X's composer with the required mention and
  the campaign link already in it — removes the step where a poster gives up.
- **Earner payout bells, live homepage pulse, and a removed constraint that was silently eating them.**
  Migration 0023 widens `notifications.kind`; the homepage shows live activity instead of a static hero.
- **E2E-verified campaign money loop.** Fixed an indexer RPC problem that had made the whole path dead code;
  exact daily gate; admin verify console. *The lesson: a payout loop that has never been run end-to-end is
  broken; you just do not know it yet.*
- **Project campaigns.** Per-project Earn pools with automatic daily payouts, plus a leaderboard rebuild.
- **Automatic reward distribution.** Daily cron + funds-arrival sweep with lease-guarded payouts — the
  keystone of the money engine (lease, attempt cap, balance ceiling, gas floor).
- **`earn_refill_pool` returns `text`.** Previously PostgREST float-truncated a 24-digit pool remaining,
  which silently lost precision in the number that decides how much can be paid out.
- **Earn claim flow fix.** `earn_refill_pool` broke under PostgREST's `search_path`, and
  `getApprovedUnclaimed` filtered on the wrong column — both silent, both money-affecting.
- **Tip receipts, battle metrics with anti-wash and streaks, live Transfer worker.**
- **`$BEGFI` is live.** One exact CA pinned in config; homepage stats from real market and on-chain data;
  fees counted from the launch contracts' own fee events.
- **Footer copy.** Exactly "Built on Robinhood Chain", with ", $BEGFI is live" only once `TOKEN_CA` is set;
  the dead per-account daily-limit knob removed from Earn.
- **Linked socials + X verification tick; send-panel wiring for pay-with-any-token.**
- **Weekly Beg Battles.** Leaderboard of who received the most `$BEGFI` this week, Monday 00:00 UTC reset
  with a countdown, Top Beggar badge frozen on the top three profiles.

## Standing invariants (verified at each of these changes)

- Everything that pays out keeps the two-layer no-double-payment rule: `payout_tx IS NULL` for money truth,
  the atomic `claimed_at` lease for send truth.
- Migration `0021`'s lease exists because `claimed_at` could not be the send signal — `submit` stages it at
  birth. That is a decision, not an accident: `DECISIONS.md` D-009/D-011.
