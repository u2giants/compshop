import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link2 } from "lucide-react";

interface PhotoForPicker {
  id: string;
  product_name: string | null;
  signed_url?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourcePhotoId: string;
  photos: PhotoForPicker[];
  onLink: (sourceId: string, targetId: string) => void;
}

export default function LinkToCardDialog({ open, onOpenChange, sourcePhotoId, photos, onLink }: Props) {
  const [search, setSearch] = useState("");
  
  // Filter out the source photo and show remaining primary photos
  const candidates = photos.filter(p => 
    p.id !== sourcePhotoId && 
    (search === "" || (p.product_name || "").toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-sans flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Link to Card
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Select a card to merge this photo into:</p>
        <Input 
          placeholder="Search by product name..." 
          value={search} 
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2"
        />
        <div className="grid grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto">
          {candidates.map(p => (
            <button
              key={p.id}
              className="rounded-lg border border-border p-1 hover:ring-2 hover:ring-primary transition-all text-left"
              onClick={() => {
                onLink(sourcePhotoId, p.id);
                onOpenChange(false);
              }}
            >
              {p.signed_url ? (
                <img src={p.signed_url} alt={p.product_name || "Photo"} className="aspect-[4/3] w-full object-cover rounded" />
              ) : (
                <div className="aspect-[4/3] w-full bg-muted rounded flex items-center justify-center text-xs text-muted-foreground">No preview</div>
              )}
              <p className="text-xs mt-1 truncate px-1">{p.product_name || "Untitled"}</p>
            </button>
          ))}
          {candidates.length === 0 && (
            <p className="col-span-2 text-sm text-muted-foreground text-center py-4">No other cards to link to</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
