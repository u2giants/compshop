import React, { createContext, useContext, useState } from "react";

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
