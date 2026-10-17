# CHANGELOG.md

Newest first. Reconstructed from the repository's commit history plus what was verified at the time.
Format: what changed, and why it mattered.

---

## 2026-10-17 (fourth pass) — The payout key can live in AWS KMS

**The signer is now pluggable.** `lib/distributor-signer.ts` chooses the payout wallet's signer
from configuration: AWS KMS when `AWS_KMS_KEY_ID`, `AWS_REGION` and `DISTRIBUTOR_ADDRESS` are set,
the existing `DISTRIBUTOR_PRIVATE_KEY` when they are not, and nothing when neither is configured.
The private key stays as the fallback so a deployment does not stop paying the day this ships, and
so the KMS path can be rolled back without a code change.

**How the KMS path signs.** `lib/kms-signature.ts` is a pure module that turns a KMS ECDSA
signature into an Ethereum transaction. KMS returns DER, which is parsed to r and s; s is
normalised to the low half of the curve (EIP-2 rejects high s on some paths); the recovery bit is
found by trying 0 and 1 against the configured address, which is also the check that the key and
the address agree. It signs the EIP-1559 digest with `MessageType: DIGEST` so KMS does not hash it
twice. The AWS SDK is imported lazily, so a deployment using the env key never loads it.

**Every money path reads the signer, not the key.** `earn-distributor.ts`, `campaign-distributor.ts`
and `drop-distributor.ts` build their account through `distributorAccount()`, their configured
guard through `distributorSignerConfigured()`, and their public address through
`distributorAddress()`. The claim route and the payouts console follow the same two functions.
No route or page reads `DISTRIBUTOR_PRIVATE_KEY` any more.

**Verified:** a locally generated key signed through the same code path produced a signature that
`recoverTransactionAddress` resolved to the expected address, for both a legacy and an EIP-1559
transaction, with low s. Typecheck and build pass with the env-key path active, which is the path
production runs today. The KMS path itself is not yet exercised against a real AWS key, because no
key exists in the account; that is stated rather than claimed.

**Not built:** per-pool deposit addresses. One KMS key signs for one address and AWS KMS does not
derive BIP32 children, so a pool address means one key per pool or a forwarding contract. That is
the same custody question, one level down, and it stays open.

---

## 2026-10-17 (third pass) — One ledger for every movement, written by the database

**`begfi.ledger`, migration 0030.** Campaign deposits, drop deposits and confirmed payouts now
land in one append-only table, with `kind`, `pool_kind`, `pool_id`, token, amount, wallet, tx and
a unique `source_key`. The rows are written by triggers on the three source tables, in the same
transaction as the row they describe, so no application money path had to change and a path
cannot be added without its movement being recorded. The migration backfilled history: 1 campaign
deposit and 122 confirmed payouts, which is every row in the source tables.

**Reconciliation now checks the copy.** Every `/api/cron/reconcile` run compares ledger totals
per pool against `campaign_deposits`, `drop_deposits` and sent `earn_payouts`, reports
`ledger: { rows, ok, mismatches }`, and audits a `ledger.mismatch` when they disagree. It reports
rather than pauses: a missing ledger row does not mean the wallet is short, and stopping payouts
would stop the writes that repair the picture.

**Campaign balances now read the ledger.** `lib/ledger.ts` sums deposits and payouts per
campaign in one query, and `lib/campaigns.ts` uses it for every card, detail page and owner view,
falling back to the two source tables when the ledger cannot be read. One read also removes the
chance of pairing a deposit query from one instant with a payout query from another. The live
campaign matched exactly: 30,000 deposited, 20,000 paid, 10,000 remaining in both readings, zero
mismatches. Drop pots were left on their source reads on purpose: their repair term needs
`earn_payouts.submission_ids`, which maps a confirmed payout to the claims it settled and which
the ledger does not carry.

**Verified:** the migration applied to the live database; ledger counts equal the sources
(123 = 1 + 122); trigger behaviour was exercised inside a rolled-back transaction for a deposit,
a payout inserted already sent, and a pending payout flipped to sent, with no leftover rows.
The ledger query ran through the same PostgREST client the app uses. Typecheck and build pass.
No payout, wallet, key or fee code changed.

---

## 2026-10-17 (second pass) — The master plan against the code, and the public surfaces it was missing

**Wrote `docs/IMPLEMENTATION_PLAN.md`.** It maps every master-plan section to LIVE / PARTIAL /
MISSING / ASK-FIRST, separates the work that can ship now from the custody work, records the
recommended money-phase order (per-pool addresses → ledger → reconciliation → refunds → keys →
multi-chain), and lists fourteen additions beyond the plan with the reason each exists. It is
the order of work; `ROADMAP.md` stays the longer audit.

