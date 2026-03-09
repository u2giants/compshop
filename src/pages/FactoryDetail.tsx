import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { batchSignedUrls } from "@/lib/photo-utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Phone, Mail, MessageCircle, Globe, MapPin, User, Calendar, Factory, ExternalLink } from "lucide-react";
import { format } from "date-fns";

interface PhotoItem {
  id: string;
  file_path: string;
  product_name: string | null;
  category: string | null;
  trip_id: string;
  created_at: string;
  signed_url?: string;
}

interface TripInfo {
  id: string;
  name: string;
  supplier: string;
  date: string;
  venue_type: string;
}

interface FactoryInfo {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  wechat: string | null;
  whatsapp: string | null;
  address: string | null;
  website: string | null;
}

export default function FactoryDetail() {
  const { name } = useParams<{ name: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const passedTripIds: string[] = (location.state as any)?.tripIds ?? [];
  const passedFactory: FactoryInfo | null = (location.state as any)?.factory ?? null;

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [trips, setTrips] = useState<TripInfo[]>([]);
  const [factory, setFactory] = useState<FactoryInfo | null>(passedFactory);
  const [loading, setLoading] = useState(true);

  const decodedName = decodeURIComponent(name ?? "");

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user, name]);

  async function loadData() {
    setLoading(true);

    // Find all trips for this supplier
    let tripIds = passedTripIds;
    if (tripIds.length === 0) {
      const { data: tripData } = await supabase
        .from("china_trips")
        .select("id, name, supplier, date, venue_type")
        .ilike("supplier", decodedName)
        .is("deleted_at", null)
        .eq("is_draft", false)
        .is("end_date", null);
      if (tripData) {
        tripIds = tripData.map(t => t.id);
        setTrips(tripData as TripInfo[]);
      }
    } else {
      const { data: tripData } = await supabase
        .from("china_trips")
        .select("id, name, supplier, date, venue_type")
        .in("id", tripIds);
      if (tripData) setTrips(tripData as TripInfo[]);
    }

    if (tripIds.length === 0) { setLoading(false); return; }

    // Load factory info if not passed
    if (!factory) {
      const { data: tripWithFactory } = await supabase
        .from("china_trips")
        .select("factory_id")
        .in("id", tripIds)
        .not("factory_id", "is", null)
        .limit(1);

      if (tripWithFactory?.[0]?.factory_id) {
        const { data: f } = await supabase
          .from("factories")
          .select("*")
          .eq("id", tripWithFactory[0].factory_id)
          .single();
        if (f) setFactory(f as FactoryInfo);
      }
    }

    // Load all photos across these trips
    const allPhotos: PhotoItem[] = [];
    // Batch in chunks of 10 trips
    for (let i = 0; i < tripIds.length; i += 10) {
      const chunk = tripIds.slice(i, i + 10);
      const { data: photoData } = await supabase
        .from("china_photos")
        .select("id, file_path, product_name, category, trip_id, created_at")
        .in("trip_id", chunk)
        .order("created_at", { ascending: false });
      if (photoData) allPhotos.push(...(photoData as PhotoItem[]));
    }

    // Get signed URLs
    const urlMap = await batchSignedUrls(allPhotos.map(p => ({ file_path: p.file_path })));
    allPhotos.forEach(p => { p.signed_url = urlMap.get(p.file_path); });

    setPhotos(allPhotos);
    setLoading(false);
  }

  const tripMap = new Map(trips.map(t => [t.id, t]));

  // Group photos by trip
  const photosByTrip = new Map<string, PhotoItem[]>();
  photos.forEach(p => {
    const list = photosByTrip.get(p.trip_id) || [];
    list.push(p);
    photosByTrip.set(p.trip_id, list);
  });

  return (
    <div className="container py-6">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="mb-6">
        <h1 className="font-sans text-2xl md:text-3xl">{decodedName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {trips.length} trip{trips.length !== 1 ? "s" : ""} · {photos.length} photo{photos.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Contact card */}
      {factory && (
        <Card className="mb-6">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="secondary" className="text-xs">Business Card</Badge>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              {factory.contact_person && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{factory.contact_person}</span>
                </div>
              )}
              {factory.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <a href={`tel:${factory.phone}`} className="text-primary hover:underline">{factory.phone}</a>
                </div>
              )}
              {factory.email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <a href={`mailto:${factory.email}`} className="text-primary hover:underline truncate">{factory.email}</a>
                </div>
              )}
              {factory.wechat && (
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>WeChat: {factory.wechat}</span>
                </div>
              )}
              {factory.whatsapp && (
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>WhatsApp: {factory.whatsapp}</span>
                </div>
              )}
              {factory.address && (
                <div className="flex items-center gap-2 sm:col-span-2">
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{factory.address}</span>
                </div>
              )}
              {factory.website && (
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                  <a href={factory.website.startsWith("http") ? factory.website : `https://${factory.website}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1">
                    {factory.website} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="grid gap-3 grid-cols-3 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {trips
            .sort((a, b) => b.date.localeCompare(a.date))
            .map(trip => {
              const tripPhotos = photosByTrip.get(trip.id) || [];
              if (tripPhotos.length === 0) return null;
              return (
                <div key={trip.id}>
                  <button
                    onClick={() => navigate(`/china/${trip.id}`)}
                    className="mb-2 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    {format(new Date(trip.date), "MMM d, yyyy")}
                    <span className="text-xs">· {trip.venue_type.replace("_", " ")}</span>
                    <span className="text-xs">· {tripPhotos.length} photos</span>
                  </button>
                  <div className="grid gap-2 grid-cols-3 sm:grid-cols-4 lg:grid-cols-6">
                    {tripPhotos.map(photo => (
                      <div
                        key={photo.id}
                        className="group relative aspect-square cursor-pointer overflow-hidden rounded-md bg-muted"
                        onClick={() => navigate(`/china/${trip.id}`)}
                      >
                        {photo.signed_url ? (
                          <img
                            src={photo.signed_url}
                            alt={photo.product_name || "Photo"}
                            className="h-full w-full object-cover transition-transform group-hover:scale-105"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Factory className="h-6 w-6 text-muted-foreground/30" />
                          </div>
                        )}
                        {photo.product_name && (
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
                            <p className="text-[10px] text-white truncate">{photo.product_name}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
