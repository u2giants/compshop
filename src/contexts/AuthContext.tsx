import React, { createContext, useContext, useEffect, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getUserRoles } from "@/lib/supabase-helpers";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isAdmin: boolean;
  isStoreReadOnly: boolean;
  isChinaReadOnly: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  isAdmin: false,
  isStoreReadOnly: false,
  isChinaReadOnly: false,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  function loadRoles(userId: string) {
    getUserRoles(userId)
      .then(setRoles)
      .catch(() => setRoles([]));
  }

  useEffect(() => {
    // 1. Set up listener FIRST (keep synchronous - no async/await)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setLoading(false);

        if (newSession?.user) {
          loadRoles(newSession.user.id);
        } else {
          setRoles([]);
        }
      }
    );

    // 2. Then get initial session
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
      setUser(initialSession?.user ?? null);
      setLoading(false);

      if (initialSession?.user) {
        loadRoles(initialSession.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const isAdmin = roles.includes("admin");
  // Admin always bypasses readonly restrictions
  const isStoreReadOnly = !isAdmin && roles.includes("store_readonly");
  const isChinaReadOnly = !isAdmin && roles.includes("china_readonly");

  return (
    <AuthContext.Provider value={{ session, user, isAdmin, isStoreReadOnly, isChinaReadOnly, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
