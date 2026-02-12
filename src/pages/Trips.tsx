import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cacheTrips, getCachedTrips, type CachedTrip } from "@/lib/offline-db";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, MapPin, Store, Plus, Users } from "lucide-react";
import { format } from "date-fns";

export default function Trips() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [trips, setTrips] = useState<CachedTrip[]>([]);
  const [loading, setLoading] = useState(true);

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
    // Try cache first
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
            const [{ count: photoCount }, { count: memberCount }] = await Promise.all([
              supabase.from("photos").select("*", { count: "exact", head: true }).eq("trip_id", trip.id),
              supabase.from("trip_members").select("*", { count: "exact", head: true }).eq("trip_id", trip.id),
            ]);
            return { ...trip, photo_count: photoCount ?? 0, member_count: memberCount ?? 0 };
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
      ) : trips.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Store className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h2 className="font-serif text-xl">No trips yet</h2>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Create your first shopping trip to start capturing competitor intel with your team.
            </p>
            <Button onClick={() => navigate("/trips/new")} className="mt-6 gap-2">
              <Plus className="h-4 w-4" /> Create First Trip
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {trips.map((trip) => (
            <Card
              key={trip.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => navigate(`/trips/${trip.id}`)}
            >
              <CardContent className="p-5">
                <h3 className="font-serif text-lg font-medium leading-snug">{trip.name}</h3>
                <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Store className="h-3.5 w-3.5" />
                    {trip.store}
                  </div>
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
                <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{trip.photo_count ?? 0} photos</span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" /> {trip.member_count ?? 0}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
