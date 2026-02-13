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
import { DollarSign, MapPin, Ruler, Layers, Tag, MessageSquare, Trash2, Pencil, Sparkles, Loader2 } from "lucide-react";
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
}

export default function PhotoCard({ photo, extraPhotos = [], onUpdated, onGroupPhoto }: Props) {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const countries = useCountries();
  const [showDetail, setShowDetail] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [editing, setEditing] = useState(false);
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

  const canEdit = isAdmin || photo.user_id === user?.id;
  const canDelete = canEdit;

  function startEditing() {
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
    setEditing(true);
  }

  async function handleAnalyze() {
    if (!photo.signed_url) return;
    setAnalyzing(true);
    try {
      // Fetch the image and convert to base64
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

      // Pre-fill edit fields and enter edit mode
      setEditData((d) => ({
        ...d,
        product_name: data.product_name || d.product_name,
        price: data.price != null ? String(data.price) : d.price,
        dimensions: data.dimensions || d.dimensions,
        brand: data.brand || d.brand,
        material: data.material || d.material,
        country_of_origin: data.country_of_origin || d.country_of_origin,
      }));
      setEditing(true);
      toast({ title: "AI analysis complete", description: "Fields have been pre-filled. Review and save." });
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
      setEditing(false);
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
          e.dataTransfer.dropEffect = "move";
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const draggedId = e.dataTransfer.getData("text/plain");
          if (draggedId && draggedId !== photo.id && onGroupPhoto) {
            onGroupPhoto(draggedId, photo.id);
          }
        }}
      >
        <div className="relative cursor-pointer" onClick={() => setShowDetail(true)}>
          {photo.signed_url ? (
            <img
              src={photo.signed_url}
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
            <Badge className="absolute right-2 top-2 bg-background/80 text-foreground backdrop-blur-sm">
              {totalImages} photos
            </Badge>
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
            {canEdit && (
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => { setShowDetail(true); startEditing(); }}>
                <Pencil className="h-3 w-3" /> Edit
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={handleDelete}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Full detail / edit dialog */}
      <Dialog open={showDetail} onOpenChange={(open) => { setShowDetail(open); if (!open) setEditing(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="font-serif">{photo.product_name || "Photo Details"}</DialogTitle>
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
                {canEdit && !editing && (
                  <Button variant="outline" size="sm" className="gap-1" onClick={startEditing}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>
          {totalImages > 1 ? (
            <div className="relative">
              <img
                src={allImages[activeImageIndex]?.signed_url || ""}
                alt={photo.product_name || "Photo"}
                className="w-full rounded-lg"
              />
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
                variant="ghost"
                size="sm"
                className="absolute left-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0 bg-background/60 backdrop-blur-sm"
                onClick={() => setActiveImageIndex((i) => (i - 1 + totalImages) % totalImages)}
              >
                ‹
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0 bg-background/60 backdrop-blur-sm"
                onClick={() => setActiveImageIndex((i) => (i + 1) % totalImages)}
              >
                ›
              </Button>
            </div>
          ) : photo.signed_url ? (
            <img src={photo.signed_url} alt={photo.product_name || "Photo"} className="w-full rounded-lg" />
          ) : null}

          {editing ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-2">
                  <Label>Product Name</Label>
                  <Input value={editData.product_name} onChange={(e) => setEditData((d) => ({ ...d, product_name: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={editData.category} onValueChange={(v) => setEditData((d) => ({ ...d, category: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {PRODUCT_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Price</Label>
                  <Input type="number" step="0.01" value={editData.price} onChange={(e) => setEditData((d) => ({ ...d, price: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Brand</Label>
                  <Input value={editData.brand} onChange={(e) => setEditData((d) => ({ ...d, brand: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Size/Dimensions</Label>
                  <Input value={editData.dimensions} onChange={(e) => setEditData((d) => ({ ...d, dimensions: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Made In</Label>
                  <AutocompleteInput
                    value={editData.country_of_origin}
                    onChange={(v) => setEditData((d) => ({ ...d, country_of_origin: v }))}
                    suggestions={countries}
                    placeholder="Country"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Material</Label>
                  <Input value={editData.material} onChange={(e) => setEditData((d) => ({ ...d, material: e.target.value }))} />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>Notes</Label>
                  <Textarea rows={2} value={editData.notes} onChange={(e) => setEditData((d) => ({ ...d, notes: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving} className="flex-1">
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
                <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {photo.category && <div><span className="text-muted-foreground">Category:</span> {photo.category}</div>}
                {photo.price != null && <div><span className="text-muted-foreground">Price:</span> ${photo.price}</div>}
                {photo.brand && <div><span className="text-muted-foreground">Brand:</span> {photo.brand}</div>}
                {photo.dimensions && <div><span className="text-muted-foreground">Dimensions:</span> {photo.dimensions}</div>}
                {photo.country_of_origin && <div><span className="text-muted-foreground">Made In:</span> {photo.country_of_origin}</div>}
                {photo.material && <div><span className="text-muted-foreground">Material:</span> {photo.material}</div>}
              </div>
              {photo.notes && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Notes:</span>
                  <p className="mt-1">{photo.notes}</p>
                </div>
              )}
            </>
          )}
          <PhotoComments photoId={photo.id} />
        </DialogContent>
      </Dialog>

      {/* Comments dialog (mobile shortcut) */}
      <Dialog open={showComments} onOpenChange={setShowComments}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Comments</DialogTitle>
          </DialogHeader>
          <PhotoComments photoId={photo.id} />
        </DialogContent>
      </Dialog>
    </>
  );
}
