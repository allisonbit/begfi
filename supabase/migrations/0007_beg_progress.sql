-- Public progress for a beg.
--
-- A beg page is public: whoever holds the link should see how far along it is,
-- including someone who has never visited the site. But the RLS policy on
-- `transfers` allows a row to the two addresses involved and nobody else, which
-- is deliberate — it stops the whole sender-to-recipient graph being readable.
--
-- So progress cannot be a query from the page. It is an aggregate instead: one
-- number, computed here, exposed to anyone. That leaks exactly what the profile
-- page already shows publicly (a total received) and nothing more — no sender
-- addresses, no individual transfers, no timings.
--
-- SECURITY DEFINER, because the function runs with the definer's rights and can
-- therefore sum rows the caller cannot read. That is the entire reason it exists,
-- and it is why the body does nothing but aggregate: a definer function that
-- returned rows, or took an arbitrary query, would be a hole straight through the
-- policies it is sitting behind.
-- RETURNS TEXT, NOT numeric — changed by migration 0026 for the reason
-- migration 0013 had already documented once (see `earn_refill_pool`):
-- PostgREST serializes numeric as a JSON number, a float64 mantissa is 53 bits,
-- and a 24-digit base-unit amount therefore comes back as `1e+22` — which is both
-- lossy and unparseable by `BigInt`. `::text` keeps the exact digits. Edited here
-- as well as in 0026 because `scripts/migrate.js` re-runs every file in order and
-- a return type cannot be changed by CREATE OR REPLACE: leaving `numeric` here
-- would abort the whole run at this file.
create or replace function begfi.received_since(p_wallet text, p_since timestamptz)
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

-- Callable by anyone, including a signed-out visitor reading a shared link.
revoke all on function begfi.received_since(text, timestamptz) from public;
grant execute on function begfi.received_since(text, timestamptz) to anon, authenticated, service_role;
