import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, RotateCcw, Store } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface DeletedTrip {
  id: string;
  store: string;
  date: string;
  location: string | null;
  deleted_at: string;
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

    const { data } = await supabase
      .from("shopping_trips")
      .select("id, store, date, location, deleted_at")
      .not("deleted_at", "is", null)
      .gte("deleted_at", fifteenDaysAgo.toISOString())
      .order("deleted_at", { ascending: false });

    setDeleted((data as DeletedTrip[]) || []);
    setLoading(false);
  }

  async function handleRestore(id: string) {
    const { error } = await supabase
      .from("shopping_trips")
      .update({ deleted_at: null })
      .eq("id", id);

    if (error) {
      toast({ title: "Error", description: "Failed to restore trip", variant: "destructive" });
      return;
    }

    toast({ title: "Trip restored" });
    setDeleted((prev) => prev.filter((t) => t.id !== id));
    onRestored();
  }

  async function handlePermanentDelete(id: string) {
    const { error } = await supabase
      .from("shopping_trips")
      .delete()
      .eq("id", id);

    if (error) {
      toast({ title: "Error", description: "Failed to permanently delete trip", variant: "destructive" });
      return;
    }

    toast({ title: "Trip permanently deleted" });
    setDeleted((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
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
              return (
                <div key={trip.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Store className="h-4 w-4 text-muted-foreground shrink-0" />
                      <p className="font-medium text-sm truncate">{trip.store}</p>
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
                    <Button size="sm" variant="ghost" onClick={() => handleRestore(trip.id)} title="Restore">
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handlePermanentDelete(trip.id)} title="Delete permanently">
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
