-- Post-to-earn: people post about BegFi on X, submit the post link, and are
-- paid after a human review.
--
-- DESIGN NOTES THAT MATTER:
--
--  * The reward pool is BegFi's own giveaway treasury, not user money. The
--    site's "noncustodial" promise is about other people's begs and sends;
--    this pool is BegFi paying its community. It lives in a distribution
--    wallet the admin funds, and claims are paid from it on-chain.
--  * Manual review BEFORE anything pays is the core anti-abuse control: an
--    approved row credits the wallet, a rejected row pays nothing, and the
--    pool arithmetic happens at approval time, not claim time.
--  * `post_url` is unique — the same post can never pay twice, no matter who
--    submits it or how the ask is phrased.
--  * Rejected rows are visible ONLY to their owner. The live feed policy
--    exposes pending and approved rows; RLS row filters do this properly.

-- Settings are a singleton row. `id` is a boolean tautology that makes the
-- unique-key rule ("there is exactly one settings row") explicit in the data.
create table if not exists begfi.earn_settings (
  id boolean primary key default true,
  -- Reward and pool are in $BEGFI BASE UNITS (18 decimals), same discipline as
  -- transfers: raw integers, no floats, sums exact. 10000 $BEGFI = 1e22.
  reward_per_post numeric(78,0) not null default '10000000000000000000000',
  pool_total numeric(78,0) not null default '10000000000000000000000000',
  pool_remaining numeric(78,0) not null default '10000000000000000000000000',
  daily_limit integer not null default 3 check (daily_limit between 1 and 20),
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  check (pool_remaining >= 0 and pool_remaining <= pool_total)
);

insert into begfi.earn_settings (id) values (true) on conflict (id) do nothing;

create table if not exists begfi.earn_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references begfi.profiles (id) on delete cascade,
  -- Copied at submit time so the feed does not have to join profiles, and so
  -- a renamed username does not rewrite the history of what was shown.
  username text not null,
  wallet_address text not null check (wallet_address = lower(wallet_address)),
  post_url text not null unique,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reward_amount numeric(78,0) not null check (reward_amount > 0),
  -- The payout bookkeeping: an approved row becomes claimable the moment it
  -- is approved; `claimed_at` is set when the claim was STAGED for payment
  -- (before the transfer), and `payout_tx` only after the transfer confirmed.
  -- Rows staged but without a tx are the retry path: the claim route pays
  -- exactly those, so a crash between marking and paying cannot both lose and
  -- double the money.
  claimed_at timestamptz,
  payout_tx text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists earn_submissions_created_idx on begfi.earn_submissions (created_at desc);
create index if not exists earn_submissions_user_idx on begfi.earn_submissions (user_id, created_at desc);

alter table begfi.earn_settings enable row level security;
alter table begfi.earn_submissions enable row level security;

-- Public read: both tables are the page. Submissions show as approved/pending;
-- rejected rows are visible only to the person who submitted them.
drop policy if exists earn_submissions_read_public on begfi.earn_submissions;
create policy earn_submissions_read_public on begfi.earn_submissions
  for select using (
    status in ('pending', 'approved') or user_id = auth.uid()
  );

-- Insert as yourself, and only when the account has a username. The API route
-- does the same check with the service role; this policy keeps a
-- browser-direct write from bypassing it.
drop policy if exists earn_submissions_insert_own on begfi.earn_submissions;
create policy earn_submissions_insert_own on begfi.earn_submissions
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from begfi.profiles p
      where p.id = auth.uid() and p.username is not null
    )
  );

-- No update/delete policies on submissions on purpose: review, approval and
-- claiming are all server actions with the service role, and none of them is
-- something a session should ever be able to do to its own row (a user
-- approving their own post is the exact thing this feature must not allow).

drop policy if exists earn_settings_read_public on begfi.earn_settings;
create policy earn_settings_read_public on begfi.earn_settings
  for select using (true);

-- No update policy on settings: admin writes go through the service role.

grant select on begfi.earn_settings to anon, authenticated;
grant select, insert on begfi.earn_submissions to anon, authenticated;
grant all privileges on begfi.earn_settings, begfi.earn_submissions to service_role;
