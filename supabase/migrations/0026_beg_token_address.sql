-- THE SITE'S TOKEN ADDRESS, SET — six weeks of zeros explained.
--
-- WHAT WAS WRONG. `app_config.beg_token_address` is seeded as `''` in migration
-- 0001, and NOTHING in the codebase ever writes it. Its own seed comment says
-- why it starts blank: "the `$BEG` row is only given a real value once `$BEG`
-- has actually been launched (spec §9.4); until then the empty string is what
-- tells `profile_stats` that there is no token to count yet."
--
-- $BEGFI launched on 2026-10-14. The row was never given its value. So every
-- reader that filters on it has been comparing against the empty string:
--
--   * `begfi.received_since(p_wallet, p_since)` (migration 0007) — which is what
--     `/beg/<id>` progress, the beg's OG card and `/pay/<id>`'s received total
--     all read. All of them returned 0, always, for every wallet, however much
--     money had actually arrived. A beg could be fully funded and still show an
--     empty progress bar.
--   * `begfi.profile_stats` (migration 0001) — the profile page's received
--     total, same filter, same zero.
--
-- The failure mode is the expensive kind: nothing errored, nothing looked
-- broken, and the number was simply wrong in a way that told users the product
-- did not work. It was found by a test of the pay-link's received total, which
-- asserted a non-zero amount for a wallet with a confirmed 10,000 $BEGFI
-- transfer recorded — and got 0.
--
-- THE VALUE IS THE PINNED CONTRACT, not an environment variable: `$BEGFI`'s
-- address is pinned in `web/lib/config.ts` (`TOKEN_CA`) and is deliberately not
-- env-overridable (D-002), so a machine whose `.env.local` still carries the
-- pre-relaunch address cannot be allowed to win here either. The value below is
-- that pin, written out because SQL cannot import TypeScript.
--
-- THE DURABLE FIX IS NOT THIS MIGRATION, it is the indexer's new sync of this
-- row from `BEG_TOKEN_ADDRESS` on every run (`/api/cron/indexer`). A migration
-- fixes the value once; the sync means the row can never drift from the pin
-- again — which is the actual defect, not the blank string.
update begfi.app_config
   set value = '0x18823d1f1807ce3bdd90aafb7473928bc9368242',
       updated_at = now()
 where key = 'beg_token_address';

-- ---------------------------------------------------------------------------
-- AND THE READERS THAT WERE ONLY EVER RETURNING ZERO BECAUSE OF IT
-- ---------------------------------------------------------------------------
-- Fixing the config value exposes a second, independent defect that the zero
-- was hiding — the same class migration 0013 already solved once for
-- `earn_refill_pool`, in its own words: "Returns TEXT, not numeric: PostgREST
-- serializes numeric as a JSON number, and a float64 mantissa is 53 bits — a
-- 24-digit base-unit amount comes back polluted, so `::text` keeps the exact
-- digits."
--
-- `received_since` and `profile_stats.total_received` both returned `numeric`.
-- With the token filter matching nothing they returned 0, and `BigInt(0)`
-- parses happily — so nothing complained. The moment they return a real amount,
-- the value crosses PostgREST as a JSON number, becomes a float64, and reaches
-- JavaScript as `1e+22`. `BigInt("1e+22")` throws, and `String(1e+22)` loses the
-- digits that a money total is made of. Verified, not theorised: the pay-link
-- page 500'd with `SyntaxError: Cannot convert 1e+22 to a BigInt` on the first
-- run after the config was set.
--
-- Both now return TEXT. Every call site already treats the value as a string
-- and hands it to `BigInt`, so the digits arrive exact and nothing else changes.

-- A return type cannot be changed by CREATE OR REPLACE, so this is a drop and a
-- recreate — which also drops the grants, hence the two lines after it.
-- Reproduced in full rather than referenced, so this file alone says what the
-- function does today.
drop function if exists begfi.received_since(text, timestamptz);

