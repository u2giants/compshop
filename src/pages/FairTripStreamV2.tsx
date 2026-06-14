import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, Calendar, Download, Factory, Loader2, MapPin, Play, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { batchSignedUrls } from "@/lib/photo-utils";
import CachedImage from "@/components/CachedImage";
import {
  cacheChinaPhotos,
  cacheChinaTrips,
  cacheImageBlob,
  getCachedChinaPhotos,
  getCachedChinaTrip,
  getCachedChinaTrips,
  getCachedImageBlob,
  type CachedChinaPhoto,
  type CachedChinaTrip,
} from "@/lib/offline-db";

interface PhotoItem {
  id: string;
  trip_id: string;
  file_path: string;
  thumbnail_path: string | null;
  display_path: string;
  display_url?: string;
  product_name: string | null;
  media_type?: string | null;
  category?: string | null;
  price?: number | null;
  dimensions?: string | null;
  country_of_origin?: string | null;
  material?: string | null;
  brand?: string | null;
  notes?: string | null;
  section?: string | null;
  image_type?: string | null;
  group_id?: string | null;
  user_id?: string | null;
  created_at: string;
}

interface BoothSection {
  trip: CachedChinaTrip;
  photos: PhotoItem[];
}

interface CacheProgress {
  total: number;
  done: number;
  failed: number;
}

const GAP = 6;
const blobUrlCache = new Map<string, string>();
const blobMissCache = new Set<string>();

function chinaTripFromRow(row: any): CachedChinaTrip {
  return {
    id: row.id,
    name: row.name ?? row.supplier ?? "",
    supplier: row.supplier ?? row.name ?? "",
    venue_type: row.venue_type ?? "booth_visit",
    date: row.date,
    end_date: row.end_date ?? null,
    location: row.location ?? null,
    notes: row.notes ?? null,
    parent_id: row.parent_id ?? null,
    factory_id: row.factory_id ?? null,
    created_by: row.created_by ?? null,
    created_at: row.created_at ?? new Date().toISOString(),
    updated_at: row.updated_at ?? new Date().toISOString(),
    deleted_at: row.deleted_at ?? null,
    is_draft: Boolean(row.is_draft ?? false),
    photo_count: row.photo_count ? Number(row.photo_count) : undefined,
    photographer: row.photographer ?? null,
  };
}

function photoFromRow(row: any): PhotoItem {
  const thumbnailPath = row.thumbnail_path ?? null;
  const filePath = row.file_path;
  return {
    id: row.id,
    trip_id: row.trip_id,
    file_path: filePath,
    thumbnail_path: thumbnailPath,
    display_path: thumbnailPath || filePath,
    product_name: row.product_name ?? null,
    media_type: row.media_type ?? null,
    category: row.category ?? null,
    price: row.price ?? null,
    dimensions: row.dimensions ?? null,
    country_of_origin: row.country_of_origin ?? null,
    material: row.material ?? null,
    brand: row.brand ?? null,
    notes: row.notes ?? null,
    section: row.section ?? null,
    image_type: row.image_type ?? null,
    group_id: row.group_id ?? null,
    user_id: row.user_id ?? null,
    created_at: row.created_at ?? "",
  };
}

function cachedPhotoFromPhoto(photo: PhotoItem): CachedChinaPhoto {
  return {
    id: photo.id,
    trip_id: photo.trip_id,
    file_path: photo.file_path,
    thumbnail_path: photo.thumbnail_path,
    media_type: photo.media_type ?? null,
    product_name: photo.product_name,
    category: photo.category ?? null,
    price: photo.price ?? null,
    dimensions: photo.dimensions ?? null,
    country_of_origin: photo.country_of_origin ?? null,
    material: photo.material ?? null,
    brand: photo.brand ?? null,
    notes: photo.notes ?? null,
    section: photo.section ?? null,
    image_type: photo.image_type ?? null,
    group_id: photo.group_id ?? null,
    user_id: photo.user_id ?? null,
    created_at: photo.created_at || new Date().toISOString(),
  };
}

