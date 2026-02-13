import { useEffect, useState, useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
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
import { Calendar, MapPin, Store, Plus, Users, Filter, X, Upload, Loader2, Trash2, CheckSquare, FileText } from "lucide-react";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import RecycleBin from "@/components/trip/RecycleBin";
import DraftTrips from "@/components/trip/DraftTrips";

interface TripWithCover extends CachedTrip {
  cover_url?: string;
}

export default function Trips() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const { toast } = useToast();
  const { retailerNames, getLogoUrl } = useRetailers();
  const isMobile = useIsMobile();
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
  const [draftsOpen, setDraftsOpen] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSelectedRef = useRef<string | null>(null);

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
      setTrips(cached.filter(t => !(t as any).deleted_at && !(t as any).is_draft).sort((a, b) => b.date.localeCompare(a.date)));
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
        .eq("is_draft", false)
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

  function toggleSelect(id: string, shiftKey: boolean) {
    if (shiftKey && lastSelectedRef.current && lastSelectedRef.current !== id) {
      // Range select
      const ids = filteredTrips.map((t) => t.id);
      const lastIdx = ids.indexOf(lastSelectedRef.current);
      const currIdx = ids.indexOf(id);
      if (lastIdx !== -1 && currIdx !== -1) {
        const start = Math.min(lastIdx, currIdx);
        const end = Math.max(lastIdx, currIdx);
        setSelected((prev) => {
          const next = new Set(prev);
          for (let i = start; i <= end; i++) next.add(ids[i]);
          return next;
        });
        return;
      }
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastSelectedRef.current = id;
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

    // Step 1: Extract EXIF from all files first
    const filesMeta: { file: File; date: string; lat: number | null; lng: number | null }[] = [];
    for (let i = 0; i < fileArray.length; i++) {
      setSmartProgress(Math.round((i / fileArray.length) * 40));
      const exif = await extractExif(fileArray[i]);
      filesMeta.push({
        file: fileArray[i],
        date: exif.dateTime || new Date().toISOString().split("T")[0],
        lat: exif.latitude,
        lng: exif.longitude,
      });
    }

    // Step 2: Cluster by date + location (within 1km = same store)
    const CLUSTER_RADIUS_KM = 0.15;
    interface Cluster { date: string; lat: number | null; lng: number | null; indices: number[]; tripId?: string; tripName?: string; isNew?: boolean }
    const clusters: Cluster[] = [];

    for (let i = 0; i < filesMeta.length; i++) {
      const fm = filesMeta[i];
      let matched = false;
      for (const c of clusters) {
        if (c.date !== fm.date) continue;
        // If both have GPS, check distance
        if (c.lat != null && c.lng != null && fm.lat != null && fm.lng != null) {
          if (distanceKm(c.lat, c.lng, fm.lat, fm.lng) <= CLUSTER_RADIUS_KM) {
            c.indices.push(i);
            matched = true;
            break;
          }
        } else if (c.lat == null && fm.lat == null) {
          // Both missing GPS, group by date only
          c.indices.push(i);
          matched = true;
          break;
        }
      }
      if (!matched) {
        clusters.push({ date: fm.date, lat: fm.lat, lng: fm.lng, indices: [i] });
      }
    }

    // Step 3: For each cluster, find or create a trip, then upload
    let uploaded = 0;
    const totalFiles = fileArray.length;

    for (const cluster of clusters) {
      // Try to match an existing trip by date (and roughly same location if GPS available)
      let matchedTrip = trips.find((t) => t.date === cluster.date);

      let tripId: string;
      let tripName: string;
      let isNew = false;

      if (matchedTrip) {
        tripId = matchedTrip.id;
        tripName = matchedTrip.store;
      } else {
        const locationLabel = cluster.lat != null ? `(${cluster.lat.toFixed(4)}, ${cluster.lng!.toFixed(4)})` : "";
        const draftName = `${format(new Date(cluster.date), "MMM d, yyyy")} ${locationLabel}`.trim();
        const { data: newTrip, error } = await supabase
          .from("shopping_trips")
          .insert({
            name: draftName,
            store: draftName,
            date: cluster.date,
            created_by: user.id,
            is_draft: true,
          })
          .select()
          .single();

        if (error || !newTrip) {
          console.error("Failed to create trip:", error);
          continue;
        }

        await supabase.from("trip_members").insert({ trip_id: newTrip.id, user_id: user.id });
        tripId = newTrip.id;
        tripName = draftName;
        isNew = true;
        // Don't add drafts to the main trips list
      }

      for (const idx of cluster.indices) {
        const file = filesMeta[idx].file;
        uploaded++;
        setSmartProgress(40 + Math.round((uploaded / totalFiles) * 60));
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
    }

    setSmartProgress(100);
    setSmartUploading(false);
    setSmartResults(Array.from(results.values()));
    setShowSmartResults(true);
    loadTrips();
    const draftCount = Array.from(results.values()).filter(r => r.isNew).length;
    toast({
      title: "Smart upload complete",
      description: draftCount > 0
        ? `${fileArray.length} photos sorted into ${results.size} trip(s). ${draftCount} draft(s) ready to review.`
        : `${fileArray.length} photos sorted into ${results.size} trip(s).`,
    });
    if (draftCount > 0) setDraftsOpen(true);
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
          <h1 className="font-sans text-3xl md:text-4xl">Shopping Trips</h1>
          <p className="mt-1 text-muted-foreground hidden md:block">Your team's comparison shopping intel</p>
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
              <Button variant="ghost" size="icon" onClick={() => setDraftsOpen(true)} title="Draft Trips">
                <FileText className="h-4 w-4" />
              </Button>
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
            <DialogTitle className="font-sans">Smart Upload Results</DialogTitle>
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
          <Select value={filterRetailer} onValueChange={setFilterRetailer}>
            <SelectTrigger className="w-[120px] md:w-[180px]">
              <SelectValue placeholder={isMobile ? "Filter by str" : "Filter by retailer"} />
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
            <h2 className="font-sans text-xl">{hasFilters ? "No matching trips" : "No trips yet"}</h2>
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
                onClick={(e) => {
                  if (selectMode) {
                    toggleSelect(trip.id, e.shiftKey);
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
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 text-sm">
                    {logoUrl && (
                      <img src={logoUrl} alt={trip.store} className="h-5 w-5 rounded object-contain shrink-0" />
                    )}
                    <span className="font-sans font-medium truncate">{trip.store}</span>
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

      <DraftTrips open={draftsOpen} onOpenChange={setDraftsOpen} onPublished={loadTrips} />
      <RecycleBin open={recycleBinOpen} onOpenChange={setRecycleBinOpen} onRestored={loadTrips} />
    </div>
  );
}
