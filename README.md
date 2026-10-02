# BegFi

Everyone begs. BegFi gives begging a payment link.

A non-custodial `$BEG` payment link on **Robinhood Chain**, plus a token launchpad. You claim
`begfi.xyz/<username>`, anyone can open that link and send you `$BEG` wallet-to-wallet, and from
the same account you can launch a token that pays you a share of its trading fees.

Full specification: `~/Downloads/BegFi-Complete-Spec.md`.

## Layout

```
web/                    Next.js 16 app — Vercel Root Directory points here
  app/                  routes: home, /[username], /dashboard, /launch, /token/[address]
  lib/                  chains, ERC-20, config, Supabase clients, wallet sign-in
  components/
contracts/              BegSplitter, its clone factory, and a local-only TestToken
test/                   Hardhat tests for the splitter
supabase/migrations/    schema, RLS and seed data for the `begfi` schema
index.html              the original static landing page (removed at cutover)
```

## Running it

```sh
npm install                 # repo root: Hardhat + OpenZeppelin
npm test                    # 26 splitter tests

cd web && npm install       # app dependencies (.npmrc sets legacy-peer-deps — see that file)
cp .env.example .env.local  # then fill in Supabase keys
npm run dev
```

### Developing before `$BEG` exists

`npx hardhat node` at the repo root runs at **chainId 4663 — the same as Robinhood Chain**. Deploy
`TestToken` to it, then set `NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545` and
`NEXT_PUBLIC_BEG_TOKEN_ADDRESS` to the local address. The whole send flow then runs in a browser
with no code changes, which is the only way to exercise it before the real token is deployed.

## Current state

**Built and verified**

- `BegSplitter` + factory — 26 Hardhat tests passing, including the negative cases: a stranger
  cannot claim, the launcher cannot reach the treasury's share, a non-controller cannot touch the
  growth fund, rounding never strands a wei, and no function in the ABI changes the split.
- Database schema with RLS. Three corrections to the spec's sketch, the important one being that
  `profile_stats` is created `security_invoker` — without it a Postgres view bypasses RLS on the
  tables underneath and would leak hidden profiles and the whole transfer graph.
- Next.js app: design system, wallet connection, wallet sign-in (nonce → signature → session),
  username availability and atomic claim, home page, terms, privacy.

**Not built yet**

- `/[username]` public page and the send flow
- `/dashboard` (overview, profile edit, activity) and `/dashboard/launches`
- The indexer that records confirmed `Transfer` events
- `/launch` and `/token/[address]`
- Open Graph previews

**Blocked on things outside the code**

1. **`$BEG` does not exist.** No contract, no address. The product's currency has no deployment, so
   the send flow can be tested only against a local test token.
2. **Pons integration is unverified.** Pons V2 appears to hold creator fees in a *fee escrow* that
   the recipient claims from, rather than pushing them to the recipient address. If so,
   `BegSplitter.receive()` may never see a wei on its own and the contract needs a call into Pons'
   escrow — whose ABI we do not have. **Do not deploy the splitter expecting fees to arrive until
   this is settled against Pons' real contracts.**
3. **The Supabase schema has not been applied.** The migrations are written but never run; the
   `begfi` schema must also be added to Exposed schemas in the dashboard.
4. **An audit is a hard gate** before any mainnet deployment (spec §13).

## Conventions worth knowing

- **No fake data, anywhere.** No invented users, balances, totals or addresses. Unconfigured
  features say they are unconfigured rather than rendering a control that cannot work. This is a
  standing rule of the owner's and the spec restates it in §3 and §17.
- **Supabase for records and files.** Never Vercel Blob.
- **`web/.npmrc` sets `legacy-peer-deps`.** RainbowKit 2.2.11 declares a wagmi 2 peer and this app
  runs wagmi 3. The reason, and the build failure that ruled out the alternative, are in that file.