function getColumnCount(width: number) {
  if (width >= 1280) return 8;
  if (width >= 1024) return 6;
  if (width >= 640) return 4;
  return 3;
}

function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const update = () => setWidth(node.clientWidth);
    update();

    if (!("ResizeObserver" in window)) {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

function StreamThumb({ photo, priority }: { photo: PhotoItem; priority: boolean }) {
  const isVideo = photo.media_type === "video";

  return (
    <button
      type="button"
      className="group relative aspect-square overflow-hidden rounded-md bg-muted text-left focus:outline-none focus:ring-2 focus:ring-primary"
      aria-label={photo.product_name ?? (isVideo ? "Video" : "Photo")}
    >
      {/* CachedImage keeps a stable src (signed URL) and caches the blob in the
          background after load — it never swaps the visible src, which is what
          prevented the grid from blinking on scroll. */}
      <CachedImage
        filePath={photo.display_path}
        signedUrl={photo.display_url}
        alt={photo.product_name ?? (isVideo ? "Video" : "Photo")}
        className="h-full w-full object-cover"
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        fallback={
          <div className="flex h-full w-full items-center justify-center bg-muted">
            {isVideo ? <Video className="h-6 w-6 text-muted-foreground/40" /> : <Factory className="h-6 w-6 text-muted-foreground/30" />}
          </div>
        }
      />
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-black/60 p-2 backdrop-blur-sm">
            <Play className="h-4 w-4 fill-white text-white" />
          </div>
        </div>
      )}
      {photo.product_name && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-5">
          <p className="truncate text-[10px] leading-tight text-white">{photo.product_name}</p>
        </div>
      )}
    </button>
  );
}

