/**
 * Public Supabase config. Only the URL and the anon (publishable) key live here;
 * both are designed to ship to clients and are protected by row-level security,
 * never the service role key.
 *
 * The `process.env.NEXT_PUBLIC_*` references are intentionally literal so Next
 * inlines them into the client bundle at build time.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * BegFi keeps its tables in their own schema, not `public`.
 *
 * This Supabase project (spgijqgogjugqtjtvunb) is shared with cosmic-oracle-charts,
 * which already occupies `public`. A separate schema makes the two impossible to
 * confuse: BegFi's migrations cannot collide with its tables, its RLS policies
 * cannot read them, and dropping BegFi is one `drop schema` rather than a hunt.
 *
 * The schema must also be listed under Exposed schemas in the project's API
 * settings, or PostgREST answers 404 for every call regardless of RLS.
 */
export const BEGFI_SCHEMA = "begfi";

/** True when the public client can be constructed (auth + RLS-scoped reads). */
export const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
