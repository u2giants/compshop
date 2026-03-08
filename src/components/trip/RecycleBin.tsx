import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, RotateCcw, Store, Factory } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface DeletedTrip {
  id: string;
  store: string;
  date: string;
  location: string | null;
  deleted_at: string;
  type: "shopping" | "asia";
}

interface RecycleBinProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: () => void;
}

export default function RecycleBin({ open, onOpenChange, onRestored }: RecycleBinProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [deleted, setDeleted] = useState<DeletedTrip[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && user) loadDeleted();
  }, [open, user]);

  async function loadDeleted() {
    setLoading(true);
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
    const cutoff = fifteenDaysAgo.toISOString();

    // Query both tables in parallel
    const [{ data: shopData }, { data: chinaData }] = await Promise.all([
      supabase
        .from("shopping_trips")
        .select("id, store, date, location, deleted_at")
        .not("deleted_at", "is", null)
        .gte("deleted_at", cutoff)
        .order("deleted_at", { ascending: false }),
      supabase
        .from("china_trips")
        .select("id, supplier, date, location, deleted_at")
        .not("deleted_at", "is", null)
        .gte("deleted_at", cutoff)
        .order("deleted_at", { ascending: false }),
    ]);

    const shopping: DeletedTrip[] = (shopData || []).map(t => ({
      id: t.id, store: t.store, date: t.date, location: t.location, deleted_at: t.deleted_at!, type: "shopping" as const,
    }));
    const asia: DeletedTrip[] = (chinaData || []).map(t => ({
      id: t.id, store: t.supplier, date: t.date, location: t.location, deleted_at: t.deleted_at!, type: "asia" as const,
    }));

    const combined = [...shopping, ...asia].sort(
      (a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime()
    );
    setDeleted(combined);
    setLoading(false);
  }

  async function handleRestore(trip: DeletedTrip) {
    const table = trip.type === "shopping" ? "shopping_trips" : "china_trips";
    const { error } = await supabase.from(table).update({ deleted_at: null }).eq("id", trip.id);

    if (error) {
      toast({ title: "Error", description: "Failed to restore trip", variant: "destructive" });
      return;
    }

    toast({ title: "Trip restored" });
    setDeleted((prev) => prev.filter((t) => t.id !== trip.id));
    onRestored();
  }

  async function handlePermanentDelete(trip: DeletedTrip) {
    const table = trip.type === "shopping" ? "shopping_trips" : "china_trips";
    const { error } = await supabase.from(table).delete().eq("id", trip.id);

    if (error) {
      toast({ title: "Error", description: "Failed to permanently delete trip", variant: "destructive" });
      return;
    }

    toast({ title: "Trip permanently deleted" });
    setDeleted((prev) => prev.filter((t) => t.id !== trip.id));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-sans flex items-center gap-2">
            <Trash2 className="h-5 w-5" /> Recycling Bin
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground mb-3">Items are permanently deleted after 15 days.</p>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : deleted.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <Trash2 className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Recycling bin is empty</p>
          </div>
        ) : (
          <div className="space-y-2">
            {deleted.map((trip) => {
              const daysLeft = 15 - differenceInDays(new Date(), new Date(trip.deleted_at));
              const Icon = trip.type === "asia" ? Factory : Store;
              return (
                <div key={trip.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <p className="font-medium text-sm truncate">{trip.store}</p>
                      {trip.type === "asia" && (
                        <Badge variant="outline" className="text-[10px]">Asia</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(trip.date), "MMM d, yyyy")}
                      <span className="ml-2">·</span>
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {daysLeft}d left
                      </Badge>
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => handleRestore(trip)} title="Restore">
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handlePermanentDelete(trip)} title="Delete permanently">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
