import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSignedPhotoUrl } from "@/lib/supabase-helpers";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Calendar, MapPin, Loader2, Check, Trash2, FileText, GripHorizontal, ImageIcon } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface DraftPhoto {
  id: string;
  file_path: string;
  url?: string;
}

interface ChinaDraft {
  id: string;
  name: string;
  supplier: string;
  venue_type: string;
  date: string;
  location: string | null;
  photo_count: number;
  photos: DraftPhoto[];
}

interface ChinaDraftTripsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished: () => void;
}

export default function ChinaDraftTrips({ open, onOpenChange, onPublished }: ChinaDraftTripsProps) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<ChinaDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [supplierNames, setSupplierNames] = useState<Map<string, string>>(new Map());
  const [publishing, setPublishing] = useState<Set<string>>(new Set());
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [dragFromTripId, setDragFromTripId] = useState<string | null>(null);
  const [dragOverTrip, setDragOverTrip] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadDrafts();
      setSelectedPhotos(new Set());
    }
  }, [open]);

  async function loadDrafts() {
    setLoading(true);
    const { data } = await supabase
      .from("china_trips")
      .select("*")
      .eq("is_draft", true)
      .is("deleted_at", null)
      .order("date", { ascending: false });

    if (!data) { setLoading(false); return; }

    const enriched: ChinaDraft[] = await Promise.all(
      data.map(async (trip) => {
        const { data: photoData } = await supabase
          .from("china_photos")
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

        return { ...trip, photo_count: photos.length, photos };
      })
    );

    setDrafts(enriched);
    setLoading(false);
  }

  async function publishDraft(tripId: string) {
    const draft = drafts.find((d) => d.id === tripId);
    const name = supplierNames.get(tripId) ?? draft?.supplier;
    if (!name?.trim()) {
      toast({ title: "Please enter a supplier name", variant: "destructive", description: "The supplier/booth name field cannot be empty." });
      return;
    }

    setPublishing((prev) => new Set(prev).add(tripId));
    const { error } = await supabase
      .from("china_trips")
      .update({ is_draft: false, supplier: name.trim(), name: name.trim() })
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
    await supabase.from("china_photos").delete().eq("trip_id", tripId);
    await supabase.from("china_trip_members").delete().eq("trip_id", tripId);
    await supabase.from("china_trips").delete().eq("id", tripId);
    setDrafts((prev) => prev.filter((d) => d.id !== tripId));
    setSelectedPhotos(new Set());
    toast({ title: "Draft deleted" });
    onPublished();
  }

  // Multi-select: click to toggle selection
  function togglePhotoSelection(photoId: string, tripId: string) {
    setSelectedPhotos((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        // Only allow selecting photos from the same trip
        // If selecting from a different trip, clear previous selection
        const currentDraft = drafts.find((d) => d.id === tripId);
        const photoInTrip = currentDraft?.photos.some((p) => p.id === photoId);
        if (photoInTrip) {
          // Check if existing selection is from a different trip
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
    // If dragging a selected photo, all selected move; otherwise just the one
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

    // Move all selected photos in DB
    const { error } = await supabase
      .from("china_photos")
      .update({ trip_id: toTripId })
      .in("id", photoIds);

    if (error) { toast({ title: "Failed to move photos", variant: "destructive" }); return; }

    // Update local state
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

    const count = photoIds.length;
    toast({ title: `${count} photo${count !== 1 ? "s" : ""} moved` });
    setSelectedPhotos(new Set());
  }

  // Clean up empty drafts in DB
  useEffect(() => {
    const emptyDrafts = drafts.filter((d) => d.photo_count === 0);
    for (const d of emptyDrafts) {
      supabase.from("china_trip_members").delete().eq("trip_id", d.id).then(() =>
        supabase.from("china_trips").delete().eq("id", d.id)
      );
    }
  }, [drafts]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-sans flex items-center gap-2">
            <FileText className="h-5 w-5" /> China Draft Trips
          </DialogTitle>
          <DialogDescription>
            Click photos to select multiple, then drag them to another trip. Enter supplier names and publish.
          </DialogDescription>
        </DialogHeader>

        {selectedPhotos.size > 0 && (
          <div className="flex items-center justify-between rounded-md bg-primary/10 px-3 py-2 text-sm">
            <span className="font-medium">{selectedPhotos.size} photo{selectedPhotos.size !== 1 ? "s" : ""} selected</span>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setSelectedPhotos(new Set())}>
              Clear
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : drafts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No draft China trips to review.</p>
        ) : (
          <div className="space-y-4">
            {drafts.map((draft) => {
              const currentName = supplierNames.get(draft.id) || draft.supplier || "";
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
                            </div>
                          );
                        })}
                      </div>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                  )}

                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(new Date(draft.date), "MMM d, yyyy")}
                        <Badge variant="outline" className="text-xs">
                          {draft.venue_type === "canton_fair" ? "Canton Fair" : "Factory"}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">{draft.photo_count} photo{draft.photo_count !== 1 ? "s" : ""}</span>
                    </div>

                    {draft.location && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {draft.location}
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="text-xs font-medium">Supplier / Booth Name</label>
                      <Input
                        placeholder="Enter supplier or booth name"
                        value={currentName}
                        onChange={(e) => setSupplierNames((prev) => new Map(prev).set(draft.id, e.target.value))}
                        className="text-sm"
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 gap-1"
                        disabled={!(supplierNames.get(draft.id) || draft.supplier)?.trim() || publishing.has(draft.id)}
                        onClick={() => publishDraft(draft.id)}
                      >
                        {publishing.has(draft.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Publish
                      </Button>
                      <Button size="sm" variant="destructive" className="gap-1" onClick={() => deleteDraft(draft.id)}>
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
