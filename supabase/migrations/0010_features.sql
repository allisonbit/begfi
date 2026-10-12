-- Watchlist and notifications, plus the pieces the new UI needs.
--
-- LIMITS OF WHAT WE RECORD, stated here because it decides what the UI may
-- claim: the indexer records quote_amount (volume, confirmed) but NOT the fee
-- split, so a per-creator "fees earned over time" chart needs the tax side of
-- each trade. 0008 fingerprinted CurveBuy/CurveSell with 4 uints; the last two
-- are (fee, tax) per the live curve's event shape. We record `tax_amount` on
-- write so a fee history is real data, not an estimate.

-- ---------------------------------------------------------------------------
-- trades: add the recorded creator tax side
-- ---------------------------------------------------------------------------
alter table begfi.trades
  add column if not exists tax_amount numeric(78, 0) not null default 0;

-- Indexer writes, service role bypasses RLS and later looks up taxes by (token,
-- time) for the fee chart.
create index if not exists trades_token_time_tax_idx
  on begfi.trades (token_address, block_time desc);

-- ---------------------------------------------------------------------------
-- watchlist
-- ---------------------------------------------------------------------------

create table if not exists begfi.watchlist (
  profile_id uuid not null references begfi.profiles (id) on delete cascade,
  token_address text not null
    check (token_address = lower(token_address) and token_address ~ '^0x[0-9a-f]{40}$'),
  -- Both toggles default to on: the point of watching something is paying
  -- attention to it. A pair of booleans rather than JSON so PostgREST-updated
  -- values cannot drift into malformed shapes.
  alert_on_move boolean not null default true,
  alert_on_graduation boolean not null default true,
  created_at timestamptz not null default now(),

  primary key (profile_id, token_address)
);

create index if not exists watchlist_profile_idx on begfi.watchlist (profile_id, created_at desc);
create index if not exists watchlist_token_idx on begfi.watchlist (token_address);

alter table begfi.watchlist enable row level security;

-- Read and write your own watchlist only. The join on profiles is the same
-- shape as begs_insert_own: authorisation lives in the policy, not in a route.
drop policy if exists watchlist_own on begfi.watchlist;
create policy watchlist_own on begfi.watchlist
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

grant select, insert, update, delete on begfi.watchlist to authenticated;
grant all privileges on begfi.watchlist to service_role;

-- Service-role history lookups (large watchlist sweeps for cron alerts).
drop policy if exists watchlist_service on begfi.watchlist;
create policy watchlist_service on begfi.watchlist
  for select to service_role using (true);

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

-- One row per event that happened to the user. Types are constrained rather
-- than free text so the bell cannot be fed a shape no caller renders. The
-- payload column carries the fields the row's renderer needs (token address,
-- hover text, tx hash) as jsonb — flexible, but validated by the writer.
create table if not exists begfi.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references begfi.profiles (id) on delete cascade,

  -- The bell shows five kinds (begs received, fees ready, launch confirmed,
  -- graduation, watchlist alerts) and should not learn a sixth silently.
  kind text not null check (kind in (
    'beg',            -- someone sent $BEG
    'fees',           -- claimable fees crossed a threshold
    'launch',         -- a launch from this wallet was recorded
    'graduation',     -- a watched token left the curve
    'move',           -- a watched token moved past a percent in the window
    'claim',          -- a fee claim succeeded
    'digest'          -- the daily 24h summary, one per profile per day
  )),

  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 280),
  payload jsonb not null default '{}'::jsonb,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_profile_created_idx
  on begfi.notifications (profile_id, created_at desc);
create index if not exists notifications_unread_idx
  on begfi.notifications (profile_id) where read_at is null;

alter table begfi.notifications enable row level security;

-- Read and mark-as-read your own notifications. Create is service-role only:
-- a client that could insert a notification could forge two things at once —
-- someone else's legitimate attention — and the forge would arrive without
-- any on-chain event behind it.
drop policy if exists notifications_own on begfi.notifications;
create policy notifications_own on begfi.notifications
  for select using (profile_id = auth.uid());

drop policy if exists notifications_update_own on begfi.notifications;
create policy notifications_update_own on begfi.notifications
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists notifications_service on begfi.notifications;
create policy notifications_service on begfi.notifications
  for all to service_role using (true) with check (true);

grant select, update on begfi.notifications to authenticated;
grant all privileges on begfi.notifications to service_role;

-- A row notified once stays read even if the same event is encountered again
-- during a reindexed window: service role upserts by this key.
create index if not exists notifications_profile_kind_ref_idx
  on begfi.notifications (profile_id, kind, (payload->>'ref'));
