-- Beg-to-launch: a pre-launch ask with a goal, funded by real transfers to the
-- creator's wallet.
--
-- NON-CUSTODIAL BY CONSTRUCTION. BegFi holds nothing: a supporter sends $BEG
-- from their wallet to the creator's wallet, and the indexer's existing
-- transfer scan is what proves it arrived. No funds ever route through BegFi,
-- no withdrawal exists, and cancelling the ask cannot move money that has
-- already been sent — the page says this in exactly those words.
--
-- UNIQUE ACTIVE ASK. One open launch beg per profile, enforced by a partial
-- unique index on opened rows. A second ask means closing the first first,
-- which from the UI is one click and from the data layer is a race impossible
-- to lose.

create table if not exists begfi.launch_begs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references begfi.profiles (id) on delete cascade,

  -- What supporters are funding. Plain text, same length discipline as begs.
  token_name text not null check (char_length(token_name) between 1 and 32),
  token_ticker text not null check (char_length(token_ticker) between 2 and 10),
  one_liner text not null check (char_length(one_liner) between 1 and 180),

  -- The ask, in $BEG base units (numeric(78,0), same as begs.goal).
  goal numeric(78, 0) not null check (goal > 0),

  -- The creator marks the beg funded by recording the launch tx. /api/launch
  -- verifies the chain before a launch row exists, so "funded_tx" is a pointer
  -- the launch record can be checked against, never a claim on its own.
  funded_at timestamptz,
  funded_tx text,

  created_at timestamptz not null default now()
);

-- Only ONE open ask per creator at a time. NULLs are distinct in Postgres
-- unique indexes unless the expression form is used, hence coalesce.
create unique index if not exists launch_begs_one_active_per_profile
  on begfi.launch_begs (profile_id, coalesce(funded_at, 'infinity'::timestamptz));
create index if not exists launch_begs_active_idx
  on begfi.launch_begs (created_at desc) where funded_at is null;

alter table begfi.launch_begs enable row level security;

-- Public read: an open ask is the whole product of the feature.
drop policy if exists launch_begs_read_public on begfi.launch_begs;
create policy launch_begs_read_public on begfi.launch_begs
  for select using (
    -- Open asks are public; funded ones too (the story "asked, then launched"
    -- is public). Only the profile's hidden state can suppress it, which the
    -- join in the queries already handles for the index.
    true
  );

-- Owner-only create/update, same shape as begs. A launch beg is created
-- through the caller's own session so `profiles.id = auth.uid()` is what the
-- policy checks — not trusting the body's profile id.
drop policy if exists launch_begs_insert_own on begfi.launch_begs;
create policy launch_begs_insert_own on begfi.launch_begs
  for insert with check (
    exists (select 1 from begfi.profiles p where p.id = profile_id and p.id = auth.uid())
    and funded_at is null
  );

drop policy if exists launch_begs_update_own on begfi.launch_begs;
create policy launch_begs_update_own on begfi.launch_begs
  for update using (
    exists (select 1 from begfi.profiles p where p.id = profile_id and p.id = auth.uid())
  );

-- No delete: closing an ask is a funded_at update. Removing a beg entirely
-- would orphan supporters' receipts that reference it.

grant select on begfi.launch_begs to anon, authenticated;
grant select, insert, update on begfi.launch_begs to authenticated;
grant all privileges on begfi.launch_begs to service_role;

-- The launches table gains the optional pointer that links a launch to the
-- beg that raised for it. Nullable: a straight launch with no beg fills
-- nothing and breaks nothing.
alter table begfi.launches
  add column if not exists from_launch_beg uuid references begfi.launch_begs (id) on delete set null;
