"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);

  // Constructed once. `createClient` throws on an empty URL, so a deployment
  // without Supabase env vars degrades to "signed out" instead of crashing the
  // whole page — the app has honest unconfigured states and this is one of them.
  const supabase = useMemo(() => (SUPABASE_CONFIGURED ? createClient() : null), []);

  const refresh = useCallback(async () => {
    if (!supabase) {
      setProfile(null);
      setLoading(false);
      return;
    }

    try {
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
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    setProfile(null);
  }, [supabase]);

  return (
    <AuthContext.Provider value={{ profile, loading, refresh, signOut }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
