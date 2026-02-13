import { useState, useRef, useCallback } from "react";
import ReactCrop, { type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  photoId: string;
  filePath: string;
  chinaMode?: boolean;
  onCropped: () => void;
}

function getCroppedCanvas(image: HTMLImageElement, crop: PixelCrop): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  canvas.width = crop.width * scaleX;
  canvas.height = crop.height * scaleY;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

export default function PhotoCropDialog({ open, onOpenChange, imageUrl, photoId, filePath, chinaMode, onCropped }: Props) {
  const { toast } = useToast();
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleSave = useCallback(async () => {
    if (!completedCrop || !imgRef.current) return;
    setSaving(true);
    try {
      const canvas = getCroppedCanvas(imgRef.current, completedCrop);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas to blob failed"))), "image/jpeg", 0.92),
      );

      // Overwrite existing file in storage
      const { error: uploadErr } = await supabase.storage
        .from("photos")
        .update(filePath, blob, { upsert: true, contentType: "image/jpeg" });
      if (uploadErr) throw uploadErr;

      // Touch updated_at so caches refresh
      const table = chinaMode ? "china_photos" : "photos";
      await supabase.from(table).update({ updated_at: new Date().toISOString() }).eq("id", photoId);

      toast({ title: "Photo cropped & saved!" });
      onOpenChange(false);
      onCropped();
    } catch (err: any) {
      toast({ title: "Crop failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [completedCrop, filePath, photoId, chinaMode, onCropped, onOpenChange, toast]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-sans">Crop Photo</DialogTitle>
          <DialogDescription>Drag to select the area you want to keep.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center">
          <ReactCrop crop={crop} onChange={(c) => setCrop(c)} onComplete={(c) => setCompletedCrop(c)}>
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Crop preview"
              className="max-h-[60vh] w-auto"
              crossOrigin="anonymous"
            />
          </ReactCrop>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !completedCrop}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Saving...</> : "Save Crop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
