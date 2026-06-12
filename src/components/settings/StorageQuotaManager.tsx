import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HardDrive, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STORAGE_KEY = "compshop-cache-quota-mb";
const PERSIST_REQUESTED_KEY = "compshop-persistent-storage-requested";
const DEFAULT_QUOTA_MB = 500;
const MIN_QUOTA_MB = 50;
const MAX_QUOTA_MB = 5000;

export function getStorageQuotaMB(): number {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    return val ? Number(val) : DEFAULT_QUOTA_MB;
  } catch {
    return DEFAULT_QUOTA_MB;
  }
}

export function setStorageQuotaMB(mb: number) {
  localStorage.setItem(STORAGE_KEY, String(mb));
}

export default function StorageQuotaManager() {
  const { toast } = useToast();
  const [quota, setQuota] = useState(getStorageQuotaMB());
  const [usage, setUsage] = useState<{ used: number; total: number } | null>(null);
  const [persistent, setPersistent] = useState<"unsupported" | "unknown" | "granted" | "denied">("unknown");

  useEffect(() => {
    estimateUsage();
    checkPersistentStorage();
  }, []);

  async function estimateUsage() {
    if ("storage" in navigator && "estimate" in navigator.storage) {
      const est = await navigator.storage.estimate();
      setUsage({
        used: est.usage ?? 0,
        total: est.quota ?? 0,
      });
    }
  }

  function handleQuotaChange(val: number[]) {
    const mb = val[0];
    setQuota(mb);
    setStorageQuotaMB(mb);
  }

  async function clearCache() {
    try {
      const { clearImageBlobCache } = await import("@/lib/offline-db");
      await clearImageBlobCache();
      await estimateUsage();
      toast({ title: "Cache cleared", description: "All cached images have been removed." });
    } catch (err) {
      toast({ title: "Error clearing cache", variant: "destructive" });
    }
  }

  async function checkPersistentStorage() {
    if (!("storage" in navigator) || !("persisted" in navigator.storage)) {
      setPersistent("unsupported");
      return;
    }
    const granted = await navigator.storage.persisted();
    if (granted) {
      setPersistent("granted");
      return;
    }
    if (!localStorage.getItem(PERSIST_REQUESTED_KEY) && "persist" in navigator.storage) {
      localStorage.setItem(PERSIST_REQUESTED_KEY, "true");
      const requested = await navigator.storage.persist();
      setPersistent(requested ? "granted" : "denied");
      return;
    }
    setPersistent("denied");
  }

  async function requestPersistentStorage() {
    if (!("storage" in navigator) || !("persist" in navigator.storage)) {
      setPersistent("unsupported");
      return;
    }
    const granted = await navigator.storage.persist();
    setPersistent(granted ? "granted" : "denied");
    toast({
      title: granted ? "Persistent storage enabled" : "Persistent storage not granted",
      description: granted ? "The browser is less likely to evict cached photos." : "The app will keep using normal browser storage.",
    });
  }

  const usedMB = usage ? (usage.used / 1024 / 1024).toFixed(1) : "?";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-sans text-lg">
          <HardDrive className="h-5 w-5" /> Offline Storage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Cache limit</span>
            <Badge variant="secondary">{quota} MB</Badge>
          </div>
          <Slider
            value={[quota]}
            onValueChange={handleQuotaChange}
            min={MIN_QUOTA_MB}
            max={MAX_QUOTA_MB}
            step={50}
            className="mt-2"
          />
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>{MIN_QUOTA_MB} MB</span>
            <span>{MAX_QUOTA_MB / 1000} GB</span>
          </div>
        </div>

        {usage && (
          <div className="text-sm text-muted-foreground">
            Currently using <span className="font-medium text-foreground">{usedMB} MB</span> of device storage
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Eviction protection</span>
          <Badge variant={persistent === "granted" ? "secondary" : "outline"}>
            {persistent === "unsupported" ? "unsupported" : persistent === "granted" ? "enabled" : "not enabled"}
          </Badge>
          {persistent === "denied" && (
            <Button variant="outline" size="sm" onClick={requestPersistentStorage}>
              Enable
            </Button>
          )}
        </div>

        <Button variant="outline" size="sm" className="gap-1" onClick={clearCache}>
          <Trash2 className="h-3.5 w-3.5" /> Clear Cached Images
        </Button>

        <p className="text-xs text-muted-foreground">
          Controls how much space is used to store photos for offline viewing. Older images are automatically removed when the limit is reached.
        </p>
      </CardContent>
    </Card>
  );
}
