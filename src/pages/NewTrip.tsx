import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, MapPin, Loader2 } from "lucide-react";

export default function NewTrip() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [location, setLocation] = useState("");
  const [locatingDevice, setLocatingDevice] = useState(false);

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
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
          );
          const data = await res.json();
          const city = data.address?.city || data.address?.town || data.address?.village || "";
          const state = data.address?.state || "";
          const country = data.address?.country || "";
          const parts = [city, state, country].filter(Boolean);
          setLocation(parts.join(", "));
        } catch {
          // silently fail, user can type manually
        } finally {
          setLocatingDevice(false);
        }
      },
      () => setLocatingDevice(false),
      { timeout: 10000 }
    );
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const store = form.get("store") as string;
    const date = form.get("date") as string;
    const notes = form.get("notes") as string;

    try {
      const { data: trip, error } = await supabase
        .from("shopping_trips")
        .insert({ name: store, store, date, location: location || null, notes: notes || null, created_by: user.id })
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

  return (
    <div className="container max-w-lg py-6">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-2xl">New Shopping Trip</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="store">Store</Label>
              <Input id="store" name="store" placeholder="e.g. West Elm" required />
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
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Creating..." : "Create Trip"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
