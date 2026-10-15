-- Automatic reward distribution.
--
-- THE SHIFT THIS MIGRATION PLAINS OUT: payouts used to wait for the user's
-- "Claim" click (earn/claim route). From here the distributor sweeps on its
-- own — a daily cron (vercel.json) and a funds-arrival trigger (the indexer
-- calls the sweep when a transfer lands in the distributor wallet). No
-- approval, no click.
--
-- WHAT IS NEW HERE, AND WHY IT LOOKS LIKE EARN_SUBMISSIONS BUT ISN'T:
--
--   * earn_submissions answers "what did a post earn" — per-post money truth,
--     and it stays exactly that (payout_tx on the submission is still set only
--     after a real confirmed transfer, so nothing double-pays).
--   * earn_payouts answers "what did a TRANSFER send" — one row per wallet per
--     cycle, because the distributor pays a wallet ONCE per cycle with its
--     whole owed amount aggregated, not once per post. The UNIQUE
--     (wallet_address, cycle_date) is the "no double payments" guarantee at
--     the ledger level; the payout_tx IS NULL filter at the earnings level is
--     the guarantee at the money level. Two layers, like the wallet-once rule.
--
-- CYCLES. A cycle is a UTC day: the day the distributor sweep runs and serves
-- a funding batch (the user funds the wallet, the day's completers get paid
-- from it). Rows are keyed to the run date, so yesterday's completers are
-- paid by the first cycle that had funds for them.

create table if not exists begfi.earn_payouts (
  id uuid primary key default gen_random_uuid(),
  -- The distribution cycle (UTC date this payout belongs to).
  cycle_date date not null,
  -- LOWERCASE, same discipline as every wallet column here.
  wallet_address text not null check (wallet_address = lower(wallet_address)),
  user_id uuid references begfi.profiles (id) on delete set null,
  username text,
  -- THE AMOUNT THIS TRANSFER SENT, in $BEGFI base units (18 decimals).
  -- numeric(78,0): exact digits, no float dust — the same reason every other
  -- money column in this schema is numeric.
  amount numeric(78,0) not null check (amount > 0),
  -- The unpaid submissions this payout settles, for the audit trail: read a
  -- payout row and know exactly which posts' money it was.
  submission_ids uuid[] not null default '{}',
  -- pending: created and staged, not yet sent. sent: confirmed on-chain.
  -- failed: the send threw or reverted BEFORE it could confirm. A failed row
  -- is retried by the next sweep; it is never "given up on" silently — the
  -- admin page lists failed rows for exactly this reason.
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  tx_hash text,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  -- ONE PAYOUT PER WALLET PER CYCLE. Two sweeps on the same day — a cron run
  -- and a funds-arrival trigger, a retry racing an admin nudge — cannot both
  -- create a row for a wallet: the second insert conflicts and re-joins the
  -- first row instead of paying twice.
  unique (wallet_address, cycle_date)
);

create index if not exists earn_payouts_cycle_idx on begfi.earn_payouts (cycle_date, status);
create index if not exists earn_payouts_wallet_idx on begfi.earn_payouts (wallet_address);

-- THE PAYOUT LEASE, the piece that makes automatic sending safe.
--
-- The sweep, a funds-arrival trigger and the user's own "Claim" button can all
-- try to pay the same wallet around the same time. `payout_tx` (the money
-- truth) is only set AFTER a transfer confirms, so it cannot say "someone is
-- already sending". And `claimed_at` cannot either: the submit route stages
-- rows AT BIRTH, so a fresh claimable row already carries a recent claimed_at
-- through no fault of a payout.
--
-- So every sender takes a LEASE before it sends:
--   * take:  set payout_lease = now(), only where payout_tx IS NULL and
--            payout_lease IS NULL (one conditional update wins the lease; the
--            loser's update returns zero rows and it backs off),
--   - hold:  a live lease blocks other senders,
--   * stale: the lease expires (the sweep re-checks against the age cut-off
--            below; a cron kill, deploy or dropped tx realeases it automatically),
--   * end:   set payout_tx (confirmed) which also nulls the lease.
--
-- The reservation is enforced with a conditional UPDATE, which is atomic even
-- with two racing requests — no lock table, no polling, no advisory locks.
alter table begfi.earn_submissions
  add column if not exists payout_lease timestamptz;

alter table begfi.earn_payouts enable row level security;

-- Readable publicly: a payout is paid money, the opposite of sensitive. No
-- insert/update policies — the sweep writes with the service role only, so
-- a browser can never stage or confirm a payout row to itself.
drop policy if exists earn_payouts_read_public on begfi.earn_payouts;
create policy earn_payouts_read_public on begfi.earn_payouts
  for select using (true);

grant select on begfi.earn_payouts to anon, authenticated;
grant all privileges on begfi.earn_payouts to service_role;
