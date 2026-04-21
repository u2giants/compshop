import { useState, useRef, useCallback, useEffect } from "react";
import { getCachedImageBlob, cacheImageBlob } from "@/lib/offline-db";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCategories } from "@/hooks/use-categories";
import { useImageTypes } from "@/hooks/use-image-types";
import { useCountries } from "@/hooks/use-countries";
import { useIsMobile } from "@/hooks/use-mobile";
import AutocompleteInput from "@/components/ui/autocomplete-input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DollarSign, MapPin, Ruler, Layers, Tag, MessageSquare, Trash2, Sparkles, Loader2, ImageIcon, ArrowRightLeft, Crop, Camera, Plus, Link2, Unlink2 } from "lucide-react";
import PhotoCropDialog from "./PhotoCropDialog";
import MoveToTripDialog from "./MoveToTripDialog";
import ChinaMoveToTripDialog from "./ChinaMoveToTripDialog";
import { useToast } from "@/hooks/use-toast";
import PhotoComments from "./PhotoComments";

interface Photo {
  id: string;
  file_path: string;
  product_name: string | null;
  category: string | null;
  price: number | null;
  dimensions: string | null;
  country_of_origin: string | null;
  material: string | null;
  brand: string | null;
  notes: string | null;
  image_type: string | null;
  user_id: string | null;
  created_at: string;
  signed_url?: string;
  group_id?: string | null;
  thumbnail_path?: string | null;
  signed_thumbnail_url?: string;
  media_type?: string | null;
}

interface Props {
  photo: Photo;
  extraPhotos?: Photo[];
  tripId?: string;
  onUpdated: () => void;
  onGroupPhoto?: (draggedId: string, targetId: string) => void;
  onFileDrop?: (files: File[], targetPhotoId: string) => void;
  onMobileLinkRequest?: (sourcePhotoId: string) => void;
  onUnlinkPhoto?: (photoId: string) => void;
  selected?: boolean;
  onSelect?: (photoId: string, event?: React.MouseEvent) => void;
  selectionMode?: boolean;
  chinaMode?: boolean;
  userName?: string;
}

