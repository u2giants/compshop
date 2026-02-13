import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cacheTrips, getCachedTrips, type CachedTrip } from "@/lib/offline-db";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useRetailers } from "@/hooks/use-retailers";
import { getSignedPhotoUrl, uploadPhoto } from "@/lib/supabase-helpers";
import { extractExif, distanceKm } from "@/lib/exif-utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar, MapPin, Store, Plus, Users, Filter, X, Upload, Loader2, Trash2, CheckSquare } from "lucide-react";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import RecycleBin from "@/components/trip/RecycleBin";

interface TripWithCover extends CachedTrip {
  cover_url?: string;
}

export default function Trips() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const { toast } = useToast();
  const { retailerNames, getLogoUrl } = useRetailers();
  const [trips, setTrips] = useState<TripWithCover[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState("");
  const [filterRetailer, setFilterRetailer] = useState("");
  const smartUploadRef = useRef<HTMLInputElement>(null);
  const [smartUploading, setSmartUploading] = useState(false);
  const [smartProgress, setSmartProgress] = useState(0);
  const [showSmartResults, setShowSmartResults] = useState(false);
  const [smartResults, setSmartResults] = useState<{ tripName: string; count: number; isNew: boolean }[]>([]);

  // Multi-select & delete state
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recycleBinOpen, setRecycleBinOpen] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;
    loadTrips();

    if (!online) return;

    const channel = supabase
      .channel("trips-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "shopping_trips" }, () => loadTrips())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, online]);

  async function loadTrips() {
    const cached = await getCachedTrips();
    if (cached.length > 0) {
      setTrips(cached.filter(t => !(t as any).deleted_at).sort((a, b) => b.date.localeCompare(a.date)));
      setLoading(false);
    }

    if (!navigator.onLine) {
      setLoading(false);
      return;
    }

    try {
      const { data } = await supabase
        .from("shopping_trips")
        .select("*")
        .is("deleted_at", null)
        .order("date", { ascending: false });

      if (data) {
        const tripsWithCounts = await Promise.all(
          data.map(async (trip) => {
            const [{ count: photoCount }, { count: memberCount }, coverResult] = await Promise.all([
              supabase.from("photos").select("*", { count: "exact", head: true }).eq("trip_id", trip.id),
              supabase.from("trip_members").select("*", { count: "exact", head: true }).eq("trip_id", trip.id),
              supabase.from("photos").select("file_path").eq("trip_id", trip.id).order("created_at", { ascending: true }).limit(1),
            ]);
            
            let cover_url: string | undefined;
            if (coverResult.data?.[0]?.file_path) {
              try { cover_url = await getSignedPhotoUrl(coverResult.data[0].file_path); } catch {}
            }

            return { ...trip, photo_count: photoCount ?? 0, member_count: memberCount ?? 0, cover_url };
          })
        );
        setTrips(tripsWithCounts);
        await cacheTrips(tripsWithCounts);
      }
    } catch (err) {
      console.error("[Trips] Network error, using cache", err);
    }
    setLoading(false);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const now = new Date().toISOString();

    // Soft delete
    const { error } = await supabase
      .from("shopping_trips")
      .update({ deleted_at: now })
      .in("id", ids);

    if (error) {
      toast({ title: "Error", description: "Failed to delete trips", variant: "destructive" });
      return;
    }

    const deletedCount = ids.length;
    setTrips((prev) => prev.filter((t) => !ids.includes(t.id)));
    exitSelectMode();

    // Undo toast
    const { dismiss } = toast({
      title: `${deletedCount} trip${deletedCount > 1 ? "s" : ""} deleted`,
      description: "Moved to recycling bin",
      action: (
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await supabase
              .from("shopping_trips")
              .update({ deleted_at: null })
              .in("id", ids);
            dismiss();
            loadTrips();
          }}
        >
          Undo
        </Button>
      ),
      duration: 8000,
    });
  }

  async function handleSmartUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || !user) return;
    setSmartUploading(true);
    setSmartProgress(0);

    const fileArray = Array.from(files);
    const results: Map<string, { tripId: string; tripName: string; count: number; isNew: boolean }> = new Map();

    // Parse location from trip data (simple lat/lng from location string isn't available,
    // so we match by date only, or create new trips)
    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      setSmartProgress(Math.round((i / fileArray.length) * 100));

      const exif = await extractExif(file);
      const photoDate = exif.dateTime || new Date().toISOString().split("T")[0];

      // Try to find an existing trip with matching date
      let matchedTrip = trips.find((t) => t.date === photoDate);

      let tripId: string;
      let tripName: string;
      let isNew = false;

      if (matchedTrip) {
        tripId = matchedTrip.id;
        tripName = matchedTrip.store;
      } else {
        // Create a new trip
        const storeName = `Auto-import ${format(new Date(photoDate), "MMM d, yyyy")}`;
        const { data: newTrip, error } = await supabase
          .from("shopping_trips")
          .insert({
            name: storeName,
            store: storeName,
            date: photoDate,
            created_by: user.id,
          })
          .select()
          .single();

        if (error || !newTrip) {
          console.error("Failed to create trip:", error);
          continue;
        }

        await supabase.from("trip_members").insert({ trip_id: newTrip.id, user_id: user.id });
        tripId = newTrip.id;
        tripName = storeName;
        isNew = true;
        // Add to local trips so subsequent photos on same date match
        matchedTrip = { ...newTrip, photo_count: 0, member_count: 1 } as TripWithCover;
        setTrips((prev) => [matchedTrip!, ...prev]);
      }

      try {
        const filePath = await uploadPhoto(file, user.id, tripId);
        await supabase.from("photos").insert({
          trip_id: tripId,
          user_id: user.id,
          file_path: filePath,
        });

        const existing = results.get(tripId);
        if (existing) {
          existing.count++;
        } else {
          results.set(tripId, { tripId, tripName, count: 1, isNew });
        }
      } catch (err) {
        console.error("Upload failed for:", file.name, err);
      }
    }

    setSmartProgress(100);
    setSmartUploading(false);
    setSmartResults(Array.from(results.values()));
    setShowSmartResults(true);
    loadTrips();
    toast({
      title: "Smart upload complete",
      description: `${fileArray.length} photos sorted into ${results.size} trip(s) by date.`,
    });
  }

  const filteredTrips = trips.filter((trip) => {
    if (filterDate && trip.date !== filterDate) return false;
    if (filterRetailer && trip.store.toLowerCase() !== filterRetailer.toLowerCase()) return false;
    return true;
  });

  const uniqueDates = [...new Set(trips.map((t) => t.date))].sort((a, b) => b.localeCompare(a));
  const uniqueStores = [...new Set(trips.map((t) => t.store))].sort();

  const hasFilters = filterDate || filterRetailer;

  return (
    <div className="container py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl md:text-4xl">Shopping Trips</h1>
          <p className="mt-1 text-muted-foreground">Your team's comparison shopping intel</p>
        </div>
        <div className="flex items-center gap-2">
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
              <Button variant="ghost" size="icon" onClick={() => setRecycleBinOpen(true)} title="Recycling Bin">
                <Trash2 className="h-4 w-4" />
              </Button>
              {trips.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setSelectMode(true)} className="gap-1">
                  <CheckSquare className="h-4 w-4" /> Select
                </Button>
              )}
              <input ref={smartUploadRef} type="file" accept="image/*" multiple className="hidden" onChange={handleSmartUpload} />
              <Button variant="outline" onClick={() => smartUploadRef.current?.click()} disabled={smartUploading} className="gap-2">
                {smartUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {smartUploading ? `${smartProgress}%` : "Smart Upload"}
              </Button>
              <Button onClick={() => navigate("/trips/new")} className="gap-2">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New Trip</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Smart upload progress */}
      {smartUploading && (
        <div className="mb-4">
          <Progress value={smartProgress} className="h-2" />
          <p className="mt-1 text-xs text-muted-foreground">Reading EXIF data and sorting photos by date...</p>
        </div>
      )}

      {/* Smart upload results dialog */}
      <Dialog open={showSmartResults} onOpenChange={setShowSmartResults}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Smart Upload Results</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {smartResults.map((r, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border p-3 text-sm">
                <div>
                  <p className="font-medium">{r.tripName}</p>
                  <p className="text-xs text-muted-foreground">{r.count} photo{r.count !== 1 ? "s" : ""}</p>
                </div>
                <Badge variant={r.isNew ? "default" : "secondary"}>
                  {r.isNew ? "New trip" : "Existing"}
                </Badge>
              </div>
            ))}
          </div>
          <Button onClick={() => setShowSmartResults(false)} className="w-full">Done</Button>
        </DialogContent>
      </Dialog>

      {/* Filters */}
      {trips.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterDate} onValueChange={setFilterDate}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Filter by date" />
            </SelectTrigger>
            <SelectContent>
              {uniqueDates.map((d) => (
                <SelectItem key={d} value={d}>{format(new Date(d), "MMM d, yyyy")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterRetailer} onValueChange={setFilterRetailer}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by retailer" />
            </SelectTrigger>
            <SelectContent>
              {uniqueStores.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => { setFilterDate(""); setFilterRetailer(""); }}>
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
                <div className="mt-2 h-4 w-1/3 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredTrips.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Store className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h2 className="font-serif text-xl">{hasFilters ? "No matching trips" : "No trips yet"}</h2>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              {hasFilters
                ? "Try adjusting your filters."
                : "Create your first shopping trip to start capturing competitor intel with your team."}
            </p>
            {!hasFilters && (
              <Button onClick={() => navigate("/trips/new")} className="mt-6 gap-2">
                <Plus className="h-4 w-4" /> Create First Trip
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTrips.map((trip) => {
            const logoUrl = getLogoUrl(trip.store);
            const isSelected = selected.has(trip.id);
            return (
              <Card
                key={trip.id}
                className={`cursor-pointer overflow-hidden transition-shadow hover:shadow-md ${selectMode && isSelected ? "ring-2 ring-primary" : ""}`}
                onClick={() => {
                  if (selectMode) {
                    toggleSelect(trip.id);
                  } else {
                    navigate(`/trips/${trip.id}`);
                  }
                }}
              >
                {/* Cover image */}
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
                    <Store className="h-8 w-8 text-muted-foreground/30" />
                    {selectMode && (
                      <div className="absolute top-2 left-2">
                        <Checkbox checked={isSelected} className="h-5 w-5 data-[state=checked]:bg-primary" />
                      </div>
                    )}
                  </div>
                )}
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    {logoUrl && (
                      <img src={logoUrl} alt={trip.store} className="h-6 w-6 rounded object-contain" />
                    )}
                    <h3 className="font-serif text-lg font-medium leading-snug">{trip.store}</h3>
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5" />
                      {format(new Date(trip.date), "MMM d, yyyy")}
                    </div>
                    {trip.location && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5" />
                        {trip.location}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{trip.photo_count ?? 0} photos</span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" /> {trip.member_count ?? 0}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <RecycleBin open={recycleBinOpen} onOpenChange={setRecycleBinOpen} onRestored={loadTrips} />
    </div>
  );
}
