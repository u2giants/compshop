import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getSignedPhotoUrl, uploadPhoto, hashFile, checkDuplicatePhoto } from "@/lib/supabase-helpers";
import { extractExif, distanceKm } from "@/lib/exif-utils";
import { getCantonFairSession, sessionKey } from "@/lib/canton-fair-utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, MapPin, Factory, Plus, Filter, X, Trash2, CheckSquare, Upload, Loader2, FileText } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import ChinaDraftTrips from "@/components/trip/ChinaDraftTrips";

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

  // Smart upload state
  const smartUploadRef = useRef<HTMLInputElement>(null);
  const [smartUploading, setSmartUploading] = useState(false);
  const [smartProgress, setSmartProgress] = useState(0);
  const [showSmartResults, setShowSmartResults] = useState(false);
  const [smartResults, setSmartResults] = useState<{ tripName: string; count: number; isNew: boolean }[]>([]);
  const [draftsOpen, setDraftsOpen] = useState(false);

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

  // ── Smart Upload ──────────────────────────────────────────────────────────
  async function handleSmartUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || !user) return;
    setSmartUploading(true);
    setSmartProgress(0);

    const fileArray = Array.from(files);
    const results: Map<string, { tripId: string; tripName: string; count: number; isNew: boolean }> = new Map();

    // Step 1: Extract EXIF from all files
    const filesMeta: { file: File; date: string; lat: number | null; lng: number | null }[] = [];
    for (let i = 0; i < fileArray.length; i++) {
      setSmartProgress(Math.round((i / fileArray.length) * 30));
      const exif = await extractExif(fileArray[i]);
      filesMeta.push({
        file: fileArray[i],
        date: exif.dateTime || new Date().toISOString().split("T")[0],
        lat: exif.latitude,
        lng: exif.longitude,
      });
    }

    // Step 2: Separate Canton Fair photos from Factory Visit photos
    const CLUSTER_RADIUS_KM = 0.15;

    interface Cluster {
      key: string;
      venueType: "canton_fair" | "factory_visit";
      date: string; // representative date or session start
      sessionLabel?: string;
      lat: number | null;
      lng: number | null;
      indices: number[];
    }

    const clusters: Cluster[] = [];

    for (let i = 0; i < filesMeta.length; i++) {
      const fm = filesMeta[i];
      const session = getCantonFairSession(fm.date);

      if (session) {
        // Canton Fair: group by session + GPS cluster (booth)
        const sKey = sessionKey(session);
        let matched = false;

        for (const c of clusters) {
          if (c.venueType !== "canton_fair") continue;
          if (!c.key.startsWith(sKey)) continue;
          // Check GPS proximity for booth grouping
          if (c.lat != null && c.lng != null && fm.lat != null && fm.lng != null) {
            if (distanceKm(c.lat, c.lng, fm.lat, fm.lng) <= CLUSTER_RADIUS_KM) {
              c.indices.push(i);
              matched = true;
              break;
            }
          } else if (c.lat == null && fm.lat == null) {
            // Both missing GPS, put in same session cluster
            c.indices.push(i);
            matched = true;
            break;
          }
        }

        if (!matched) {
          const gpsTag = fm.lat != null ? `-${fm.lat.toFixed(4)},${fm.lng!.toFixed(4)}` : "-nogps";
          clusters.push({
            key: sKey + gpsTag,
            venueType: "canton_fair",
            date: session.startDate,
            sessionLabel: session.label,
            lat: fm.lat,
            lng: fm.lng,
            indices: [i],
          });
        }
      } else {
        // Factory Visit: cluster by date + GPS proximity (like store shopping)
        let matched = false;
        for (const c of clusters) {
          if (c.venueType !== "factory_visit") continue;
          if (c.date !== fm.date) continue;
          if (c.lat != null && c.lng != null && fm.lat != null && fm.lng != null) {
            if (distanceKm(c.lat, c.lng, fm.lat, fm.lng) <= CLUSTER_RADIUS_KM) {
              c.indices.push(i);
              matched = true;
              break;
            }
          } else if (c.lat == null && fm.lat == null) {
            c.indices.push(i);
            matched = true;
            break;
          }
        }

        if (!matched) {
          clusters.push({
            key: `factory-${fm.date}-${fm.lat ?? "x"}-${fm.lng ?? "x"}`,
            venueType: "factory_visit",
            date: fm.date,
            lat: fm.lat,
            lng: fm.lng,
            indices: [i],
          });
        }
      }
    }

    // Step 3: For each cluster, find or create a trip, then upload
    let uploaded = 0;
    const totalFiles = fileArray.length;

    for (const cluster of clusters) {
      setSmartProgress(30 + Math.round((uploaded / totalFiles) * 65));

      let tripId: string | undefined;
      let tripName: string;
      let isNew = false;

      if (cluster.venueType === "canton_fair" && cluster.sessionLabel) {
        // Try to find an existing Canton Fair trip in this session's date range
        const sKey = sessionKey({ year: 0, phase: "spring", label: "", startDate: "", endDate: "" }); // just for type
        // Actually search by date range and venue type
        const sessionInfo = getCantonFairSession(cluster.date + "");
        if (sessionInfo) {
          const { data: existing } = await supabase
            .from("china_trips")
            .select("id, supplier")
            .eq("venue_type", "canton_fair")
            .is("deleted_at", null)
            .gte("date", sessionInfo.startDate)
            .lte("date", sessionInfo.endDate);

          // Try to match by location proximity if GPS is available
          if (existing && existing.length > 0 && cluster.lat == null) {
            // No GPS - can't distinguish booths, use first match
            tripId = existing[0].id;
            tripName = existing[0].supplier;
          }
          // If GPS, we don't match existing (each booth is separate)
        }
      } else {
        // Factory visit: try to match by date
        const { data: existing } = await supabase
          .from("china_trips")
          .select("id, supplier")
          .eq("venue_type", "factory_visit")
          .eq("date", cluster.date)
          .is("deleted_at", null)
          .limit(1);

        if (existing && existing.length > 0) {
          tripId = existing[0].id;
          tripName = existing[0].supplier;
        }
      }

      if (!tripId) {
        // Create a new draft trip
        const locationLabel = cluster.lat != null ? `(${cluster.lat.toFixed(4)}, ${cluster.lng!.toFixed(4)})` : "";
        const draftName = cluster.sessionLabel
          ? `${cluster.sessionLabel} ${locationLabel}`.trim()
          : `Factory ${format(new Date(cluster.date), "MMM d, yyyy")} ${locationLabel}`.trim();

        const { data: newTrip, error } = await supabase
          .from("china_trips")
          .insert({
            name: draftName,
            supplier: draftName,
            venue_type: cluster.venueType,
            date: cluster.date,
            location: locationLabel || null,
            created_by: user.id,
            is_draft: true,
          })
          .select()
          .single();

        if (error || !newTrip) {
          console.error("Failed to create china trip:", error);
          continue;
        }

        await supabase.from("china_trip_members").insert({ trip_id: newTrip.id, user_id: user.id });
        tripId = newTrip.id;
        tripName = draftName;
        isNew = true;
      } else {
        tripName = tripName!;
      }

      // Upload photos
      for (const idx of cluster.indices) {
        const file = filesMeta[idx].file;
        uploaded++;
        setSmartProgress(30 + Math.round((uploaded / totalFiles) * 65));
        try {
          const fileHash = await hashFile(file);
          if (await checkDuplicatePhoto(fileHash)) continue;
          const filePath = await uploadPhoto(file, user.id, tripId);
          await supabase.from("china_photos").insert({
            trip_id: tripId,
            user_id: user.id,
            file_path: filePath,
            file_hash: fileHash,
          });

          const existing = results.get(tripId);
          if (existing) {
            existing.count++;
          } else {
            results.set(tripId, { tripId, tripName, count: 1, isNew });
          }
        } catch (err) {
          console.error("Upload failed:", file.name, err);
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
              <input ref={smartUploadRef} type="file" accept="image/*" multiple className="hidden" onChange={handleSmartUpload} />
              <Button variant="outline" onClick={() => smartUploadRef.current?.click()} disabled={smartUploading} className="gap-2">
                {smartUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {smartUploading ? `${smartProgress}%` : "Smart Upload"}
              </Button>
              <Button onClick={() => navigate("/china/new")} className="gap-2">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New Trip</span>
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setDraftsOpen(true)} title="Draft Trips">
                <FileText className="h-4 w-4" />
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

      {/* Smart upload progress */}
      {smartUploading && (
        <div className="mb-4">
          <Progress value={smartProgress} className="h-2" />
          <p className="mt-1 text-xs text-muted-foreground">Reading EXIF data and sorting photos by session...</p>
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
                  {r.isNew ? "New draft" : "Existing"}
                </Badge>
              </div>
            ))}
          </div>
          <Button onClick={() => setShowSmartResults(false)} className="w-full">Done</Button>
        </DialogContent>
      </Dialog>

      {/* Draft trips dialog */}
      <ChinaDraftTrips open={draftsOpen} onOpenChange={setDraftsOpen} onPublished={loadTrips} />

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
                : "Create your first China trip or use Smart Upload to auto-sort photos by Canton Fair session."}
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
