# DECISIONS.md

Every product or technical decision with a short reason. Newest first. When the plan was unclear, the
decision made here is the one the code follows.

---

## Decisions from the 2026-10-16 evening session: money reads, and the explainer

**D-063 — A money column is read as `::text`, and `select("*")` is not allowed on a table that holds one.**
A `numeric(78,0)` base-unit amount crossing PostgREST becomes a JSON number, and a float64 mantissa is 53
bits: 1,000,000 $BEGFI (1e24 wei) arrives as 999999999999999983222784, with nothing thrown and nothing
logged. The rule is therefore mechanical rather than a judgement call: any read of a money column says
`::text` and converts with `BigInt` at the boundary, and a table with a money column is never read with
`select("*")`, because that is how the cast gets lost. Where a cast is impossible, `exactAmount()` returns
null instead of guessing digits that are already gone. *(Reason: two live bugs — a pay link printed and
PREFILLED a truncated amount, so the payer's send no longer met the ask and the request could never settle;
and a beg goal printed 99,999.999999999991611392 for 100,000. Both were one missing cast. See
`KNOWN_ISSUES.md` #24 for the sites that still need it.)*

**D-064 — The explainer video is built from the live site, and its pipeline is reproducible.** Chapter text
and visuals live in `video/chapters.json`; one TTS clip per beat means a beat's audio length IS its on-screen
length, so picture and voice cannot drift; screenshots are real pages from production, captured with
Playwright + the installed Chrome, and the one unavoidable demo (a funded drop pot) is created by
`video/tools/fixture.cjs`, labelled as a demo on the page itself, and deleted after the capture — the script
prints that the database ends with zero drops. *(Reason: a product video that quietly mocks up screens is a
marketing asset, not a record, and this site's whole claim is that it does not do that. The video also states
the open limitations out loud, so a viewer checking it against the site finds agreement.)*

---

## Decisions from the 2026-10-16 (later) session: Drops

**D-054 — Drops are a FRONT over the existing payout engine, and the only new money-adjacent object is a
lease table.** Same wallet, same key, same ledger (`earn_payouts` + one `drop_id` column), same lease atom,
same gas floor, same confirm-then-record rule, same kill switch, same reconciler. Drops add four tables
(`drops`, `drop_fundings`, `drop_deposits`, `drop_claims`), one lease table (`pool_tokens`) and one sweep.
*(Reason: D-021 said this, and it is now implemented rather than restated. A second engine is a second way to
double-pay, and the existing one has been verified against real chain history.)*

**D-055 — A drop's caps are the wallet, the VERIFIED X account, and `max_claims`. No device fingerprint.**
The earn rewrite (0014 → 0016 → `app/api/earn/submit`) removed device budgeting deliberately, because a
family phone, a campus NAT or a shared exit node told honest people "come back tomorrow" for a sin someone
else committed. *(Reason: a giveaway is the strongest argument there is for a per-device cap, and it is still
the wrong one — this codebase already decided that punishing shared hardware costs more real users than it
stops farmers. Stronger sybil resistance is captcha + clustering + a review queue (KNOWN_ISSUES #22), not a
revived fingerprint.)*

**D-056 — Drops are funded by INTENT, and a transfer that matches no intent is credited nowhere.** A funder
registers `(their own wallet, the drop, the amount)`; the scan credits only transfers that match it. The
partial unique index `drop_fundings_pending_idx` keeps at most one open intent per `(funder, token)`, which is
what makes the match a fact instead of a coin flip; recently matched intents stay matchable for 24 hours, so a
funder who sends in two transfers is still credited. *(Reason: every pool funds ONE address, so a deposit
cannot be attributed by address — and money must never be attributed to a guess. The cost is stated rather
than hidden: an unmatched transfer sits in the wallet and is credited the moment its intent is registered
(KNOWN_ISSUES #20).)*

**D-057 — One payout token, one live pool — across products, enforced by a trigger in a shared table.**
`pool_tokens` holds one row per token; `campaigns` and `drops` both claim it on write, and a second claimer
raises instead of overwriting. A drop holds its token from creation until it has ENDED (it accepts deposits
while merely paused); a campaign holds it while `active`, exactly as 0025 defined. Deleting a pool releases
the lease, because deleting a profile cascades to its pools and a row that is gone cannot fire an UPDATE.
*(Reason: 0025's partial unique index could not span two tables, and a check in an API loses to two
concurrent creates.)*

**D-058 — The pot has ONE arithmetic, and money that LEFT counts as gone.** `readDropPot` is read by the page,
the claim gate and the sweep; `paid` is the settled ledger rows **plus** any claim carrying a `payout_tx` that
no ledger row accounts for. *(Reason: found by seeding the crash state — a transfer that confirmed and whose
ledger write failed left the pot reporting money the wallet no longer held, and the claim gate would have
spent it. Two implementations of "what is in the pot" is one place too many for that bug to live.)*

**D-059 — A drop's prize, token and cap are immutable; the owner's levers are pause, resume, extend, end.**
A claim is a promise made at a moment and the claim row carries the prize it was made for, so editing the
number afterwards would mean paying a promise at a new number or keeping two numbers that disagree. And
`end` does not strand anything: the sweep is driven by unpaid claims, so accepted prizes are paid whatever the
drop's status is. *(Reason: the alternative — an editable prize — is the single most obvious way for this
product to start lying to the people it already promised.)*

**D-060 — A claim is refused when the payout wallet cannot actually send it, through one shared
`payoutWalletReady(token, amount)`.** The earn submit path calls the same function now; it used to carry its
own copy. *(Reason: a pot can be funded in the ledger while the wallet has no gas or the tokens have moved.
Accepting the claim anyway is how a giveaway becomes a lie — and three products asking "is the wallet funded?"
with three implementations is three answers that can disagree.)*

**D-061 — Drops get no cron entry of their own.** The daily sweep runs earn (22s), campaigns (22s) and drops
(12s) inside one function, and a drop sweep is additionally fired by a credited deposit and by a claim.
*(Reason: Vercel Hobby allows two crons and both are spent; a third schedule would also be a second way to ask
the same question. Drops get the smallest slice because a drop sweep has already been nudged — whatever the
cron finds is the residue of triggers that ran out of time.)*

**D-062 — An unspent pot is NOT refundable yet, and the site now says so instead of implying otherwise.**
D-019 decided the remainder should be returnable; building it needs per-pool deposit addresses or a signed
refund path, i.e. the Phase 1 custody work. Until then the drop dashboard and the footer state that the
remainder stays in the payout wallet, and "fund only what you intend to give away" is the advice. *(Reason:
the footer previously asserted that unspent pools are returned — a claim no code backed for campaigns either.
Correcting an over-promise is worth more than the sentence it cost.)*

**D-063 — A FIFTH dock tab, for a product with something behind it.** `site-nav`'s comment argued for four
wider targets, and that reasoning was about a dead tab (`/explore`, whose catalog could never gain a row). A
drop is the shortest path from a shared link to money in a stranger's wallet, and it is the only product whose
users arrive with no wallet and leave with one, so it earns a thumb. *(Reason: the rule was never "four tabs";
it was "no tab without a product".)*

---

## Decisions from the 2026-10-16 session: Pay Links + money safety

**D-036 — A pay link stores an ASK, never a payment. "Paid" is derived from confirmed transfers.**
`begfi.pay_links` (migration 0024) holds the amount, the memo, the token and `is_active`; it holds no
balance, no deposit address and no `paid` flag. Settlement is computed in `lib/pay-links.ts` from the
indexer's confirmed `transfers` rows. *(Reason: a stored "paid" boolean is a second truth that can disagree
with the chain, and this is the one product where BegFi is not a party to the payment — the payer transfers
straight to the owner's wallet. A row of ours that could be wrong must never be able to make someone believe
money arrived.)*

**D-037 — The public pay page shows the total received and whether the ask is met, and never who paid.**
The aggregate comes from `received_since` (migration 0007), a definer function that returns one number, so a
signed-out visitor holding a shared link gets exact progress without `transfers` becoming publicly readable.
The settling transfer is matched against the **most recent 50** transfers to that wallet for that token, and
the page leads with the total rather than the badge for exactly that reason. *(Reason: publishing the
sender→recipient graph is the leak migration 0001 refuses; and a bounded match that is stated beats an
unbounded one that is guessed. Closing the window properly means storing the match at index time — Phase 1.)*

**D-038 — The global payout kill switch fails CLOSED, which is the opposite of every other control here.**
`lib/payout-controls.ts` treats an unreadable `begfi.payout_controls` row as paused; every rate limiter in
this codebase fails open on the same principle, inverted. *(Reason: a limiter outage must not stop a real
person from writing a beg, but the one moment a kill switch is needed is the moment the database is
misbehaving. The costs are not symmetric: failing closed delays a payout that the next sweep picks up;
failing open pays during the exact incident the switch exists for.)*

**D-048 — Pay-link settlement and its bell are decided at DETECTION time, in the run that indexes the
transfer.** The indexer hands the confirmed transfers it just wrote to `settlePayLinks`, which settles a
met ask atomically and writes the payment bell. *(Reason: a second watcher looking for payments is a second
thing that can disagree with the ledger, and this product's whole promise is that one truth decides. It also
closes `KNOWN_ISSUES.md` #17 — "paid" stops being a window search at render time and becomes a column.)*

**D-049 — A PARTIAL payment toward a fixed ask is recorded but never belled.** The transfer is real and the
page's total shows it; the bell is withheld because it would have to assert "you were paid toward this
request", which is a guess about the payer's intent. *(Reason: the honesty rule — state only what the chain
and the ledger can back. "Any amount" requests are fulfilled by definition and are belled.)*

**D-050 — Low gas ALERTS; it does not pause.** The reconciliation job compares the payout wallet's native
balance against the SWEEP'S OWN floor, exported as `gasFloor` so sender and alert cannot disagree, and bells
once an hour while it is under. *(Reason: no gas already stops every send at the moment of sending, so pausing
would be a slower way of saying the same thing — and it would need a human to undo even after a top-up. The
first real reading also corrected a claim made earlier in this session: 0.00087 ETH against a 0.000049 ETH
floor is not "nearly out", it is ~176 sends' worth.)*

**D-051 — The payout wallet's own profile is a candidate for every alert, and the recipient count is
reported.** *(Reason: the admin allowlist is an env list, and it resolved to a wallet nobody had signed in
with — so a shortfall paused all payouts and told nobody. The signing wallet is the one address guaranteed to
be involved. When the count is zero the job writes an `alert.undelivered` audit row, because "we alerted
nobody" has to be a fact in the record rather than an absence in it.)*

**D-052 — The audit log's writer never throws, and the hole is documented rather than hidden.** A switch that
has already stopped payouts must not roll back because its record failed to insert, so `recordAudit` returns
false instead of raising and the limitation is stated in the module and in `KNOWN_ISSUES.md` #11. *(Reason:
the money-facing act is the point; the record of it is second — but a silent hole would be a lie, and the
difference between the two is whether the code says which it chose.)*

**D-053 — `/transparency` renders the bad news with the good.** The page publishes the payout wallet's live
balance, what it owes, the switch state in the console's own words, the last reconciliation per token and the
last audit rows — including "Paused — no money is leaving" and "Short". *(Reason: it is published precisely so
the numbers can be checked, and a transparency page that looks good only when things are good is a marketing
page with a ledger in it. Custody is stated plainly too: what is in the wallet, and what never passes through
it at all — `/username` and `/pay/<id>` payments.)*

**D-045 — Public money totals are served by SECURITY DEFINER aggregates, not by a view the caller can see
through.** `received_since` (0007) and `public_wallet_totals` (0026) each return digits and nothing else, and
are granted to `anon`. The `profile_stats` view stays `security_invoker` for the leaderboard's exact ordering,
but a signed-out visitor cannot read it — so the public profile's total now comes from the function. *(Reason:
`security_invoker` is the right choice for the view — it makes the transfers policy the guard — but it also
made every public profile read "0 $BEGFI received from 0 supporters" to every visitor who was not already an
involved party, while the leaderboard showed the same wallet's real total. A public aggregate that nobody can
read is not a privacy win; it is a lie about money.)*

**D-046 — Money values leave Postgres as TEXT.** Every amount a page or a route parses is selected
`::text` (or returned as text by a function), because a `numeric` crossing PostgREST becomes a float64 and a
24-digit base-unit figure arrives either rounded or as `1e+22` — which `BigInt` refuses outright. *(Reason:
migration 0013 recorded this for `earn_refill_pool`; the 2026-10-16 session proved it twice more by breaking a
pay page with `SyntaxError: Cannot convert 1e+22 to a BigInt` the moment a real total appeared, and by finding
`profile_stats` returning the same shape.)*

**D-047 — A migration that changes a type is written into the EARLIER migration too.** `scripts/migrate.js`
re-runs every file in order, so a later file that changes a view column or a function's return type aborts the
whole run at the earlier file (`cannot change return type of existing column`). 0001's view and 0007's function
now carry their final shapes, with a comment pointing at 0026. *(Reason: the alternative — a runner that skips
applied migrations — is a bigger change to the deploy path than the problem it solves, and the replay is what
caught this.)*

**D-039 — The switch is global, and pausing takes two clicks while resuming takes one.** Per-campaign pause
already exists (`campaigns.status`); a second per-pool level of the same lever was not worth the extra read
on every money path. And an accidental resume sends money that was deliberately held, while an accidental
pause costs a delayed payout — so the two directions get different friction, and the pause reason is
typed **before** the flip because that reason is what every earner reads on a failed button.

**D-040 — Reconciliation compares OBLIGATIONS PER TOKEN against ONE shared wallet balance, and says so.**
`/api/cron/reconcile` computes, per token, `Σ(deposits credited − payouts sent)` over campaigns plus BegFi's
owned **already-promised** rewards — approved submissions with no payout tx, which is what the wallet is
actually short of. It compares that to the distributor's live `balanceOf`. Extra float is normal (owners fund
ahead of a sweep); only a SHORTFALL raises drift, because that is the one that ends in a failed claim.

**OWED, NOT BUDGETED, and the difference is the whole design.** `earn_settings.pool_remaining` is the day's
remaining ALLOWANCE, refilled every UTC day: money nobody has claimed is not money the wallet must cover.
Comparing the balance against it would raise drift on every quiet day and pause every payout wrongly. The
budget is still reported — as a NOTE when the balance is under it, with no effect on the verdict — because
covered-but-tight is worth knowing. *(Reason: with one deposit address there is no per-pool balance to read —
an honest approximation that names its own shape is worth more than a precise-looking number that cannot
exist yet. Per-pool addresses in Phase 1 make this exact.)*

**D-041 — Reconciliation never reports `ok` from a truncated or failed read.** A hit row cap or a failed
chain read produces `unreadable`, with the reason stored on the row. *(Reason: "could not read" and "read
zero" are different facts; a check that renders green because it only looked at the first ten thousand rows
is worse than no check, because someone would trust it.)*

**D-042 — Drift pauses payouts itself, before it alerts anyone, and only a human ever resumes.** The order
is deliberate: the switch is flipped first and the bell second, so a failed notification cannot leave the
wallet still paying. The job also runs while payouts are paused. *(Reason: a pause is often the response to
drift, and a monitor that switches itself off during the incident it monitors reports nothing. Resuming is a
decision about money and stays with a person.)*

**D-043 — Two active campaigns may never share a payout token, and $BEGFI may never be one.** A partial
unique index (`campaigns_active_token_idx`) makes the first impossible even under two concurrent creates, and
`createCampaign` refuses the second in words the owner can act on — including the $BEGFI case, where a pool
top-up would be indistinguishable from the site funding its own rewards at the same address.
*(Reason: deposits are attributed per token to ONE shared address, so a shared token silently credits one
pool and starves the other. `KNOWN_ISSUES.md` #2; the index is the enforcement, the message is the courtesy.)*

**D-044 — Reconciliation rows record `token_decimals`, and the console renders with it.** *(Reason: a
campaign may pay in a 6-decimal token; the 18-decimal default would show a number a trillionth of its real
size, on the page whose entire job is to be trusted about money.)*

---

## Decisions from the 2026-10-15 audit and Phase 0 work

**D-032 — The dashboard uses a desktop sidebar plus a phone tab row, not the plan's "sidebar + bottom tab
bar on mobile".** The plan (§9.1) asks for both. The product already has a **global** bottom dock (Begs / Earn
/ Board / You) fixed on phones; adding a dashboard tab bar above it would put two navigation bars inside the
same thumb's reach, and the plan's own app shell is drawn for a project that does not have one yet. So the
rail appears at `md` and above, and on phones the dashboard keeps its scrolling pill row under the page
title. Recorded because it is a deliberate divergence from the plan, not an omission.

**D-033 — Dashboard navigation lists every section, and only sections that exist.** `DashboardShell` builds
its list client-side (icons are React components and a server component cannot pass one to a client
component), and takes exactly one thing from the server: whether this wallet is an admin. Adding `/dashboard/profile`
fixes a page that was reachable only by typing its URL — it had never been in the tab row. `dashboard-tabs.tsx`
and the already-dead `dashboard-nav.tsx` were both deleted, not left as unused siblings of the new shell.

**D-034 — Admin sections are appended, never hidden behind a mystery.** A non-admin's sidebar simply has no
Admin group, rather than a locked item they can click and be refused. The page still re-checks the wallet
server-side; the sidebar only decides whether the door is drawn.

**D-035 — The active section is the longest matching href.** `/dashboard/earn/payouts` is a prefix-match for
both "Earn review" and "Auto payouts", so a naive `startsWith` highlights two entries at once and tells the
user nothing about where they are. Verified on the real route: only "Auto payouts" lights up.

**D-028 — The 324 accounts are real users, early — the rows stay.** The user's determination: not test
debris, not to be purged. Recorded because the opposite call (chasing a cleanup script) was the tempting one
from the numbers alone, and because it moved the question from "who wrote this data" to "why is nobody using
the product" — which turned out to have a bug for an answer (`KNOWN_ISSUES.md` #14). The remaining gap is
monitoring, not repair.

**D-029 — `/explore` is removed, and the launchpad's *read* side stays where it is genuinely live.**
`app/explore/page.tsx` is deleted along with the nav tab, the footer link and its sitemap entry, and the two
modules it orphaned (`lib/format.ts`, `components/watch-star.tsx`) are gone. But `curve.ts` and `pons.ts` are
**kept**: the 15-minute indexer imports them to scan trades. Deleting them because their product was removed
would have broken a live cron — which is why the removal was decided by the module-reachability scan rather
than by file name. The remaining trade-indexer/watchlist question is `KNOWN_ISSUES.md` #16.

**D-030 — The beg composer lives on `/dashboard/begs`, and every promise of an action must link to where that
action exists.** Not a stylistic choice: `/begs` had a "Write a beg" button pointing at a page with no
composer, which is how a product with hundreds of real accounts produced zero begs. The general rule this
encodes is that a call to action and its implementation are one unit, and a link is not implemented until the
target renders the thing the link promises.

**D-031 — Analytics is env-gated, client-only, and PII-free.** A blank `NEXT_PUBLIC_GA_ID` loads no script
and sends nothing, so the module can be imported on the money path without risk. Events fire only where a
browser really did something (the server cannot know a button was pressed and guessing from request logs
would produce confident, wrong numbers), and they carry a slug, an id or a yes/no — never a wallet address or
a username, because the privacy policy claims that. Page views are sent by hand on route change, since GA4's
automatic one fires once per document load and would report every funnel as a single page.

## New decisions made while setting up this docs folder (2026-10-15)

**D-025 — The sitemap lists static routes, visible profiles, begs and non-draft campaigns; tip receipts
(`/t/<tx>`) are deliberately excluded.** *(Reason: receipts are unbounded user-generated pages — one per
transfer — and they are shared directly, which is how they unfurl, rather than searched for. Listing them
would spend the crawl budget on pages nobody arrives from a search result. Profiles are included, and are
now the bulk of the sitemap, because `/username` is the product — a new user's page must be indexable the day
they claim it.)*

**D-026 — The sitemap reads with the anon (RLS) client, and a failed read degrades instead of failing.**
*(Reason: RLS makes the `is_hidden` policy the guard, so a forgotten filter cannot publish a hidden profile.
And a sitemap that 500s tells a crawler the whole site is broken, while a missing URL costs one delayed crawl
and never states anything untrue — the one place in this codebase where a partial answer beats no answer.)*

**D-027 — Every `web/app` route must stay reachable from the navigation, and deleted routes must be deleted
from the README in the same commit.** *(Reason: `4da54cd` removed the launchpad's routes but left `/explore`'s
copy and the README pointing at `/api/launch`, and that is how a stale document becomes an audit error — this
very audit drafted "Launchpad: `/launch`, `/token/[address]`" as current fact before the filesystem
contradicted it. `KNOWN_ISSUES.md` #13.)*

**D-020 — `/docs` lives in the repo and is read at the start of every session.**
The plan asks for a self-improving setup (§11). Files in the repo beat memory in a chat, because a new
session (or a different model) starts from the code, not from what someone happened to remember.

**D-021 — Drops reuse the campaign deposit + lease payout path; no second money engine.**
The plan describes Drops as a new product, which invites a parallel payout stack. We already have a
verified, idempotent, lease-guarded engine that credits on-chain deposits and pays out automatically.
A second engine would mean a second way to double-pay. Drops get new **tables** (`pools`, `claims`,
`payouts`) and a new claim UI, but they call the **same** distributor primitives. *Reason: two payout
paths is two chances to lose money.*

**D-022 — The chain registry becomes data (`begfi.chains`), not code constants.**
Plan §2: "adding a new EVM chain must be a config change, not a code change." Today `web/lib/chains.ts`
is the only source of truth, so Base is a code edit plus a redeploy. A table with `chain_id`, `name`,
`rpc_url` (+fallbacks), `explorer_url`, `native_symbol`, `block_confirmations`, `gas_wallet_min_balance`,
`is_active`, `logo` moves that to a row. *Reason: the multi-chain work should be paid once, not per chain.*

**D-023 — The audit is written into `ROADMAP.md` (Part A), not a separate file.**
Plan §17.3 says so literally. Keeping it where the plan expects it means a future session following the
plan finds it without hunting.

**D-024 — "Ask first" is enforced by category, not by judgement in the moment.**
`PROJECT_BRAIN.md` §4 lists what an autonomous session may never touch without approval: payout logic,
key handling, fees, the ledger schema, anything that moves funds, and any new custodial path. Categories
are checkable; "does this feel risky?" is not.

## Decisions already made in the code (recorded here so they are not relitigated)

**D-001 — No smart-contract escrow. Pools are funded to backend-controlled wallets and paid out by a
service EOA.** *(Reason: shipping an unaudited escrow contract that holds user funds is worse than
shipping a well-logged service wallet. The ledger and engine are written so escrow can replace them later
without the product changing.)*

**D-002 — `$BEGFI`'s contract address is pinned in `web/lib/config.ts` and is not env-overridable.**
*(Reason: the brief said always this exact CA. An environment still carrying the pre-relaunch address must
not be able to win.)*

**D-003 — Every configured address resolves a bad or missing value to `null`, and the UI must say
"not configured".** *(Reason: never render a control that cannot work — a send button for a token with no
address is a lie.)*

**D-004 — Server secrets carry no `NEXT_PUBLIC_` prefix; `.env` is refused by the pre-commit hook by both
name and content.** *(Reason: the prefix is what inlines a value into client JS. Name and content checks
mean a key cannot be committed even by a careless `git add -A`.)*

**D-005 — Site copy is English-only.** *(Reason: the product is aimed at a global crypto audience; mixed
languages in a payments UI read as unfinished.)*

**D-006 — Robinhood Chain (4663) only, for now.** *(Reason: one chain that works beats three that half-work.
Multi-chain is Phase 1/6, tracked in `ROADMAP.md`.)*

**D-007 — The indexer is driven by a GitHub Actions cron every 15 minutes, not by Vercel cron.**
*(Reason: Vercel Hobby allows one cron per day. The workflow calls the same endpoint with the same bearer
token, and the site's copy states the real cadence rather than promising real-time.)*

**D-008 — The `begfi` schema is separate from `public`, and must be listed under Settings → API → Exposed
schemas.** *(Reason: the project is shared with cosmic-oracle-charts. Without the expose step PostgREST
answers 404 no matter how RLS is written — documented in `web/.env.example` because it costs an afternoon
to rediscover.)*

**D-009 — One payout ledger for BegFi's own pool and every campaign (migration 0022).**
*(Reason: one payout truth. The per-cycle uniqueness was rescoped to per-campaign, so a wallet can be paid
by BegFi's pool and two campaigns on the same day — but never twice by the same one.)*

**D-010 — Uniqueness is enforced by unique indexes, not by application checks.**
*(Reason: `campaign_submissions_wallet_day_idx`, the post-URL index, and the per-cycle payout index are the
authority. Application code racing itself is otherwise a matter of luck.)*

**D-011 — A submitted-but-unconfirmed transaction is presumed dropped after 10 minutes and re-sent; a
lease older than 10 minutes is presumed dead.** *(Reason: a crashed function must not strand money forever,
and the `payout_tx` + chain check keeps a re-send from double-paying.)*

**D-012 — Attempts cap at 10, then a payout stays visibly `failed`.** *(Reason: burning gas forever on a
send that will never succeed is worse than a red row an admin can read.)*

**D-013 — The sweep budget inside a Vercel function is 45s of the 60s limit, and 40 payouts per run.**
*(Reason: a timeout mid-run is a reconciliation problem; stopping early is a normal outcome.)*

**D-014 — Admin actions are gated by an allowlisted wallet (`GENESIS_LAUNCHER_WALLET`), not by a separate
admin login.** *(Reason: one identity system, no second credential to leak. Revisit for the Phase 1 admin
panel, where this becomes an actual role.)*

**D-015 — Launch fees are read from the launch contracts' own fee events, not computed by us.**
*(Reason: if our arithmetic and the chain disagree, the chain is right.)*

**D-016 — Genesis mode defaults live in code as well as in the environment.** *(Reason: a build cache that
predates an env var must not silently hide the site's own community channels or its genesis wallet.)*

**D-017 — The tip receipt (`/t/[tx]`) is a page, not a toast.** *(Reason: the confirmation is the social
artifact — the thing worth posting — and a posted link with a real OG card is distribution.)*

**D-018 — Drops/claims must be gated per **X account** as well as per wallet (plan §3.4).** Currently the
wallet side is airtight and the X side is not. Recorded here because it will be tempting to ship Drops with
wallet-only uniqueness; a fresh wallet per claim is free.

**D-019 — Unclaimed pool funds return to the funder.** The plan (§4.3) leaves this open. Decided: the
remainder is refundable to the funding wallet, and the drop page shows the deadline. *(Reason: money that
cannot get stranded is money people will fund.)*
