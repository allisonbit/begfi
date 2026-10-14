-- Earn becomes a daily pool with automatic payouts.
--
-- THE NEW RULES:
--   * 1 submission per account per day (the daily_limit row is 1).
--   * An approved post is claimable the moment it is submitted — no manual
--     review gate. The controls that keep this honest are the daily cap,
--     the unique post_url, and the pool itself.
--   * pool_remaining refills to pool_total once per UTC day. `pool_day`
--     records which day the current pool belongs to; any debit where the day
--     has rolled over first refills. The daily pool is the whole budget:
--     spent fast, it is gone until tomorrow.
--   * Submission sets claimed_at immediately: the reward is the money, and
--     the claim route's stage->transfer->record retry path pays exactly the
--     rows staged but without a payout tx.

-- 1. The pool-day columns. Nullable so pre-existing rows read "no refill has
--    happened yet"; the refill function treats null as "refill now".
alter table begfi.earn_settings
  add column if not exists pool_day date;

alter table begfi.earn_settings
  add column if not exists pool_refills_at timestamptz;

-- 2. Rule row: reward 10k, pool 1,000,000 $BEGFI per day, one post per day.
update begfi.earn_settings
set reward_per_post = '10000000000000000000000',
    pool_total      = '1000000000000000000000000',
    pool_remaining  = '1000000000000000000000000',
    pool_day        = date_trunc('day', now() at time zone 'utc'),
    daily_limit     = 1,
    is_active       = true,
    updated_at      = now()
where id = true;

-- 3. The refill, as a function so the submit route can call it in the same
--    transaction as its debit. It refills when the UTC date has rolled over
--    (or on the very first call) and returns the remaining after refill.
create or replace function begfi.earn_refill_pool()
returns text
language plpgsql
--(Returns TEXT, not numeric: PostgREST serializes numeric as a JSON number,
-- and a float64 mantissa is 53 bits — a 24-digit base-unit remaining is
-- returned polluted (9500000000000000134217728 instead of 950000…000), and
-- the debit below wrote that contamination back into the pool. ::text keeps
-- the exact digits, the same rule every other big-integer read follows.
-- BigInt(string) in the submit route parses it exactly.
-- SECURITY DEFINER + a pinned search_path: PostgREST calls this with a
-- search_path that does not include the `begfi` schema, so nothing inside
-- the body may rely on an unqualified name. The pinned path (and the
-- definer privilege of the table owner) makes the row lock and the update
-- resolve correctly regardless of the caller's session.
security definer
set search_path = begfi, public, extensions
as $$
declare
  /* FOUR variables, deliberately not reusing `day`: the original body
   * SELECTed the stored pool_day INTO `day` and then immediately
   * overwrote `day` with today's date, so the "has the day rolled
   * over?" check could never see the stored value — and its
   * `earn_settings.pool_day` reference (a table-column expression with
   * nothing in FROM) failed on every call with "missing FROM-clause
   * entry", which the submit route surfaced as "Could not reserve from
   * the pool". That was the whole Earn page outage.
   */
  v_total     numeric(78,0);
  v_remaining numeric(78,0);
  v_stored    date;
  v_today     date;
begin
  select pool_total, pool_remaining, pool_day
    into v_total, v_remaining, v_stored
  from begfi.earn_settings where id = true
  for update;

  v_today := (date_trunc('day', now() at time zone 'utc'))::date;

  if v_stored is null or v_stored < v_today then
    update begfi.earn_settings
    set pool_remaining = v_total,
        pool_day = v_today,
        pool_refills_at = (date_trunc('day', now() at time zone 'utc') + interval '1 day'),
        updated_at = now()
    where id = true;
    v_remaining := v_total;
  end if;

  return v_remaining::text;
end;
$$;

-- 4. Manual review is gone: anything still pending is approved immediately.
update begfi.earn_submissions
set status = 'approved',
    reviewed_at = now()
where status = 'pending';

-- 5. The review console's pending queue legitimately shows nothing on a
--    submit-first product; the admin tab now manages settings and shows the
--    day's payouts instead. The policies are unchanged — admin write access
--    stays service-role only.
