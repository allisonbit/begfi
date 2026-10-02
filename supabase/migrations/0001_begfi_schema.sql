-- BegFi schema.
--
-- Runs against Supabase project spgijqgogjugqtjtvunb, which is shared with
-- cosmic-oracle-charts. Everything BegFi owns lives in the `begfi` schema so the
-- two applications cannot collide in `public`, and dropping BegFi is one
-- `drop schema begfi cascade` rather than a hunt through someone else's tables.
--
-- AFTER RUNNING THIS, two dashboard steps are still required:
--   1. Settings -> API -> Exposed schemas: add `begfi`.
--      Without it PostgREST answers 404 for every call, regardless of RLS.
--   2. Reload the PostgREST schema cache (or wait for it).
--
-- Migrations are applied by pasting into the SQL editor: the Supabase CLI is not
-- installed on this machine.

create schema if not exists begfi;

-- PostgREST connects as `anon` / `authenticated`; a new schema is not reachable
-- until it is granted. RLS still applies on top of these grants — the grants
-- decide whether a role may touch the schema at all, the policies decide which
-- rows it sees.
grant usage on schema begfi to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table if not exists begfi.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  wallet_address text unique not null
    check (wallet_address = lower(wallet_address) and wallet_address ~ '^0x[0-9a-f]{40}$'),
  -- Lowercase is enforced by the check rather than by citext, so this needs no
  -- extension and the unique index below is genuinely case-insensitive: there is
  -- no uppercase form of a username that could exist as a second account.
  username text unique not null
    check (username = lower(username) and username ~ '^[a-z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) <= 40),
  bio text check (char_length(bio) <= 160),
  avatar_url text,
  x_handle text check (x_handle is null or char_length(x_handle) <= 15),
  x_verified boolean not null default false,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table begfi.profiles enable row level security;

-- Anyone may read a profile that its owner has not hidden. The `is_hidden`
-- test is inside the policy rather than in application code, so a forgotten
-- `where` clause in a new page cannot expose a hidden profile.
drop policy if exists profiles_read_public on begfi.profiles;
create policy profiles_read_public on begfi.profiles
  for select using (is_hidden = false or auth.uid() = id);

-- A profile is created only by the sign-in route (service role) or by the
-- claim RPC below; a client may not insert a row for arbitrary id.
drop policy if exists profiles_update_self on begfi.profiles;
create policy profiles_update_self on begfi.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- No delete policy: a profile is removed by deleting the auth user, which
-- cascades. Letting the client delete the row alone would leave the auth user
-- behind and the username free while the account still exists.


-- ---------------------------------------------------------------------------
-- reserved_usernames
-- ---------------------------------------------------------------------------

create table if not exists begfi.reserved_usernames (
  username text primary key check (username = lower(username)),
  note text
);

alter table begfi.reserved_usernames enable row level security;

-- Readable so the UI can explain *why* a name is refused; not writable by
-- anyone but the service role.
drop policy if exists reserved_read on begfi.reserved_usernames;
create policy reserved_read on begfi.reserved_usernames for select using (true);


-- ---------------------------------------------------------------------------
-- transfers  (written by the indexer, never by a browser)
-- ---------------------------------------------------------------------------

create table if not exists begfi.transfers (
  tx_hash text not null,
  log_index integer not null,
  token_address text not null,
  from_address text not null,
  to_address text not null,
  amount numeric(78,0) not null,
  block_number bigint not null,
  block_time timestamptz not null,
  primary key (tx_hash, log_index)
);

create index if not exists transfers_to_idx on begfi.transfers (to_address, block_time desc);
create index if not exists transfers_block_idx on begfi.transfers (block_number);

alter table begfi.transfers enable row level security;

-- NOT public read, which is what the spec's §11 sketches.
--
-- A publicly readable `transfers` table publishes the entire sender -> recipient
-- graph: every person who has ever sent to anyone, with amounts and times. That
-- is not needed to render a public page, because a public page shows aggregates
-- (see profile_stats). Only the two parties to a transfer may see the row.
drop policy if exists transfers_read_involved on begfi.transfers;
create policy transfers_read_involved on begfi.transfers
  for select using (
    auth.uid() is not null
    and exists (
      select 1 from begfi.profiles p
      where p.id = auth.uid()
        and (p.wallet_address = transfers.to_address or p.wallet_address = transfers.from_address)
    )
  );

-- No insert/update/delete policy at all: the indexer writes with the service
-- role key, which bypasses RLS. A client cannot fabricate a transfer, which is
-- the point — spec §7.4, "never trust the browser's claim that a send happened".


-- ---------------------------------------------------------------------------
-- app_config
-- ---------------------------------------------------------------------------
--
-- Declared BEFORE profile_stats, because the view reads the $BEG address from
-- this table. Postgres resolves a view's dependencies when the view is created,
-- so a definition that names a table declared further down the file fails with
-- "relation does not exist" — the ordering here is load-bearing, not cosmetic.

create table if not exists begfi.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table begfi.app_config enable row level security;

-- Public read so the client can discover the $BEG address without a rebuild.
drop policy if exists app_config_read on begfi.app_config;
create policy app_config_read on begfi.app_config for select using (true);

-- Seeded empty on purpose. The $BEG row is only given a real value once $BEG has
-- actually been launched (spec §9.4); until then the empty string is what tells
-- profile_stats below that there is no token to count yet.
insert into begfi.app_config (key, value)
values ('beg_token_address', '')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- profile_stats  (the public aggregate)
-- ---------------------------------------------------------------------------

/**
 * SECURITY_INVOKER IS LOAD-BEARING.
 *
 * A Postgres view is owned by whoever creates it and, by default, runs with
 * *definer* rights — which means the RLS policies on `profiles` and `transfers`
 * are BYPASSED for any query that goes through the view. As written without it,
 * this view would happily return the totals of hidden profiles and would count
 * the whole transfers table, and every policy in this file would still look
 * correct.
 *
 * `security_invoker = on` (Postgres 15+, which Supabase runs) makes the view run
 * with the caller's rights, so the policies apply. If you ever recreate this
 * view, recreate this option with it.
 */
create or replace view begfi.profile_stats
with (security_invoker = on)
as
select
  p.id as profile_id,
  coalesce(sum(t.amount), 0)::numeric(78,0) as total_received,
  count(distinct t.from_address)::integer as supporters
from begfi.profiles p
left join begfi.transfers t
  on t.to_address = p.wallet_address
 and t.token_address = (select value from begfi.app_config where key = 'beg_token_address')
group by p.id;

grant select on begfi.profile_stats to anon, authenticated;


-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------

create table if not exists begfi.reports (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references begfi.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 500),
  reporter_wallet text,
  created_at timestamptz not null default now()
);

