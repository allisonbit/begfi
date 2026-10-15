-- PROJECT CAMPAIGNS — Earn for any project.
--
-- WHAT THIS SCHEMA PROMISES:
--   * A project (any signed-in profile with a username) registers a campaign:
--     identity + token + the required mention + the daily budget. Its pool is
--     funded by the project itself and tracked through THIS database —
--     deposits credited automatically from on-chain transfers, payouts
--     debited only after a confirmed transfer. Rewards can only ever draw
--     that campaign's own pool, never another campaign's or BegFi's own.
--   * Daily payout is automatic. The sweep shares each cycle's budget
--     (capped by the pool remaining) across that cycle's valid posters —
--     no approval anywhere. See lib/campaign-distributor.ts.
--   * Anti-spam is schema-level BEFORE it is code-level: one submission per
--     wallet per campaign per UTC day (expression index, indifferently
--     enforced against race and rewrite), post links unique per campaign,
--     and a row carries the verification verdict, so a fake link is stored
--     rejected WITH the reason, not silently dropped.
--   * POSTS ARE VERIFIED WITH THE SITE'S NORMAL MECHANISM: X's public oEmbed
--     read (the same readPost the profile tick uses) decides whether the
--     post exists and contains the required mention. No API keys, no OAuth.

-- SETTINGS PER CAMPAIGN -----------------------------------------------------

create table if not exists begfi.campaigns (
  id uuid primary key default gen_random_uuid(),
  -- Namespace is /earn/<slug>: campaign pages live on the Earn page itself.
  slug text not null unique check (slug = lower(slug)),
  owner_id uuid not null references begfi.profiles (id) on delete cascade,
  name text not null,
  logo_url text,
  banner_url text,
  x_url text,
  website_url text,
  token_name text not null,
  token_symbol text not null,
  -- THE payouts token, lowercase like every address the schema stores.
  token_address text not null check (token_address = lower(token_address)),
  -- Read from the token's own contract at creation (1 eth_call); only a
  -- failed read stores the ERC-20 default. Display math uses this — it must
  -- be the CONTRACT's value, not an assumption.
  token_decimals integer not null default 18,
  description text,
  -- What a valid post must contain (the mention/hashtag), matched
  -- case-insensitively against the post text. Modelled as ONE required
  -- fragment: "$PEPE" or "@handle" — a rule the user can read at a glance.
  required_entry text not null check (length(required_entry) between 1 and 40),
  instructions text,
  -- In $BASE units of ITS OWN token (18-dec discipline kept per campaign).
  daily_budget numeric(78,0) not null check (daily_budget > 0),
  status text not null default 'active' check (status in ('draft', 'active', 'paused', 'ended')),
  -- THE TRUST BADGE. Granted only by an admin route on a given campaign,
  -- never by the owner; the UI renders the tick against this column and
  -- nothing else.
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists campaigns_owner_idx on begfi.campaigns (owner_id);
create index if not exists campaigns_status_idx on begfi.campaigns (status) where status = 'active';

alter table begfi.campaigns enable row level security;

drop policy if exists campaigns_read_public on begfi.campaigns;
create policy campaigns_read_public on begfi.campaigns
  for select using (true);

-- Only the OWNER writes the resource own campaign (through the server; the
-- policy keeps a browser-direct write from reshaping someone else's page).
drop policy if exists campaigns_write_own on begfi.campaigns;
create policy campaigns_write_own on begfi.campaigns
  for update using (owner_id = (select id from begfi.profiles p where p.id = auth.uid()));

grant select on begfi.campaigns to anon, authenticated;
grant all privileges on begfi.campaigns to service_role;

-- DEPOSITS — the pool's money trail ------------------------------------------

create table if not exists begfi.campaign_deposits (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references begfi.campaigns (id) on delete cascade,
  token_address text not null,
  amount numeric(78,0) not null check (amount > 0),
  depositor text not null check (depositor = lower(depositor)),
  -- Idempotency at event level: a re-scanned window re-credits nothing.
  tx_hash text not null,
  log_index integer not null,
  block_number integer,
  created_at timestamptz not null default now(),
  unique (tx_hash, log_index)
);

create index if not exists campaign_deposits_campaign_idx on begfi.campaign_deposits (campaign_id);

alter table begfi.campaign_deposits enable row level security;

drop policy if exists campaign_deposits_read_public on begfi.campaign_deposits;
create policy campaign_deposits_read_public on begfi.campaign_deposits
  for select using (true);

-- No insert/update policies: deposits are written ONLY by the indexer with
-- the service role. A user claiming a deposit they never made is the exact
-- theft this table must make impossible.
grant select on begfi.campaign_deposits to anon, authenticated;
grant all privileges on begfi.campaign_deposits to service_role;

-- SUBMISSIONS -----------------------------------------------------------------

create table if not exists begfi.campaign_submissions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references begfi.campaigns (id) on delete cascade,
  user_id uuid not null references begfi.profiles (id) on delete cascade,
  username text not null,
  wallet_address text not null check (wallet_address = lower(wallet_address)),
  post_url text not null,
  -- valid: exists on X and carries required_entry (the oEmbed verdict).
  -- rejected: stored WITH the reason — a rejected row is an audit fact,
  -- not a silent drop.
  status text not null default 'valid' check (status in ('valid', 'rejected')),
  verify_note text,
  -- THE PAYOUT BOOKKEEPING, same discipline as earn_submissions: payout_tx
  -- is set only once the transfer CONFIRMS; payout_lease is the send lock
  -- the sweep takes so no double-send can race. These are also why
  -- "one reward per wallet per cycle" is enforceable AFTER the fact:
  -- eligibility is payout_tx IS NULL, not a boolean nobody updates.
  payout_tx text,
  payout_lease timestamp,
  created_at timestamptz not null default now(),
  check (status = 'valid' or verify_note is not null)
);

-- ONE REWARD PER WALLET PER CAMPAIGN PER DAY — enforced by the database, not
-- by a UI promise. (created_at at time zone 'utc')::date is the cycle key.
create unique index if not exists campaign_submissions_wallet_day_idx
  on begfi.campaign_submissions (campaign_id, wallet_address, ((created_at at time zone 'utc')::date));

-- The same post never pays twice, no matter which campaign it targets.
create unique index if not exists campaign_submissions_post_idx
  on begfi.campaign_submissions (campaign_id, post_url);

create index if not exists campaign_submissions_campaign_idx on begfi.campaign_submissions (campaign_id, created_at desc);
create index if not exists campaign_submissions_wallet_idx on begfi.campaign_submissions (wallet_address);

alter table begfi.campaign_submissions enable row level security;

-- Public feed: valid submissions only. A rejected row is visible to its
-- own owner (their wall-of-record) and to admins, nobody else.
drop policy if exists campaign_submissions_read_public on begfi.campaign_submissions;
create policy campaign_submissions_read_public on begfi.campaign_submissions
  for select using (
    status = 'valid'
    or user_id = auth.uid()
  );

drop policy if exists campaign_submissions_insert_own on begfi.campaign_submissions;
create policy campaign_submissions_insert_own on begfi.campaign_submissions
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from begfi.profiles p
      where p.id = auth.uid() and p.username is not null
    )
  );

