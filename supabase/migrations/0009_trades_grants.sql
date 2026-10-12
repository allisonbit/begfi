-- Grant the service role explicit privileges on begfi.trades.
--
-- WHY THIS EXISTS. begfi.trades was created by 0008 AFTER the blanket grants in
-- 0004, and 0004's default privileges only cover tables created in the same
-- session/database scope — on the live project the new table ended up with NO
-- service_role privileges at all. The indexer wrote to it without error because
-- the Supabase `service_role` used by supabase-js bypasses RLS AND the REST
-- layer ran the writes through a role that had ownership-equivalent access
-- server-side — but PostgREST aggregates reads (`select * from trades`) failed
-- with `permission denied for table trades` (42501), so the explore page's
-- volume column and trade counts silently returned empty.
--
-- The fix is the same blanket grant 0004 made for the tables that existed
-- then, applied to this table now. RLS is unaffected: service_role bypasses
-- RLS by design, and anon/authenticated grants are NOT added — a per-trade
-- feed would publish the whole trader graph.
--
-- Idempotent: safe to run again.

grant all privileges on table begfi.trades to service_role;
