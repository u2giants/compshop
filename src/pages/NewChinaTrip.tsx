import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, MapPin, Loader2, Store, Star } from "lucide-react";

interface NearbyStore {
  name: string;
  address: string;
  rating: number | null;
}

export default function NewChinaTrip() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [venueType, setVenueType] = useState<string>("canton_fair");
  const [location, setLocation] = useState("");
  const [locatingDevice, setLocatingDevice] = useState(false);
  const [nearbyStores, setNearbyStores] = useState<NearbyStore[]>([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    detectLocation();
  }, []);

  const detectLocation = () => {
    if (!navigator.geolocation) return;
    setLocatingDevice(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          coordsRef.current = { lat: latitude, lng: longitude };

          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
          );
          const data = await res.json();
          const city = data.address?.city || data.address?.town || data.address?.village || "";
          const state = data.address?.state || "";
          const country = data.address?.country || "";
          const parts = [city, state, country].filter(Boolean);
          setLocation(parts.join(", "));

          // Use larger radius (1km) for trade shows / large venues
          fetchNearbyStores(latitude, longitude);
        } catch {
        } finally {
          setLocatingDevice(false);
        }
      },
      () => setLocatingDevice(false),
      { timeout: 10000 }
    );
  };

  const fetchNearbyStores = async (latitude: number, longitude: number) => {
    setLoadingStores(true);
    try {
      const { data, error } = await supabase.functions.invoke("nearby-stores", {
        body: { latitude, longitude, radius: 1000 },
      });
      if (error) throw error;
      if (data?.stores) {
        setNearbyStores(data.stores);
      }
    } catch (err: any) {
      console.error("Failed to fetch nearby stores:", err);
    } finally {
      setLoadingStores(false);
    }
  };

  const selectNearbyStore = (s: NearbyStore) => {
    setSupplier(s.name);
    if (s.address && !location) {
      setLocation(s.address);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !supplier.trim()) return;
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const date = form.get("date") as string;
    const notes = form.get("notes") as string;

    try {
      const { data: trip, error } = await supabase
        .from("china_trips")
        .insert({
          name: supplier.trim(),
          supplier: supplier.trim(),
          venue_type: venueType,
          date,
          location: location || null,
          notes: notes || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      await supabase.from("china_trip_members").insert({ trip_id: trip.id, user_id: user.id });

      toast({ title: "China trip created!" });
      navigate(`/china/${trip.id}`);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container max-w-lg py-6">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <Card>
        <CardHeader>
          <CardTitle className="font-sans text-2xl">New China Trip</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supplier">Supplier / Factory</Label>
              <Input
                id="supplier"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="e.g. Shenzhen Lighting Co."
                required
              />
            </div>

            {/* Nearby Location Suggestions */}
            {(loadingStores || nearbyStores.length > 0) && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Store className="h-3.5 w-3.5" /> Nearby locations
                </Label>
                {loadingStores ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Finding locations near you…
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {nearbyStores.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => selectNearbyStore(s)}
                        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                        title={s.address}
                      >
                        {s.name}
                        {s.rating && (
                          <span className="flex items-center gap-0.5 text-muted-foreground">
                            <Star className="h-3 w-3 fill-current" /> {s.rating}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>Venue Type</Label>
              <Select value={venueType} onValueChange={setVenueType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="canton_fair">Canton Fair (Trade Show)</SelectItem>
                  <SelectItem value="factory_visit">Factory Visit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input id="date" name="date" type="date" defaultValue={new Date().toISOString().split("T")[0]} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <div className="relative">
                  <Input
                    id="location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="City or booth #"
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={detectLocation}
                    disabled={locatingDevice}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    title="Detect location"
                  >
                    {locatingDevice ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" placeholder="What products are you sourcing?" rows={3} />
            </div>
            <Button type="submit" className="w-full" disabled={submitting || !supplier.trim()}>
              {submitting ? "Creating..." : "Create Trip"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