export default function FairTripStreamV2() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const online = useOnlineStatus();
  const { ref: streamRef, width } = useContainerWidth();

  const [fair, setFair] = useState<CachedChinaTrip | null>(null);
  const [sections, setSections] = useState<BoothSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedFromCache, setLoadedFromCache] = useState(false);
  const [cacheProgress, setCacheProgress] = useState<CacheProgress | null>(null);
  const [cacheStatus, setCacheStatus] = useState<string | null>(null);
  // Track which fair id we've already loaded from cache so `online` toggles don't re-run it
  const cacheLoadedForIdRef = useRef<string | null>(null);

  const loadCachedStream = useCallback(async (): Promise<boolean> => {
    if (!id) return false;
    const cachedFair = await getCachedChinaTrip(id);
    const cachedTrips = await getCachedChinaTrips();
    const children = cachedTrips
      .filter((trip) => trip.parent_id === id && !trip.deleted_at)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (!cachedFair && children.length === 0) return false;

    const cachedSections: BoothSection[] = [];
    for (const trip of children) {
      const photos = (await getCachedChinaPhotos(trip.id))
        .map(photoFromRow)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      if (photos.length > 0) cachedSections.push({ trip, photos });
    }

    setFair(cachedFair ?? null);
    setSections(cachedSections);
    setLoadedFromCache(true);
    return true;
  }, [id]);

  const loadOnlineStream = useCallback(async () => {
    if (!id) return;

    const { data: fairData } = await supabase
      .from("china_trips")
      .select("id, name, supplier, venue_type, date, end_date, location, notes, parent_id, factory_id, created_by, created_at, updated_at, deleted_at, is_draft")
      .eq("id", id)
      .single();

    const { data: childRows } = await supabase
      .from("china_trips")
      .select("id, name, supplier, venue_type, date, end_date, location, notes, parent_id, factory_id, created_by, created_at, updated_at, deleted_at, is_draft")
      .eq("parent_id", id)
      .is("deleted_at", null)
      .order("date", { ascending: true });

    const childTrips = (childRows ?? []).map(chinaTripFromRow);
    const childIds = childTrips.map((trip) => trip.id);
    const allPhotos: PhotoItem[] = [];

    for (let i = 0; i < childIds.length; i += 10) {
      const chunk = childIds.slice(i, i + 10);
      const { data } = await supabase
        .from("china_photos")
        .select("id, trip_id, file_path, thumbnail_path, product_name, media_type, category, price, dimensions, country_of_origin, material, brand, notes, section, image_type, group_id, user_id, created_at")
        .in("trip_id", chunk)
        .order("created_at", { ascending: true });
      if (data) allPhotos.push(...data.map(photoFromRow));
    }

    const urlMap = await batchSignedUrls(allPhotos.map((photo) => ({ file_path: photo.display_path })));
    const photosWithUrls = allPhotos.map((photo) => ({ ...photo, display_url: urlMap.get(photo.display_path) }));

    const photosByTrip = new Map<string, PhotoItem[]>();
    for (const photo of photosWithUrls) {
      const list = photosByTrip.get(photo.trip_id) ?? [];
      list.push(photo);
      photosByTrip.set(photo.trip_id, list);
    }

    const nextSections = childTrips
      .map((trip) => ({ trip, photos: photosByTrip.get(trip.id) ?? [] }))
      .filter((section) => section.photos.length > 0);

    const nextFair = fairData ? chinaTripFromRow(fairData) : null;
    setFair(nextFair);
    setSections(nextSections);
    setLoadedFromCache(false);

    const tripsToCache = nextFair ? [nextFair, ...childTrips] : childTrips;
    cacheChinaTrips(tripsToCache).catch(() => {});
    cacheChinaPhotos(photosWithUrls.map(cachedPhotoFromPhoto)).catch(() => {});
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    if (!user || !id) return;

    (async () => {
      setLoading(true);

      // Only load from IndexedDB cache once per fair id — not on every `online` toggle
      if (cacheLoadedForIdRef.current !== id) {
        const hadCachedData = await loadCachedStream();
        if (!cancelled && hadCachedData) setLoading(false);
        if (!cancelled) cacheLoadedForIdRef.current = id;
      }

      if (!online) {
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        await loadOnlineStream();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user, id, online, loadCachedStream, loadOnlineStream]);

  const { columns, cellSize } = useMemo(() => {
    const columnCount = getColumnCount(window.innerWidth);
    const measuredWidth = width || 360;
    const size = Math.max(72, Math.floor((measuredWidth - GAP * (columnCount - 1)) / columnCount));
    return { columns: columnCount, cellSize: size };
  }, [width]);

  const totalPhotos = sections.reduce((sum, section) => sum + section.photos.length, 0);
  const firstPriorityIds = new Set(sections.flatMap((section) => section.photos).slice(0, columns * 3).map((photo) => photo.id));

  async function handleCacheFair() {
    if (!online) {
      setCacheStatus("Connect to the internet to cache this fair.");
      return;
    }

    const photos = sections.flatMap((section) => section.photos);
    setCacheStatus(null);
    setCacheProgress({ total: photos.length, done: 0, failed: 0 });

    const urlMap = await batchSignedUrls(photos.map((photo) => ({ file_path: photo.display_path })));
    const queue = photos.map((photo) => ({ ...photo, display_url: photo.display_url || urlMap.get(photo.display_path) }));
    const progress: CacheProgress = { total: queue.length, done: 0, failed: 0 };
    let index = 0;

    async function worker() {
      while (index < queue.length) {
        const photo = queue[index++];
        try {
          const existing = await getCachedImageBlob(photo.display_path);
          if (existing && (existing.type.startsWith("image/") || existing.type.startsWith("video/"))) {
            if (!blobUrlCache.has(photo.display_path)) blobUrlCache.set(photo.display_path, URL.createObjectURL(existing));
          } else if (photo.display_url) {
            const res = await fetch(photo.display_url);
            if (!res.ok) throw new Error("Failed to download thumbnail");
            const blob = await res.blob();
            if (!blob.type.startsWith("image/") && !blob.type.startsWith("video/")) throw new Error("Invalid image blob");
            await cacheImageBlob(photo.display_path, blob);
            blobMissCache.delete(photo.display_path);
            if (!blobUrlCache.has(photo.display_path)) blobUrlCache.set(photo.display_path, URL.createObjectURL(blob));
          } else {
            progress.failed++;
          }
        } catch {
          progress.failed++;
        }
        progress.done++;
        setCacheProgress({ ...progress });
      }
    }

    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, () => worker()));
    setCacheProgress({ ...progress });
    setCacheStatus(progress.failed ? `${progress.failed} thumbnail${progress.failed === 1 ? "" : "s"} failed to cache.` : "Fair thumbnails cached for offline browsing.");
  }

  return (
    <div className="container py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => navigate("/china")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Asia Trips
        </button>
        <button
          onClick={handleCacheFair}
          disabled={Boolean(cacheProgress && cacheProgress.done < cacheProgress.total)}
          className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          {cacheProgress && cacheProgress.done < cacheProgress.total ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Cache fair
        </button>
      </div>

      <div className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-sans text-2xl font-semibold md:text-3xl">{fair?.name ?? "Fair Trip"}</h1>
            {fair && (
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {format(new Date(fair.date), "MMM d")}
                  {fair.end_date && ` - ${format(new Date(fair.end_date), "MMM d, yyyy")}`}
                </span>
                {fair.location && (
                  <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {fair.location}</span>
                )}
              </p>
            )}
            {!loading && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {sections.length} booth{sections.length !== 1 ? "s" : ""} · {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""}
                {loadedFromCache && " · cached data"}
                {!online && " · offline"}
              </p>
            )}
          </div>
          <button
            onClick={() => navigate(`/china/${id}/stream`)}
            className="text-sm font-medium text-primary hover:underline"
          >
            Open original view
          </button>
        </div>
        {cacheProgress && (
          <div className="mt-3 max-w-sm">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${cacheProgress.total ? Math.round((cacheProgress.done / cacheProgress.total) * 100) : 0}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {cacheProgress.done} / {cacheProgress.total} cached{cacheProgress.failed ? ` · ${cacheProgress.failed} failed` : ""}
            </p>
          </div>
        )}
        {cacheStatus && <p className="mt-2 text-sm text-muted-foreground">{cacheStatus}</p>}
      </div>

      {loading && sections.length === 0 ? (
        <div className="space-y-8">
          {[1, 2, 3].map((i) => (
            <div key={i}>
              <div className="mb-3 h-5 w-48 animate-pulse rounded bg-muted" />
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {Array.from({ length: 8 }).map((_, j) => <div key={j} className="aspect-square animate-pulse rounded-md bg-muted" />)}
              </div>
            </div>
          ))}
        </div>
      ) : sections.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">No photos found in this fair trip.</div>
      ) : (
        <div ref={streamRef} className="space-y-8">
          {sections.map((section, sectionIndex) => (
            <div key={section.trip.id}>
              {sectionIndex > 0 && <div className="mb-6 border-t" />}
              <button
                onClick={() => navigate(`/china/${section.trip.id}`)}
                className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-left group"
              >
                <h2 className="font-sans text-base font-semibold transition-colors group-hover:text-primary">
                  {section.trip.supplier || section.trip.name}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(section.trip.date), "MMM d")} · {section.photos.length} photo{section.photos.length !== 1 ? "s" : ""}
                </span>
              </button>
              <div
                className="grid gap-1.5"
                style={{
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  gridAutoRows: cellSize,
                }}
                onClick={() => navigate(`/china/${section.trip.id}`)}
              >
                {section.photos.map((photo) => (
                  <StreamThumb key={photo.id} photo={photo} priority={firstPriorityIds.has(photo.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
