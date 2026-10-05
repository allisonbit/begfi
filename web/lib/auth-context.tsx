"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import type { Profile } from "@/lib/types";

/**
 * The signed-in user, if any.
 *
 * TWO DIFFERENT FACTS, and conflating them broke the product. `signedIn` says a
 * session exists; `profile` says a username has been claimed. They are not the
 * same, because signing in creates an auth account and claiming creates the
 * profile row — an account can be signed in and have no profile at all.
 *
 * The claim form previously tested only `profile` to decide whether to sign in
 * or to claim, so a signed-in visitor with no username looked signed out: it
 * started a fresh sign-in instead of claiming, every single time, and the
 * username could never be claimed. That is the loop.
 *
 * The browser client is constructed lazily, inside the calls that use it.
 * `createBrowserClient` is a browser client; building one while the server
 * prerenders a page is wrong and broke the production build, and doing it here
 * means the initial render is identical on the server and the client, which is
 * what keeps hydration from mismatching.
 */
type AuthValue = {
  /** A Supabase session exists. */
  signedIn: boolean;
  /**
   * The session's user id.
   *
   * Needed by uploads, and it has to come from here rather than from the profile:
   * storage paths begin with this id because that is what the bucket policy
   * compares against `auth.uid()`. A launcher who has signed in but not claimed a
   * username has no profile, and would otherwise have no id to upload under.
   */
  userId: string | null;
  /** A username has been claimed. Null when signed in without one. */
  profile: Profile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue>({
  signedIn: false,
  userId: null,
  profile: null,
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);

  const refresh = useCallback(async () => {
    if (!SUPABASE_CONFIGURED) {
      setSignedIn(false);
      setUserId(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setSignedIn(false);
        setUserId(null);
        setProfile(null);
        return;
      }

      // Signed in. Whether there is a profile is a second, separate question.
      setSignedIn(true);
      setUserId(user.id);
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      setProfile((data as Profile | null) ?? null);
    } catch {
      // No session is the common case here, not an error worth surfacing.
      setSignedIn(false);
      setUserId(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    if (SUPABASE_CONFIGURED) {
      try {
        await createClient().auth.signOut();
      } catch {
        /* already signed out, or storage unavailable */
      }
    }
    setSignedIn(false);
    setUserId(null);
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider value={{ signedIn, userId, profile, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
