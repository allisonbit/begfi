# AGENTS.md — working on BegFi

Instructions for any AI agent (or new contributor) editing this repository.

## Read this first, every session

1. [`docs/BEGFI_CONTEXT.md`](docs/BEGFI_CONTEXT.md) — the master brief: products, routes,
   architecture, payout flow, removed features, tone of voice.
2. [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — the order of work, what is
   live, and which items need an explicit decision before anyone touches them.
3. [`docs/PROJECT_BRAIN.md`](docs/PROJECT_BRAIN.md) — the operational record written from
   the code, including what is actually live and what is paused.
4. [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md) — bugs and fund-safety risks, most severe
   first.

Do not start from the README alone. It is a summary, and summaries drift.

## Rules

- **Keep the brain current.** Every change updates `docs/CHANGELOG.md` with today's date and
  a plain-English line about what changed and why it mattered. Update
  `docs/PROJECT_BRAIN.md`, `docs/KNOWN_ISSUES.md` and `docs/BEGFI_CONTEXT.md` when the code
  moves under them. A stale claim in a doc is a bug.
- **Do not reintroduce removed features.** The launchpad (`/launch`, `/token/[address]`,
  `/beg-to-launch`, `/dashboard/launches`, `/dashboard/fees`, `/api/launch`), `/explore`, and
  device fingerprinting were removed on purpose. Reasons are in
  `docs/BEGFI_CONTEXT.md` §6 and `docs/DECISIONS.md`.
- **Do not promise money.** No copy, page, metadata or doc may promise returns, yield, profit,
  a refund for an unspent pot, or a reversal of a transaction. Campaign pools and drop pots
  are custodial until paid out; payment links are not.
- **Money paths need a decision, not a patch.** Payout logic, wallet or key handling, fee
  percentages, the ledger schema and anything that actually moves funds require an explicit
  decision recorded in `docs/DECISIONS.md` and a security review. UI, copy, SEO, docs and
  read-only boards do not.
- **Confirmed rows or an honest failure.** A read that fails returns `dbFailed: true` (or the
  local equivalent) and the page says so. Never render a failed read as zero or as an empty
  list.
- **No secrets in the tree.** Credentials arrive as environment variables. `.env` files are
  refused by the pre-commit hook. A token printed into a log is a token to rotate.
- **Money columns are read as text.** A `numeric(78,0)` crossing PostgREST becomes a float and
  loses digits; select `amount::text` and use `BigInt`. Do not `select("*")` on a table that
  holds a money column (`docs/KNOWN_ISSUES.md` #24).

## Commands

```sh
npm test                       # Hardhat: 32 splitter tests
npm run migrate                # applies supabase/migrations to the `begfi` schema

cd web
npm run typecheck              # tsc --noEmit — run before calling anything done
npm run build                  # next build — catches route and prerender errors
npm run dev                    # local server
```

The Supabase project must expose the `begfi` schema (Settings → API → Exposed schemas) or
every PostgREST call answers 404.

## Definition of done

1. `npm run typecheck` and `npm run build` are clean in `web/`.
2. The pages you touched were loaded against real data, at desktop and phone widths.
3. `docs/CHANGELOG.md` has the entry; any doc that is now wrong was corrected.
4. Anything you could not verify is labelled unverified in the summary, not implied to be
   working.
