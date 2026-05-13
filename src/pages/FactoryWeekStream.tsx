import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { batchSignedUrls } from "@/lib/photo-utils";
import CachedImage from "@/components/CachedImage";
import { ArrowLeft, Factory, Play, Video, User, Phone } from "lucide-react";

interface PhotoItem {
  id: string;
  file_path: string;
  product_name: string | null;
  trip_id: string;
  thumbnail_path?: string | null;
  signed_url?: string;
  signed_thumbnail_url?: string;
  media_type?: string | null;
}

interface VisitInfo {
  supplier: string;
  tripIds: string[];
  factory: {
    contact_person: string | null;
    phone: string | null;
  } | null;
}

interface StreamState {
  label: string;
  visits: VisitInfo[];
}

export default function FactoryWeekStream() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const state = (location.state as StreamState | null);
  const label = state?.label ?? "";
  const visits = state?.visits ?? [];

  const [photosBySupplier, setPhotosBySupplier] = useState<Map<string, PhotoItem[]>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || visits.length === 0) {
      setLoading(false);
      return;
    }
    loadStream();
  }, [user]);

  async function loadStream() {
    setLoading(true);

    const allTripIds = visits.flatMap((v) => v.tripIds);
    // Build a map from tripId → supplier for grouping
    const tripToSupplier = new Map<string, string>();
    for (const visit of visits) {
      for (const tid of visit.tripIds) {
        tripToSupplier.set(tid, visit.supplier);
      }
    }

    const allPhotos: PhotoItem[] = [];
    for (let i = 0; i < allTripIds.length; i += 10) {
      const chunk = allTripIds.slice(i, i + 10);
      const { data } = await supabase
        .from("china_photos")
        .select("id, file_path, product_name, trip_id, thumbnail_path, media_type")
        .in("trip_id", chunk)
        .order("created_at", { ascending: true });
      if (data) allPhotos.push(...(data as PhotoItem[]));
    }

    const urlMap = await batchSignedUrls(
      allPhotos.map((p) => ({ file_path: p.file_path, thumbnail_path: p.thumbnail_path ?? null }))
    );
    allPhotos.forEach((p) => {
      p.signed_url = urlMap.get(p.file_path);
      if (p.thumbnail_path) p.signed_thumbnail_url = urlMap.get(p.thumbnail_path);
    });

    // Group by supplier (normalized)
    const bySupplier = new Map<string, PhotoItem[]>();
    for (const photo of allPhotos) {
      const supplierKey = (tripToSupplier.get(photo.trip_id) ?? "").trim().toLowerCase();
      const list = bySupplier.get(supplierKey) ?? [];
      list.push(photo);
      bySupplier.set(supplierKey, list);
    }
    setPhotosBySupplier(bySupplier);
    setLoading(false);
  }

  const totalPhotos = Array.from(photosBySupplier.values()).reduce((sum, p) => sum + p.length, 0);
  const suppliersWithPhotos = visits.filter(
    (v) => (photosBySupplier.get(v.supplier.trim().toLowerCase()) ?? []).length > 0
  );

  if (!state) {
    return (
      <div className="container py-6">
        <button
          onClick={() => navigate("/china/factories")}
          className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Factory Visits
        </button>
        <p className="text-muted-foreground text-sm">No data. Navigate here from the Factory Visits page.</p>
      </div>
    );
  }

  return (
    <div className="container py-6">
      <button
        onClick={() => navigate("/china/factories")}
        className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Factory Visits
      </button>

      <div className="mb-6">
        <h1 className="font-sans text-2xl md:text-3xl font-semibold">{label}</h1>
        {!loading && (
          <p className="mt-1 text-sm text-muted-foreground">
            {suppliersWithPhotos.length} factor{suppliersWithPhotos.length !== 1 ? "ies" : "y"} · {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""}
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
      ) : suppliersWithPhotos.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          No photos found for this period.
        </div>
      ) : (
        <div className="space-y-8">
          {visits.map((visit, idx) => {
            const photos = photosBySupplier.get(visit.supplier.trim().toLowerCase()) ?? [];
            if (photos.length === 0) return null;
            // Navigate to factory detail for this supplier (passing tripIds via state)
            const firstTripId = visit.tripIds[0];
            return (
              <div key={visit.supplier}>
                {idx > 0 && suppliersWithPhotos.indexOf(visit) > 0 && <div className="border-t mb-6" />}
                <button
                  onClick={() =>
                    navigate(`/china/factories/${encodeURIComponent(visit.supplier)}`, {
                      state: { tripIds: visit.tripIds, factory: visit.factory },
                    })
                  }
                  className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-0.5 group text-left"
                >
                  <h2 className="font-sans text-base font-semibold group-hover:text-primary transition-colors">
                    {visit.supplier}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {photos.length} photo{photos.length !== 1 ? "s" : ""}
                  </span>
                  {visit.factory?.contact_person && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <User className="h-3 w-3" /> {visit.factory.contact_person}
                    </span>
                  )}
                  {visit.factory?.phone && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" /> {visit.factory.phone}
                    </span>
                  )}
                </button>
                <div className="grid gap-1.5 grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                  {photos.map((photo) => {
                    const isVideo = photo.media_type === "video";
                    const thumb = photo.signed_thumbnail_url || photo.signed_url;
                    return (
                      <div
                        key={photo.id}
                        className="group relative aspect-square cursor-pointer overflow-hidden rounded-md bg-muted"
                        onClick={() => navigate(`/china/${photo.trip_id}`)}
                      >
                        {isVideo ? (
                          <>
                            {thumb ? (
                              <img
                                src={thumb}
                                alt={photo.product_name ?? "Video"}
                                className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                loading="lazy"
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
                          <CachedImage
                            filePath={photo.file_path}
                            signedUrl={photo.signed_url}
                            alt={photo.product_name ?? "Photo"}
                            className="h-full w-full object-cover transition-transform group-hover:scale-105"
                            loading="lazy"
                            fallback={
                              <div className="flex h-full w-full items-center justify-center">
                                <Factory className="h-6 w-6 text-muted-foreground/30" />
                              </div>
                            }
                          />
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
