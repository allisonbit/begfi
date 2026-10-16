-- DROPS — the giveaway product.
--
-- WHAT A DROP IS. A pot of one token, a fixed amount per claim, and a cap on
-- how many people can take it. The first N claimers each get `amount_per_claim`
-- sent to their own wallet by the distributor — the SAME wallet, key and ledger
-- BegFi's own pool and every campaign pay from. Drops are a new FRONT (setting,
-- claiming, tracking) over the payout engine that already exists, not a second
-- money engine. lib/drop-distributor.ts says precisely which parts are shared.
--
-- WHY THE POOL IS A LEDGER AND NOT A BALANCE. `drop_deposits` minus confirmed
-- `earn_payouts` rows — the identical arithmetic as `campaign_deposits`, and for
-- the identical reason: a mutable counter can be wrong after a crash and there
-- is no way to tell. Rows can be re-derived.
--
--
-- THE ONE THING DROPS NEED THAT CAMPAIGNS DID NOT: ATTRIBUTION.
--
-- Campaigns credit deposits by scanning transfers TO the distributor for the
-- campaign's token, and then attribute the batch to the first campaign with
-- that token. That works only because migration 0025 guarantees no two active
-- campaigns share a payout token — and KNOWN_ISSUES #2 records the real fix
-- (one deposit address per pool) as unbuilt, because it needs per-pool keys.
--
-- A drop may not have per-pool keys either. So a drop's funding is attributed
-- by INTENT instead of by address:
--
--   1. The funder (signed in) creates a `drop_fundings` row naming the drop,
--      THEIR OWN wallet, the token and the amount they intend to send.
--   2. The indexer looks for a Transfer for that exact (from, to, token) and
--      writes a `drop_deposits` row — money truth, idempotent by tx+log.
--
-- The match key is (funder wallet, token): it cannot be ambiguous, because only
-- ONE pending intent may exist per (funder, token) at a time — the partial
-- unique index below makes that the database's job. And an intent's funder must
-- be the signed-in profile's own wallet (the insert policy says so), which is
-- what stops anyone attributing somebody else's transfer into their own pot.
--
-- The consequence is stated rather than hidden: a transfer to the distributor
-- that matches NO pending intent is credited nowhere. It sits in the wallet and
-- shows up as drift in the hourly reconciliation — which is an alarm, not a
-- silent loss (docs/KNOWN_ISSUES.md #20).

-- ---------------------------------------------------------------------------
-- drops — the pot itself
-- ---------------------------------------------------------------------------
create table if not exists begfi.drops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references begfi.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  description text check (description is null or char_length(description) between 1 and 280),
  -- The token that pays the claims. Lowercase like every address here.
  token_name text not null check (char_length(token_name) between 1 and 40),
  token_symbol text not null check (char_length(token_symbol) between 1 and 12),
  token_address text not null check (token_address = lower(token_address)),
  -- Read from the contract at creation, never assumed: a 6-decimal token
  -- divided by 1e18 renders a prize one trillionth of its real size.
  token_decimals integer not null default 18 check (token_decimals between 0 and 36),
  -- One prize, in the token's base units. Claims are refused unless the pool
  -- covers a whole prize — see the claim path in lib/drops.ts.
  amount_per_claim numeric(78, 0) not null check (amount_per_claim > 0),
  max_claims integer not null check (max_claims between 1 and 100000),
  -- NO 'draft' AND NO 'funding' STATE, deliberately. A drop is claimable the
  -- moment its pool covers one prize, and "is it funded yet" is DERIVED from
  -- the ledger rather than stored — one truth instead of two that can disagree.
  -- `open` accepts claims; `paused` stops new ones while already-accepted
  -- claims still get paid; `ended` is final.
  status text not null default 'open' check (status in ('open', 'paused', 'ended')),
  -- Optional deadline. Null means "until the cap or the pool runs out".
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists drops_owner_idx on begfi.drops (owner_id, created_at desc);
create index if not exists drops_open_idx on begfi.drops (created_at desc) where status = 'open';

alter table begfi.drops enable row level security;

-- The page has to work for someone who has never signed in: a giveaway that
-- needs an account to READ is a giveaway nobody shares.
drop policy if exists drops_read_public on begfi.drops;
create policy drops_read_public on begfi.drops
  for select using (true);

-- Writes go through the server routes, which resolve the owner from the
-- session. The policies are the backstop for a browser-direct write.
drop policy if exists drops_insert_own on begfi.drops;
create policy drops_insert_own on begfi.drops
  for insert with check (
    owner_id = (select p.id from begfi.profiles p where p.id = auth.uid())
  );

drop policy if exists drops_update_own on begfi.drops;
create policy drops_update_own on begfi.drops
  for update using (
    owner_id = (select p.id from begfi.profiles p where p.id = auth.uid())
  );

grant select on begfi.drops to anon, authenticated;
grant all privileges on begfi.drops to service_role;

-- ---------------------------------------------------------------------------
-- drop_fundings — the funding INTENT (what makes attribution exact)
-- ---------------------------------------------------------------------------
create table if not exists begfi.drop_fundings (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references begfi.drops (id) on delete cascade,
  -- The wallet that is about to send. Must be the signed-in profile's own.
  funder_wallet text not null check (funder_wallet = lower(funder_wallet)),
  token_address text not null check (token_address = lower(token_address)),
  -- What the funder says they will send, for the UI and for the "is it funded"
  -- arithmetic. NOT the match key and NOT a cap: the amount credited is the
  -- transfer's own value, because that is the money that actually arrived.
  expected_amount numeric(78, 0) not null check (expected_amount > 0),
  status text not null default 'pending' check (status in ('pending', 'matched', 'expired')),
  -- A pending intent that never matches must stop matching somebody's later
  -- transfer under an old expectation. 24 hours, extended by re-creating it.
  expires_at timestamptz not null,
  -- The transfer that settled it, once the indexer saw it.
  tx_hash text,
  log_index integer,
  block_number integer,
  matched_amount numeric(78, 0),
  matched_at timestamptz,
  created_at timestamptz not null default now()
);

-- THE INDEX THAT MAKES ATTRIBUTION UNAMBIGUOUS: at most one OPEN intent per
-- (funder, token). Two open intents would make an incoming transfer a coin
-- flip, and money that lands in the wrong pot cannot be un-landed.
create unique index if not exists drop_fundings_pending_idx
  on begfi.drop_fundings (funder_wallet, token_address)
  where status = 'pending';

create index if not exists drop_fundings_drop_idx on begfi.drop_fundings (drop_id, created_at desc);
create index if not exists drop_fundings_pending_scan_idx
  on begfi.drop_fundings (status, expires_at)
  where status = 'pending';

alter table begfi.drop_fundings enable row level security;

-- Readable by the two participants and nobody else: a pending intent is a
-- public statement that "wallet X intends to send N" — true, unnecessary to
-- publish, and nobody's business.
drop policy if exists drop_fundings_read_participants on begfi.drop_fundings;
create policy drop_fundings_read_participants on begfi.drop_fundings
  for select using (
    funder_wallet = (select p.wallet_address from begfi.profiles p where p.id = auth.uid())
    or drop_id in (select d.id from begfi.drops d where d.owner_id = auth.uid())
  );

-- THE AUTHORIZATION RULE OF THIS TABLE, in SQL as well as in the route: an
-- intent can only ever be created for the caller's OWN verified wallet, and
-- only while the drop is open. Without the first half, anyone could register an
-- intent over somebody else's wallet and have that person's transfer credited
-- into a pot of the attacker's choosing (where the attacker may also be a
-- claimer). Anyone may fund anyone's drop — with their own money.
drop policy if exists drop_fundings_insert_own on begfi.drop_fundings;
create policy drop_fundings_insert_own on begfi.drop_fundings
  for insert with check (
    funder_wallet = (select p.wallet_address from begfi.profiles p where p.id = auth.uid())
    and exists (
      select 1 from begfi.drops d
      where d.id = drop_id and d.status = 'open' and d.token_address = token_address
    )
  );

