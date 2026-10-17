# CLAUDE.md

This repository uses one set of instructions for every AI agent. Read
[`AGENTS.md`](AGENTS.md), then read [`docs/BEGFI_CONTEXT.md`](docs/BEGFI_CONTEXT.md) before
changing anything.

The short version:

- BegFi is a non-custodial payment-link product on Robinhood Chain with four products: beg
  pages, Pay Links, Earn campaigns and Drops.
- Payment links move money wallet to wallet. Campaign pools and drop pots are held by a BegFi
  payout wallet until paid out. Never describe those two cases with the same sentence.
- Never promise returns, refunds or reversals. Never reintroduce the launchpad, `/explore` or
  device fingerprinting.
- Update [`docs/CHANGELOG.md`](docs/CHANGELOG.md) with every change.
- Run `npm run typecheck` and `npm run build` in `web/` before calling a change done, and load
  the page against real data.
