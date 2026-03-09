import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, MapPin, Loader2, Store, Star, Info } from "lucide-react";

interface NearbyStore {
  name: string;
  address: string;
  rating: number | null;
}

interface ParentGroup {
  id: string;
  name: string;
  date: string;
  end_date: string | null;
}

export default function NewChinaTrip() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const presetType = searchParams.get("type") || "factory_visit";
  const presetParent = searchParams.get("parent") || "";

  const [submitting, setSubmitting] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [venueType, setVenueType] = useState<string>(presetType);
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [locatingDevice, setLocatingDevice] = useState(false);
  const [nearbyStores, setNearbyStores] = useState<NearbyStore[]>([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);

  // Auto-suggest parent group
  const [availableGroups, setAvailableGroups] = useState<ParentGroup[]>([]);
  const [selectedParentId, setSelectedParentId] = useState<string>(presetParent);
  const [suggestedParentId, setSuggestedParentId] = useState<string | null>(null);

  const isGroupType = venueType === "canton_fair_group";
  const canHaveParent = venueType === "factory_visit" || venueType === "booth_visit" || venueType === "canton_fair";

  useEffect(() => {
    detectLocation();
    loadAvailableGroups();
  }, []);

  // Auto-suggest parent when date changes
  useEffect(() => {
    if (!canHaveParent || !date) {
      setSuggestedParentId(null);
      return;
    }
    const d = new Date(date);
    const matching = availableGroups.find((g) => {
      const start = new Date(g.date);
      const end = g.end_date ? new Date(g.end_date) : start;
      return d >= start && d <= end;
    });
    if (matching) {
      setSuggestedParentId(matching.id);
      if (!selectedParentId) setSelectedParentId(matching.id);
    } else {
      setSuggestedParentId(null);
    }
  }, [date, availableGroups, canHaveParent]);

  async function loadAvailableGroups() {
    const { data } = await supabase
      .from("china_trips")
      .select("id, name, date, end_date")
      .not("end_date", "is", null)
      .is("parent_id", null)
      .is("deleted_at", null)
      .order("date", { ascending: false });
    if (data) setAvailableGroups(data as ParentGroup[]);
  }

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
        body: { latitude, longitude, radius: 150 },
      });
      if (error) throw error;
      if (data?.stores) setNearbyStores(data.stores);
    } catch (err: any) {
      console.error("Failed to fetch nearby stores:", err);
    } finally {
      setLoadingStores(false);
    }
  };

  const selectNearbyStore = (s: NearbyStore) => {
    setSupplier(s.name);
    if (s.address && !location) setLocation(s.address);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !supplier.trim()) return;
    setSubmitting(true);

    try {
      const insertData: any = {
        name: supplier.trim(),
        supplier: supplier.trim(),
        venue_type: isGroupType ? "canton_fair" : venueType,
        date,
        location: location || null,
        notes: notes || null,
        created_by: user.id,
      };

      if (isGroupType && endDate) {
        insertData.end_date = endDate;
      }

      if (canHaveParent && selectedParentId && selectedParentId !== "none") {
        insertData.parent_id = selectedParentId;
      }

      const { data: trip, error } = await supabase
        .from("china_trips")
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      await supabase.from("china_trip_members").insert({ trip_id: trip.id, user_id: user.id });

      toast({ title: isGroupType ? "Canton Fair group created!" : "Asia trip created!" });
      navigate(isGroupType ? "/china" : `/china/${trip.id}`);
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
          <CardTitle className="font-sans text-2xl">New Asia Trip</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Only show type selector if no preset type from URL */}
            {!searchParams.get("type") && (
            <div className="space-y-2">
              <Label>Trip Type</Label>
              <Select value={venueType} onValueChange={(v) => { setVenueType(v); setSelectedParentId(""); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="factory_visit">Factory Visit</SelectItem>
                  <SelectItem value="canton_fair_group">📦 Canton Fair Group</SelectItem>
                </SelectContent>
              </Select>
              {isGroupType && (
                <p className="text-xs text-muted-foreground flex items-start gap-1">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  A group card contains factory visits and booth visits made during a Canton Fair trip.
                </p>
              )}
            </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="supplier">{isGroupType ? "Trip Name" : "Supplier / Factory"}</Label>
              <Input
                id="supplier"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder={isGroupType ? "e.g. Canton Fair Autumn 2026" : "e.g. Shenzhen Lighting Co."}
                required
              />
            </div>

            {/* Nearby Location Suggestions */}
            {!isGroupType && (loadingStores || nearbyStores.length > 0) && (
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

            {/* Auto-suggest parent group - hide when parent is preset from URL */}
            {canHaveParent && !presetParent && availableGroups.length > 0 && (
              <div className="space-y-2">
                <Label>Parent Group (optional)</Label>
                <Select value={selectedParentId} onValueChange={setSelectedParentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="None (standalone trip)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (standalone)</SelectItem>
                    {availableGroups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name} ({g.date}{g.end_date ? ` – ${g.end_date}` : ""})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {suggestedParentId && selectedParentId === suggestedParentId && (
                  <Badge variant="secondary" className="text-xs">
                    Auto-suggested based on date
                  </Badge>
                )}
              </div>
            )}

            <div className={`grid gap-4 ${isGroupType ? "grid-cols-2" : "grid-cols-2"}`}>
              <div className="space-y-2">
                <Label htmlFor="date">{isGroupType ? "Start Date" : "Date"}</Label>
                <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              {isGroupType ? (
                <div className="space-y-2">
                  <Label htmlFor="end_date">End Date</Label>
                  <Input id="end_date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
                </div>
              ) : (
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
              )}
            </div>

            {isGroupType && (
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <div className="relative">
                  <Input
                    id="location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Guangzhou, China"
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
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What products are you sourcing?" rows={3} />
            </div>
            <Button type="submit" className="w-full" disabled={submitting || !supplier.trim()}>
              {submitting ? "Creating..." : isGroupType ? "Create Group" : "Create Trip"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
