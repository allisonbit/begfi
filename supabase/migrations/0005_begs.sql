-- Begs: the short messages a person writes to share.
--
-- A "beg" is a line someone writes about what they are asking for — "save up for
-- a new laptop", "help me get to the fight in March" — which BegFi turns into a
-- link with its own generated image, so posting it to X or Telegram shows the
-- words rather than a bare URL.
--
-- WHY THIS IS STORED RATHER THAN PUT IN THE URL. A message could be carried in a
-- query string, but those get truncated by chat clients, mangled by link
-- previews, and are unreadable. A row gives a short stable link, a history of
-- what someone has asked for, and one place a beg can be edited or removed
-- without every shared copy going stale.

create table if not exists begfi.begs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references begfi.profiles (id) on delete cascade,

  -- Plain text, and the column says so. Spec §12: a beg that could carry links or
  -- markup turns every shared image into a place to phish from, and the fix is
  -- that the field cannot contain them rather than that each renderer escapes
  -- them carefully. 180 characters is about what fits on a share card legibly.
  body text not null check (char_length(body) between 1 and 180),

  -- An optional amount asked for, in base units. Nullable because most begs are
  -- open-ended, and a numeric(78,0) because it is a token amount and must not be
  -- a float.
  goal numeric(78, 0),

  created_at timestamptz not null default now()
);

create index if not exists begs_profile_idx on begfi.begs (profile_id, created_at desc);

alter table begfi.begs enable row level security;

-- Public read: the whole point is that the link works for whoever it is sent to,
-- including a crawler that has never seen the site.
drop policy if exists begs_read_public on begfi.begs;
create policy begs_read_public on begfi.begs for select using (true);

-- Owner-only write, and insert is additionally constrained to the caller's own
-- profile so a row cannot be created claiming to be someone else's beg.
drop policy if exists begs_insert_own on begfi.begs;
create policy begs_insert_own on begfi.begs
  for insert with check (
    exists (select 1 from begfi.profiles p where p.id = profile_id and p.id = auth.uid())
  );

drop policy if exists begs_update_own on begfi.begs;
create policy begs_update_own on begfi.begs
  for update using (
    exists (select 1 from begfi.profiles p where p.id = profile_id and p.id = auth.uid())
  );

drop policy if exists begs_delete_own on begfi.begs;
create policy begs_delete_own on begfi.begs
  for delete using (
    exists (select 1 from begfi.profiles p where p.id = profile_id and p.id = auth.uid())
  );

-- Grants are also handled by 0004's ALTER DEFAULT PRIVILEGES, but stating them
-- here means this migration is correct on its own if it is ever the first one run.
grant select on begfi.begs to anon, authenticated;
grant select, insert, update, delete on begfi.begs to authenticated;
grant all privileges on begfi.begs to service_role;
