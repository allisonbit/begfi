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
scripts/                migrate.js (applies migrations), push-env.js (Vercel env)
```

`index.html` — the original static landing page — was removed at cutover. It is recoverable from
git history (last present in `718b12f`).

## Running it

```sh
npm install                 # repo root: Hardhat + OpenZeppelin
npm test                    # 32 splitter tests

cd web && npm install       # app dependencies (.npmrc sets legacy-peer-deps — see that file)
cp .env.example .env.local  # then fill in Supabase keys
npm run dev
```

### Testing the whole flow, for free

There is no testnet build. `npx hardhat node` runs at **chainId 4663 — the same chain id as
mainnet** — so a local run exercises the identical code path with the identical addresses, rather
than a parallel network that has to be kept in step with the real one.

```sh
npx hardhat node                    # terminal 1 — leave running
npm run deploy:local                # terminal 2 — prints the TestToken address

# web/.env.local:
#   NEXT_PUBLIC_RPC_URL="http://127.0.0.1:8545"
#   NEXT_PUBLIC_BEG_TOKEN_ADDRESS="<the TestToken address it printed>"
cd web && npm run dev
```

Then connect a wallet, claim a username, open `/[username]` from a second wallet, send, and watch
the total appear. Real transactions, real signatures, no money.

`TestToken` has an open `mint` — it is a faucet, and it must never exist on a chain where it could
be mistaken for $BEG. The deploy script refuses to deploy it to mainnet.

### Deploying for real

`npm run deploy:mainnet` spends real ETH and writes a public contract. Nothing in this repo has
ever been run against mainnet — no token, no splitter, no factory. Two gates sit in front of it:

1. **Spec §13's audit.** The splitter is unaudited and would hold real fee revenue, with no upgrade
   path and no way to fix a bug after deployment.
2. **The Pons fee path is unfinished.** Pons V2 holds creator fees in a fee escrow
   (`0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e`) that the recipient claims from, rather than
   pushing them to the recipient. `BegSplitter.receive()` may therefore never see a wei. Finishing
   it needs that contract's ABI. Read the note at the top of `contracts/BegSplitter.sol` before
   deploying it anywhere that matters.

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
- `/[username]` public page with the wallet-to-wallet send flow, `/beg/[id]` progress pages and
  the public `/begs` feed, with generated share images.
- `/dashboard` (overview, profile edit, activity, launches) and its own tab navigation.
- The `/launch` form and `/token/[address]` pages, reading straight from Pons' factory on-chain.
- The indexer that records confirmed `Transfer` events, driven by `/api/cron/indexer`.

**Not built yet**

- Nothing in the app tree — the blockers that remain are outside the code: `$BEG` itself is not
  deployed, Supabase migrations have not been applied to a live project, and the audit gate.

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
