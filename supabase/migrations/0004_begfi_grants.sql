-- Grant table privileges on the `begfi` schema.
--
-- EXPOSING THE SCHEMA IS NOT ENOUGH. The previous migration told PostgREST to
-- serve `begfi`; this one gives the roles something to serve. Without it every
-- read answers 403, because `grant usage on schema` only allows *resolving* an
-- object, not touching it. The original migration granted usage and nothing else,
-- which went unnoticed because the schema was not exposed, so every request
-- failed earlier at 406 and never reached the permission check.
--
-- RLS IS STILL THE GATE. These grants are deliberately broad — they say which
-- objects a role may touch, not which rows it may see. Every table in this schema
-- has row-level security enabled, and the policies in 0001 decide what an anonymous
-- or signed-in visitor actually reads. A bug here cannot leak a row that a policy
-- does not already allow.
--
-- The service role is granted everything because it is the role that bypasses RLS
-- by design, and is used only by the indexer, sign-in and the claim route.

-- Resolve objects in the schema at all.
grant usage on schema begfi to anon, authenticated, service_role;

-- Tables. `all tables` covers the ones that exist now; the default privileges
-- below cover ones added later, which would otherwise need this migration re-run.
grant select, insert, update, delete on all tables in schema begfi to anon, authenticated;
grant all privileges on all tables in schema begfi to service_role;

-- Sequences, for the bigserial on rate_limits.
grant usage, select on all sequences in schema begfi to anon, authenticated, service_role;

-- Functions. `claim_username` and `check_rate_limit` are `security definer`, so
-- they run with the definer's rights — but the caller still needs EXECUTE to
-- invoke them at all. 0001 granted that to service_role only, on purpose: neither
-- is meant to be callable from a browser.
grant execute on all functions in schema begfi to service_role;

-- Anything created later in this schema gets the same treatment, so a future
-- migration that adds a table does not silently produce another 403.
alter default privileges in schema begfi
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema begfi
  grant usage, select on sequences to anon, authenticated, service_role;
