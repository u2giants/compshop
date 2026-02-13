import { useEffect, useState, useCallback } from "react";
import { useDragAutoScroll } from "@/hooks/use-drag-autoscroll";
import { supabase } from "@/integrations/supabase/client";
import { getSignedPhotoUrl } from "@/lib/supabase-helpers";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AutocompleteInput from "@/components/ui/autocomplete-input";
import { useRetailers } from "@/hooks/use-retailers";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Calendar, MapPin, Loader2, Check, Trash2, FileText, GripHorizontal, ImageIcon, Plus, ZoomIn } from "lucide-react";
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
  const { user } = useAuth();
  const { retailerNames, getLogoUrl } = useRetailers();
  const { toast } = useToast();
  const { scrollRef, handleDragOverScroll, stopAutoScroll } = useDragAutoScroll();
  const [drafts, setDrafts] = useState<DraftTrip[]>([]);
  const [loading, setLoading] = useState(false);
  const [storeOptions, setStoreOptions] = useState<Map<string, NearbyStore[]>>(new Map());
  const [loadingStores, setLoadingStores] = useState<Set<string>>(new Set());
  const [customNames, setCustomNames] = useState<Map<string, string>>(new Map());
  const [publishing, setPublishing] = useState<Set<string>>(new Set());
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [dragFromTripId, setDragFromTripId] = useState<string | null>(null);
  const [dragOverTrip, setDragOverTrip] = useState<string | null>(null);
  const [zoomedPhoto, setZoomedPhoto] = useState<{ url: string; id: string } | null>(null);

  useEffect(() => {
    if (open) {
      loadDrafts();
      setSelectedPhotos(new Set());
    }
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
      setDrafts((prev) => {
        const remaining = prev.filter((d) => d.id !== tripId);
        if (remaining.length === 0) setSelectedPhotos(new Set());
        return remaining;
      });
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
    setSelectedPhotos(new Set());
    toast({ title: "Draft deleted" });
    onPublished();
  }

  // Multi-select
  function togglePhotoSelection(photoId: string, tripId: string) {
    setSelectedPhotos((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        const currentDraft = drafts.find((d) => d.id === tripId);
        if (currentDraft?.photos.some((p) => p.id === photoId)) {
          if (next.size > 0) {
            const firstSelectedId = next.values().next().value;
            const fromSameTrip = currentDraft?.photos.some((p) => p.id === firstSelectedId);
            if (!fromSameTrip) next.clear();
          }
          next.add(photoId);
        }
      }
      return next;
    });
  }

  // Drag-and-drop: drag selected photos (or single unselected)
  function handleDragStart(photoId: string, fromTripId: string) {
    if (!selectedPhotos.has(photoId)) {
      setSelectedPhotos(new Set([photoId]));
    }
    setDragFromTripId(fromTripId);
  }

  function handleDragOver(e: React.DragEvent, tripId: string) {
    e.preventDefault();
    if (dragFromTripId && dragFromTripId !== tripId) setDragOverTrip(tripId);
  }

  function handleDragLeave() { setDragOverTrip(null); }

  async function handleDrop(e: React.DragEvent, toTripId: string) {
    e.preventDefault();
    setDragOverTrip(null);
    if (!dragFromTripId || dragFromTripId === toTripId || selectedPhotos.size === 0) return;

    const fromTripId = dragFromTripId;
    const photoIds = Array.from(selectedPhotos);
    setDragFromTripId(null);

    const { error } = await supabase
      .from("photos")
      .update({ trip_id: toTripId })
      .in("id", photoIds);

    if (error) { toast({ title: "Failed to move photos", variant: "destructive" }); return; }

    setDrafts((prev) => {
      const movedSet = new Set(photoIds);
      const updated = prev.map((d) => {
        if (d.id === fromTripId) {
          const remaining = d.photos.filter((p) => !movedSet.has(p.id));
          return { ...d, photos: remaining, photo_count: remaining.length };
        }
        if (d.id === toTripId) {
          const fromDraft = prev.find((dd) => dd.id === fromTripId);
          const movedPhotos = fromDraft?.photos.filter((p) => movedSet.has(p.id)) || [];
          const newPhotos = [...d.photos, ...movedPhotos];
          return { ...d, photos: newPhotos, photo_count: newPhotos.length };
        }
        return d;
      });
      return updated.filter((d) => d.photos.length > 0);
    });

    toast({ title: `${photoIds.length} photo${photoIds.length !== 1 ? "s" : ""} moved` });
    setSelectedPhotos(new Set());
  }

  // Create a new draft card from selected photos
  async function createNewDraftFromSelected() {
    if (selectedPhotos.size === 0) return;

    // Find which draft they belong to
    const sourceDraft = drafts.find((d) => d.photos.some((p) => selectedPhotos.has(p.id)));
    if (!sourceDraft || !user) return;

    const photoIds = Array.from(selectedPhotos);

    // Create a new draft trip
    const { data: newTrip, error: tripError } = await supabase
      .from("shopping_trips")
      .insert({
        name: "New Draft",
        store: "New Draft",
        date: sourceDraft.date,
        location: sourceDraft.location,
        is_draft: true,
        created_by: user.id,
      })
      .select()
      .single();

    if (tripError || !newTrip) {
      toast({ title: "Failed to create new draft", variant: "destructive" });
      return;
    }

    // Add user as member
    await supabase.from("trip_members").insert({ trip_id: newTrip.id, user_id: user.id });

    // Move selected photos to new trip
    const { error } = await supabase
      .from("photos")
      .update({ trip_id: newTrip.id })
      .in("id", photoIds);

    if (error) {
      toast({ title: "Failed to move photos", variant: "destructive" });
      return;
    }

    // Update local state
    const movedSet = new Set(photoIds);
    const movedPhotos = sourceDraft.photos.filter((p) => movedSet.has(p.id));
    const remainingPhotos = sourceDraft.photos.filter((p) => !movedSet.has(p.id));

    setDrafts((prev) => {
      const updated = prev.map((d) => {
        if (d.id === sourceDraft.id) {
          return { ...d, photos: remainingPhotos, photo_count: remainingPhotos.length };
        }
        return d;
      }).filter((d) => d.photos.length > 0);

      // Add the new draft
      const newDraft: DraftTrip = {
        ...newTrip,
        photo_count: movedPhotos.length,
        photos: movedPhotos,
        lat: sourceDraft.lat,
        lng: sourceDraft.lng,
      };
      return [newDraft, ...updated];
    });

    // Fetch store options for new draft if it has coordinates
    if (sourceDraft.lat && sourceDraft.lng) {
      fetchStoreOptions(newTrip.id, sourceDraft.lat, sourceDraft.lng);
    }

    toast({ title: `New draft created with ${photoIds.length} photo${photoIds.length !== 1 ? "s" : ""}` });
    setSelectedPhotos(new Set());
  }

  // Clean up empty drafts in DB
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
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        ref={(el) => { scrollRef.current = el; }}
        onDragOver={handleDragOverScroll}
        onDragLeave={stopAutoScroll}
        onDrop={stopAutoScroll}
      >
        <DialogHeader>
          <DialogTitle className="font-sans flex items-center gap-2">
            <FileText className="h-5 w-5" /> Draft Trips
          </DialogTitle>
          <DialogDescription>
            Click photos to select, then drag to another trip or split into a new card. Tap the magnifier to zoom.
          </DialogDescription>
        </DialogHeader>

        {selectedPhotos.size > 0 && (
          <div className="flex items-center justify-between rounded-md bg-primary/10 px-3 py-2 text-sm">
            <span className="font-medium">{selectedPhotos.size} photo{selectedPhotos.size !== 1 ? "s" : ""} selected</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={createNewDraftFromSelected}>
                <Plus className="h-3 w-3" /> New Card
              </Button>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setSelectedPhotos(new Set())}>
                Clear
              </Button>
            </div>
          </div>
        )}

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
                  {draft.photos.length > 0 && (
                    <ScrollArea className="w-full whitespace-nowrap border-b">
                      <div className="flex gap-1 p-2">
                        {draft.photos.map((photo) => {
                          const isSelected = selectedPhotos.has(photo.id);
                          return (
                            <div
                              key={photo.id}
                              draggable
                              onDragStart={() => handleDragStart(photo.id, draft.id)}
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePhotoSelection(photo.id, draft.id);
                              }}
                              className={`relative flex-shrink-0 cursor-grab active:cursor-grabbing group ${
                                isSelected ? "ring-2 ring-primary rounded" : ""
                              }`}
                            >
                              {photo.url ? (
                                <img src={photo.url} alt="" className="h-20 w-20 rounded object-cover border border-border" loading="lazy" />
                              ) : (
                                <div className="h-20 w-20 rounded bg-muted flex items-center justify-center border border-border">
                                  <ImageIcon className="h-5 w-5 text-muted-foreground/40" />
                                </div>
                              )}
                              {isSelected ? (
                                <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                                  <Check className="h-3 w-3 text-primary-foreground" />
                                </div>
                              ) : (
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                  <GripHorizontal className="h-4 w-4 text-white drop-shadow" />
                                </div>
                              )}
                              {/* Zoom button */}
                              {photo.url && (
                                <button
                                  className="absolute bottom-1 left-1 h-5 w-5 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setZoomedPhoto({ url: photo.url!, id: photo.id });
                                  }}
                                >
                                  <ZoomIn className="h-3 w-3 text-white" />
                                </button>
                              )}
                            </div>
                          );
                        })}
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
                          <SelectContent className="max-h-60">
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
                      <AutocompleteInput
                        placeholder="Or type a custom store name"
                        value={currentName}
                        onChange={(v) => setCustomNames((prev) => new Map(prev).set(draft.id, v))}
                        suggestions={retailerNames}
                        className="text-sm"
                        renderSuggestion={(name) => {
                          const logo = getLogoUrl(name);
                          return (
                            <span className="flex items-center gap-2">
                              {logo && <img src={logo} alt="" className="h-4 w-4 object-contain" />}
                              {name}
                            </span>
                          );
                        }}
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

      {/* Zoom overlay */}
      {zoomedPhoto && (
        <Dialog open={!!zoomedPhoto} onOpenChange={() => setZoomedPhoto(null)}>
          <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 flex items-center justify-center">
            <img
              src={zoomedPhoto.url}
              alt=""
              className="max-w-full max-h-[85vh] object-contain rounded"
            />
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
