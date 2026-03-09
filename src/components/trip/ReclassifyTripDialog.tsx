import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface ReclassifyTripDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  currentVenueType: string;
  currentParentId: string | null;
  onReclassified: () => void;
}

interface GroupOption {
  id: string;
  name: string;
  date: string;
  end_date: string | null;
}

export default function ReclassifyTripDialog({
  open,
  onOpenChange,
  tripId,
  currentVenueType,
  currentParentId,
  onReclassified,
}: ReclassifyTripDialogProps) {
  const { toast } = useToast();
  const [venueType, setVenueType] = useState(currentVenueType);
  const [parentId, setParentId] = useState<string | null>(currentParentId);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVenueType(currentVenueType);
    setParentId(currentParentId);
    loadGroups();
  }, [open, currentVenueType, currentParentId]);

  async function loadGroups() {
    const { data } = await supabase
      .from("china_trips")
      .select("id, name, date, end_date")
      .is("deleted_at", null)
      .not("end_date", "is", null)
      .is("parent_id", null)
      .neq("id", tripId)
      .order("date", { ascending: false });
    setGroups(data ?? []);
  }

  async function handleSave() {
    setSaving(true);
    const { error } = await supabase
      .from("china_trips")
      .update({
        venue_type: venueType,
        parent_id: parentId,
      })
      .eq("id", tripId);

    setSaving(false);
    if (error) {
      toast({ title: "Failed to reclassify", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Trip reclassified" });
    onOpenChange(false);
    onReclassified();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-sans">Reclassify Trip</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Venue Type</Label>
            <Select value={venueType} onValueChange={setVenueType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="canton_fair">Canton Fair</SelectItem>
                <SelectItem value="booth_visit">Booth Visit</SelectItem>
                <SelectItem value="factory_visit">Factory Visit</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Canton Fair Group</Label>
            <Select
              value={parentId ?? "__none__"}
              onValueChange={(v) => setParentId(v === "__none__" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="No group (standalone)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No group (standalone)</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Assign to a Canton Fair group or leave standalone.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
