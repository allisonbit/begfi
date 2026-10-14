-- Weekly Beg Battles: the Top-3 receivers of each week, persisted so the
-- badge survives the reset.
--
-- THE SHAPE OF A WEEK. Monday 00:00 UTC is the boundary, both for the live
-- ranking computed from confirmed transfers and for the winners frozen here.
-- The week key is the ISO Monday date as text — stable, comparable, and the
-- same string in every timezone-agnostic read.
--
-- WHO WRITES IT. The indexer cron (daily) freezes the previous week's Top-3
-- the first time it runs after the boundary. A week with no transfers at all
-- writes an empty winners list — a real state, shown honestly.
--
-- WHAT A WINNER CARRIES. username and wallet at the time of freezing: the
-- badge is a historical fact, so a later rename cannot rewrite it.
--
-- (Socials migration moved to 0020: profiles gain x/telegram/website links
-- and an X verification record, in their own migration to keep each one
-- readable.)

create table if not exists begfi.battle_winners (
  week_start date primary key,
  winners jsonb not null default '[]'::jsonb,
  frozen_at timestamptz not null default now(),
  check (jsonb_typeof(winners) = 'array')
);

alter table begfi.battle_winners enable row level security;

drop policy if exists battle_winners_read_public on begfi.battle_winners;
create policy battle_winners_read_public on begfi.battle_winners
  for select using (true);

-- Write access is service-role only: the badge must not be self-awardable.

grant select on begfi.battle_winners to anon, authenticated;
grant all privileges on begfi.battle_winners to service_role;