grant select on begfi.drop_fundings to authenticated;
grant all privileges on begfi.drop_fundings to service_role;

-- ---------------------------------------------------------------------------
-- drop_deposits — the pool's money trail
-- ---------------------------------------------------------------------------
create table if not exists begfi.drop_deposits (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references begfi.drops (id) on delete cascade,
  -- Which intent attributed it. Kept for the audit trail even if the intent is
  -- later cleaned up.
  funding_id uuid references begfi.drop_fundings (id) on delete set null,
  token_address text not null check (token_address = lower(token_address)),
  amount numeric(78, 0) not null check (amount > 0),
  depositor text not null check (depositor = lower(depositor)),
  -- Idempotency at event level, exactly like campaign_deposits: a re-scanned
  -- window re-credits nothing.
  tx_hash text not null,
  log_index integer not null,
  block_number integer,
  created_at timestamptz not null default now(),
  unique (tx_hash, log_index)
);

create index if not exists drop_deposits_drop_idx on begfi.drop_deposits (drop_id, created_at desc);

alter table begfi.drop_deposits enable row level security;

-- Public, like campaign_deposits: "is this pot really funded" is a question a
-- claimer is entitled to ask, and the answer is a list of confirmed transfers.
drop policy if exists drop_deposits_read_public on begfi.drop_deposits;
create policy drop_deposits_read_public on begfi.drop_deposits
  for select using (true);

