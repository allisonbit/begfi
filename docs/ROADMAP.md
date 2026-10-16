# ROADMAP.md

Phases from the master plan, plus **the audit the plan asks for in §17.3** and **my own improvements
(§17.4)**. Status is written from the code, not from optimism.

---

## PART A — AUDIT: the live site vs the plan

Legend: ✅ done · 🟡 partial · ❌ missing · ⚠️ risk

| Plan section | Requirement | Status | Reality |
|---|---|---|---|
| §0–1 | Four products under one identity | 🟡 | Beg pages + Campaigns + **Pay Links** live. Drops ❌ — the only product with no schema at all. |
| §2 | Multi-chain: Ethereum, Base, Robinhood | ❌ | Robinhood only, hardcoded in `web/lib/chains.ts`. |
| §2 | `chains` config as a **DB row**, not code | ❌ | Code constants. Adding Base today = code change + redeploy. |
| §2 | ERC-20 autodiscovery + suspicious-token warnings | 🟡 | `config.ts` validates addresses; token metadata read (`erc20.ts`, `token-stats.ts`). No fee-on-transfer / honeypot screen. |
| §3.2 | No escrow, backend wallets | ✅ | Implemented and documented in `earn-distributor.ts` header, in detail. |
| §3.2 | **One deposit address per pool** | ❌ ⚠️ | Every campaign deposits to **one** distributor address. Per-campaign attribution comes from the indexer reading the transfer, not from address separation. |
| §3.2 | Keys in a KMS / encrypted store | 🟡 | Single server secret in the Vercel env, never in logs or DB. No KMS, no rotation plan. |
| §3.2 | Hot/cold wallet split, sweep to cold | ❌ | One hot EOA holds all distributable funds. |
| §3.2 | Gas wallet per chain, low-gas alerts | 🟡 | Native-gas floor blocks a run rather than failing a tx. No alerting. |
| §3.2 | Ledger first, balances computed | 🟡 | `earn_payouts` + `campaign_deposits` are a real money trail with idempotency keys. No generic `ledger` table; no deposit/payout/fee/refund kinds. |
| §3.2 | Confirmations before credit | ✅ | Deposits credited from confirmed transfers by the indexer. |
| §3.2 | Queue, retries, dead-letter | 🟡 | In-loop retries, attempt cap, failures stay visible. No separate queue/worker; bounded by the 60s function limit (45s budget). |
| §3.2 | Hourly reconciliation vs on-chain | ✅ | `/api/cron/reconcile`, hourly via `.github/workflows/reconcile.yml`; one row per token in `begfi.reconciliation_runs`, rendered first on the admin payouts console. Per TOKEN not per pool (one deposit address), and it alarms only on a shortfall — stated in the code and `KNOWN_ISSUES.md` #3. |
| §3.2 | Kill switch (global / chain / pool) | 🟡 | **Global** switch live (`begfi.payout_controls`, read at the top of every money path, one lever on the admin console, fails closed). Per-pool exists as campaign `status`; per-CHAIN does not — it becomes meaningful with a second chain. |
| §3.3 | Wallet sign-in + X link + username | ✅ | SIWE-style sign-in, X verify route, username claims with reserved names. |
| §3.3 | Project accounts with profile + verified badge | 🟡 | Project **campaigns** exist; no project entity/profile/badge. |
| §3.4 | One claim per wallet **and per X account** | 🟡 ✅ | Per-wallet uniqueness is enforced by unique indexes (wallet+cycle, wallet+campaign+day, post URL). Per-**X-account** uniqueness is weaker. |
| §3.4 | Captcha / bot protection | ❌ | Device limits (`0014`) + DB rate limiting (`rate_limits`, `check_rate_limit`). No captcha. |
| §3.5 | Fees configurable, shown upfront | 🟡 | Token-launch fees are tracked from on-chain events (`fees-history.ts`) and surfaced in the footer. No platform-fee setting for pools, and the launchpad that earned those fees is gone. |
| §4 | Drops in full | ❌ | Nothing exists. |
| §5 | Pay links, request links, receipts, notifications | ✅ | Pay page + QR + receipt page + notifications, plus fixed-amount request links (`/pay/<id>`, memo, QR, share text, OG card) settled from confirmed on-chain transfers. Missing: "pay with anything" conversion estimate. |
| §6 | Campaigns, both types, auto payout | ✅ | The most built-out part of the platform. |
| §6.4 | Pluggable verifier | 🟡 | Verification exists (X post read, auto + pending queue). Not a swappable module; depends on a fragile post-read path. |
| §6.6 | Per-campaign leaderboard | ✅ | Campaign leaderboards + a global one. |
| §7 | Beg pages upgraded (themes, goals, supporter wall) | 🟡 | Goals + progress + socials ✅. Themes ≠ done; supporter wall is the leaderboard. |
| §8 | Full public leaderboards + live feed | ✅ | Tabs, windows, ranks, levels, streaks, battles, activity feed. |
| §9 | Sidebar shell + mobile tab bar | ❌ | Nav is a top bar (`site-nav`) + `dashboard-nav` tabs. Not the plan's shell. |
| §9.3 | Empty / loading / error states everywhere | 🟡 | Good on Earn/leaderboard. Not audited page-by-page. |
| §10 | Schema as specified | 🟡 | Different but coherent: `profiles`, `campaigns`, `campaign_deposits`, `campaign_submissions`, `earn_payouts`, `earn_claims`, `earn_settings`, and since 2026-10-16 `pay_links`, `payout_controls`, `reconciliation_runs`. No generic `pools`, `ledger`, `payments`, `admin_settings` or `audit_log`. |
| §12 | Admin panel | 🟡 | Still an allowlisted wallet, but the payout console now carries the kill switch, the reconciliation history, the failed-payout queue and the ledger with explorer links. No audit log, no wallet/gas monitor, no moderation queue. `KNOWN_ISSUES.md` #11. |
| §13 | TOS, privacy, refund policy, audit log | 🟡 | `/terms` + `/privacy` exist. No refund/unclaimed policy text, no audit log table. |
| §14 | SEO: sitemap, robots, per-page OG | 🟡 ⚠️ | Strong OG cards already (`opengraph-image` on home, `/beg`, `/t/[tx]`, username). **No `sitemap.ts`, no `robots.ts`, no `manifest`.** |
| §14 | Analytics (GA4, Search Console, events) | ❌ | No analytics of any kind in the code. |
| §14 | Google Play readiness | ❌ | No manifest / PWA. Web only. |
| §15 | Docs brain files | ✅ | This folder. |
| — | Launchpad (was live, unplanned here) | ⚠️ | **Removed** in `4da54cd`, but its read paths remain and `README.md` still advertises `/launch` and `/token/[address]`. `KNOWN_ISSUES.md` #13. |

