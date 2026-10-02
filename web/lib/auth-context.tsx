"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/shared";
import type { Profile } from "@/lib/types";

/**
 * The signed-in user, if any.
 *
 * Sign-in is a wallet signature (spec §7.3) and the session is a Supabase cookie
 * set by `/api/auth/wallet/verify`. This context only *reads* that session — it
 * never establishes it, so there is exactly one place in the app that can create
 * an account and it is a server route.
 *
 * THE CLIENT IS CONSTRUCTED LAZILY, INSIDE THE CALLS THAT USE IT. That is not a
 * style choice. `createBrowserClient` is a browser client; building one while the
 * server prerenders a page is wrong, and in practice it broke the production
 * build with a TypeError from inside the Supabase bundle. Creating it on demand
 * means it is only ever constructed from an effect or an event handler, both of
 * which run in the browser by definition, and the initial render is therefore
 * identical on the server and on the client — which is also what keeps hydration
 * from mismatching.
 */
type AuthValue = {
  profile: Profile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue>({
  profile: null,
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // `loading` starts true in both places when Supabase is configured, so the
  // server and the first client render agree.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);

  const refresh = useCallback(async () => {
    if (!SUPABASE_CONFIGURED) {
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
        setProfile(null);
        return;
      }

      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      setProfile((data as Profile | null) ?? null);
    } catch {
      // A signed-out visitor is the common case here, not an error worth
      // surfacing: no session simply means no profile.
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
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider value={{ profile, loading, refresh, signOut }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
