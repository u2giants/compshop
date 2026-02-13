import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCategories } from "@/hooks/use-categories";
import { useImageTypes } from "@/hooks/use-image-types";
import { useCountries } from "@/hooks/use-countries";
import AutocompleteInput from "@/components/ui/autocomplete-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface Photo {
  id: string;
  product_name: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photoIds: string[];
  /** We need existing photos to append to product_name */
  photos: Photo[];
  onApplied: () => void;
}

export default function BulkEditDialog({ open, onOpenChange, photoIds, photos, onApplied }: Props) {
  const { toast } = useToast();
  const imageTypes = useImageTypes();
  const countries = useCountries();
  const [saving, setSaving] = useState(false);
  const categories = useCategories();

  // Each field has a value + enabled toggle (only apply fields the user fills in)
  const [productNameAppend, setProductNameAppend] = useState("");
  const [imageType, setImageType] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [brand, setBrand] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [countryValue, setCountryValue] = useState("");
  const [material, setMaterial] = useState("");

  function reset() {
    setProductNameAppend("");
    setImageType("");
    setCategory("");
    setPrice("");
    setBrand("");
    setDimensions("");
    setCountryValue("");
    setMaterial("");
  }

  async function handleApply() {
    if (photoIds.length === 0) return;
    setSaving(true);

    try {
      // Build shared update for replace fields (only non-empty ones)
      const sharedUpdate: Record<string, unknown> = {};
      if (imageType) sharedUpdate.image_type = imageType;
      if (category) sharedUpdate.category = category;
      if (price) sharedUpdate.price = Number(price);
      if (brand) sharedUpdate.brand = brand;
      if (dimensions) sharedUpdate.dimensions = dimensions;
      if (countryValue) sharedUpdate.country_of_origin = countryValue;
      if (material) sharedUpdate.material = material;

      const hasSharedUpdate = Object.keys(sharedUpdate).length > 0;
      const hasAppend = productNameAppend.trim().length > 0;

      if (!hasSharedUpdate && !hasAppend) {
        toast({ title: "Nothing to apply", description: "Fill in at least one field.", variant: "destructive" });
        setSaving(false);
        return;
      }

      // If only shared (no append), we can do a single bulk update
      if (hasSharedUpdate && !hasAppend) {
        const { error } = await supabase
          .from("photos")
          .update(sharedUpdate)
          .in("id", photoIds);
        if (error) throw error;
      } else {
        // Need per-photo updates for append logic
        const appendText = productNameAppend.trim();
        for (const pid of photoIds) {
          const update: Record<string, unknown> = { ...sharedUpdate };
          if (hasAppend) {
            const existing = photos.find((p) => p.id === pid)?.product_name || "";
            update.product_name = existing
              ? `${existing} ${appendText}`
              : appendText;
          }
          const { error } = await supabase
            .from("photos")
            .update(update)
            .eq("id", pid);
          if (error) throw error;
        }
      }

      toast({ title: `Updated ${photoIds.length} photos` });
      reset();
      onOpenChange(false);
      onApplied();
    } catch (err: any) {
      toast({ title: "Bulk edit failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-sans">Bulk Edit {photoIds.length} Photos</DialogTitle>
          <DialogDescription>
            Only filled fields will be applied. Product Name is <strong>appended</strong> to existing values; all other fields <strong>replace</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-2">
            <Label>Product Name (append)</Label>
            <Input
              value={productNameAppend}
              onChange={(e) => setProductNameAppend(e.target.value)}
              placeholder="Text to append…"
            />
          </div>

          <div className="space-y-2">
            <Label>Image Type</Label>
            <Select value={imageType} onValueChange={setImageType}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {imageTypes.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Price</Label>
            <Input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="$0.00"
            />
          </div>

          <div className="space-y-2">
            <Label>Brand</Label>
            <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand name" />
          </div>

          <div className="space-y-2">
            <Label>Size/Dimensions</Label>
            <Input value={dimensions} onChange={(e) => setDimensions(e.target.value)} placeholder='e.g. 12"x8"' />
          </div>

          <div className="space-y-2">
            <Label>Made In</Label>
            <AutocompleteInput
              value={countryValue}
              onChange={setCountryValue}
              suggestions={countries}
              placeholder="Country"
            />
          </div>

          <div className="col-span-2 space-y-2">
            <Label>Material</Label>
            <Input value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="e.g. Ceramic, Wood" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleApply} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Applying...</> : `Apply to ${photoIds.length} Photos`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
