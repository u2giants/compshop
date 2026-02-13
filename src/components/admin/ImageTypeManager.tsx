import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Image } from "lucide-react";

interface ImageType {
  id: string;
  name: string;
}

export default function ImageTypeManager() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [types, setTypes] = useState<ImageType[]>([]);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    loadTypes();
  }, [isAdmin]);

  async function loadTypes() {
    const { data } = await supabase.from("image_types").select("id, name").order("name");
    if (data) setTypes(data);
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    const { error } = await supabase.from("image_types").insert({ name: newName.trim() });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Image type added" });
      setNewName("");
      loadTypes();
    }
    setAdding(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this image type?")) return;
    const { error } = await supabase.from("image_types").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      loadTypes();
    }
  }

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Image className="h-4 w-4" /> Manage Image Types
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Image type name"
            className="flex-1"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button onClick={handleAdd} disabled={adding || !newName.trim()} size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>

        <div className="space-y-1">
          {types.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
              <span className="flex-1 text-sm">{t.name}</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive" onClick={() => handleDelete(t.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          {types.length === 0 && (
            <p className="text-sm text-muted-foreground">No image types added yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
