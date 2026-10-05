-- Expose the `begfi` schema to PostgREST.
--
-- WITHOUT THIS, NOTHING WORKS. PostgREST only serves the schemas named in its
-- `db-schemas` setting, and BegFi's tables live in `begfi` rather than `public`.
-- Until this runs, every request answers:
--
--     406 PGRST106  Invalid schema: begfi
--     Only the following schemas are exposed: public, graphql_public
--
-- The usual instruction is to add the schema under Settings -> API -> Exposed
-- schemas in the dashboard. That sets exactly the same value; this does it in a
-- migration, where it is versioned alongside the schema it refers to and cannot
-- be forgotten on a fresh project.
--
-- WHY THIS WAS HARD TO NOTICE. supabase-js does not throw on an API error - it
-- returns `{ data: null, error }`. Code that only wraps the call in try/catch
-- therefore treats a 406 as "no rows", and a 406 on a username lookup reads as
-- "that username is free". The availability endpoint reported every name as
-- available for exactly this reason. Errors must be read, not caught.

-- The `authenticator` role is what PostgREST connects as, so the setting lives
-- there. `public` is kept because other projects share this database.
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, begfi';

-- Ask PostgREST to pick the change up now rather than on its next restart.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
