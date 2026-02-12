import { useState, useEffect, useSyncExternalStore } from "react";
import { onSyncStatusChange, getSyncStatus, type SyncStatus } from "@/lib/sync-service";

export function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return online;
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(onSyncStatusChange, getSyncStatus);
}
