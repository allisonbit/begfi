# DROPS.md — the giveaway product, and the plan it was built from

Drops is the fourth product, and the first one built **on top of** the payout engine instead of beside it.
This file is two things: the implementation plan it was built from, and the record of what is actually in
the code — including the two real bugs the build surfaced, because both of them were pre-existing and both
would have cost money.

Read `PROJECT_BRAIN.md` first. `DECISIONS.md` carries the numbered decisions (D-054…D-062 for this work) and
`KNOWN_ISSUES.md` #20–#23 carry the limitations that are still open.

---

## 1. The product

A **drop** is a pot of one token, a fixed prize per claim, and a cap on how many people can take it.

> Someone funds a pot, sets the prize, shares `/drop/<id>`. The first N people to open it sign in, claim, and
> each receives that prize in their own wallet — automatically, within seconds of claiming.

The audience is different from every other product here, and that is the point: a drop is the one screen a
person with **no wallet and no account** can arrive at from a group chat, and leave with both.

## 2. The reuse map — no second money engine

Deliberate and complete (D-021 said this would be the shape; this is that decision implemented):

| Engine part | Shared? | How Drops uses it |
|---|---|---|
| Distributor wallet + `DISTRIBUTOR_PRIVATE_KEY` | **shared, unchanged** | Prizes leave the same EOA that pays BegFi's pool and every campaign. |
| Ledger `begfi.earn_payouts` | **shared, one new column** | A drop payout is a ledger row with `drop_id` set. `lib/earn-distributor.ts`'s "one ledger, one console, one audit trail" now covers three pools. |
| Lease atom (conditional UPDATE) | **shared pattern, new table** | `earn_submissions.payout_lease` → campaigns; `campaign_submissions.payout_lease` → campaigns; **`drop_claims.payout_lease` → drops**. Same 10-minute stale window, same "loser matches nothing" property. |
| Gas floor, `MAX_ATTEMPTS = 10`, confirm-then-record, in-flight reconciler, time budgets | **shared shape** | `lib/drop-distributor.ts` reads the same native balance, files the tx hash before waiting, settles a late receipt on the next run, and marks a row `sent` only after the receipt says success. |
| Global kill switch (`begfi.payout_controls`) | **shared, unchanged** | Read at the top of the drop sweep and on the claim path. A paused switch refuses a claim rather than banking a promise. |
| `payoutWalletReady(token, amount)` | **shared, new helper** | One implementation of "can the wallet pay this?" for all three products (`lib/payout-controls.ts`); the earn submit route now calls it too. |
| The bell (`lib/notify.ts`) | **shared** | `drop_reward` (the claimer's prize), `drop_payout` (the owner's daily summary), `drop_funded` (a credited deposit). |
| Reconciliation (`/api/cron/reconcile`) | **shared, extended** | Drop pots join the per-token obligation sum, so the job that pauses payouts on a shortfall now sees prize money too. |

What is **new**, and only because the two products' lifecycles differ:

| New thing | Why it has to exist |
|---|---|
| `begfi.drops` | The pot: token, decimals (read from the contract), prize, cap, status, optional deadline. |
| `begfi.drop_fundings` | **Attribution.** A campaign is credited by token alone; a drop cannot be, because a second product now shares the same receiving wallet. An intent names the funder's own wallet, the drop and the amount, and the scan credits only transfers that match it. |
| `begfi.drop_deposits` | The money trail, idempotent on `(tx_hash, log_index)` — the same shape as `campaign_deposits`. |
| `begfi.drop_claims` | Who took a prize, with the prize **snapshotted** at claim time, plus the lease and `payout_tx` bookkeeping. |
| `begfi.pool_tokens` | One payout token = one live pool, **across both products**, enforced by a trigger. 0025 could do this with a partial unique index inside `campaigns`; two tables cannot share an index, so the lease became a table of its own. |
| A drop sweep (`sweepDropPayouts`) | Campaigns pay a daily budget to a set of posters; a drop pays ONE whole prize per claim, once, ever. The budget concept does not transfer, so the sweep is driven by unpaid claims. |

## 3. The lifecycle, end to end

**Create** — `/dashboard/drops` → `POST /api/drop/create` → `createDrop`
- owner from the session, never from the body;
- `token_decimals` **read from the contract**, and a failed read *refuses* the drop (campaigns fall back to
  18; a prize cannot, because the prize is the number every claimer is promised);
- `$BEGFI` refused as a prize token, for the same reason campaigns refuse it (the site funds its own pool to
  the same address, so the deposit could not be told apart);
- a token already held by another live pool is refused **in a sentence**, and the database refuses it again
  with a `23505` if two creates race (the trigger is the authority, the read is the courtesy);
- the prize, the token and the cap are then **immutable**: a claim is a promise made at a moment and the row
  carries the number it was made for. A different prize is a different drop.

