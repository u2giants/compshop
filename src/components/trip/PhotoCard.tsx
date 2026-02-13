import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PRODUCT_CATEGORIES } from "@/lib/supabase-helpers";
import { useCountries } from "@/hooks/use-countries";
import AutocompleteInput from "@/components/ui/autocomplete-input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DollarSign, MapPin, Ruler, Layers, Tag, MessageSquare, Trash2, Sparkles, Loader2 } from "lucide-react";
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
  user_id: string | null;
  created_at: string;
  signed_url?: string;
  group_id?: string | null;
}

interface Props {
  photo: Photo;
  extraPhotos?: Photo[];
  onUpdated: () => void;
  onGroupPhoto?: (draggedId: string, targetId: string) => void;
  onFileDrop?: (files: File[], targetPhotoId: string) => void;
}

export default function PhotoCard({ photo, extraPhotos = [], onUpdated, onGroupPhoto, onFileDrop }: Props) {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const countries = useCountries();
  const [showDetail, setShowDetail] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

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
    });
  }

  const canEdit = isAdmin || photo.user_id === user?.id;
  const canDelete = canEdit;

  async function handleAnalyze() {
    if (!photo.signed_url) return;
    setAnalyzing(true);
    try {
      const res = await fetch(photo.signed_url);
      const blob = await res.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const { data, error } = await supabase.functions.invoke("analyze-photo", {
        body: { imageBase64: base64, mimeType: blob.type },
      });

      if (error) throw error;

      setEditData((d) => ({
        ...d,
        product_name: data.product_name || d.product_name,
        price: data.price != null ? String(data.price) : d.price,
        dimensions: data.dimensions || d.dimensions,
        brand: data.brand || d.brand,
        material: data.material || d.material,
        country_of_origin: data.country_of_origin || d.country_of_origin,
      }));
      toast({ title: "AI analysis complete", description: "Fields have been pre-filled." });
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("photos")
        .update({
          product_name: editData.product_name || null,
          category: editData.category || null,
          price: editData.price ? Number(editData.price) : null,
          brand: editData.brand || null,
          dimensions: editData.dimensions || null,
          country_of_origin: editData.country_of_origin || null,
          material: editData.material || null,
          notes: editData.notes || null,
        })
        .eq("id", photo.id);
      if (error) throw error;
      toast({ title: "Photo updated!" });
      onUpdated();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this photo?")) return;
    try {
      await supabase.storage.from("photos").remove([photo.file_path]);
      const { error } = await supabase.from("photos").delete().eq("id", photo.id);
      if (error) throw error;
      toast({ title: "Photo deleted" });
      onUpdated();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  const metaItems = [
    photo.price != null && { icon: DollarSign, text: `${photo.price}` },
    photo.country_of_origin && { icon: MapPin, text: photo.country_of_origin },
    photo.dimensions && { icon: Ruler, text: photo.dimensions },
    photo.material && { icon: Layers, text: photo.material },
    photo.brand && { icon: Tag, text: photo.brand },
  ].filter(Boolean) as { icon: any; text: string }[];

  return (
    <>
      <Card
        className={`group overflow-hidden transition-shadow hover:shadow-md ${dragOver ? "ring-2 ring-primary ring-offset-2" : ""}`}
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
        <div className="relative cursor-pointer" onClick={() => setShowDetail(true)}>
          {(allImages[activeImageIndex]?.signed_url || photo.signed_url) ? (
            <img
              src={allImages[activeImageIndex]?.signed_url || photo.signed_url}
              alt={photo.product_name || "Photo"}
              className="aspect-[4/3] w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center bg-muted text-muted-foreground">
              No preview
            </div>
          )}
          {photo.category && (
            <Badge className="absolute left-2 top-2 bg-background/80 text-foreground backdrop-blur-sm">
              {photo.category}
            </Badge>
          )}
          {totalImages > 1 && (
            <>
              <Badge className="absolute right-2 top-2 bg-background/80 text-foreground backdrop-blur-sm">
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
                <span key={i} className="flex items-center -gap-px">
                  <item.icon className="h-3 w-3 mr-[-1px]" />{item.text}
                </span>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setShowComments(true)}>
              <MessageSquare className="h-3 w-3" /> Comment
            </Button>
            {canDelete && (
              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={handleDelete}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Full detail / edit dialog */}
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="font-sans">{editData.product_name || "Photo Details"}</DialogTitle>
              <div className="flex items-center gap-1">
                {canEdit && photo.signed_url && (
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
                )}
              </div>
            </div>
          </DialogHeader>

          {/* Image with max height so fields are always visible */}
          {totalImages > 1 ? (
            <div className="relative">
              <div className="overflow-auto touch-pan-x touch-pan-y">
                <img
                  src={allImages[activeImageIndex]?.signed_url || ""}
                  alt={photo.product_name || "Photo"}
                  className="w-full max-h-[40vh] object-contain rounded-lg origin-center"
                  style={{ touchAction: "pinch-zoom" }}
                />
              </div>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                {allImages.map((_, i) => (
                  <button
                    key={i}
                    className={`h-2 w-2 rounded-full transition-colors ${i === activeImageIndex ? "bg-primary" : "bg-primary/30"}`}
                    onClick={() => setActiveImageIndex(i)}
                  />
                ))}
              </div>
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
          ) : photo.signed_url ? (
            <div className="overflow-auto touch-pan-x touch-pan-y">
              <img src={photo.signed_url} alt={photo.product_name || "Photo"} className="w-full max-h-[40vh] object-contain rounded-lg origin-center" style={{ touchAction: "pinch-zoom" }} />
            </div>
          ) : null}

          {/* Always-editable fields */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">Product Name</Label>
                <Input value={editData.product_name} onChange={(e) => setEditData((d) => ({ ...d, product_name: e.target.value }))} placeholder="Product name" disabled={!canEdit} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Category</Label>
                <Select value={editData.category} onValueChange={(v) => setEditData((d) => ({ ...d, category: v }))} disabled={!canEdit}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {PRODUCT_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Price</Label>
                <Input type="number" step="0.01" value={editData.price} onChange={(e) => setEditData((d) => ({ ...d, price: e.target.value }))} placeholder="$0.00" disabled={!canEdit} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Brand</Label>
                <Input value={editData.brand} onChange={(e) => setEditData((d) => ({ ...d, brand: e.target.value }))} placeholder="Brand" disabled={!canEdit} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Size/Dimensions</Label>
                <Input value={editData.dimensions} onChange={(e) => setEditData((d) => ({ ...d, dimensions: e.target.value }))} placeholder='e.g. 12"x8"' disabled={!canEdit} />
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
                <Label className="text-xs text-muted-foreground">Material</Label>
                <Input value={editData.material} onChange={(e) => setEditData((d) => ({ ...d, material: e.target.value }))} placeholder="e.g. Ceramic" disabled={!canEdit} />
              </div>
              <div className="col-span-2 space-y-1">
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
    </>
  );
}
