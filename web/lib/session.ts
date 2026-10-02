import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import type { Profile } from "@/lib/types";

/**
 * The signed-in account, or a redirect.
 *
 * Every `/dashboard` page starts here. It runs on the server with the caller's
 * own session, so RLS decides what it can read — this helper narrows the three
 * ways a request can fail to reach a dashboard, and sends each somewhere useful
 * rather than showing an error:
 *
 *   - no Supabase configured  -> home (there is nothing to sign in to)
 *   - no session              -> home, where the claim field starts sign-in
 *   - session but no username -> the claim step, because an account with no
 *                                username has no link and nothing to show
 *
 * An account in that third state is real but half-made: the wallet signed in,
 * the username was never claimed. Sending it to a dashboard of zeros would be
 * technically accurate and useless.
 */
export async function requireProfile(): Promise<Profile> {
  if (!SUPABASE_CONFIGURED) redirect("/");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();

  if (!data) redirect("/#claim");

  return data as Profile;
}