**Fund** — the drop page → `POST /api/drop/fund` (`create`, then `check`)
1. the funder registers an intent (their own wallet, enforced by RLS, one open intent per
   `(funder, token)`);
2. they send the tokens from **that** wallet to the published payout address — the UI refuses to send from a
   different connected wallet, because that transfer could not be credited to this pot;
3. "I've sent it — check" scans a recent block window with the **same matcher the indexer uses**, so a drop
   becomes claimable in seconds instead of waiting for the next indexer run;
4. a credited transfer writes one `drop_deposits` row and bells the pot's owner.

**Claim** — `/drop/<id>` → `POST /api/drop/claim` → `claimDrop`. The order of the checks is the design:
payout gate → window → **available** pot (`deposits − confirmed payouts − prizes already promised`) → cap →
"this wallet, and this VERIFIED X account, have not claimed" → **can the wallet pay it right now**. Both
"already claimed" rules are unique indexes as well as reads, so two racing claims cannot both win.

**Pay** — the claim fires `sweepDropPayouts("claim")` after the response, so a prize lands in seconds. The
same sweep is also fired by a credited deposit and by the daily cron, and it takes the **lease** first, so
three triggers cannot pay one claim twice.

**Prove** — the drop page shows the pot's arithmetic (deposited / paid / promised / claimable now) and the
winners with their transactions; `/dashboard/drops` shows the owner the same figures, every claim with its
state, and every funding intent with its state.

## 4. Money rules, stated as rules

1. **A prize is paid in full or refused.** Nothing partial, ever — the claim row's amount is the promise, and
   a pot that cannot cover one more prize stops the sweep and refuses the next claimer.
2. **Promised ≠ paid ≠ available.** `available = deposited − paid − promised`; the claim gate is the only
   thing standing between ten simultaneous claimers and ten promises, and it uses `available`.
3. **Money that left is counted as gone.** `paid` is the settled ledger rows *plus* any claim carrying a
   `payout_tx` that no ledger row accounts for — the state a crash between the two bookkeeping writes leaves
   behind. One function, `readDropPot`, is read by the page, the claim gate and the sweep, so three code
   paths cannot disagree about what is in the pot.
4. **One prize per wallet, one per verified X account, per drop.** Both are unique indexes; the X rule is
   partial on `x_handle is not null`, because an unverified handle is a string anyone can type and two
   anonymous claimers must both be payable.
5. **No device fingerprinting** (D-055). The earn rewrite removed it deliberately — a family phone or a
   campus NAT told honest people "come back tomorrow" for a sin someone else committed — and reviving it for
   giveaways would reintroduce that bug in a louder place.
6. **Pausing stops new claims, never a promise already made.** The sweep is driven by unpaid claims and pays
   them whatever the drop's status is, including `ended`.

## 5. Wiring