-- No insert/update/delete policies: only the service role writes deposits.
grant select on begfi.drop_deposits to anon, authenticated;
grant all privileges on begfi.drop_deposits to service_role;

-- ---------------------------------------------------------------------------
-- drop_claims — who took a prize, and whether it has been sent
-- ---------------------------------------------------------------------------
create table if not exists begfi.drop_claims (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references begfi.drops (id) on delete cascade,
  user_id uuid not null references begfi.profiles (id) on delete cascade,
  username text not null,
  wallet_address text not null check (wallet_address = lower(wallet_address)),
  -- Snapshots, so a claim is judged by the rules in force when it was made:
  --   amount   — the prize at claim time, never re-read from the drop later;
  --   x_handle — only ever stored when the profile's handle was X-VERIFIED,
  --              because an unverified handle is a string anyone can type.
  amount numeric(78, 0) not null check (amount > 0),
  x_handle text,
  -- NO DEVICE COLUMN, DELIBERATELY. A giveaway is the strongest argument for
  -- a per-device cap there is — one person with ten wallets takes ten prizes.
  -- It is still not built here, because this codebase REMOVED device
  -- fingerprinting on purpose: the earn rewrite (app/api/earn/submit) records
  -- that a family phone, a campus NAT or any shared exit node told honest
  -- people "come back tomorrow" for a sin someone else committed. Reviving the
  -- fingerprint for Drops would reintroduce that bug in a louder place. The
  -- caps a drop does have are the wallet and the VERIFIED X account — the only
  -- identity this site can actually check — plus `max_claims`. Stronger
  -- sybil resistance needs real identity, which is Phase 6 (docs/DROPS.md).
  -- THE PAYOUT BOOKKEEPING, the same two columns and the same discipline as
  -- campaign_submissions: `payout_tx` is set ONLY after a transfer confirms,
  -- and `payout_lease` is the send lock that decides who sends. Eligibility is
  -- `payout_tx IS NULL` — a state, not a boolean nobody updates.
  payout_tx text,
  payout_lease timestamptz,
  created_at timestamptz not null default now()
);

-- ONE PRIZE PER DROP PER WALLET, enforced by the database.
create unique index if not exists drop_claims_wallet_idx
  on begfi.drop_claims (drop_id, wallet_address);

-- ...AND PER VERIFIED X ACCOUNT, so a farm cannot take the pot twice through
-- two wallets that are one person. Only rows that actually carried a verified
-- handle participate, which is why the index is partial.
create unique index if not exists drop_claims_x_idx
  on begfi.drop_claims (drop_id, lower(x_handle))
  where x_handle is not null;

-- Housekeeping for an earlier draft of THIS migration, which carried a
-- `device_hash` column and its index before the reasoning above was settled.
-- Idempotent and safe in both directions: a database that migrated that draft
-- loses the column, and one that never saw it does nothing.
alter table begfi.drop_claims drop column if exists device_hash;
drop index if exists begfi.drop_claims_device_idx;

