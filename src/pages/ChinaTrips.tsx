import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getSignedPhotoUrl } from "@/lib/supabase-helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, MapPin, Factory, Plus, Filter, X, Trash2, CheckSquare } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface ChinaTrip {
  id: string;
  name: string;
  supplier: string;
  venue_type: string;
  date: string;
  location: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  is_draft: boolean;
  photo_count?: number;
  cover_url?: string;
}

export default function ChinaTrips() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [trips, setTrips] = useState<ChinaTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState("");
  const [filterVenue, setFilterVenue] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    loadTrips();

    const channel = supabase
      .channel("china-trips-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "china_trips" }, () => loadTrips())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  async function loadTrips() {
    try {
      const { data } = await supabase
        .from("china_trips")
        .select("*")
        .is("deleted_at", null)
        .eq("is_draft", false)
        .order("date", { ascending: false });

      if (data) {
        const tripsWithCounts = await Promise.all(
          data.map(async (trip) => {
            const [{ count: photoCount }, coverResult] = await Promise.all([
              supabase.from("china_photos").select("*", { count: "exact", head: true }).eq("trip_id", trip.id),
              supabase.from("china_photos").select("file_path").eq("trip_id", trip.id).order("created_at", { ascending: true }).limit(1),
            ]);

            let cover_url: string | undefined;
            if (coverResult.data?.[0]?.file_path) {
              try { cover_url = await getSignedPhotoUrl(coverResult.data[0].file_path); } catch {}
            }

            return { ...trip, photo_count: photoCount ?? 0, cover_url };
          })
        );
        setTrips(tripsWithCounts);
      }
    } catch (err) {
      console.error("[ChinaTrips] Error loading trips", err);
    }
    setLoading(false);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exitSelectMode() { setSelectMode(false); setSelected(new Set()); }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const now = new Date().toISOString();
    const { error } = await supabase.from("china_trips").update({ deleted_at: now }).in("id", ids);
    if (error) { toast({ title: "Error", description: "Failed to delete trips", variant: "destructive" }); return; }
    const deletedCount = ids.length;
    setTrips((prev) => prev.filter((t) => !ids.includes(t.id)));
    exitSelectMode();
    const { dismiss } = toast({
      title: `${deletedCount} trip${deletedCount > 1 ? "s" : ""} deleted`,
      action: (
        <Button variant="outline" size="sm" onClick={async () => {
          await supabase.from("china_trips").update({ deleted_at: null }).in("id", ids);
          dismiss();
          loadTrips();
        }}>Undo</Button>
      ),
      duration: 8000,
    });
  }

  const filteredTrips = trips.filter((trip) => {
    if (filterDate && trip.date !== filterDate) return false;
    if (filterVenue && trip.venue_type !== filterVenue) return false;
    return true;
  });

  const uniqueDates = [...new Set(trips.map((t) => t.date))].sort((a, b) => b.localeCompare(a));
  const hasFilters = filterDate || filterVenue;

  return (
    <div className="container py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-sans text-3xl md:text-4xl">China Trips</h1>
          <p className="mt-1 text-muted-foreground hidden md:block">Factory visits & Canton Fair sourcing intel</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {selectMode ? (
            <>
              <span className="text-sm text-muted-foreground">{selected.size} selected</span>
              <Button variant="destructive" size="sm" disabled={selected.size === 0} onClick={handleBulkDelete} className="gap-1">
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={exitSelectMode}>Cancel</Button>
            </>
          ) : (
            <>
              <Button onClick={() => navigate("/china/new")} className="gap-2">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New Trip</span>
              </Button>
              {trips.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setSelectMode(true)} className="gap-1">
                  <CheckSquare className="h-4 w-4" /> Select
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      {trips.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 md:gap-3">
          <Filter className="h-4 w-4 text-muted-foreground hidden md:block" />
          <Select value={filterDate} onValueChange={setFilterDate}>
            <SelectTrigger className="w-[130px] md:w-[160px]">
              <SelectValue placeholder="Filter by date" />
            </SelectTrigger>
            <SelectContent>
              {uniqueDates.map((d) => (
                <SelectItem key={d} value={d}>{format(new Date(d), "MMM d, yyyy")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterVenue} onValueChange={setFilterVenue}>
            <SelectTrigger className="w-[140px] md:w-[180px]">
              <SelectValue placeholder="Venue type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="canton_fair">Canton Fair</SelectItem>
              <SelectItem value="factory_visit">Factory Visit</SelectItem>
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => { setFilterDate(""); setFilterVenue(""); }}>
              <X className="h-3 w-3" /> Clear
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-5">
                <div className="h-5 w-2/3 rounded bg-muted" />
                <div className="mt-3 h-4 w-1/2 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredTrips.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Factory className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h2 className="font-sans text-xl">{hasFilters ? "No matching trips" : "No China trips yet"}</h2>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              {hasFilters
                ? "Try adjusting your filters."
                : "Create your first China trip to start capturing supplier and factory intel."}
            </p>
            {!hasFilters && (
              <Button onClick={() => navigate("/china/new")} className="mt-6 gap-2">
                <Plus className="h-4 w-4" /> Create First Trip
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTrips.map((trip) => {
            const isSelected = selected.has(trip.id);
            return (
              <Card
                key={trip.id}
                className={`cursor-pointer overflow-hidden transition-shadow hover:shadow-md ${selectMode && isSelected ? "ring-2 ring-primary" : ""}`}
                onClick={() => {
                  if (selectMode) toggleSelect(trip.id);
                  else navigate(`/china/${trip.id}`);
                }}
              >
                {trip.cover_url ? (
                  <div className="relative h-36 w-full">
                    <img src={trip.cover_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                    {selectMode && (
                      <div className="absolute top-2 left-2">
                        <Checkbox checked={isSelected} className="h-5 w-5 border-white bg-black/30 data-[state=checked]:bg-primary" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="relative flex h-24 items-center justify-center bg-muted">
                    <Factory className="h-8 w-8 text-muted-foreground/30" />
                    {selectMode && (
                      <div className="absolute top-2 left-2">
                        <Checkbox checked={isSelected} className="h-5 w-5 data-[state=checked]:bg-primary" />
                      </div>
                    )}
                  </div>
                )}
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-sans font-medium truncate">{trip.supplier}</span>
                    <span className="text-muted-foreground shrink-0">·</span>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {trip.venue_type === "canton_fair" ? "Canton Fair" : "Factory"}
                    </Badge>
                    <span className="text-muted-foreground shrink-0">·</span>
                    <span className="text-muted-foreground shrink-0">{format(new Date(trip.date), "MMM d, yyyy")}</span>
                    <span className="text-muted-foreground shrink-0">·</span>
                    <span className="text-muted-foreground shrink-0">{trip.photo_count ?? 0} photos</span>
                  </div>
                  {trip.location && (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{trip.location}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
