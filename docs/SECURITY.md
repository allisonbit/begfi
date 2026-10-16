# SECURITY.md

BegFi holds user funds in backend-controlled wallets. **Security is the whole game.** This file is the
operational truth of how keys and money are handled today, what is weak, and what to do when something
goes wrong.

---

## 1. Wallet architecture (today)

```
funder's wallet ──(ERC-20 transfer)──▶ DISTRIBUTOR ADDRESS  (one EOA, all pools)
                                              │
                                              │  sweep signs one transfer per owed wallet
                                              ▼
                                      earner / claimer wallet
```

- **One receiving/ paying EOA.** Its private key is the server secret `DISTRIBUTOR_PRIVATE_KEY`, used by
  `web/lib/earn-distributor.ts` and `web/lib/campaign-distributor.ts`.
- **No escrow contract.** The plan's §3.2 model is implemented as written: backend-held funds, automatic
  payouts, no smart-contract custody.
- **What holds the funds is therefore what holds the key.** The only thing standing between a leaked secret
  and total loss is the secret staying secret. `KNOWN_ISSUES.md` #1.

## 2. Key handling rules (non-negotiable)

1. **Server only.** No secret may carry the `NEXT_PUBLIC_` prefix — that prefix is exactly what inlines a
   value into the browser bundle. `DISTRIBUTOR_PRIVATE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are never
   prefixed.
2. **Never in the database.** Keys live in the deployment environment (Vercel project env). No table column,
   no `app_config` row, no RLS-protected "secrets" table holds a key.
3. **Never logged.** No key is ever interpolated into a log line, a notification body, an error message, or
   a Sentry-style payload. Only the derived **address** is ever printed — it is public by nature.
4. **Never in git.** `.env` is refused by the pre-commit hook **by name and by content**, so a key cannot be
   committed even by a careless `git add -A`.
5. **Least privilege.** The service role client (`web/lib/supabase/admin.ts`, `server-only`) is used by the
   indexer, the sign-in routes and the sweeps — never imported from a client component.
6. **Rotation.** Rotating the distributor key requires deriving the new address, moving the balance, updating
   the secret, and confirming the old address holds nothing. There is no automated rotation — see §5.

## 3. Application security (what is in place)

- **Signature-verified wallet sign-in.** SIWE-style nonce → signature → session cookie
  (`web/lib/wallet-auth.ts`, `/api/auth/wallet/{nonce,verify}`).
- **RLS on every table.** Public read where a page needs it; writes restricted to the owner
  (`campaigns_write_own`) or to `service_role` only (`campaign_deposits` has **no** insert policy: a deposit
  is written only by the indexer, which is what stops a user claiming a deposit they never made).
- **Rate limiting in the database** (`begfi.rate_limits` + `check_rate_limit`), plus per-device limits on
  Earn. Not sufficient on its own — see `KNOWN_ISSUES.md` #7.
- **Idempotency everywhere money moves.** Event-level (`tx_hash, log_index`), cycle-level
  (`wallet × cycle × campaign`), and send-level (the atomic `claimed_at` lease).
- **Server-side validation of every amount and eligibility check.** The frontend is never trusted for money.
- **Cron authentication.** `/api/cron/*` requires a bearer `CRON_SECRET`; the workflow fails loudly if the
  secret is missing rather than calling an unauthenticated endpoint.

## 4. Known weaknesses (accepted, tracked)

| # | Weakness | Reference |
|---|---|---|
| 1 | One key holds all pools; no hot/cold split | `KNOWN_ISSUES.md` #1 |
| 2 | All campaigns share one deposit address; attribution is by token | `KNOWN_ISSUES.md` #2 |
| 3 | No ledger-vs-chain reconciliation job | `KNOWN_ISSUES.md` #3 |
| 4 | No global kill switch | `KNOWN_ISSUES.md` #4 |
| 5 | No captcha / cluster detection | `KNOWN_ISSUES.md` #7 |
| 6 | Admin = one allowlisted wallet, no audit log | `KNOWN_ISSUES.md` #11 |
| 7 | No independent review of the payout engine | Plan §13 |

## 5. Incident response

**If the distributor key is suspected leaked — in this order:**
1. **Stop the bleeding:** pause payouts (today: set Earn's pause flag and every campaign to `paused`; the
   global switch in `KNOWN_ISSUES.md` #4 does not exist yet).
2. **Move the remaining balance** out of the distributor address to a newly created cold wallet.
3. **Rotate** `DISTRIBUTOR_PRIVATE_KEY` in the deployment environment and redeploy.
4. **Assess:** read the distributor address's transfer history on the explorer and account for every
   outgoing transfer that BegFi did not send.
5. **Tell users** what happened, what was lost, and what is being done — with the on-chain evidence, not a
   vague notice.

**If the Supabase service-role key is suspected leaked:** rotate it in the Supabase dashboard, update the
deployment env, redeploy, then review `campaign_deposits`, `earn_payouts` and `profiles` for writes that
were not made by the indexer.

**If a payout is double-sent:** capture both tx hashes, compare against the `claimed_at` lease row, and
record the incident. The lease exists so this should be impossible without a code defect — treat it as a
defect, not bad luck.

**If a pool cannot pay what the ledger says it owes:** that is `KNOWN_ISSUES.md` #3's drift, discovered the
hard way. Pause that pool, reconcile by hand from the explorer, and do not resume payouts until the numbers
match.

## 6. Before real money scales (plan §13, unbuilt)

- External review of the payout engine and key handling.
- Full reconciliation + kill switch + audit log in place first.
- A written refund / unclaimed-funds policy on `/terms` (the decision is made — `DECISIONS.md` D-019 — the
  text is not written).
- A compliance note on operating a platform that holds user funds in the relevant jurisdictions.
