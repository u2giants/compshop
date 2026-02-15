import React, { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppMode = "store_shopping" | "china_trip";

interface AppModeContextType {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

const AppModeContext = createContext<AppModeContextType>({
  mode: "store_shopping",
  setMode: () => {},
});

export function AppModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<AppMode>(
    () => (localStorage.getItem("app_mode") as AppMode) || "store_shopping"
  );
  const [initialised, setInitialised] = useState(false);

  // On first mount, load the user's default_mode from their profile (if no local override exists)
  useEffect(() => {
    if (initialised) return;
    const stored = localStorage.getItem("app_mode");
    if (stored) { setInitialised(true); return; }

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setInitialised(true); return; }
      supabase
        .from("profiles")
        .select("default_mode")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          if (data && (data as any).default_mode) {
            const dm = (data as any).default_mode as AppMode;
            setMode(dm);
            localStorage.setItem("app_mode", dm);
          }
          setInitialised(true);
        });
    });
  }, [initialised]);

  const handleSetMode = (m: AppMode) => {
    setMode(m);
    localStorage.setItem("app_mode", m);
  };

  return (
    <AppModeContext.Provider value={{ mode, setMode: handleSetMode }}>
      {children}
    </AppModeContext.Provider>
  );
}

export const useAppMode = () => useContext(AppModeContext);
