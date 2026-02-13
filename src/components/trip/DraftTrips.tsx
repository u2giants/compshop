import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSignedPhotoUrl } from "@/lib/supabase-helpers";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Calendar, MapPin, Loader2, Check, Trash2, FileText, GripHorizontal, ImageIcon } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface DraftPhoto {
  id: string;
  file_path: string;
  url?: string;
}

interface DraftTrip {
  id: string;
  name: string;
  store: string;
  date: string;
  location: string | null;
  photo_count: number;
  photos: DraftPhoto[];
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
  const [dragPhoto, setDragPhoto] = useState<{ photoId: string; fromTripId: string } | null>(null);
  const [dragOverTrip, setDragOverTrip] = useState<string | null>(null);

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
        const { data: photoData } = await supabase
          .from("photos")
          .select("id, file_path")
          .eq("trip_id", trip.id)
          .order("created_at");

        const photos: DraftPhoto[] = [];
        if (photoData) {
          for (const p of photoData) {
            let url: string | undefined;
            try { url = await getSignedPhotoUrl(p.file_path); } catch {}
            photos.push({ id: p.id, file_path: p.file_path, url });
          }
        }

        // Parse lat/lng from the store name if it contains coordinates
        let lat: number | undefined;
        let lng: number | undefined;
        const coordMatch = trip.store.match(/\(([-\d.]+),\s*([-\d.]+)\)/);
        if (coordMatch) {
          lat = parseFloat(coordMatch[1]);
          lng = parseFloat(coordMatch[2]);
        }

        return { ...trip, photo_count: photos.length, photos, lat, lng };
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
    await supabase.from("photos").delete().eq("trip_id", tripId);
    await supabase.from("trip_members").delete().eq("trip_id", tripId);
    await supabase.from("shopping_trips").delete().eq("id", tripId);
    setDrafts((prev) => prev.filter((d) => d.id !== tripId));
    toast({ title: "Draft deleted" });
    onPublished();
  }

  // Drag and drop handlers
  function handleDragStart(photoId: string, fromTripId: string) {
    setDragPhoto({ photoId, fromTripId });
  }

  function handleDragOver(e: React.DragEvent, tripId: string) {
    e.preventDefault();
    if (dragPhoto && dragPhoto.fromTripId !== tripId) {
      setDragOverTrip(tripId);
    }
  }

  function handleDragLeave() {
    setDragOverTrip(null);
  }

  async function handleDrop(e: React.DragEvent, toTripId: string) {
    e.preventDefault();
    setDragOverTrip(null);
    if (!dragPhoto || dragPhoto.fromTripId === toTripId) return;

    const { photoId, fromTripId } = dragPhoto;
    setDragPhoto(null);

    // Move photo to new trip in DB
    const { error } = await supabase
      .from("photos")
      .update({ trip_id: toTripId })
      .eq("id", photoId);

    if (error) {
      toast({ title: "Failed to move photo", variant: "destructive" });
      return;
    }

    // Update local state
    setDrafts((prev) => {
      const updated = prev.map((d) => {
        if (d.id === fromTripId) {
          const photo = d.photos.find((p) => p.id === photoId);
          const newPhotos = d.photos.filter((p) => p.id !== photoId);
          return { ...d, photos: newPhotos, photo_count: newPhotos.length };
        }
        if (d.id === toTripId) {
          const fromDraft = prev.find((dd) => dd.id === fromTripId);
          const movedPhoto = fromDraft?.photos.find((p) => p.id === photoId);
          if (movedPhoto) {
            const newPhotos = [...d.photos, movedPhoto];
            return { ...d, photos: newPhotos, photo_count: newPhotos.length };
          }
        }
        return d;
      });
      // Remove empty drafts
      return updated.filter((d) => d.photos.length > 0);
    });

    toast({ title: "Photo moved" });
  }

  // Also clean up empty trips in DB
  useEffect(() => {
    const emptyDrafts = drafts.filter((d) => d.photo_count === 0);
    for (const d of emptyDrafts) {
      supabase.from("trip_members").delete().eq("trip_id", d.id).then(() =>
        supabase.from("shopping_trips").delete().eq("id", d.id)
      );
    }
  }, [drafts]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            <FileText className="h-5 w-5" /> Draft Trips
          </DialogTitle>
          <DialogDescription>
            Review auto-imported trips. Scroll through photos to verify, drag photos between trips, then publish.
          </DialogDescription>
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
              const isDragTarget = dragOverTrip === draft.id;

              return (
                <Card
                  key={draft.id}
                  className={`overflow-hidden transition-colors ${isDragTarget ? "ring-2 ring-primary bg-primary/5" : ""}`}
                  onDragOver={(e) => handleDragOver(e, draft.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, draft.id)}
                >
                  {/* Horizontal scrollable photo strip */}
                  {draft.photos.length > 0 && (
                    <ScrollArea className="w-full whitespace-nowrap border-b">
                      <div className="flex gap-1 p-2">
                        {draft.photos.map((photo) => (
                          <div
                            key={photo.id}
                            draggable
                            onDragStart={() => handleDragStart(photo.id, draft.id)}
                            className="relative flex-shrink-0 cursor-grab active:cursor-grabbing group"
                          >
                            {photo.url ? (
                              <img
                                src={photo.url}
                                alt=""
                                className="h-20 w-20 rounded object-cover border border-border"
                                loading="lazy"
                              />
                            ) : (
                              <div className="h-20 w-20 rounded bg-muted flex items-center justify-center border border-border">
                                <ImageIcon className="h-5 w-5 text-muted-foreground/40" />
                              </div>
                            )}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                              <GripHorizontal className="h-4 w-4 text-white drop-shadow" />
                            </div>
                          </div>
                        ))}
                      </div>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                  )}

                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(new Date(draft.date), "MMM d, yyyy")}
                      </div>
                      <span className="text-xs text-muted-foreground">{draft.photo_count} photo{draft.photo_count !== 1 ? "s" : ""}</span>
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
                                <span>{s.name}</span>
                                {s.rating && (
                                  <span className="ml-2 text-xs text-muted-foreground">★ {s.rating}</span>
                                )}
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
