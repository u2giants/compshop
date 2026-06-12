import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { hashFile, checkDuplicatePhoto } from "@/lib/supabase-helpers";
import { queuePendingUpload } from "@/lib/pending-upload-utils";
import { runSync } from "@/lib/sync-service";
import { extractExif, distanceKm } from "@/lib/exif-utils";
import { getCantonFairSession, sessionKey } from "@/lib/canton-fair-utils";
import { cacheChinaTripPhotos, type BulkCacheProgress } from "@/lib/bulk-cache";
import { cacheChinaTrips, getCachedChinaTrips, clearCachedChinaTrips, setSyncTimestamp, getSyncTimestamp, cacheImageBlob, getCachedImageBlob, getCachedSignedUrls, cacheSignedUrls, type CachedChinaTrip, type CachedSignedUrl } from "@/lib/offline-db";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, MapPin, Factory, Plus, Filter, X, Trash2, CheckSquare, Upload, Loader2, FileText, ArrowRightLeft, ChevronDown, Building2, Download } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useCategories } from "@/hooks/use-categories";
import ChinaDraftTrips from "@/components/trip/ChinaDraftTrips";

import CantonFairGroupCard, { type ChinaTripListItem } from "@/components/trip/CantonFairGroupCard";
import ChinaTripCard from "@/components/trip/ChinaTripCard";

type ChinaTrip = ChinaTripListItem;

type ChinaTripStatsRow = CachedChinaTrip & {
  cover_user_id?: string | null;
  photo_count?: number | string | null;
};

const COVER_SIGNED_URL_TTL = 86400;
const COVER_SIGNED_URL_TTL_MS = COVER_SIGNED_URL_TTL * 1000;

function stripCoverUrls(trips: CachedChinaTrip[]): CachedChinaTrip[] {
  return trips.map((trip) => {
    const cachedTrip = { ...trip };
    delete cachedTrip.cover_url;
    return cachedTrip;
  });
}

async function attachCachedCoverUrls(trips: CachedChinaTrip[]): Promise<CachedChinaTrip[]> {
  const coverFilePaths = trips.map((trip) => trip.cover_file_path).filter(Boolean) as string[];
  if (coverFilePaths.length === 0) return trips;

  const cachedCoverUrls = await getCachedSignedUrls(coverFilePaths);
  if (cachedCoverUrls.size === 0) return trips;

  return trips.map((trip) => ({
    ...trip,
    cover_url: trip.cover_file_path ? cachedCoverUrls.get(trip.cover_file_path) : undefined,
  }));
}