**Top Givers.** The plan's §8 asked for it and the data already existed in `campaign_deposits`
and `drop_deposits`. Ranked by **distinct pools funded**, not by a sum: campaign and drop
deposits can be in different tokens, so adding their amounts would be adding metres to
kilograms. Draft campaigns are excluded, so a test deposit cannot top a public board. Right now
the only campaign deposit in the database is a test deposit into the draft E2E campaign, so the
board is honestly empty and says so — the empty state was verified against the real tables.

**The live feed now includes creation, and a drop prize is no longer mislabelled.** New drops
and new campaigns join payouts and transfers, and a payout row carrying a `drop_id` now says
"won X in <drop>" with a link to the drop. Before this, the shared ledger meant every drop prize
rendered as "earned from the BegFi pool", naming the wrong product for real money.

**Search.** `/search` covers public people, campaigns and drops, reachable from a magnifier in
the top bar. It is server-rendered, submits as a normal GET, and queries each column separately
instead of using Supabase's `.or()` mini-language, so a name with a comma returns results rather
than a 400. Begs, pay links and receipts are deliberately not searchable: they are not things
people publish to be found.

**A Help page.** `/help` answers the operational questions: what BegFi holds and does not,
why a drop stopped paying, what happens to an unspent pot, what "claimable" means, what the X
tick proves, and why a failed read says unavailable instead of zero. The FAQ JSON-LD is built
from the same array the page renders, so a crawler cannot be told a different answer from a
reader. Linked from the footer and the sitemap.

**The drop share card.** `/drop/<id>` now has an `opengraph-image` and a matching
`twitter-image` (one design, re-exported): prize, cap, one-per-wallet, and "paid automatically"
at 1200×630. The open gap in `docs/DROPS.md` §6.5 closes. Verified as `image/png`, 1200×630, HTTP 200 — the
not-found variant, because the database currently has no drops to render a real one.

**Your own row.** The signed-in visitor's row carries a small "you" badge on any board they
appear on. Rendered on the server, so no session data reaches a signed-out page.

**Also:** the leaderboard copy and metadata now say seven boards rather than six; `/search`,
`/help` and the new boards are in `BEGFI_CONTEXT.md` and the README route list.

**Verified.** `npm run typecheck` and `npm run build` are clean; the contract suite is unchanged
(32 passing). `/leaderboard?tab=givers` (all and weekly), `/search?q=ase`, `/search`
without a query, `/help` and the drop OG route were fetched. `ase` returns the matching profile;
the no-query state explains the minimum; the givers counts were checked against the live tables
with a throwaway read-only script. **Unverified:** a real drop's share card (there are no drops),
the signed-in "you" badge, the named holder list (the explorer's bot challenge blocks this
machine), and every money flow — payouts are still paused with 210,000 $BEGFI owed and 0 held.
No payout, wallet, key, fee or ledger code was touched.

## 2026-10-17 — Session: six boards, a brief every AI can read, and the settings that were missing

**Leaderboards are now six boards with a window, not one ranking with tabs.** `/leaderboard` serves top
earners, top begged, top supporters, most active, top campaigns and holders. The first five take `w=day`
(rolling 24 hours), `w=week` (Monday 00:00 UTC, the same boundary the Beg Battle freezes on) and `w=all`;
holders is a live snapshot and says so. Each tab has its own source and its own empty state, and a failed
read still renders as `dbFailed`, never as an empty board. **Top begged is a corrected number, not a renamed
one:** it reads confirmed transfers with the payout and fee wallets excluded, so an earn payout no longer
counts as somebody begging. That list was previously summing every transfer, which made the "top beggar"
and "top earner" boards two views of the same fact. On today's data the honest result is that nobody has
been *supported* yet — every confirmed transfer came from the distributor — and the board says so instead of
showing earners twice. **Top campaigns** ranks by distinct people paid, because two campaigns can pay in two
tokens and their totals cannot be added; each row still shows its own total in its own unit. **Most active**
has a stated definition (begs, pay links, campaign posts, drop claims) rather than a vibe. **Holders** reads
the explorer for the named list and the market feed for the holder count and top-ten concentration; when the
explorer's bot challenge answers nothing, the tab shows the count and concentration and says the named list
is unavailable, instead of printing an empty list as "no holders".

**Pay Links got amount presets.** 5 / 20 / 100 / 500 or "Any amount", filling the same input a custom
amount uses, so the request is one tap and there is still one parser. The paid state, QR and memo were
already live and unchanged.

