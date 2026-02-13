import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSignedPhotoUrl } from "@/lib/supabase-helpers";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, MapPin, Loader2, Check, Trash2, FileText } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface DraftTrip {
  id: string;
  name: string;
  store: string;
  date: string;
  location: string | null;
  photo_count: number;
  cover_url?: string;
  lat?: number;
  lng?: number;
}

interface NearbyStore {
  name: string;
  address: string;
  rating: number | null;
}

interface DraftTripsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished: () => void;
}

export default function DraftTrips({ open, onOpenChange, onPublished }: DraftTripsProps) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<DraftTrip[]>([]);
  const [loading, setLoading] = useState(false);
  const [storeOptions, setStoreOptions] = useState<Map<string, NearbyStore[]>>(new Map());
  const [loadingStores, setLoadingStores] = useState<Set<string>>(new Set());
  const [customNames, setCustomNames] = useState<Map<string, string>>(new Map());
  const [publishing, setPublishing] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) loadDrafts();
  }, [open]);

  async function loadDrafts() {
    setLoading(true);
    const { data } = await supabase
      .from("shopping_trips")
      .select("*")
      .eq("is_draft", true)
      .is("deleted_at", null)
      .order("date", { ascending: false });

    if (!data) { setLoading(false); return; }

    const enriched: DraftTrip[] = await Promise.all(
      data.map(async (trip) => {
        const [{ count }, coverRes] = await Promise.all([
          supabase.from("photos").select("*", { count: "exact", head: true }).eq("trip_id", trip.id),
          supabase.from("photos").select("file_path").eq("trip_id", trip.id).order("created_at").limit(1),
        ]);
        let cover_url: string | undefined;
        if (coverRes.data?.[0]?.file_path) {
          try { cover_url = await getSignedPhotoUrl(coverRes.data[0].file_path); } catch {}
        }

        // Parse lat/lng from the store name if it contains coordinates
        let lat: number | undefined;
        let lng: number | undefined;
        const coordMatch = trip.store.match(/\(([-\d.]+),\s*([-\d.]+)\)/);
        if (coordMatch) {
          lat = parseFloat(coordMatch[1]);
          lng = parseFloat(coordMatch[2]);
        }

        return { ...trip, photo_count: count ?? 0, cover_url, lat, lng };
      })
    );

    setDrafts(enriched);
    setLoading(false);

    // Fetch store suggestions for drafts with coordinates
    for (const draft of enriched) {
      if (draft.lat && draft.lng && !storeOptions.has(draft.id)) {
        fetchStoreOptions(draft.id, draft.lat, draft.lng);
      }
    }
  }

  async function fetchStoreOptions(tripId: string, lat: number, lng: number) {
    setLoadingStores((prev) => new Set(prev).add(tripId));
    try {
      const { data, error } = await supabase.functions.invoke("nearby-stores", {
        body: { latitude: lat, longitude: lng },
      });
      if (!error && data?.stores) {
        setStoreOptions((prev) => new Map(prev).set(tripId, data.stores));
        // Auto-select first store as default
        if (data.stores.length > 0 && !customNames.has(tripId)) {
          setCustomNames((prev) => new Map(prev).set(tripId, data.stores[0].name));
        }
      }
    } catch (err) {
      console.error("Failed to fetch nearby stores for draft", tripId, err);
    }
    setLoadingStores((prev) => { const n = new Set(prev); n.delete(tripId); return n; });
  }

  async function publishDraft(tripId: string) {
    const storeName = customNames.get(tripId);
    if (!storeName?.trim()) {
      toast({ title: "Please enter a store name", variant: "destructive" });
      return;
    }

    setPublishing((prev) => new Set(prev).add(tripId));
    const { error } = await supabase
      .from("shopping_trips")
      .update({ is_draft: false, store: storeName.trim(), name: storeName.trim() })
      .eq("id", tripId);

    if (error) {
      toast({ title: "Failed to publish", variant: "destructive" });
    } else {
      setDrafts((prev) => prev.filter((d) => d.id !== tripId));
      toast({ title: "Trip published!" });
      onPublished();
    }
    setPublishing((prev) => { const n = new Set(prev); n.delete(tripId); return n; });
  }

  async function deleteDraft(tripId: string) {
    // Permanently delete draft + its photos
    await supabase.from("photos").delete().eq("trip_id", tripId);
    await supabase.from("trip_members").delete().eq("trip_id", tripId);
    await supabase.from("shopping_trips").delete().eq("id", tripId);
    setDrafts((prev) => prev.filter((d) => d.id !== tripId));
    toast({ title: "Draft deleted" });
    onPublished();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            <FileText className="h-5 w-5" /> Draft Trips
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : drafts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No draft trips to review.</p>
        ) : (
          <div className="space-y-4">
            {drafts.map((draft) => {
              const stores = storeOptions.get(draft.id) || [];
              const isLoadingStores = loadingStores.has(draft.id);
              const currentName = customNames.get(draft.id) || "";

              return (
                <Card key={draft.id} className="overflow-hidden">
                  {draft.cover_url && (
                    <div className="h-28 w-full">
                      <img src={draft.cover_url} alt="" className="h-full w-full object-cover" />
                    </div>
                  )}
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(new Date(draft.date), "MMM d, yyyy")}
                      </div>
                      <Badge variant="secondary">{draft.photo_count} photos</Badge>
                    </div>

                    {draft.lat && draft.lng && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {draft.lat.toFixed(4)}, {draft.lng.toFixed(4)}
                      </div>
                    )}

                    {/* Store name selection */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Store Name</label>
                      {isLoadingStores ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Finding nearby stores...
                        </div>
                      ) : stores.length > 0 ? (
                        <Select
                          value={currentName}
                          onValueChange={(v) => setCustomNames((prev) => new Map(prev).set(draft.id, v))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose a store" />
                          </SelectTrigger>
                          <SelectContent>
                            {stores.map((s, i) => (
                              <SelectItem key={i} value={s.name}>
                                <div>
                                  <span>{s.name}</span>
                                  {s.rating && (
                                    <span className="ml-2 text-xs text-muted-foreground">★ {s.rating}</span>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                      <Input
                        placeholder="Or type a custom store name"
                        value={currentName}
                        onChange={(e) => setCustomNames((prev) => new Map(prev).set(draft.id, e.target.value))}
                        className="text-sm"
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 gap-1"
                        disabled={!currentName.trim() || publishing.has(draft.id)}
                        onClick={() => publishDraft(draft.id)}
                      >
                        {publishing.has(draft.id) ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        Publish
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="gap-1"
                        onClick={() => deleteDraft(draft.id)}
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
