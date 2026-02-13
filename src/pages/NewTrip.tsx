import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRetailers } from "@/hooks/use-retailers";
import AutocompleteInput from "@/components/ui/autocomplete-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, MapPin, Loader2, Store, Star } from "lucide-react";

interface NearbyStore {
  name: string;
  address: string;
  rating: number | null;
}

export default function NewTrip() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { retailerNames, getLogoUrl } = useRetailers();
  const [submitting, setSubmitting] = useState(false);
  const [location, setLocation] = useState("");
  const [store, setStore] = useState("");
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

          // Reverse geocode for location name
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
          );
          const data = await res.json();
          const city = data.address?.city || data.address?.town || data.address?.village || "";
          const state = data.address?.state || "";
          const country = data.address?.country || "";
          const parts = [city, state, country].filter(Boolean);
          setLocation(parts.join(", "));

          // Fetch nearby stores
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
        body: { latitude, longitude },
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
    setStore(s.name);
    if (s.address && !location) {
      setLocation(s.address);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !store.trim()) return;
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const date = form.get("date") as string;
    const notes = form.get("notes") as string;

    try {
      const { data: trip, error } = await supabase
        .from("shopping_trips")
        .insert({ name: store.trim(), store: store.trim(), date, location: location || null, notes: notes || null, created_by: user.id })
        .select()
        .single();

      if (error) throw error;

      await supabase.from("trip_members").insert({ trip_id: trip.id, user_id: user.id });

      toast({ title: "Trip created!" });
      navigate(`/trips/${trip.id}`);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const logoUrl = getLogoUrl(store);

  return (
    <div className="container max-w-lg py-6">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <Card>
        <CardHeader>
          <CardTitle className="font-sans text-2xl">New Shopping Trip</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="store">Store</Label>
              <div className="flex items-center gap-2">
                {logoUrl && <img src={logoUrl} alt={store} className="h-8 w-8 rounded object-contain" />}
                <div className="flex-1">
                  <AutocompleteInput
                    id="store"
                    value={store}
                    onChange={setStore}
                    suggestions={retailerNames}
                    placeholder="e.g. West Elm"
                  />
                </div>
              </div>
            </div>

            {/* Nearby Store Suggestions */}
            {(loadingStores || nearbyStores.length > 0) && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Store className="h-3.5 w-3.5" /> Nearby stores
                </Label>
                {loadingStores ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Finding stores near you…
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
                    placeholder="City or address"
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
              <Textarea id="notes" name="notes" placeholder="What are you looking for on this trip?" rows={3} />
            </div>
            <Button type="submit" className="w-full" disabled={submitting || !store.trim()}>
              {submitting ? "Creating..." : "Create Trip"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