create index if not exists drop_claims_drop_idx on begfi.drop_claims (drop_id, created_at desc);
create index if not exists drop_claims_user_idx on begfi.drop_claims (user_id, created_at desc);
create index if not exists drop_claims_unpaid_idx
  on begfi.drop_claims (drop_id, created_at) where payout_tx is null;

alter table begfi.drop_claims enable row level security;

-- The public feed shows CLAIMS THAT WERE PAID — the winners list a giveaway
-- page is expected to show. An unpaid row is not public: it is a promise in
-- flight, and it stays visible to its own owner and to admins.
drop policy if exists drop_claims_read_public on begfi.drop_claims;
create policy drop_claims_read_public on begfi.drop_claims
  for select using (payout_tx is not null or user_id = auth.uid());

-- The claim insert, server-routed, with the rules stated in SQL: your own
-- profile, your own wallet, a username, and the drop's own prize amount — a
-- client cannot name its own number.
drop policy if exists drop_claims_insert_own on begfi.drop_claims;
create policy drop_claims_insert_own on begfi.drop_claims
  for insert with check (
    user_id = auth.uid()
    and wallet_address = (select p.wallet_address from begfi.profiles p where p.id = auth.uid())
    and exists (
      select 1 from begfi.profiles p
      where p.id = auth.uid() and p.username is not null
    )
    and amount = (select d.amount_per_claim from begfi.drops d where d.id = drop_id)
  );

-- No update policy: payout marks are the distributor's work.
grant select on begfi.drop_claims to anon, authenticated;
grant all privileges on begfi.drop_claims to service_role;

-- ---------------------------------------------------------------------------
-- ONE PAYOUT TOKEN PER LIVE POOL — now across BOTH products
-- ---------------------------------------------------------------------------
-- Migration 0025 stopped two ACTIVE CAMPAIGNS sharing a payout token, because
-- deposits are credited per token and two claims on one token starve each
-- other. Drops make the hole wider: a drop's deposits are scanned just like a
-- campaign's, so a drop and an active campaign on one token would credit each
-- other's money too.
--
-- A unique index cannot span two tables, so the lease lives in a shared table
-- and is claimed by a trigger on write. `pool_tokens` is the resource: each
-- token has at most ONE live holder. Keeping this in the database rather than
-- in the create routes is the same lesson 0025 learned — a check in an API
-- loses to two concurrent creates, an index does not.
create table if not exists begfi.pool_tokens (
  token_address text primary key check (token_address = lower(token_address)),
  -- Which product holds it, and which pool. `campaigns` and `drops` are the
  -- only writers; a third product adds its own pair of callers.
  kind text not null check (kind in ('campaign', 'drop')),
  pool_id uuid not null,
  claimed_at timestamptz not null default now()
);

alter table begfi.pool_tokens enable row level security;
grant all privileges on begfi.pool_tokens to service_role;

/**
 * The lease, as one function both triggers call.
 *
 * `p_holds` is the product's own rule about when its pool needs the token
 * exclusively: a campaign holds it only while status = 'active' (0025's
 * semantics), a drop holds it from creation until it has ENDED — a drop accepts
 * deposits while open or paused, so the token has to stay reserved.
 *
 * Releasing is a DELETE, not a flag, so the released lease cannot be misread
 * as still holding — and claiming an already-held token raises instead of
 * overwriting, which is what makes the guard a guard.
 */
create or replace function begfi.claim_pool_token(
  p_kind text,
  p_pool_id uuid,
  p_token text,
  p_holds boolean
)
returns void
language plpgsql
security definer
set search_path = begfi, public
as $$
declare
  holder begfi.pool_tokens;
