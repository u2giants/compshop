import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { batchSignedUrls } from "@/lib/photo-utils";
import { ArrowLeft, Calendar, MapPin, Factory, Play, Video } from "lucide-react";
import { format } from "date-fns";

interface PhotoItem {
  id: string;
  file_path: string;
  product_name: string | null;
  trip_id: string;
  thumbnail_path?: string | null;
  signed_url?: string;
  signed_thumbnail_url?: string;
  display_url?: string;
  media_type?: string | null;
}

interface ChildTrip {
  id: string;
  supplier: string;
  date: string;
  venue_type: string;
}

interface FairTrip {
  id: string;
  name: string;
  date: string;
  end_date: string | null;
  location: string | null;
}

export default function FairTripStream() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [fairTrip, setFairTrip] = useState<FairTrip | null>(null);
  const [childTrips, setChildTrips] = useState<ChildTrip[]>([]);
  const [photosByTrip, setPhotosByTrip] = useState<Map<string, PhotoItem[]>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !id) return;
    loadStream();
  }, [user, id]);

  async function loadStream() {
    setLoading(true);

    const { data: fairData } = await supabase
      .from("china_trips")
      .select("id, name, date, end_date, location")
      .eq("id", id!)
      .single();
    if (fairData) setFairTrip(fairData as FairTrip);

    const { data: children } = await supabase
      .from("china_trips")
      .select("id, supplier, date, venue_type")
      .eq("parent_id", id!)
      .is("deleted_at", null)
      .order("date", { ascending: true });

    if (!children || children.length === 0) {
      setLoading(false);
      return;
    }
    setChildTrips(children as ChildTrip[]);

    const childIds = children.map((c) => c.id);
    const allPhotos: PhotoItem[] = [];
    for (let i = 0; i < childIds.length; i += 10) {
      const chunk = childIds.slice(i, i + 10);
      const { data } = await supabase
        .from("china_photos")
        .select("id, file_path, product_name, trip_id, thumbnail_path, media_type")
        .in("trip_id", chunk)
        .order("created_at", { ascending: true });
      if (data) allPhotos.push(...(data as PhotoItem[]));
    }

    const urlMap = await batchSignedUrls(
      allPhotos.map((p) => ({ file_path: p.thumbnail_path || p.file_path }))
    );
    allPhotos.forEach((p) => {
      const displayPath = p.thumbnail_path || p.file_path;
      p.display_url = urlMap.get(displayPath);
      if (p.thumbnail_path) p.signed_thumbnail_url = p.display_url;
      else p.signed_url = p.display_url;
    });

    const byTrip = new Map<string, PhotoItem[]>();
    for (const photo of allPhotos) {
      const list = byTrip.get(photo.trip_id) ?? [];
      list.push(photo);
      byTrip.set(photo.trip_id, list);
    }
    setPhotosByTrip(byTrip);
    setLoading(false);
  }

  const totalPhotos = Array.from(photosByTrip.values()).reduce((sum, p) => sum + p.length, 0);
  const tripsWithPhotos = childTrips.filter((t) => (photosByTrip.get(t.id) ?? []).length > 0);
  const priorityPhotoIds = new Set(
    childTrips.flatMap((trip) => photosByTrip.get(trip.id) ?? []).slice(0, 36).map((photo) => photo.id)
  );

  return (
    <div className="container py-6">
      <button
        onClick={() => navigate("/china")}
        className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Asia Trips
      </button>

      <div className="mb-6">
        <h1 className="font-sans text-2xl md:text-3xl font-semibold">
          {fairTrip?.name ?? "Fair Trip"}
        </h1>
        {fairTrip && (
          <p className="mt-1 text-sm text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {format(new Date(fairTrip.date), "MMM d")}
              {fairTrip.end_date && ` – ${format(new Date(fairTrip.end_date), "MMM d, yyyy")}`}
            </span>
            {fairTrip.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {fairTrip.location}
              </span>
            )}
          </p>
        )}
        {!loading && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {tripsWithPhotos.length} booth{tripsWithPhotos.length !== 1 ? "s" : ""} · {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      {loading ? (
        <div className="space-y-8">
          {[1, 2, 3].map((i) => (
            <div key={i}>
              <div className="mb-3 h-5 w-48 rounded bg-muted animate-pulse" />
              <div className="grid gap-1.5 grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {Array.from({ length: 8 }).map((_, j) => (
                  <div key={j} className="aspect-square rounded-md bg-muted animate-pulse" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : tripsWithPhotos.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          No photos found in this fair trip.
        </div>
      ) : (
        <div className="space-y-8">
          {childTrips.map((trip, idx) => {
            const photos = photosByTrip.get(trip.id) ?? [];
            if (photos.length === 0) return null;
            return (
              <div key={trip.id}>
                {idx > 0 && tripsWithPhotos.indexOf(trip) > 0 && <div className="border-t mb-6" />}
                <button
                  onClick={() => navigate(`/china/${trip.id}`)}
                  className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 group text-left"
                >
                  <h2 className="font-sans text-base font-semibold group-hover:text-primary transition-colors">
                    {trip.supplier}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(trip.date), "MMM d")} · {photos.length} photo{photos.length !== 1 ? "s" : ""}
                  </span>
                </button>
                <div className="grid gap-1.5 grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                  {photos.map((photo) => {
                    const isVideo = photo.media_type === "video";
                    const thumb = photo.display_url;
                    const loadingMode = priorityPhotoIds.has(photo.id) ? "eager" : "lazy";
                    return (
                      <div
                        key={photo.id}
                        className="group relative aspect-square cursor-pointer overflow-hidden rounded-md bg-muted"
                        onClick={() => navigate(`/china/${trip.id}`)}
                      >
                        {isVideo ? (
                          <>
                            {thumb ? (
                              <img
                                src={thumb}
                                alt={photo.product_name ?? "Video"}
                                className="h-full w-full object-cover"
                                loading={loadingMode}
                                decoding="async"
                                draggable={false}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-black/80">
                                <Video className="h-6 w-6 text-white/70" />
                              </div>
                            )}
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="rounded-full bg-black/60 p-2 backdrop-blur-sm">
                                <Play className="h-4 w-4 fill-white text-white" />
                              </div>
                            </div>
                          </>
                        ) : (
                          thumb ? (
                            <img
                              src={thumb}
                              alt={photo.product_name ?? "Photo"}
                              className="h-full w-full object-cover"
                              loading={loadingMode}
                              decoding="async"
                              draggable={false}
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <Factory className="h-6 w-6 text-muted-foreground/30" />
                            </div>
                          )
                        )}
                        {photo.product_name && (
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
                            <p className="text-[10px] text-white truncate">{photo.product_name}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