create function begfi.received_since(p_wallet text, p_since timestamptz)
returns text
language sql
security definer
stable
set search_path = begfi, public
as $$
  select coalesce(sum(amount), 0)::numeric(78, 0)::text
    from begfi.transfers
   where to_address = lower(p_wallet)
     and block_time > p_since
     and token_address = (select value from begfi.app_config where key = 'beg_token_address');
$$;

revoke all on function begfi.received_since(text, timestamptz) from public;
grant execute on function begfi.received_since(text, timestamptz) to anon, authenticated, service_role;

-- `profile_stats` needs BOTH: money as text for display, and a numeric column to
-- ORDER BY. PostgREST would serialize a numeric into a lossy float, but the
-- leaderboard's ordering is computed inside Postgres, where `numeric` is exact —
-- so the ranking is done on `total_received_units` and the number a person reads
-- comes from `total_received`. Ordering by the text column instead would sort
-- "9" above "10000", which is a leaderboard that is simply wrong.
--
-- `security_invoker = on` is NOT optional and is the reason this view can be
-- recreated at all: it makes the policies on `transfers` apply to the caller, so
-- a hidden profile and the sender graph stay protected. Dropping the view drops
-- the option with it, so it is restated here.
drop view if exists begfi.profile_stats;

create view begfi.profile_stats
with (security_invoker = on)
as
select
  p.id as profile_id,
  coalesce(sum(t.amount), 0)::numeric(78,0)::text as total_received,
  coalesce(sum(t.amount), 0)::numeric(78,0) as total_received_units,
  count(distinct t.from_address)::integer as supporters
from begfi.profiles p
left join begfi.transfers t
  on t.to_address = p.wallet_address
 and t.token_address = (select value from begfi.app_config where key = 'beg_token_address')
group by p.id;

grant select on begfi.profile_stats to anon, authenticated;

-- ---------------------------------------------------------------------------
-- AND THE PUBLIC PROFILE TOTAL, WHICH WAS 0 FOR EVERY VISITOR
-- ---------------------------------------------------------------------------
-- `profile_stats` is `security_invoker`, deliberately (see migration 0001): the
-- policies on `transfers` apply to the caller, so a hidden profile and the whole
-- sender graph stay private. The consequence is that an ANONYMOUS visitor —
-- which is what most visitors to a public profile are — cannot see any transfer
-- rows, so the view sums to 0 for them. Every public profile has been showing
-- "0 $BEGFI received from 0 supporters" to everyone who was not signed in as an
-- involved party, while the leaderboard (which reads with the service role)
-- showed the same wallet's real total. Two pages, two answers, one of them
-- plainly wrong to the person reading it.
--
-- THE FIX IS THE MECHANISM MIGRATION 0007 ALREADY ESTABLISHED for beg progress:
-- a SECURITY DEFINER aggregate that returns ONE NUMBER to anyone, and nothing
-- else. It cannot return rows, cannot take a query, and is granted explicitly to
-- `anon` — so a public total is readable without `transfers` becoming a public
-- table. This is what `received_since` does for a beg; this does it for a
-- profile, with the supporters count the profile page also prints.
--
-- (`profile_stats` is KEPT and still used — the leaderboard orders by it with the
-- service role, where RLS is not in the way and `total_received_units` can be
-- sorted exactly.)
create or replace function begfi.public_wallet_totals(p_wallet text, p_since timestamptz)
returns table (received text, supporters integer)
language sql
security definer
stable
set search_path = begfi, public
as $$
  select coalesce(sum(amount), 0)::numeric(78, 0)::text,
         count(distinct from_address)::integer
    from begfi.transfers
   where to_address = lower(p_wallet)
     and block_time > p_since
     and token_address = (select value from begfi.app_config where key = 'beg_token_address');
$$;

revoke all on function begfi.public_wallet_totals(text, timestamptz) from public;
grant execute on function begfi.public_wallet_totals(text, timestamptz) to anon, authenticated, service_role;
