import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cacheTrips, getCachedTrips, type CachedTrip } from "@/lib/offline-db";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useRetailers } from "@/hooks/use-retailers";
import { getSignedPhotoUrl } from "@/lib/supabase-helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar, MapPin, Store, Plus, Users, Filter, X } from "lucide-react";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface TripWithCover extends CachedTrip {
  cover_url?: string;
}

export default function Trips() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const { retailerNames, getLogoUrl } = useRetailers();
  const [trips, setTrips] = useState<TripWithCover[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState("");
  const [filterRetailer, setFilterRetailer] = useState("");

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
      setTrips(cached.sort((a, b) => b.date.localeCompare(a.date)));
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
        <Button onClick={() => navigate("/trips/new")} className="gap-2">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Trip</span>
        </Button>
      </div>

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
            return (
              <Card
                key={trip.id}
                className="cursor-pointer overflow-hidden transition-shadow hover:shadow-md"
                onClick={() => navigate(`/trips/${trip.id}`)}
              >
                {/* Cover image */}
                {trip.cover_url ? (
                  <div className="relative h-36 w-full">
                    <img src={trip.cover_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                  </div>
                ) : (
                  <div className="flex h-24 items-center justify-center bg-muted">
                    <Store className="h-8 w-8 text-muted-foreground/30" />
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
    </div>
  );
}
