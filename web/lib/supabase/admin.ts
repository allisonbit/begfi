import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { BEGFI_SCHEMA, SUPABASE_URL } from "./shared";

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * The only legitimate uses in this app are the ones that write data no user is
 * allowed to write: the indexer recording confirmed transfers, and the sign-in
 * route creating a profile row. Everything else must go through `server.ts` so
 * that a bug in a page cannot quietly become a privacy bug.
 *
 * Never import this from a Client Component — `server-only` turns that into a
 * build error rather than a leaked key.
 */
export function createAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. The indexer and sign-in routes need it; " +
        "set it in .env.local (and in Vercel) rather than falling back to the anon key.",
    );
  }

  return createSupabaseClient(SUPABASE_URL, serviceKey, {
    db: { schema: BEGFI_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
