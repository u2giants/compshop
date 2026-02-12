import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DollarSign, MapPin, Ruler, Layers, Tag, MessageSquare, Trash2 } from "lucide-react";
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
}

interface Props {
  photo: Photo;
  onUpdated: () => void;
}

export default function PhotoCard({ photo, onUpdated }: Props) {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [showDetail, setShowDetail] = useState(false);
  const [showComments, setShowComments] = useState(false);

  const canDelete = isAdmin || photo.user_id === user?.id;

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
    photo.price != null && { icon: DollarSign, text: `$${photo.price}` },
    photo.country_of_origin && { icon: MapPin, text: photo.country_of_origin },
    photo.dimensions && { icon: Ruler, text: photo.dimensions },
    photo.material && { icon: Layers, text: photo.material },
    photo.brand && { icon: Tag, text: photo.brand },
  ].filter(Boolean) as { icon: any; text: string }[];

  return (
    <>
      <Card className="group overflow-hidden transition-shadow hover:shadow-md">
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
        </div>
        <CardContent className="p-3">
          {photo.product_name && (
            <h4 className="font-medium leading-snug">{photo.product_name}</h4>
          )}
          {metaItems.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {metaItems.slice(0, 3).map((item, i) => (
                <span key={i} className="flex items-center gap-1">
                  <item.icon className="h-3 w-3" /> {item.text}
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

      {/* Full detail dialog */}
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif">{photo.product_name || "Photo Details"}</DialogTitle>
          </DialogHeader>
          {photo.signed_url && (
            <img src={photo.signed_url} alt={photo.product_name || "Photo"} className="w-full rounded-lg" />
          )}
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