**A context brief every AI can read.** `docs/BEGFI_CONTEXT.md` is the master brief: products and routes,
architecture, the payout flow, removed features, custody language and tone. `AGENTS.md` and `CLAUDE.md` at
the repo root point at it and carry the rules (read it first, keep the changelog, never reintroduce the
launchpad, /explore or device fingerprinting, never promise a return). `docs/CONTENT_BRIEF.md` is the
copy-paste brief for the content AI, with official wording, the CA and a "what's new" section.
`/llms.txt` publishes the same facts to outside tools, and `/how` explains the four products and who holds
the money to a visitor with no wallet. The footer and sitemap link `/how`.

**Dashboard gaps closed, one real switch added, and two dead things removed.** The sidebar keeps the product's
shipped name, **Drops** (the same thing the brief calls Giveaways; renaming the surface but not the routes,
docs and page title would leave two names for one page), adds Leaderboards, Notifications and Settings, and
calls Profile "Profile & socials". `/dashboard/notifications` is a full inbox (read through the caller's session; RLS is the
authorisation) with mark-all-read. `/dashboard/settings` exposes `profiles.is_hidden` — the one real account
switch the schema had and no surface showed — with its actual consequences written down: the profile page
leaves public view, the account leaves the boards and sitemap, and pay links keep working without a name.

The **Overview** was rebuilt around the money rather than around the launchpad. It now shows $BEGFI received,
supporters, payouts paid, a real Claim button when approved pool work is unpaid, a seven-day receipts chart,
the five most recent payouts with their campaign and token, and four next actions. Removed from that page: the
launchpad **watchlist** (a dead product's remnant, still readable through its API but no longer the first
thing after sign-in) and the **launch meter** — which made a factory read and then two RPC calls per catalog
token, up to five hundred of them, on every dashboard load, for a number the page never rendered. Two indexed
reads are what the page actually shows now.

**A shared loading state, a real 404 and an error boundary.** `app/loading.tsx` gives every route a skeleton with
the shape of the list it is about to show, `app/not-found.tsx` offers the four live products instead of a dead
end, and `app/error.tsx` says plainly that a failed page is a failed read and does not move money, with a retry
and the server digest. There were no loading states anywhere before this.

**Two display bugs found by looking at the rendered board.** The live feed printed dust as `1e-16` because
it divided a BigInt by `1e18` in JavaScript; it now prints the exact decimal (`0.0000000000000001`). And the
top-campaigns board ranked a **draft** E2E test campaign — test money, in a campaign nobody can open — because
it filtered only on the payout ledger and not on the campaign's visibility. Draft campaigns are now excluded
from that board and from the live activity feed, after the cut rather than before it, so hiding a draft cannot
silently shrink a board. The E2E row is gone from the rendered page; the rows themselves stay, as money facts
must.

**Verified.** `npm run typecheck` and `npm run build` are clean. `/leaderboard` was loaded in every tab and
window against the live database and reviewed at phone and desktop widths; `/how`, `/llms.txt`,
`/dashboard`, `/dashboard/notifications` and `/dashboard/settings` were fetched, and the holders fallback was
watched rendering the live count instead of an empty list. The Overview's queries were run against the live
schema with a throwaway script (profile, payouts, payout count, seven-day receipts, claimable rows) and the
campaign fix was confirmed by watching the draft disappear from the rendered board. **Unverified:** the
explorer's *named* holder list, because its bot challenge blocks this machine; the signed-in dashboard pages
were compiled and fetched through the sign-in gate but not visually reviewed with a session; and no money
path was exercised end to end (payouts are still paused, see `PROJECT_BRAIN.md`). No money path, wallet,
key, fee or ledger code was touched.

## 2026-10-16 (evening) — Session: two money displays that lied, and the explainer video

**Fixed — a missing `::text` made the pay page print, and PREFILL, a truncated amount.** A `numeric(78,0)`
base-unit amount crossing PostgREST becomes a JSON number, and a float64 mantissa is 53 bits, so a link
asking for exactly **1,000,000 $BEGFI** (1e24 wei) arrived as `999999999999999983222784` and the page
rendered `999,999.999999999983222784 $BEGFI`. That was not only cosmetic: the same value is fed through
`formatAmount` into the send panel as the **locked** amount, so a payer following the page would send
*less than the ask* — and the indexer's `paid >= ask` test means such a request never settles and never
rings its owner's bell. `lib/pay-links.ts` now selects `amount::text` in both reads, and `begs.goal`
(`lib/queries.ts`, `app/beg/[id]/page.tsx`) was the same bug printing `99,999.999999999991611392` for a
100,000 goal. Verified through the pages: **1,000,000 $BEGFI** and **Goal 100,000 $BEGFI**. The shape of the
bug, the remaining sites (`campaigns.daily_budget` via `select("*")`, `transfers.amount` display paths) and
the rule that prevents it are `KNOWN_ISSUES.md` #24 and D-063 — the rule being that a money column is read
as text and `select("*")` is not allowed on a table that holds one.