export default function PhotoCard({ photo, extraPhotos = [], tripId, onUpdated, onGroupPhoto, onFileDrop, onMobileLinkRequest, onUnlinkPhoto, selected, onSelect, selectionMode, chinaMode, userName }: Props) {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const countries = useCountries();
  const IMAGE_TYPES = useImageTypes();
  const categories = useCategories();
  const isMobile = useIsMobile();
  const [showDetail, setShowDetail] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showCropDialog, setShowCropDialog] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [imageZoomed, setImageZoomed] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const addPhotoInputRef = useRef<HTMLInputElement>(null);
  const addPhotoCameraRef = useRef<HTMLInputElement>(null);
  const dragState = useRef<{ isDragging: boolean; startX: number; startY: number; scrollLeft: number; scrollTop: number }>({ isDragging: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });

  // ── Blob cache: prefer local blobs over signed URLs ──
  const [blobUrl, setBlobUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    let revoke: string | undefined;
    let cancelled = false;
    (async () => {
      // Check blob cache for the original file
      const blob = await getCachedImageBlob(photo.file_path);
      if (cancelled) return;
      if (blob) {
        const url = URL.createObjectURL(blob);
        revoke = url;
        setBlobUrl(url);
        return;
      }
      // No blob cached — if we have a signed URL, fetch & cache it
      const signedUrl = photo.signed_thumbnail_url || photo.signed_url;
      if (signedUrl) {
        try {
          const res = await fetch(signedUrl);
          const b = await res.blob();
          await cacheImageBlob(photo.file_path, b);
          if (cancelled) return;
          const url = URL.createObjectURL(b);
          revoke = url;
          setBlobUrl(url);
        } catch {}
      }
    })();
    return () => { cancelled = true; if (revoke) URL.revokeObjectURL(revoke); };
  }, [photo.id, photo.file_path]);

  // Use a ref-based native wheel listener so we can preventDefault (passive: false)
  const zoomContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    // Also store as imgContainerRef if needed
    (imgContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setZoomScale((prev) => {
        const next = prev - e.deltaY * 0.002;
        return Math.min(Math.max(next, 0.5), 5);
      });
    };
    node.addEventListener('wheel', handler, { passive: false });
    // Store cleanup on the node itself
    (node as any).__wheelCleanup?.();
    (node as any).__wheelCleanup = () => node.removeEventListener('wheel', handler);
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setZoomScale(1);
    setImageZoomed(false);
  }, []);

  const resetZoom = useCallback(() => {
    setZoomScale(1);
    setImageZoomed(false);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    dragState.current = { isDragging: true, startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
    el.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.isDragging) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    e.currentTarget.scrollLeft = dragState.current.scrollLeft - dx;
    e.currentTarget.scrollTop = dragState.current.scrollTop - dy;
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current.isDragging = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const allImages = [photo, ...extraPhotos];
  const totalImages = allImages.length;

  const [editData, setEditData] = useState({
    product_name: photo.product_name || "",
    category: photo.category || "",
    price: photo.price != null ? String(photo.price) : "",
    brand: photo.brand || "",
    dimensions: photo.dimensions || "",
    country_of_origin: photo.country_of_origin || "",
    material: photo.material || "",
    notes: photo.notes || "",
    image_type: (photo as any).image_type || "",
  });

  // Sync editData when photo prop changes
  const [lastPhotoId, setLastPhotoId] = useState(photo.id);
  if (photo.id !== lastPhotoId) {
    setLastPhotoId(photo.id);
    setEditData({
      product_name: photo.product_name || "",
      category: photo.category || "",
      price: photo.price != null ? String(photo.price) : "",
      brand: photo.brand || "",
      dimensions: photo.dimensions || "",
      country_of_origin: photo.country_of_origin || "",
      material: photo.material || "",
      notes: photo.notes || "",
      image_type: (photo as any).image_type || "",
    });
  }

  const canEdit = isAdmin || photo.user_id === user?.id;
  const canDelete = canEdit;

  // Multi-image AI detect: analyzes all images in the group and merges results
  async function handleAnalyze() {
    const imagesToAnalyze = allImages.filter(img => img.signed_url);
    if (imagesToAnalyze.length === 0) return;
    setAnalyzing(true);
    try {
      // Analyze all images (or just the first if single)
      const results: Record<string, any>[] = [];
      
      for (const img of imagesToAnalyze) {
        try {
          const res = await fetch(img.signed_url!);
          const blob = await res.blob();
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          const { data, error } = await supabase.functions.invoke("analyze-photo", {
            body: { imageBase64: base64, mimeType: blob.type, categories },
          });

          if (error) {
            console.error("AI analysis error for image:", img.id, error);
            continue;
          }
          results.push(data);
        } catch (err) {
          console.error("Failed to analyze image:", img.id, err);
        }
      }

      if (results.length === 0) {
        throw new Error("All image analyses failed");
      }

      // Merge results: pick first non-null value for each field across all results
      const merged = {
        product_name: null as string | null,
        category: null as string | null,
        price: null as number | null,
        dimensions: null as string | null,
        brand: null as string | null,
        material: null as string | null,
        country_of_origin: null as string | null,
      };

      for (const r of results) {
        if (!merged.product_name && r.product_name) merged.product_name = r.product_name;
        if (!merged.category && r.category) merged.category = r.category;
        if (merged.price == null && r.price != null) merged.price = r.price;
        if (!merged.dimensions && r.dimensions) merged.dimensions = r.dimensions;
        if (!merged.brand && r.brand) merged.brand = r.brand;
        if (!merged.material && r.material) merged.material = r.material;
        if (!merged.country_of_origin && r.country_of_origin) merged.country_of_origin = r.country_of_origin;
      }

      setEditData((d) => ({
        ...d,
        product_name: merged.product_name || d.product_name,
        category: (merged.category ? (categories.find((c) => c.toLowerCase() === merged.category!.toLowerCase()) || merged.category) : null) || d.category,
        price: merged.price != null ? String(merged.price) : d.price,
        dimensions: merged.dimensions || d.dimensions,
        brand: merged.brand || d.brand,
        material: merged.material || d.material,
        country_of_origin: merged.country_of_origin || d.country_of_origin,
      }));
      toast({ 
        title: "AI analysis complete", 
        description: results.length > 1 
          ? `Analyzed ${results.length} images and merged results.` 
          : "Fields have been pre-filled." 
      });
    } catch (err: unknown) {
      toast({ title: "AI analysis failed", description: friendlyErrorMessage(err), variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  }

  // Handle adding more photos to this card
  async function handleAddPhotoToCard(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || !onFileDrop) return;
    const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (imageFiles.length > 0) {
      onFileDrop(imageFiles, photo.id);
    }
    // Reset input so same file can be selected again
    e.target.value = "";
  }

  async function handleSave() {
    setSaving(true);
    const table = chinaMode ? "china_photos" : "photos";
    try {
      const { error } = await supabase
        .from(table)
        .update({
          product_name: editData.product_name || null,
          category: editData.category || null,
          price: editData.price ? Number(editData.price) : null,
          brand: editData.brand || null,
          dimensions: editData.dimensions || null,
          country_of_origin: editData.country_of_origin || null,
          material: editData.material || null,
          notes: editData.notes || null,
          image_type: editData.image_type || null,
        })
        .eq("id", photo.id);
      if (error) throw error;
      toast({ title: "Photo updated!" });
      setShowDetail(false);
      onUpdated();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this photo?")) return;
    const table = chinaMode ? "china_photos" : "photos";
    try {
      await supabase.storage.from("photos").remove([photo.file_path]);
      const { error } = await supabase.from(table).delete().eq("id", photo.id);
      if (error) throw error;
      toast({ title: "Photo deleted" });
      onUpdated();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  // Strip metric portion from dimensions if imperial is also present
  function displayDimensions(dim: string): string {
    const hasImperial = /["'"]|(\d\s*in\b)/i.test(dim);
    const hasMetric = /\d\s*(cm|mm|m\b)/i.test(dim);
    if (hasImperial && hasMetric) {
      return dim
        .replace(/\s*[/|]\s*[\d.]+\s*x?\s*[\d.]*\s*(cm|mm|m)\b[^)"]*/gi, "")
        .replace(/\s*\([\d.\s×x]+\s*(cm|mm|m)\s*\)/gi, "")
        .replace(/,?\s*[\d.]+\s*(cm|mm|m)\s*x?\s*[\d.]*\s*(cm|mm|m)?\b/gi, "")
        .trim();
    }
    return dim;
  }

  const metaItems = [
    (photo as any).image_type && { icon: ImageIcon, text: (photo as any).image_type },
    photo.dimensions && { icon: Ruler, text: displayDimensions(photo.dimensions) },
    photo.price != null && { icon: DollarSign, text: `${photo.price}` },
  ].filter(Boolean) as { icon: any; text: string }[];

  return (
    <>
      <Card
        className={`group overflow-hidden transition-shadow hover:shadow-md md:cursor-default cursor-pointer ${dragOver ? "ring-2 ring-primary ring-offset-2" : ""} ${selected ? "ring-2 ring-primary" : ""}`}
        onClick={() => {
          if (window.innerWidth < 768) setShowDetail(true);
        }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", photo.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = e.dataTransfer.types.includes("Files") ? "copy" : "move";
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0 && onFileDrop) {
            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
            if (files.length > 0) {
              onFileDrop(files, photo.id);
              return;
            }
          }
          const draggedId = e.dataTransfer.getData("text/plain");
          if (draggedId && draggedId !== photo.id && onGroupPhoto) {
            onGroupPhoto(draggedId, photo.id);
          }
        }}
      >
        <div className="relative cursor-pointer" onClick={(e) => { if (selectionMode && onSelect) { onSelect(photo.id, e); return; } setShowDetail(true); }}>
          {onSelect && (
            <button
              className={`absolute right-2 top-2 z-10 h-5 w-5 rounded border-2 flex items-center justify-center transition-all ${
                selected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/50 bg-background/80 backdrop-blur-sm opacity-0 group-hover:opacity-100"
              } ${selectionMode ? "!opacity-100" : ""}`}
              onClick={(e) => { e.stopPropagation(); onSelect(photo.id, e); }}
            >
              {selected && <span className="text-xs">✓</span>}
            </button>
          )}
          {(() => {
            const currentImg = allImages[activeImageIndex] || photo;
            const isVideo = (currentImg as any).media_type === "video";
            const previewSrc = blobUrl || currentImg.signed_thumbnail_url || (isVideo ? undefined : currentImg.signed_url) || photo.signed_thumbnail_url || (isVideo ? undefined : photo.signed_url);
            if (isVideo) {
              return (
                <div className="relative aspect-[4/3] w-full bg-black">
                  {previewSrc ? (
                    <img src={previewSrc} alt={photo.product_name || "Video"} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-white/50 text-xs">Video</div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="rounded-full bg-black/60 p-3 backdrop-blur-sm">
                      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d="M8 5v14l11-7z" /></svg>
                    </div>
                  </div>
                </div>
              );
            }
            if (previewSrc) {
              return (
                <img
                  src={previewSrc}
                  alt={photo.product_name || "Photo"}
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                />
              );
            }
            return (
              <div className="flex aspect-[4/3] items-center justify-center bg-muted text-muted-foreground">
                No preview
              </div>
            );
          })()}
          {photo.category && (
            <Badge className="absolute left-2 top-2 bg-background/80 text-foreground backdrop-blur-sm">
              {photo.category}
            </Badge>
          )}
          {totalImages > 1 && (
            <>
              <Badge className="absolute right-2 bottom-2 bg-background/80 text-foreground backdrop-blur-sm">
                {activeImageIndex + 1}/{totalImages}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="absolute left-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0 border-2 border-destructive bg-background/80 backdrop-blur-sm text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); setActiveImageIndex((i) => (i - 1 + totalImages) % totalImages); }}
              >
                ‹
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0 border-2 border-destructive bg-background/80 backdrop-blur-sm text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); setActiveImageIndex((i) => (i + 1) % totalImages); }}
              >
                ›
              </Button>
            </>
          )}
        </div>
        <CardContent className="p-3">
          {photo.product_name && (
            <h4 className="font-medium leading-snug">{photo.product_name}</h4>
          )}
          {metaItems.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {metaItems.slice(0, 3).map((item, i) => (
                <span key={i} className={`flex items-center ${item.icon === DollarSign ? 'gap-0' : 'gap-1'}`}>
                  <item.icon className="h-3 w-3 shrink-0" />{item.text}
                </span>
              ))}
            </div>
          )}
          {userName && (
            <p className="mt-1 text-[10px] text-muted-foreground/70 truncate">by {userName}</p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={(e) => { e.stopPropagation(); setShowComments(true); }}>
              <MessageSquare className="h-3 w-3" /> Comment
            </Button>
            {tripId && canEdit && (
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={(e) => { e.stopPropagation(); setShowMoveDialog(true); }}>
                <ArrowRightLeft className="h-3 w-3" /> Move
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(); }}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
            {isMobile && onMobileLinkRequest && (
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={(e) => { e.stopPropagation(); onMobileLinkRequest(photo.id); }}>
                <Link2 className="h-3 w-3" /> Link
              </Button>
            )}
            {totalImages > 1 && onUnlinkPhoto && canEdit && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                onClick={(e) => {
                  e.stopPropagation();
                  const imgToUnlink = allImages[activeImageIndex];
                  const target = activeImageIndex > 0 ? imgToUnlink : allImages[1];
                  if (target && confirm(`Unlink ${activeImageIndex > 0 ? "this" : "the next"} photo from the card? It will become its own card.`)) {
                    onUnlinkPhoto(target.id);
                    if (activeImageIndex > 0) setActiveImageIndex(0);
                  }
                }}
              >
                <Link2 className="h-3 w-3" /> Unlink
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Hidden inputs for adding photos to this card */}
      <input ref={addPhotoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAddPhotoToCard} />
      {isMobile && (
        <input ref={addPhotoCameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleAddPhotoToCard} />
      )}

      {/* Full detail / edit dialog */}
      <Dialog open={showDetail} onOpenChange={(open) => { setShowDetail(open); if (!open) { setImageZoomed(false); setZoomScale(1); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="font-sans">{editData.product_name || "Photo Details"}</DialogTitle>
              <div className="flex items-center gap-1">
                {canEdit && (
                  <>
                    {/* Add photo to this card */}
                    {onFileDrop && (
                      isMobile ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => addPhotoCameraRef.current?.click()}
                          >
                            <Camera className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => addPhotoInputRef.current?.click()}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => addPhotoInputRef.current?.click()}
                        >
                          <Plus className="h-3.5 w-3.5" /> Add Photo
                        </Button>
                      )
                    )}
                    {photo.signed_url && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => setShowCropDialog(true)}
                        >
                          <Crop className="h-3.5 w-3.5" /> Crop
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={handleAnalyze}
                          disabled={analyzing}
                        >
                          {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          {analyzing ? "Analyzing..." : "AI Detect"}
                        </Button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </DialogHeader>

          {/* Image with scroll-wheel zoom – double-click to reset */}
          {totalImages > 1 ? (
            <>
              <div className="relative">
                <div
                  ref={zoomContainerRef}
                  className="overflow-auto max-h-[50vh] touch-pan-x touch-pan-y cursor-grab active:cursor-grabbing select-none"
                  onDoubleClick={handleDoubleClick}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                >
                  {(allImages[activeImageIndex] as any)?.media_type === "video" ? (
                    <video
                      src={allImages[activeImageIndex]?.signed_url || ""}
                      controls
                      playsInline
                      className="w-full rounded-lg max-h-[50vh] bg-black"
                    />
                  ) : (
                    <img
                      src={allImages[activeImageIndex]?.signed_url || ""}
                      alt={photo.product_name || "Photo"}
                      className="w-full rounded-lg origin-top-left transition-transform duration-100"
                      style={{ transform: `scale(${zoomScale})`, touchAction: "pinch-zoom" }}
                      draggable={false}
                    />
                  )}
                </div>
                {zoomScale !== 1 && (
                  <Badge className="absolute top-2 left-1/2 -translate-x-1/2 bg-background/80 text-foreground backdrop-blur-sm text-xs">
                    {Math.round(zoomScale * 100)}% — double-click to reset
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute left-1 top-1/2 -translate-y-1/2 h-10 w-10 p-0 border-2 border-destructive bg-background/80 backdrop-blur-sm text-foreground"
                  onClick={() => setActiveImageIndex((i) => (i - 1 + totalImages) % totalImages)}
                >
                  ‹
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 p-0 border-2 border-destructive bg-background/80 backdrop-blur-sm text-foreground"
                  onClick={() => setActiveImageIndex((i) => (i + 1) % totalImages)}
                >
                  ›
                </Button>
              </div>
              {/* Thumbnail strip with unlink buttons */}
              <div className="flex gap-2 overflow-x-auto py-2 px-1">
                {allImages.map((img, i) => (
                  <div key={img.id} className="relative shrink-0 group/thumb">
                    <button
                      className={`block h-16 w-16 rounded-md overflow-hidden border-2 transition-all ${i === activeImageIndex ? "border-primary ring-1 ring-primary" : "border-transparent hover:border-muted-foreground/40"}`}
                      onClick={() => setActiveImageIndex(i)}
                    >
                      {img.signed_url ? (
                        <img src={img.signed_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full bg-muted flex items-center justify-center">
                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </button>
                    {onUnlinkPhoto && canEdit && (
                      <button
                        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity shadow-sm"
                        title="Unlink from this card"
                        onClick={(e) => {
                          e.stopPropagation();
                          const imgToUnlink = i === 0 ? allImages[1] : img;
                          if (confirm("Unlink this photo from the card? It will become its own card.")) {
                            onUnlinkPhoto(imgToUnlink.id);
                            if (activeImageIndex >= totalImages - 1) setActiveImageIndex(Math.max(0, activeImageIndex - 1));
                          }
                        }}
                      >
                        <Unlink2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : photo.signed_url ? (
            <div
              ref={zoomContainerRef}
              className="overflow-auto max-h-[50vh] touch-pan-x touch-pan-y cursor-grab active:cursor-grabbing relative select-none"
              onDoubleClick={handleDoubleClick}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <img
                src={photo.signed_url}
                alt={photo.product_name || "Photo"}
                className="w-full rounded-lg origin-top-left transition-transform duration-100"
                style={{ transform: `scale(${zoomScale})`, touchAction: "pinch-zoom" }}
                draggable={false}
              />
              {zoomScale !== 1 && (
                <Badge className="absolute top-2 left-1/2 -translate-x-1/2 bg-background/80 text-foreground backdrop-blur-sm text-xs z-10">
                  {Math.round(zoomScale * 100)}% — double-click to reset
                </Badge>
              )}
            </div>
          ) : null}

          {/* Always-editable fields */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="col-span-2 md:col-span-3 space-y-1">
                <Label className="text-xs text-muted-foreground">Product Name</Label>
                <Input value={editData.product_name} onChange={(e) => setEditData((d) => ({ ...d, product_name: e.target.value }))} placeholder="Product name" disabled={!canEdit} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Image Type</Label>
                <Select value={editData.image_type} onValueChange={(v) => setEditData((d) => ({ ...d, image_type: v }))} disabled={!canEdit}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {IMAGE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Size/Dimensions</Label>
                <Input value={editData.dimensions} onChange={(e) => setEditData((d) => ({ ...d, dimensions: e.target.value }))} placeholder='e.g. 12"x8"' disabled={!canEdit} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Price</Label>
                <Input type="number" step="0.01" value={editData.price} onChange={(e) => setEditData((d) => ({ ...d, price: e.target.value }))} placeholder="$0.00" disabled={!canEdit} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Made In</Label>
                <AutocompleteInput
                  value={editData.country_of_origin}
                  onChange={(v) => setEditData((d) => ({ ...d, country_of_origin: v }))}
                  suggestions={countries}
                  placeholder="Country"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Category</Label>
                <Select value={editData.category} onValueChange={(v) => setEditData((d) => ({ ...d, category: v }))} disabled={!canEdit}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Material</Label>
                <Input value={editData.material} onChange={(e) => setEditData((d) => ({ ...d, material: e.target.value }))} placeholder="e.g. Ceramic" disabled={!canEdit} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Brand</Label>
                <Input value={editData.brand} onChange={(e) => setEditData((d) => ({ ...d, brand: e.target.value }))} placeholder="Brand" disabled={!canEdit} />
              </div>
              <div className="col-span-2 md:col-span-3 space-y-1">
                <Label className="text-xs text-muted-foreground">Notes</Label>
                <Textarea rows={2} value={editData.notes} onChange={(e) => setEditData((d) => ({ ...d, notes: e.target.value }))} placeholder="Notes..." disabled={!canEdit} />
              </div>
            </div>
            {canEdit && (
              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            )}
          </div>

          <PhotoComments photoId={photo.id} />
        </DialogContent>
      </Dialog>

      {/* Comments dialog (mobile shortcut) */}
      <Dialog open={showComments} onOpenChange={setShowComments}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-sans">Comments</DialogTitle>
          </DialogHeader>
          <PhotoComments photoId={photo.id} />
        </DialogContent>
      </Dialog>

      {tripId && !chinaMode && (
        <MoveToTripDialog
          open={showMoveDialog}
          onOpenChange={setShowMoveDialog}
          photoIds={[photo.id, ...extraPhotos.map((p) => p.id)]}
          currentTripId={tripId}
          onMoved={onUpdated}
        />
      )}
      {tripId && chinaMode && (
        <ChinaMoveToTripDialog
          open={showMoveDialog}
          onOpenChange={setShowMoveDialog}
          photoIds={[photo.id, ...extraPhotos.map((p) => p.id)]}
          currentTripId={tripId}
          onMoved={onUpdated}
        />
      )}
      {photo.signed_url && (
        <PhotoCropDialog
          open={showCropDialog}
          onOpenChange={setShowCropDialog}
          imageUrl={photo.signed_url}
          photoId={photo.id}
          filePath={photo.file_path}
          chinaMode={chinaMode}
          onCropped={onUpdated}
        />
      )}
    </>
  );
}
