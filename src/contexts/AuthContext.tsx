import React, { createContext, useContext, useEffect, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getUserRoles } from "@/lib/supabase-helpers";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  approvalStatus: "approved" | "pending" | "blocked" | null;
  approvalReason: string | null;
  isApproved: boolean;
  isAdmin: boolean;
  isStoreReadOnly: boolean;
  isChinaReadOnly: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  approvalStatus: null,
  approvalReason: null,
  isApproved: false,
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
  const [approvalStatus, setApprovalStatus] = useState<"approved" | "pending" | "blocked" | null>(null);
  const [approvalReason, setApprovalReason] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(false);

  async function loadAccess(userId: string) {
    setAccessLoading(true);
    try {
      const loadedRoles = await getUserRoles(userId).catch(() => []);
      setRoles(loadedRoles);

      const { data, error } = await supabase
        .from("profiles")
        .select("approval_status, approval_reason")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        // Backward-compatible deploy ordering: if the frontend reaches a DB
        // before the approval migration, existing role-bearing users can still work.
        setApprovalStatus(loadedRoles.includes("admin") || loadedRoles.includes("user") ? "approved" : null);
        setApprovalReason(null);
        return;
      }

      const profile = data as { approval_status?: "approved" | "pending" | "blocked"; approval_reason?: string | null } | null;
      setApprovalStatus(profile?.approval_status ?? (loadedRoles.includes("admin") || loadedRoles.includes("user") ? "approved" : "pending"));
      setApprovalReason(profile?.approval_reason ?? null);
    } finally {
      setAccessLoading(false);
    }
  }

  function clearAccess() {
    setRoles([]);
    setApprovalStatus(null);
    setApprovalReason(null);
  }

  useEffect(() => {
    // 1. Set up listener FIRST (keep synchronous - no async/await)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user) {
          loadAccess(newSession.user.id);
        } else {
          clearAccess();
        }

        setAuthLoading(false);
      }
    );

    // 2. Then get initial session
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
      setUser(initialSession?.user ?? null);

      if (initialSession?.user) {
        loadAccess(initialSession.user.id);
      } else {
        clearAccess();
      }

      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const isAdmin = roles.includes("admin");
  const isApproved = isAdmin || approvalStatus === "approved";
  // Admin always bypasses readonly restrictions
  const isStoreReadOnly = !isAdmin && roles.includes("store_readonly");
  const isChinaReadOnly = !isAdmin && roles.includes("china_readonly");
  const loading = authLoading || accessLoading;

  return (
    <AuthContext.Provider value={{ session, user, approvalStatus, approvalReason, isApproved, isAdmin, isStoreReadOnly, isChinaReadOnly, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