### The one-sentence audit
**The campaign money engine is ahead of the plan; everything around it — drops, pay links, multi-chain,
the app shell, admin, SEO/analytics — is behind it.** The plan reads as if the engine is the hard part.
It was built first, so the hard part is done and the remaining work is breadth, not depth.

---

## PART B — PHASES

### Phase 0 — Foundations (start here)
- [x] `/docs` brain files (this folder).
- [x] Audit (Part A).
- [x] **SEO floor: `app/sitemap.ts` + `app/robots.ts` + `app/manifest.ts`.** Shipped 2026-10-15 and verified
      live (331 URLs, HTTP 200 ×3, build exit 0). What remains is submitting the sitemap in Search Console —
      which needs an account, not code.
- [x] Analytics: `lib/analytics.ts` + `components/analytics.tsx` — env-gated (blank ID = nothing loads),
      typed event union including the plan's `drop_*` names, no PII. Wired: `beg_posted`, `username_claimed`,
      `campaign_created`, `campaign_joined`. Verified configured and unconfigured. Remaining: create the GA4
      property and set the ID, then submit the sitemap in Search Console.
- [ ] **Decide what to do about the empty database (`KNOWN_ISSUES.md` #14) before inviting crawlers to it.**
      The sitemap now publishes 324 profiles, 262 of them created in a single day with nothing behind them.
      Either separate test data from production, or add a burst guard — publishing them as-is is a choice.
- [ ] Design-system pass: freeze the tokens (colour, spacing, type scale) into documented CSS variables.
- [x] App shell: `components/dashboard-shell.tsx` — a sticky sidebar from `md` up (grouped sections, an Admin
      group only for an admin wallet, a "Write a beg" CTA, and the public-page link) plus the phone tab row below
      `md`; `dashboard-tabs.tsx` and the dead `dashboard-nav.tsx` deleted. Verified on the real routes at both
      breakpoints, and `KNOWN_ISSUES.md`-style dead-link sweep passes.
      **Deliberately not in the sidebar yet:** Giveaways, Pay Links, Earnings/Wallet, Projects and Help — the
      plan's §9.2 menu. Those products do not exist, and a menu entry with nothing behind it is the exact
      failure `DECISIONS.md` D-030 records. The rail grows when the products do (D-033).
- [ ] Page-by-page empty / loading / error state audit. **Start with the funnel that was broken:** every
      call to action must link to a page that renders the thing it promises (`DECISIONS.md` D-030).
- [x] **Restore the product's core action** (found during the audit, not on the plan): `BegComposer` had no
      importer — the only caller of `/api/beg` was unreachable — so no one could write a beg at all. Now
      mounted on `/dashboard/begs`, with `/begs` linking there. This is the answer to the empty database
      (`KNOWN_ISSUES.md` #14).

### Phase 1 — Shared engine hardening (⚠️ ASK FIRST — moves money)
- [x] **Hourly reconciliation job: ledger totals vs live on-chain balances → pause payouts on drift.**
      Shipped 2026-10-16: `/api/cron/reconcile` + `.github/workflows/reconcile.yml`, results in
      `begfi.reconciliation_runs`, drift pauses payouts before it alerts. Per-token because there is one
      deposit address; per-pool arrives with per-pool addresses, below.
- [x] **Global kill switch, one admin lever.** Shipped 2026-10-16: `begfi.payout_controls` + `/api/admin/payouts`
      + the first card on `/dashboard/earn/payouts`. Fails closed. Per-chain pause still open.
- [ ] `begfi.chains` table + read path so a new EVM chain is a row, not a redeploy.
- [ ] **One deposit address per pool** — the root cause behind `KNOWN_ISSUES.md` #2. Guarded meanwhile by
      `campaigns_active_token_idx` and the `$BEGFI` refusal in `createCampaign` (D-043), which make the
      collision unreachable without making attribution exact.
- [ ] Generic `begfi.ledger` (deposit / payout / fee / refund) with `pool_id`, `chain_id`, token, amount, tx.
- [ ] Fee-on-transfer detection by balance delta; credit the pool with what actually arrived.
- [ ] Hot/cold split with a sweep-to-cold action. **Low-gas alerting shipped 2026-10-16** — the reconcile
      job compares the native balance to the sweep's own floor and belles when it is under (D-050).
- [x] **Audit log for admin and money actions** (plan §13; the last Phase 1 item that needed no new custody).
      `begfi.audit_log` (migration 0028), written by the switch, the sweeps and the reconciliation, read by the
      console and published in short on `/transparency`. Open: `/api/earn/review` and the campaign verifier do
      not write rows yet (`KNOWN_ISSUES.md` #11).
- [x] **The transparency page** (§17.4 improvement #7). Live at `/transparency`: balance, all-time paid, owed,
      switch state, reconciliation per token, recent actions — in the footer and the sitemap.

### Phase 2 — Drops (giveaways)
- [ ] Schema: `pools`, `claims` (unique per pool per wallet **and** per X account), `payouts`.
- [ ] Create flow: chain → token → amount → rules → fee/gas review → fund → link + QR + X post.
- [ ] Claim page: mobile-first, live pool bar, live claim feed, auto-verified requirements, tx + receipt.
- [ ] Creator dashboard: claims, remaining, claimers, pause/resume/end/top-up/extend, unclaimed refund.
- [ ] Modes: equal split / fixed / percentage / mystery range / first-N / timed.
- [ ] **Reuse the campaign deposit+lease payout path — do not build a second money engine.**

### Phase 3 — Pay links
- [x] Fixed-amount request links `/pay/<id>` (amount, memo, token) + QR + share text + per-link OG card.
      Shipped 2026-10-16 (migration 0024, non-custodial: the row is an ask, settlement is derived). Open-ended
      links work too — leave the amount blank.
- [x] On-chain detection and confirmation, derived from the indexer's confirmed transfers, with the total
      received shown to anyone holding the link. **The payment bell shipped 2026-10-16**: the indexer settles
      the request and belles its owner from the same transfer it just indexed (D-048), and the settlement is
      stored on the row, so "paid" no longer depends on a recent-transfer window (`KNOWN_ISSUES.md` #17).
      OPEN: the bell inherits the indexer's lag (`#19`), so "the moment their request is paid" is really
      "within one indexer window of being paid".
- [ ] "Pay with anything" conversion estimate on the pay page.
- [x] Store the settling transfer at index time so "paid" stops depending on a bounded recent window
      (`KNOWN_ISSUES.md` #17). Shipped 2026-10-16 (migration 0027 + `settlePayLinks`).

### Phase 4 — Campaigns depth
- [ ] Pluggable verifier module (official API ⇄ third-party ⇄ manual queue) with costs in `DECISIONS.md`.
- [ ] Project entity: profile, logo, banner, verified badge, own analytics page.
- [ ] Per-X-account uniqueness alongside per-wallet.

### Phase 5 — Growth
- [ ] Full leaderboard tabs (Top Givers, Top Campaigns, Trending) from Part A's §8 gaps.
- [ ] Badges, streaks, daily-return hooks.
- [ ] SEO/GEO polish, Play Store listing, `DISTRIBUTION.md` execution.

### Phase 6 — Platform
- [ ] Public API, embeddable pay button, webhooks.
- [ ] More chains; possibly audited smart-contract escrow once the ledger makes the swap safe.

---

## PART C — IMPROVEMENTS I AM ADDING (§17.4)

Beyond the plan, in the order I would build them. Each is here because it removes a specific reason a normal
person fails at crypto.

1. **Paste-any-contract safety verdict.** Before anyone funds a pool or pays with a token: read verified
   source, check mint authority, blacklist/owner powers, transfer tax, and simulate a buy→sell. Show a plain
   red/amber/green line — *"this token takes 5% on transfer, pools funded with it will short-change claimers."*
   Protects funders **and** claimers, and it is the single most credible trust feature BegFi can ship.
2. **Sponsored first transaction (gas paymaster on the pay path).** The #1 onboarding killer is "you need
   ETH for gas". A newcomer with zero native token should still be able to *pay* someone. Offer it on the
   pay/claim path only, with a per-day cap.
3. **`@username` as an address, everywhere.** A payer should never see a `0x`. Resolve `@name` in the send
   panel, in links (`begfi.io/pay/@name`), and in share text.
4. **Dollar-denominated pools.** Fund a giveaway as "$50 of whatever I approve" and let the token amount be
   computed at funding time. "2,000,000 tokens" means nothing; "$50" means everything.
5. **Receipts as first-class artifacts for campaigns too.** `/t/[tx]` already proves a tip; give every campaign
   payout the same shareable receipt. Trust in a paid-campaign platform is built from public proof, and this
   is nearly free because the pages already exist.
6. **Unclaimed-funds auto-refund with a visible countdown.** "If nobody claims the rest by 20 Oct, the
   remainder returns to your wallet." Money that cannot get stranded is money people will risk.
7. **A public transparency page.** Payouts sent, fees collected, pools funded, reconciliation status, last
   successful sweep. BegFi holds user funds; the only defensible posture is showing the books.
8. **Referral rewards with verified outcomes.** Pay the referrer only when the referred person actually earns
   or claims — bots cannot farm it because the payout event itself is the trigger.
9. **Embedded / social-login wallet for claiming.** A giveaway winner in a Telegram group will not install
   MetaMask. Let them claim to an embedded wallet and withdraw later, or the whole funnel leaks at the door.
10. **One-tap "pay me" share text with the amount baked in.** `begfi.io/you — send me $5` as a copyable line
    for any chat app, not just X. The messenger matters more than the chain.
11. **Per-page OG cards for every shareable route, systematic.** Drops, pay requests, campaigns, receipts.
    The card *is* the distribution channel; one missing OG route costs more than a feature.
12. **PWA install (manifest + offline shell) before Google Play.** Turns the web app into an icon on the home
    screen for free, and it is the honest prerequisite for a store listing.
13. **Rate-limit and spend guardrails in plain language on the funding screen.** "Max 40 payouts/minute ·
    2% platform fee · refunds to you after 7 days" — the number that lets a cautious funder click Fund.
14. **A "how it works" page with real screenshots and one honest paragraph about custody.** The plan's §13
    honesty note is currently only in code comments; a project deciding whether to send 4M tokens needs to
    read it before they fund, not after.

---

## PART D — WHAT I WOULD DO NEXT, IN ONE LINE

Phase 0's SEO floor + analytics (safe, no money touched), then the transparency page and the token-safety
verdict as the two trust features, then Phase 1 hardening with your approval, then Drops.

### Updated 2026-10-16

Phase 0's floor is done, **Pay Links shipped** (Phase 3, non-custodial, no new money handling), and the two
Phase 1 money-safety items that did not require new custody were built with the user's explicit approval: the
global kill switch and hourly reconciliation. What is left of Phase 1 now needs decisions rather than code —
per-pool deposit addresses (attribution), hot/cold split (key risk), and balance-delta crediting (transfer
taxes).

**A blocker that is not code, and is more urgent than anything above.** The first reconciliation run found the
distributor wallet holding **0 $BEGFI against 210,000 $BEGFI promised** to 21 approved submissions (confirmed
independently over a second RPC), and paused payouts itself. Nothing else on this roadmap matters until that
wallet is funded: `KNOWN_ISSUES.md` #3/#4, and the resume lever is on `/dashboard/earn/payouts`. The same run
also proved the monitor works on its first try, which is the one piece of good news in it.

**Two silent-zero bugs fixed on the way**, both found by asserting on a number rather than by reading code:
`app_config.beg_token_address` was never set after $BEGFI launched, so every beg progress bar and every profile
total read 0 across the whole product; and `profile_stats` being `security_invoker` meant public profiles showed
0 to every signed-out visitor while the leaderboard showed the truth. `KNOWN_ISSUES.md` #18.

Two things I would build next without touching the money path: **bell the pay-link owner when their link is
paid** (the transfer is already indexed; the notification kind is the only missing piece), and the **public
transparency page**, which now has real data to show — `reconciliation_runs` is exactly the "reconciliation
status" improvement #7 asks to publish, and right now that page would say out loud what the wallet already
knows.
