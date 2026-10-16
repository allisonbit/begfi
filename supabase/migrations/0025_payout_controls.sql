-- The payout safety controls: a global kill switch, a reconciliation ledger,
-- and the guard that stops two campaigns claiming the same deposit token.
--
-- WHY THESE THREE TOGETHER. They are one failure story. Funds sit in a single
-- distributor wallet (docs/KNOWN_ISSUES.md #1); deposits are attributed per
-- token, so two campaigns sharing a token misattribute each other's money (#2);
-- and nothing compares the books to the chain, so drift is invisible until a
-- claim fails (#3). A switch that stops the bleeding, a job that notices, and a
-- guard that prevents the worst case belong in the same change.

-- ---------------------------------------------------------------------------
-- payout_controls — the kill switch
-- ---------------------------------------------------------------------------
-- A SINGLETON, like `earn_settings`: `id` is a boolean tautology that makes
-- "there is exactly one row" the schema's job rather than the code's.
--
-- GLOBAL ON PURPOSE. Per-campaign pause already exists (`campaigns.status`), and
-- pausing eight campaigns one at a time during an incident is not an incident
-- response. This row is read at the top of every sweep and every claim path, so
-- one UPDATE stops all money leaving the wallet.
create table if not exists begfi.payout_controls (
  id boolean primary key default true,
  is_paused boolean not null default false,
  -- Shown to users when paused, if set. "Payouts paused" with no reason reads
  -- as breakage; a sentence reads as a decision.
  reason text check (reason is null or char_length(reason) between 1 and 160),
  paused_at timestamptz,
  -- The admin wallet that flipped it, and when: the first line of any incident
  -- write-up is who did what, and a flag with no attribution cannot answer it.
  paused_by text check (paused_by is null or paused_by = lower(paused_by)),
  updated_at timestamptz not null default now()
);

insert into begfi.payout_controls (id) values (true) on conflict (id) do nothing;

alter table begfi.payout_controls enable row level security;

-- Public read: this is a status, not a secret, and the UI is required to be
-- honest about it ("payouts are paused") instead of rendering a claim button
-- that will fail. Writes have no policy at all — service role only, through
-- the admin route that checks the caller's wallet.
drop policy if exists payout_controls_read_public on begfi.payout_controls;
create policy payout_controls_read_public on begfi.payout_controls
  for select using (true);

grant select on begfi.payout_controls to anon, authenticated;
grant all privileges on begfi.payout_controls to service_role;

-- ---------------------------------------------------------------------------
-- reconciliation_runs — what the books said versus what the chain held
-- ---------------------------------------------------------------------------
-- One row per token per run. `expected` is computed from the ledger rows we
-- already trust (credited deposits minus confirmed payouts); `observed` is the
-- distributor's live on-chain balance; `drift` is the difference.
--
-- WHY A TABLE RATHER THAN A LOG LINE. A reconciled-everything is only worth
-- anything if it is inspectable later: "when did this start drifting" is the
-- question an incident asks, and a console.log in a cron container answers it
-- with silence. Rows are append-only by policy, so the history cannot be
-- rewritten by the thing being measured.
create table if not exists begfi.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  token_address text not null check (token_address = lower(token_address)),
  token_symbol text,
  -- The token's own decimals, recorded alongside the raw base units so the
  -- admin console can render them WITHOUT assuming 18. A campaign can pay in a
  -- 6-decimal token; dividing its base units by 1e18 would show a number one
  -- trillionth the size of the real one, on the page whose entire purpose is
  -- to be trusted about money.
  token_decimals integer not null default 18 check (token_decimals between 0 and 36),
  -- Base units, exact. `observed` is null only when the chain read failed —
  -- which is its own status, because "could not read" and "read zero" are
  -- different facts and must never be confused for each other.
  expected numeric(78, 0) not null,
  observed numeric(78, 0),
  drift numeric(78, 0),
  status text not null check (status in ('ok', 'drift', 'unreadable')),
  note text,
  checked_at timestamptz not null default now()
);

-- Guarded ALTER for the case where this migration has already run once: the
-- CREATE above skips an existing table, so a column added to its body now would
-- otherwise never reach a database that was migrated before this line existed.
-- Same file, two idempotent statements — re-running is always safe.
alter table begfi.reconciliation_runs
  add column if not exists token_decimals integer not null default 18;

create index if not exists reconciliation_runs_checked_idx
  on begfi.reconciliation_runs (checked_at desc);

alter table begfi.reconciliation_runs enable row level security;

-- NO CLIENT-READABLE POLICY AT ALL, deliberately.
--
-- These rows name pool balances and their drift. The admin console reads them
-- server-side with the service role AFTER checking the caller's wallet with
-- `isAdminWallet` (lib/earn.ts) — one allowlist, in one language, where the rest
-- of the admin surfaces already check it.
--
-- The tempting alternative — a policy that re-implements the allowlist in SQL
-- over `app_config` — was written first and thrown away: those keys are not what
-- the TypeScript reads (it reads the environment), so the policy would have
-- silently hidden the table from everyone the day the two drifted apart. A
-- policy that fails closed but looks like a feature is worse than no policy.
--
-- The consequence is accepted and explicit: no anon or authenticated read path
-- exists, so this table is invisible to a browser client in every case.
grant all privileges on begfi.reconciliation_runs to service_role;

-- ---------------------------------------------------------------------------
-- Two active campaigns may never share a payout token
-- ---------------------------------------------------------------------------
-- THE BUG THIS PREVENTS. `creditCampaignDeposits` scans transfers TO the single
-- distributor wallet per token, then attributes each batch to the FIRST campaign
-- with that token address (campaign-distributor.ts). Two active campaigns on one
-- token therefore credit one pool and starve the other, and if that token were
-- $BEGFI itself, BegFi's own top-ups would be counted into a project's pool as
-- well. The real fix is one deposit address per pool (Phase 1); this index makes
-- the collision impossible in the meantime, so the bug cannot be reached.
--
-- A partial index, not a constraint, because `status` is mutable: ending a
-- campaign must free its token for the next one. Indexes are the enforcement the
-- codebase already trusts for uniqueness (see migrations 0021/0022) — a check in
-- the API alone would lose to two concurrent creates.
--
-- THIS WILL FAIL LOUDLY if two active campaigns already share a token. That is
-- the correct response: the data would be ambiguous about whose money is whose,
-- and a human has to decide, not a migration.
create unique index if not exists campaigns_active_token_idx
  on begfi.campaigns (token_address)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- The bell's allowed kinds, extended for the two new admin facts
-- ---------------------------------------------------------------------------
-- REPLACED, not dropped, and the full existing list is repeated: a dropped
-- constraint would let any string into `kind` forever, which is how a column
-- that was an enum becomes an arbitrary text field.
alter table begfi.notifications drop constraint if exists notifications_kind_check;
alter table begfi.notifications
  add constraint notifications_kind_check
  check (
    kind = any (
      array[
        'beg', 'fees', 'launch', 'graduation', 'move', 'claim', 'digest',
        'earn_payout', 'campaign_payout', 'campaign_pool_low',
        -- New: the kill switch was flipped, and reconciliation found drift.
        -- Both are admin facts about money, and both must reach a human
        -- without anyone watching a dashboard.
        'payouts_paused', 'reconcile_alert'
      ]
    )
  );