**Shipped — the explainer video** (`video/`, 8 minutes, narrated): the four products, the money engine, the
safety controls, the public books, and the parts that are not built, assembled from screenshots of the live
site. One TTS clip per beat, so a beat's audio length is its on-screen length and the picture cannot drift
from the voice; the single demo asset (a funded drop pot) is created for the capture, labelled as a demo on
the page, and deleted afterwards. Tooling and timings: `video/README.md`, `video/SCRIPT.md`. It was making
this video that surfaced the bug above — the ugly number was visible in a screenshot.

## 2026-10-16 (latest) — Session: Drops, the fourth product, built on the existing money engine

**Shipped — Drops: a funded pot, one fixed prize per claimer, a cap, paid automatically.** `/drops` lists
the live pots, `/drop/<id>` is the claim page (pot arithmetic, winners with their transactions, share
buttons), and `/dashboard/drops` is the owner's: create, fund, open, close, plus a line per claim and per
funding intent. Migration 0029 adds `drops`, `drop_fundings`, `drop_deposits`, `drop_claims` and
`pool_tokens`. Plan and record in full: **`docs/DROPS.md`**.

**Reused, not rebuilt — the point of the product.** A prize leaves the same distributor wallet that pays
BegFi's pool and every campaign, is a row in the same `begfi.earn_payouts` ledger (one new `drop_id`
column), takes the same lease atom on `drop_claims`, and obeys the same gas floor, global kill switch,
frequency-limited alerting and hourly reconciliation. The daily earn-payouts cron now runs three timed
slices in one function (earn 22s, campaigns 22s, drops 12s) rather than adding a third schedule — Vercel
Hobby allows two. What is genuinely new is **attribution**: a campaign is credited by token alone, but a
second product now shares the receiving wallet, so a funder registers an intent (their own wallet, the drop,
the amount, RLS-enforced) and the scan credits only transfers that match it (D-056). The other new piece is
the **cross-product token lease** (`pool_tokens`, claimed by a trigger on `campaigns` and on `drops`), since
two tables cannot share a partial unique index (D-057).

**Shipped — `payoutWalletReady` (`lib/payout-controls.ts`).** One implementation of "can the wallet pay
this?" for all three products, replacing the earn submit route's private copy of the same arithmetic.

**Found and fixed two pre-existing money bugs — both surfaced by drops, neither caused by them.**
(1) `earn_payouts` still carried migration 0021's `unique (wallet_address, cycle_date)` because 0022 dropped
a *guessed* constraint name that never matched: for a week the ledger capped every wallet at **one payout a
day across every product**, and the campaign sweep read the resulting `23505` as "already served this
cycle" and skipped the payout **silently**. 0029 drops it by its real name and creates the three-pool index;
the disk-qualified `drop index` also had to be fixed, because the migration runner does not run with `begfi`
on the search path. (2) A crash between "claim paid" and "ledger row written" made a pot read **too full** —
`paid` summed only the ledger, so money that had already left the wallet was spendable again. `readDropPot`
now counts a paid claim with no ledger row as gone; verified by seeding exactly that state and watching the
page move from "Paid out: 0, Claimable: 2,000" to "Paid out: 200, Claimable: 1,800". Both were found by
asserting on a number rather than by reading code, the same lesson as the two silent zeros of the previous
session.

**Deliberately not built, and said out loud.** No per-pool deposit addresses and **no refund for an unspent
pot** — the remainder stays in the shared wallet, and the dashboard, the footer and `docs/DROPS.md` now say
so instead of implying otherwise (D-062; the footer had been implying unconditional refunds with no code
behind it). No deviceless sybil defence beyond one prize per wallet and per **verified** X account: device
fingerprinting existed and was removed on purpose in the earn rewrite, and drops do not revive it (D-055).
No per-drop OG card yet. Open limitations recorded as `KNOWN_ISSUES.md` #20–#23.

**Verified.** `tsc --noEmit` clean; `next build` exit 0 with `/drops`, `/drop/[id]`, `/dashboard/drops` and
the four `/api/drop/*` routes in the route table; 24 database assertions against the live schema (token
lease across both products, the shared ledger's uniqueness, RLS on claims and intents, the partial X-handle
index, lease release on delete) — all pass; live pages through the running dev server: `/drops` 200,
`/drop/<id>` 200 rendering a seeded pot (200 PEPE per claim, 9 prizes left, 1/10 claimed, winners row with
its transaction link), `/sitemap.xml` carrying `/drops`, and all four API routes answering 401 with their own
sentence when signed out. Fixtures were removed afterwards; no test rows remain.

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