export default function ChinaTrips() {
  const { user, isChinaReadOnly } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const categories = useCategories();
  const online = useOnlineStatus();
  const [trips, setTrips] = useState<ChinaTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState("");
  const [filterVenue, setFilterVenue] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [categoryTripIds, setCategoryTripIds] = useState<Set<string> | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCaching, setBulkCaching] = useState(false);
  const [bulkCacheProgress, setBulkCacheProgress] = useState<BulkCacheProgress | null>(null);

  async function handleCacheSelected() {
    if (selected.size === 0) return;
    const tripIds = Array.from(selected);
    setBulkCaching(true);
    setBulkCacheProgress({ total: 0, done: 0, failed: 0 });
    try {
      const result = await cacheChinaTripPhotos(tripIds, setBulkCacheProgress);
      toast({
        title: "Cache complete",
        description: `${result.done - result.failed} of ${result.total} images cached for offline.`,
      });
    } catch (err: any) {
      toast({ title: "Cache failed", description: err.message, variant: "destructive" });
    } finally {
      setBulkCaching(false);
      setBulkCacheProgress(null);
    }
  }

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

    if (!online) return;

    const channel = supabase
      .channel("china-trips-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "china_trips" }, () => loadTrips())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, online]);

  async function loadTrips() {
    // 1. Show cached data instantly
    const cached = await getCachedChinaTrips();
    if (cached.length > 0) {
      setTrips(await attachCachedCoverUrls(stripCoverUrls(cached)) as ChinaTrip[]);
      setLoading(false);
    }

    if (!navigator.onLine) {
      setLoading(false);
      return;
    }

    // 2. Skip background refresh if synced very recently (<30s) — keeps collaboration near real-time
    const lastSync = await getSyncTimestamp("china_trips");
    if (cached.length > 0 && lastSync && Date.now() - lastSync < 30 * 1000) {
      setLoading(false);
      return;
    }

    // 3. Background fetch
    try {
      const { data } = await supabase
        .from("china_trips_with_stats" as never)
        .select("*")
        .is("deleted_at", null)
        .eq("is_draft", false)
        .order("date", { ascending: false });

      if (data) {
        const rows = data as unknown as ChinaTripStatsRow[];
        const coverFilePaths = rows.map((trip) => trip.cover_file_path).filter(Boolean) as string[];
        const cachedCoverUrls = await getCachedSignedUrls(coverFilePaths);
        const signedUrlCacheEntries: CachedSignedUrl[] = [];

        const coverSignedUrls = await Promise.all(
          rows.map(async (trip) => {
            const fp = trip.cover_file_path;
            if (!fp) return undefined;
            const cachedUrl = cachedCoverUrls.get(fp);
            if (cachedUrl) return cachedUrl;

            const { data } = await supabase.storage
              .from("photos")
              .createSignedUrl(fp, COVER_SIGNED_URL_TTL, { transform: { width: 400, height: 400, resize: "cover" } });

            if (data?.signedUrl) {
              signedUrlCacheEntries.push({
                file_path: fp,
                url: data.signedUrl,
                expires_at: Date.now() + COVER_SIGNED_URL_TTL_MS,
              });
            }
            return data?.signedUrl ?? undefined;
          })
        );

        cacheSignedUrls(signedUrlCacheEntries).catch(() => {});

        const tripsWithCounts: CachedChinaTrip[] = rows.map((trip, i) => ({
          ...trip,
          photo_count: Number(trip.photo_count ?? 0),
          cover_file_path: trip.cover_file_path || undefined,
          cover_url: coverSignedUrls[i],
          photographer: trip.photographer ?? null,
        }));
        setTrips(tripsWithCounts as ChinaTrip[]);

        // Pre-cache cover image blobs in background
        for (const t of tripsWithCounts) {
          if (t.cover_file_path && t.cover_url) {
            preCacheCoverImage(t.cover_file_path, t.cover_url);
          }
        }

        await clearCachedChinaTrips();
        await cacheChinaTrips(stripCoverUrls(tripsWithCounts));
        await setSyncTimestamp("china_trips");
      }
    } catch (err) {
      console.error("[ChinaTrips] Error loading trips", err);
    }
    setLoading(false);
  }

  function preCacheCoverImage(filePath: string, url: string) {
    getCachedImageBlob(filePath).then((existing) => {
      if (existing && (existing.type.startsWith("image/") || existing.type.startsWith("video/"))) return;
      fetch(url).then(r => { if (!r.ok) throw new Error(); return r.blob(); }).then(b => cacheImageBlob(filePath, b)).catch(() => {});
    });
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

  async function handleMergeTrips() {
    if (selected.size < 2) {
      toast({ title: "Select at least 2 trips to merge", variant: "destructive" });
      return;
    }
    const ids = Array.from(selected);
    // Keep the oldest trip (earliest date) as the target
    const sortedTrips = ids
      .map((id) => trips.find((t) => t.id === id)!)
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));

    const target = sortedTrips[0];
    const sourceIds = sortedTrips.slice(1).map((t) => t.id);

    // Move all photos from source trips to target
    const { error: moveError } = await supabase
      .from("china_photos")
      .update({ trip_id: target.id })
      .in("trip_id", sourceIds);

    if (moveError) {
      toast({ title: "Failed to merge trips", variant: "destructive" });
      return;
    }

    // Move trip members (check for existing to avoid duplicates)
    const { data: targetMembers } = await supabase
      .from("china_trip_members")
      .select("user_id")
      .eq("trip_id", target.id);
    const existingUserIds = new Set((targetMembers || []).map((m) => m.user_id));

    for (const sourceId of sourceIds) {
      const { data: members } = await supabase
        .from("china_trip_members")
        .select("user_id")
        .eq("trip_id", sourceId);
      if (members) {
        const newMembers = members.filter((m) => !existingUserIds.has(m.user_id));
        for (const m of newMembers) {
          await supabase.from("china_trip_members").insert({ trip_id: target.id, user_id: m.user_id });
          existingUserIds.add(m.user_id);
        }
      }
    }

    // Soft-delete source trips
    const now = new Date().toISOString();
    await supabase.from("china_trips").update({ deleted_at: now }).in("id", sourceIds);

    exitSelectMode();
    toast({ title: `${sortedTrips.length} trips merged into "${target.supplier}"` });
    loadTrips();
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
    const CLUSTER_RADIUS_KM = 1.0;

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
        const sessionInfo = getCantonFairSession(cluster.date + "");
        if (sessionInfo) {
          const { data: existing } = await supabase
            .from("china_trips")
            .select("id, supplier, location")
            .eq("venue_type", "canton_fair")
            .is("deleted_at", null)
            .gte("date", sessionInfo.startDate)
            .lte("date", sessionInfo.endDate);

          if (existing && existing.length > 0) {
            if (cluster.lat != null && cluster.lng != null) {
              // GPS available: try to match an existing trip by proximity
              for (const ex of existing) {
                const coordMatch = ex.location?.match(/\(([-\d.]+),\s*([-\d.]+)\)/);
                if (coordMatch) {
                  const exLat = parseFloat(coordMatch[1]);
                  const exLng = parseFloat(coordMatch[2]);
                  if (distanceKm(cluster.lat, cluster.lng!, exLat, exLng) <= CLUSTER_RADIUS_KM) {
                    tripId = ex.id;
                    tripName = ex.supplier;
                    break;
                  }
                }
              }
              // If no GPS match, try matching by supplier name (same session)
              if (!tripId && existing.length === 1) {
                // Only one trip in this session — likely the same booth
                tripId = existing[0].id;
                tripName = existing[0].supplier;
              }
            } else {
              // No GPS — match first trip in the session
              tripId = existing[0].id;
              tripName = existing[0].supplier;
            }
          }
        }
      } else {
        // Factory visit: try to match by date and GPS proximity
        const { data: existing } = await supabase
          .from("china_trips")
          .select("id, supplier, location")
          .eq("venue_type", "factory_visit")
          .eq("date", cluster.date)
          .is("deleted_at", null);

        if (existing && existing.length > 0) {
          if (cluster.lat != null && cluster.lng != null) {
            // Match by GPS proximity
            for (const ex of existing) {
              const coordMatch = ex.location?.match(/\(([-\d.]+),\s*([-\d.]+)\)/);
              if (coordMatch) {
                const exLat = parseFloat(coordMatch[1]);
                const exLng = parseFloat(coordMatch[2]);
                if (distanceKm(cluster.lat, cluster.lng!, exLat, exLng) <= CLUSTER_RADIUS_KM) {
                  tripId = ex.id;
                  tripName = ex.supplier;
                  break;
                }
              }
            }
          }
          // Fallback: if only one trip on that date, use it
          if (!tripId && existing.length === 1) {
            tripId = existing[0].id;
            tripName = existing[0].supplier;
          }
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
          await queuePendingUpload({ file, userId: user.id, tripId, table: "china_photos", fileHash });

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
    runSync();
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

  // Fetch trip IDs matching selected category
  useEffect(() => {
    if (!filterCategory) {
      setCategoryTripIds(null);
      return;
    }
    supabase
      .from("china_photos")
      .select("trip_id")
      .eq("category", filterCategory)
      .then(({ data }) => {
        if (data) setCategoryTripIds(new Set(data.map(d => d.trip_id)));
        else setCategoryTripIds(new Set());
      });
  }, [filterCategory]);

  const filteredTrips = trips.filter((trip) => {
    if (filterDate && trip.date !== filterDate) return false;
    if (filterVenue && trip.venue_type !== filterVenue) return false;
    if (categoryTripIds && !categoryTripIds.has(trip.id)) return false;
    return true;
  });

  // Separate into groups (parent_id is null, venue_type is canton_fair with end_date) and standalone trips
  // Only show Canton Fair related trips here — standalone factory visits go to "Fty Visits" tab
  const groupTrips = filteredTrips.filter(t => !t.parent_id && t.end_date != null);
  const childTrips = filteredTrips.filter(t => t.parent_id != null);
  const standaloneTrips = filteredTrips.filter(t => !t.parent_id && t.end_date == null && t.venue_type !== "factory_visit");

  // Build from unfiltered trips so venue/date filters don't strip children and break
  // the photo count used by CantonFairGroupCard to show the "view all photos" button.
  const childrenByParent = new Map<string, ChinaTrip[]>();
  trips.filter(t => t.parent_id != null).forEach(c => {
    const list = childrenByParent.get(c.parent_id!) || [];
    list.push(c);
    childrenByParent.set(c.parent_id!, list);
  });

  const uniqueDates = [...new Set(trips.map((t) => t.date))].sort((a, b) => b.localeCompare(a));
  const hasFilters = filterDate || filterVenue || filterCategory;

  return (
    <div className="container py-6">
      {/* Tabs navigation */}
      <div className="mb-4">
        <Tabs value="trips" onValueChange={(v) => v === "factories" && navigate("/china/factories")}>
          <TabsList>
            <TabsTrigger value="trips" className="gap-1.5">
              <Factory className="h-4 w-4" /> Fair Trips
            </TabsTrigger>
            <TabsTrigger value="factories" className="gap-1.5">
              <Building2 className="h-4 w-4" /> Fty Visits
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-sans text-3xl md:text-4xl">Asia Trips</h1>
          <p className="mt-1 text-muted-foreground hidden md:block">Factory visits & trade show sourcing intel</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {selectMode ? (
            <>
              <span className="text-sm text-muted-foreground">{selected.size} selected</span>
              <Button variant="outline" size="sm" disabled={selected.size === 0 || bulkCaching} onClick={handleCacheSelected} className="gap-1">
                <Download className="h-4 w-4" /> {bulkCaching ? `${bulkCacheProgress ? Math.round((bulkCacheProgress.done / bulkCacheProgress.total) * 100) || 0 : 0}%` : "Cache"}
              </Button>
              {!isChinaReadOnly && (
                <>
                  <Button variant="outline" size="sm" disabled={selected.size < 2} onClick={handleMergeTrips} className="gap-1">
                    <ArrowRightLeft className="h-4 w-4" /> Merge
                  </Button>
                  <Button variant="destructive" size="sm" disabled={selected.size === 0} onClick={handleBulkDelete} className="gap-1">
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" onClick={exitSelectMode}>Cancel</Button>
            </>
          ) : (
            <>
              {!isChinaReadOnly && (
                <>
                  <input ref={smartUploadRef} type="file" accept="image/*" multiple className="hidden" onChange={handleSmartUpload} />
                  <Button variant="outline" onClick={() => smartUploadRef.current?.click()} disabled={smartUploading} className="gap-2">
                    {smartUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {smartUploading ? `${smartProgress}%` : "Smart Upload"}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        <span className="hidden sm:inline">New</span>
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => navigate("/china/new?type=factory_visit")}>
                        Factory Visit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate("/china/new?type=canton_fair_group")}>
                        📦 Canton Fair Group
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="ghost" size="icon" onClick={() => setDraftsOpen(true)} title="Draft Trips">
                    <FileText className="h-4 w-4" />
                  </Button>
                </>
              )}
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
              <SelectItem value="booth_visit">Booth Visit</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-[120px] md:w-[160px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => { setFilterDate(""); setFilterVenue(""); setFilterCategory(""); }}>
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
            <h2 className="font-sans text-xl">{hasFilters ? "No matching trips" : "No Asia trips yet"}</h2>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              {hasFilters
                ? "Try adjusting your filters."
                : "Create your first Asia trip or use Smart Upload to auto-sort photos by Canton Fair session."}
            </p>
            {!hasFilters && !isChinaReadOnly && (
              <Button onClick={() => navigate("/china/new?type=factory_visit")} className="mt-6 gap-2">
                <Plus className="h-4 w-4" /> Create First Trip
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Render Canton Fair group cards */}
          {groupTrips.map((group) => (
            <CantonFairGroupCard
              key={group.id}
              group={group}
              children={childrenByParent.get(group.id) || []}
              selectMode={selectMode}
              selected={selected}
              onToggleSelect={toggleSelect}
              onReclassified={loadTrips}
            />
          ))}
          {/* Render standalone trips */}
          {standaloneTrips.map((trip) => (
            <ChinaTripCard
              key={trip.id}
              trip={trip}
              selectMode={selectMode}
              isSelected={selected.has(trip.id)}
              onToggleSelect={toggleSelect}
              onClick={() => {
                if (selectMode) toggleSelect(trip.id);
                else navigate(`/china/${trip.id}`);
              }}
              onReclassified={loadTrips}
            />
          ))}
        </div>
      )}
    </div>
  );
}
