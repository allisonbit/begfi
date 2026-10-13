-- Earn anti-farm: one submission per DEVICE per day and per IP per day.
--
-- WHY BOTH. A pool that pays automatically on submit is only as honest as
-- the cap around it. The account cap (1/day, from 0013) is trivial to
-- multi-account around: a farm of ten wallets on one phone would drain 10
-- rewards a day from the same hardware. So the day is budgeted per device
-- fingerprint AND per IP:
--
--   * device: one submission per browser fingerprint per UTC day. The client
--     computes a stable fingerprint (canvas + screen + locale + tz) and sends
--     it with the submit; it is hashed server-side before it touches the
--     database, so a raw fingerprint is not stored.
--   * ip: one submission per IP address per UTC day. This is the backstop a
--     fingerprint cannot be: it does not depend on client cooperation, and a
--     user-agent can be faked but a shared-exit IP cannot be distributed the
--     way a fingerprint can (it depends on network path).
--
-- One submission is recorded per (bucket, subject) per day window by the
-- existing check_rate_limit function, which is transactional: two requests
-- arriving on the same device in the same tick cannot both be allowed.

-- Device fingerprints for THIS bucket live in the same rate_limits table the
-- rest of the site uses, with a distinct bucket name. No new tables.
-- The window is pinned to the UTC day: 'PT24H' would drift.
create or replace function begfi.earn_utc_day_window()
returns interval
language sql
as $$
  select now() - date_trunc('day', now() at time zone 'utc');
$$;

revoke all on function begfi.earn_utc_day_window() from public;
grant execute on function begfi.earn_utc_day_window() to service_role;
