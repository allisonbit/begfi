import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { BEGFI_SCHEMA, SUPABASE_ANON_KEY, SUPABASE_URL } from "./shared";

/**
 * Server client for Server Components, Route Handlers and `generateMetadata`.
 *
 * Same anon key and the same RLS as the browser client — this is the signed-in
 * user's session, not an escalation. Anything that has to bypass RLS uses
 * `admin.ts` and must say why at the call site.
 *
 * Next 16 made `cookies()` async. The `setAll` handler is wrapped because a
 * Server Component is not allowed to write cookies; when that throws it is
 * harmless, since middleware refreshes the session on the way in.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: BEGFI_SCHEMA },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component. Middleware handles the refresh.
        }
      },
    },
  });
}