| Trigger | What it does |
|---|---|
| `/api/cron/indexer` (15 min) | `creditDropDeposits(...)` over the scanned window, then (rate-limited) `sweepDropPayouts("drop-funds-arrival")`. |
| `POST /api/drop/claim` | The claim, then `after(() => sweepDropPayouts("claim"))`. |
| `/api/cron/earn-payouts` (daily) | Third slice of the same function: earn 22s, campaigns 22s, drops 12s — one schedule, three budgets, no third cron entry (Vercel Hobby allows two, and a third schedule would only be a second way to ask the same question). |
| `/api/cron/reconcile` (hourly) | Drop pots join the per-token obligation sum (**drops**, campaigns, and BegFi's own promised rewards), against the distributor's live balance. |
| `POST /api/drop/fund` (`check`) | On-demand crediting for a funder who does not want to wait for the indexer. |

Routes: `app/api/drop/{create,update,fund,claim}/route.ts`. UI: `app/drops/page.tsx`,
`app/drop/[id]/page.tsx` (+ `generateMetadata`), `app/dashboard/drops/page.tsx`,
`components/drop-{card,claim-box,fund-box,form,owner-controls}.tsx`. Nav: a fifth dock tab, the dashboard's
"Drops" section, the footer column and the sitemap (live and paused drops; ended ones are history, like ended
campaigns).

## 6. What is NOT built (and what it would take)

1. **Per-pool deposit addresses and refunds.** Every pool still funds ONE shared address, so attribution is
   an inference (now an intent-matched one) rather than a separation, and — the part people will ask about —
   **an unclaimed remainder stays in the payout wallet**. There is no automated return path, and the site now
   says so on the dashboard, in the footer (which used to imply refunds unconditionally) and here.
   `DECISIONS.md` D-019 decided the remainder should be refundable; **building it needs per-pool addresses or
   a signed refund path**, i.e. it is the Phase 1 custody work, not a UI change. `KNOWN_ISSUES.md` #21.
2. **Sybil resistance beyond identity.** A drop can be farmed by wallets that are one person with no verified
   X account. The honest ceiling is what the site can check: wallet and verified X. Captcha, funding-graph
   clustering and a suspicious-activity queue are the plan's §3.4 work. `KNOWN_ISSUES.md` #22.
3. **A transfer with no intent is credited nowhere.** That is the design (it cannot be attributed safely), and
   the recovery is the funder registering the intent for the transfer they already sent — the scan matches
   recent matches too, so it is recoverable, but nothing tells them automatically. A "funds arrived that match
   no pot" alert is the fix. `KNOWN_ISSUES.md` #20.
4. **The pot's freshness depends on the indexer** unless the funder presses "check". `KNOWN_ISSUES.md` #19
   (the indexer's block lag) is the ceiling on how live a credit is.
5. **No per-drop OG image** — the page has metadata (title, description) but no generated card, so a shared
   link unfurls as text. `/beg/[id]` and `/earn/[slug]` both have cards; this is a known gap, not a decision.
6. **No admin console view of drops** as their own section. The payout ledger now labels each row's pool and
   renders it in the row's own token, so drop rows are visible and correct there; a per-drop admin view is a
   nice-to-have.
7. **Not on `/transparency` as a product line.** Drop obligations *are* inside the reconciliation per-token
   figures, so a shortfall caused by a pot shows up and pauses payouts; there is no "drops: N live, X
   promised" line.

## 7. Verification (what was actually run)

- **Migrations**: `node scripts/migrate.js` twice, clean both times (every statement guarded).
- **Database invariants** — 24 assertions against the live schema, in a temporary harness (nothing added to
  the repo), each with the expected refusal:
  - the token lease: a campaign holds a token → a drop on it is refused (`23505`, by the trigger) → ending the
    campaign frees it → a second drop is refused → deleting a pool **releases** the lease;
  - the ledger: a drop payout row writes, the same wallet cannot be paid twice by one drop, two drops *can*
    pay one wallet on the same cycle;
  - RLS: a signed-in user creates their own drop; a claim with a client-chosen amount is refused; a claim for
    somebody else's wallet is refused; own wallet + the drop's own prize is accepted; the wallet index and the
    **partial X-handle index** both refuse the second attempt while a second wallet with NO handle is allowed;
    an intent over somebody else's wallet is refused; a second open intent for one `(funder, token)` is
    refused; another pot's pending intent is invisible (0 rows) to this caller.
- **Typecheck** `tsc --noEmit` clean; **`next build`** exit 0, with `/drops`, `/drop/[id]`, `/dashboard/drops`
  and the four API routes in the route table.
- **Live pages** through the running dev server: `/drops` 200 (with the honest empty state), `/drop/<id>` 200
  rendering a seeded pot — "200 PEPE per claim, 9 prizes left, 1/10 claimed", the ledger figures, the winners
  row with its transaction link and the share buttons — and `/sitemap.xml` containing `/drops`.
- **API refusals**: all four routes answer `401` with their own sentence when signed out, rather than a generic
  error.
- Fixtures used for the page check were created and then **removed**; no test rows remain.

### Two bugs this build found (both pre-existing, both money)

1. **`earn_payouts` still carried 0021's `unique (wallet_address, cycle_date)`.** 0022 meant to replace it and
   dropped a *guessed* constraint name that never matched, so for a week the ledger capped every wallet at
   **one payout a day across every product**: a wallet paid by BegFi's pool could not be paid by a campaign
   the same day (the campaign sweep read the `23505` as "already served this cycle" and skipped it silently).
   Drops would have made it worse — and it was the drop payout path that surfaced it. 0029 now drops it by its
   real name and creates the three-pool index; the disk-qualified `drop index` also had to be fixed (the
   migration runner does not run with `begfi` on the search path).
2. **A crash between "claim paid" and "ledger row written" made the pot read too full.** `paid` summed only
   the ledger, so a claim whose transfer confirmed but whose ledger write failed left the pot reporting money
   that had already left the wallet — and the claim gate would spend it. `readDropPot` now counts a paid claim
   with no ledger row as money gone; verified by seeding exactly that state and watching the page change from
   "Paid out: 0, Claimable: 2,000" to "Paid out: 200, Claimable: 1,800".

## 8. What is next, in order

1. **Per-pool deposit addresses** (Phase 1, `ROADMAP.md` §3.2) — closes attribution, refunds (#21) and the
   shared-address assumptions in #2 for all three products at once.
2. **Refunds for an unspent pot** once addresses are separated; until then the dashboard's copy is the honest
   position and D-019 stays open.
3. **A sybil pass** (#22): captcha on claim, clustering by funding source, an admin queue for suspicious drops.
4. **Drop branding**: a per-drop OG card, and a `Drops` line on `/transparency`.
5. **Richer drop shapes** the schema already allows but nothing builds: allowlist/whitelist claims, "first
   claimer takes all", recurring drops. Add them as explicit modes, never as a mutated prize.