-- No update policy: verification verdicts and payout marks are server work.
grant select on begfi.campaign_submissions to anon, authenticated;
grant all privileges on begfi.campaign_submissions to service_role;

-- THE PAYOUT LEDGER BECOMES CAMPAIGN-AWARE -----------------------------------
-- One ledger for BegFi's own pool AND every campaign: one payout truth, one
-- lease/no-double-pay mechanism, one admin console.

alter table begfi.earn_payouts
  add column if not exists campaign_id uuid references begfi.campaigns (id) on delete set null,
  add column if not exists token_address text;

alter table begfi.earn_payouts
  drop constraint if exists earn_payouts_wallet_cycle_key;

-- The per-cycle uniqueness now must SCOOPE per campaign: a wallet can be paid
-- by BegFi's pool AND by two different campaigns on the same day, but never
-- twice within one (campaign, cycle). The COALESCE keeps BegFi's own rows
-- (campaign_id null) exactly the old behaviour, under one synthetic uuid.
create unique index if not exists earn_payouts_wallet_cycle_campaign_idx
  on begfi.earn_payouts (
    wallet_address,
    cycle_date,
    coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists earn_payouts_campaign_idx on begfi.earn_payouts (campaign_id, cycle_date);

drop policy if exists earn_payouts_read_public on begfi.earn_payouts;
create policy earn_payouts_read_public on begfi.earn_payouts
  for select using (true);
