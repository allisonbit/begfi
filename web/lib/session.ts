import "server-only";

import { createClient } from "@/lib/supabase/server";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import type { Profile } from "@/lib/types";

/**
 * The signed-in account, or null.
 *
 * Returns null rather than redirecting, and that is the point. A redirect from a
 * signed-in page is indistinguishable from a broken link: the previous version
 * sent anyone without a session straight home, so pressing "Dashboard" after
 * connecting a wallet looked like the button did nothing at all. The caller can
 * say what is missing and offer the way in.
 *
 * Runs with the caller's own session, so RLS applies as it would in the browser.
 */
export async function getProfile(): Promise<Profile | null> {
  if (!SUPABASE_CONFIGURED) return null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    return (data as Profile | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether a session exists at all, even one with no username yet.
 *
 * Needed because the two states want different pages: no session means "sign in",
 * whereas a session with no username means "finish claiming your link". Collapsing
 * them is what made a half-made account look signed out.
 */
export async function getSession(): Promise<{ signedIn: boolean; userId: string | null }> {
  if (!SUPABASE_CONFIGURED) return { signedIn: false, userId: null };

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return { signedIn: Boolean(user), userId: user?.id ?? null };
  } catch {
    return { signedIn: false, userId: null };
  }
}
