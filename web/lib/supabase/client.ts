"use client";

import { createBrowserClient } from "@supabase/ssr";
import { BEGFI_SCHEMA, SUPABASE_ANON_KEY, SUPABASE_URL } from "./shared";

/**
 * Browser client. RLS applies: this holds the anon key, so every read and write
 * it makes is judged against the policies in `supabase/migrations`.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: BEGFI_SCHEMA },
  });
}