begin
  if not p_holds then
    delete from begfi.pool_tokens
     where kind = p_kind and pool_id = p_pool_id;
    return;
  end if;

  select * into holder from begfi.pool_tokens where token_address = p_token;
  if found then
    -- Re-claiming one's own lease (any later UPDATE that touches status) is a
    -- no-op, not a conflict.
    if holder.kind = p_kind and holder.pool_id = p_pool_id then
      return;
    end if;
    raise exception
      'payout token % is already held by an active % (%) — one token can only fund one live pool',
      p_token, holder.kind, holder.pool_id
      using errcode = 'unique_violation';
  end if;

  insert into begfi.pool_tokens (token_address, kind, pool_id)
  values (p_token, p_kind, p_pool_id)
  on conflict (token_address) do update
    set kind = excluded.kind, pool_id = excluded.pool_id, claimed_at = now();
end;
$$;

create or replace function begfi.campaigns_claim_token()
returns trigger
language plpgsql
security definer
set search_path = begfi, public
as $$
begin
  perform begfi.claim_pool_token('campaign', new.id, new.token_address, new.status = 'active');
  return new;
end;
$$;

create or replace function begfi.drops_claim_token()
returns trigger
language plpgsql
security definer
set search_path = begfi, public
as $$
begin
  perform begfi.claim_pool_token('drop', new.id, new.token_address, new.status <> 'ended');
  return new;
end;
$$;

-- AFTER ... FOR EACH ROW, on the columns that change the answer only: an
-- ordinary UPDATE (a description, a window) must not run this at all.
drop trigger if exists campaigns_claim_token on begfi.campaigns;
create trigger campaigns_claim_token
  after insert or update of token_address, status on begfi.campaigns
  for each row execute function begfi.campaigns_claim_token();

drop trigger if exists drops_claim_token on begfi.drops;
create trigger drops_claim_token
  after insert or update of token_address, status on begfi.drops
  for each row execute function begfi.drops_claim_token();

-- DELETE MUST RELEASE TOO, and this is not theoretical. Deleting a profile
-- cascades to its campaigns and drops, and a row that is gone cannot fire an
-- UPDATE — so without these two triggers the lease would outlive its holder and
-- reserve a payout token forever, with nothing left in the database that owns
-- it. BEFORE DELETE because the lease lookup needs the OLD token address, which
-- is still readable there (and AFTER DELETE would only have the id).
create or replace function begfi.campaigns_release_token()
returns trigger
language plpgsql
security definer
set search_path = begfi, public
as $$
begin
  delete from begfi.pool_tokens where kind = 'campaign' and pool_id = old.id;
  return old;
end;
$$;

create or replace function begfi.drops_release_token()
returns trigger
language plpgsql
security definer
set search_path = begfi, public
as $$
begin
  delete from begfi.pool_tokens where kind = 'drop' and pool_id = old.id;
  return old;
end;
$$;

drop trigger if exists campaigns_release_token on begfi.campaigns;
create trigger campaigns_release_token
  before delete on begfi.campaigns
  for each row execute function begfi.campaigns_release_token();

drop trigger if exists drops_release_token on begfi.drops;
create trigger drops_release_token
  before delete on begfi.drops
  for each row execute function begfi.drops_release_token();

-- Backfill of STALE leases: a lease whose holder is already gone is released
-- here rather than left to block a token nobody can name. Runs before the
-- campaign backfill below, so a token held by a deleted pool is reusable.
delete from begfi.pool_tokens t
 where t.kind = 'campaign'
   and not exists (select 1 from begfi.campaigns c where c.id = t.pool_id);

delete from begfi.pool_tokens t
 where t.kind = 'drop'
   and not exists (select 1 from begfi.drops d where d.id = t.pool_id);

-- Backfill: campaigns that were already active before this trigger existed
-- must hold their leases from the first moment the guard is live, otherwise the
-- first drop created afterwards could take a token that is already paying.
insert into begfi.pool_tokens (token_address, kind, pool_id)
select c.token_address, 'campaign', c.id
  from begfi.campaigns c
 where c.status = 'active'
on conflict (token_address) do nothing;

-- ---------------------------------------------------------------------------
-- THE PAYOUT LEDGER LEARNS ITS THIRD POOL
-- ---------------------------------------------------------------------------
-- One ledger for BegFi's own pool, every campaign and now every drop — one
-- payout truth, one lease mechanism, one admin console. A drop payout row is
-- the same shape: wallet, amount, token, status, tx_hash, attempts.
alter table begfi.earn_payouts
  add column if not exists drop_id uuid references begfi.drops (id) on delete set null;

