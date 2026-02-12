import { useOnlineStatus, useSyncStatus } from "@/hooks/use-online-status";
import { useEffect, useState } from "react";
import { getPendingCount } from "@/lib/sync-service";
import { Cloud, CloudOff, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SyncStatusIndicator() {
  const online = useOnlineStatus();
  const syncStatus = useSyncStatus();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const check = () => getPendingCount().then(setPending);
    check();
    const i = setInterval(check, 5_000);
    return () => clearInterval(i);
  }, [syncStatus]);

  if (online && syncStatus === "idle" && pending === 0) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        !online
          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
          : syncStatus === "syncing"
          ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
          : syncStatus === "error"
          ? "bg-destructive/10 text-destructive"
          : pending > 0
          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
          : "bg-muted text-muted-foreground"
      )}
    >
      {!online ? (
        <>
          <CloudOff className="h-3.5 w-3.5" />
          Offline{pending > 0 ? ` · ${pending} pending` : ""}
        </>
      ) : syncStatus === "syncing" ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Syncing...
        </>
      ) : syncStatus === "error" ? (
        <>
          <AlertCircle className="h-3.5 w-3.5" />
          Sync error · {pending} pending
        </>
      ) : pending > 0 ? (
        <>
          <Cloud className="h-3.5 w-3.5" />
          {pending} pending sync
        </>
      ) : null}
    </div>
  );
}
