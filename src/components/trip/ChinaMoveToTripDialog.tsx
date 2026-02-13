import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Factory, Calendar } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface ChinaTrip {
  id: string;
  name: string;
  supplier: string;
  venue_type: string;
  date: string;
}

interface ChinaMoveToTripDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photoIds: string[];
  currentTripId: string;
  onMoved: () => void;
}

export default function ChinaMoveToTripDialog({ open, onOpenChange, photoIds, currentTripId, onMoved }: ChinaMoveToTripDialogProps) {
  const { toast } = useToast();
  const [trips, setTrips] = useState<ChinaTrip[]>([]);
  const [loading, setLoading] = useState(false);
  const [moving, setMoving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSearch("");
    supabase
      .from("china_trips")
      .select("id, name, supplier, venue_type, date")
      .is("deleted_at", null)
      .eq("is_draft", false)
      .neq("id", currentTripId)
      .order("date", { ascending: false })
      .then(({ data }) => {
        if (data) setTrips(data);
        setLoading(false);
      });
  }, [open, currentTripId]);

  const filtered = search
    ? trips.filter((t) => t.supplier.toLowerCase().includes(search.toLowerCase()) || t.name.toLowerCase().includes(search.toLowerCase()))
    : trips;

  async function moveToTrip(targetTripId: string) {
    setMoving(true);
    const { error } = await supabase
      .from("china_photos")
      .update({ trip_id: targetTripId })
      .in("id", photoIds);

    if (error) {
      toast({ title: "Failed to move photos", variant: "destructive" });
    } else {
      toast({ title: `${photoIds.length} photo${photoIds.length > 1 ? "s" : ""} moved` });
      onMoved();
      onOpenChange(false);
    }
    setMoving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-sans">Move to China Trip</DialogTitle>
          <DialogDescription>
            Select a destination trip for {photoIds.length} photo{photoIds.length > 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Search trips..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No other China trips found.</p>
        ) : (
          <ScrollArea className="max-h-64">
            <div className="space-y-1">
              {filtered.map((trip) => (
                <button
                  key={trip.id}
                  disabled={moving}
                  onClick={() => moveToTrip(trip.id)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 font-medium truncate">
                      <Factory className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {trip.supplier}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(trip.date), "MMM d, yyyy")}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        {trip.venue_type === "canton_fair" ? "Canton Fair" : "Factory"}
                      </Badge>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