create index if not exists reports_profile_idx on begfi.reports (profile_id, created_at desc);

alter table begfi.reports enable row level security;

-- Anyone may report; nobody but the service role may read the reports. There is
-- deliberately no select policy: reading who reported whom is a way to harass
-- the reporter.
drop policy if exists reports_insert_anyone on begfi.reports;
create policy reports_insert_anyone on begfi.reports for insert with check (true);


-- ---------------------------------------------------------------------------
-- launches  (written by the service role after a confirmed deploy)
-- ---------------------------------------------------------------------------

create table if not exists begfi.launches (
  token_address text primary key check (token_address = lower(token_address)),
  launcher_wallet text not null check (launcher_wallet = lower(launcher_wallet)),
  name text not null,
  ticker text not null,
  image_url text,
  mode text not null check (mode in ('genesis', 'standard')),
  splitter_address text check (splitter_address is null or splitter_address = lower(splitter_address)),
  tx_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists launches_launcher_idx on begfi.launches (launcher_wallet, created_at desc);

alter table begfi.launches enable row level security;

-- Public read: a token page must render for anyone, and a launch is a public
-- on-chain fact. Writes are service-role only.
drop policy if exists launches_read_public on begfi.launches;
create policy launches_read_public on begfi.launches for select using (true);


create table if not exists begfi.launch_blocklist (
  term text primary key check (term = lower(term)),
  note text
);

alter table begfi.launch_blocklist enable row level security;

drop policy if exists launch_blocklist_read on begfi.launch_blocklist;
create policy launch_blocklist_read on begfi.launch_blocklist for select using (true);


-- ---------------------------------------------------------------------------
-- rate_limits  (spec §12 asks for limits; §11 defines no storage for them)
-- ---------------------------------------------------------------------------

create table if not exists begfi.rate_limits (
  id bigserial primary key,
  bucket text not null,
  subject text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limits_lookup_idx
  on begfi.rate_limits (bucket, subject, created_at desc);

alter table begfi.rate_limits enable row level security;

-- Service role only. A client that could read or write this table could both
-- enumerate who has been rate limited and clear its own limit.

/**
 * Record an attempt and report whether the subject is over its allowance.
 *
 * One round trip, and the count and the insert happen together, so two requests
 * arriving at once cannot both read a count of n-1 and both be allowed.
 */
create or replace function begfi.check_rate_limit(
  p_bucket text,
  p_subject text,
  p_max integer,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = begfi, public
as $$
declare
  v_count integer;
begin
  delete from begfi.rate_limits
   where bucket = p_bucket and created_at < now() - p_window;

  select count(*) into v_count
    from begfi.rate_limits
   where bucket = p_bucket
     and subject = p_subject
     and created_at >= now() - p_window;

  if v_count >= p_max then
    return false;
  end if;

  insert into begfi.rate_limits (bucket, subject) values (p_bucket, p_subject);
  return true;
end;
$$;

revoke all on function begfi.check_rate_limit(text, text, integer, interval) from public;
grant execute on function begfi.check_rate_limit(text, text, integer, interval) to service_role;


-- ---------------------------------------------------------------------------
-- claim_username
-- ---------------------------------------------------------------------------

/**
 * Claim a username, atomically.
 *
 * The reserved check and the insert are in one transaction. A check-then-insert
 * in application code has a window where a reserved name passes the check and
 * lands in the table anyway, and that window is exactly the one an attacker
 * would use.
 *
 * Uniqueness is left to the primary key: a concurrent claim of the same name
 * raises a unique-violation, which the caller turns into "that name is taken".
 * Raising a specific errcode lets the route distinguish it from a real failure.
 */
create or replace function begfi.claim_username(
  p_user uuid,
  p_wallet text,
  p_username text
)
returns begfi.profiles
language plpgsql
security definer
set search_path = begfi, public
as $$
declare
  v_profile begfi.profiles;
  v_username text := lower(p_username);
begin
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid_username' using errcode = '22023';
  end if;

  if exists (select 1 from begfi.reserved_usernames r where r.username = v_username) then
    raise exception 'username_reserved' using errcode = 'P0001';
  end if;

  insert into begfi.profiles (id, wallet_address, username)
  values (p_user, lower(p_wallet), v_username)
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke all on function begfi.claim_username(uuid, text, text) from public;
grant execute on function begfi.claim_username(uuid, text, text) to service_role;


-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function begfi.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on begfi.profiles;
create trigger profiles_touch_updated_at
  before update on begfi.profiles
  for each row execute function begfi.touch_updated_at();