-- TWO OLD INDEXES HAVE TO GO, AND ONE OF THEM WAS A BUG OF ITS OWN.
--
-- (a) `earn_payouts_wallet_address_cycle_date_key` — `unique (wallet_address,
--     cycle_date)` — was declared inline by 0021 and 0022 meant to replace it
--     with a campaign-scoped version. 0022 dropped a GUESSED name
--     (`earn_payouts_wallet_cycle_key`) that never matched the constraint
--     Postgres actually created, so the original has been alive ever since and
--     quietly capped every wallet at ONE payout a day across every product:
--     a wallet paid by BegFi's pool could not be paid by a campaign the same
--     day (the campaign sweep read the 23505 as "already served this cycle"
--     and skipped it). Drops would have made that worse, and the drop payout
--     below is what surfaced it. Dropped here by its real name, plus the
--     guessed one, so this migration fixes it whatever a database carries.
--
-- (b) `earn_payouts_wallet_cycle_campaign_idx` — 0022's campaign-scoped index,
--     superseded by the three-pool index below. NOTE THE SCHEMA QUALIFICATION:
--     the first version of this file dropped it unqualified, which silently
--     matched nothing because these scripts run with the default search_path,
--     not `begfi`.
alter table begfi.earn_payouts
  drop constraint if exists earn_payouts_wallet_address_cycle_date_key;
alter table begfi.earn_payouts
  drop constraint if exists earn_payouts_wallet_cycle_key;
drop index if exists begfi.earn_payouts_wallet_cycle_campaign_idx;

-- The per-cycle uniqueness must now distinguish THREE pools instead of two.
-- The COALESCE trick from 0022 handled "campaign or BegFi's own"; drop_id is
-- added the same way, so:
--   * BegFi's own rows (both null) keep EXACTLY their old guarantee — three
--     payouts to one wallet need three cycle dates, as before;
--   * campaign rows keep theirs;
--   * a drop row no longer collides with a BegFi row or another drop's row on
--     the same day, which is what would have made the second drop of a day
--     fail to record at all.
create unique index if not exists earn_payouts_pool_wallet_cycle_idx
  on begfi.earn_payouts (
    wallet_address,
    cycle_date,
    coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(drop_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- A drop pays a wallet ONCE, ever — not once per cycle. The claim row already
-- says so; this makes the ledger agree, so a sweep that ran twice on two
-- different days cannot pay the same prize twice.
create unique index if not exists earn_payouts_drop_wallet_idx
  on begfi.earn_payouts (wallet_address, drop_id)
  where drop_id is not null;

create index if not exists earn_payouts_drop_idx on begfi.earn_payouts (drop_id, cycle_date);

-- `submission_ids` carries the SOURCE ROWS a payout covers — campaign
-- submissions for a campaign, drop claims for a drop. Same column, one meaning:
-- "these rows are why this money left the wallet". Named for campaigns because
-- they came first; the drop sweep and its reconcile use it the same way.
comment on column begfi.earn_payouts.submission_ids is
  'Source rows this payout settled: campaign_submissions for a campaign, drop_claims for a drop.';

-- ---------------------------------------------------------------------------
-- The bell's allowed kinds, extended for Drops
-- ---------------------------------------------------------------------------
alter table begfi.notifications drop constraint if exists notifications_kind_check;
alter table begfi.notifications
  add constraint notifications_kind_check
  check (
    kind = any (
      array[
        'beg', 'fees', 'launch', 'graduation', 'move', 'claim', 'digest',
        'earn_payout', 'campaign_payout', 'campaign_pool_low',
        'payouts_paused', 'reconcile_alert',
        -- New, for Drops:
        --   drop_reward — the claimer's prize landed in their wallet;
        --   drop_payout — the owner's pot paid claims today;
        --   drop_funded — the owner's deposit was credited to the pot.
        'drop_reward', 'drop_payout', 'drop_funded'
      ]
    )
  );
