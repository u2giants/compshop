import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Upload, Store } from "lucide-react";

interface Retailer {
  id: string;
  name: string;
  logo_path: string | null;
  created_at: string;
}

export default function RetailerManager() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!isAdmin) return;
    loadRetailers();
  }, [isAdmin]);

  async function loadRetailers() {
    const { data } = await supabase.from("retailers").select("*").order("name");
    if (data) setRetailers(data);
  }

  async function handleAdd() {
    if (!newName.trim() || !user) return;
    setAdding(true);
    const { error } = await supabase.from("retailers").insert({ name: newName.trim(), created_by: user.id });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Retailer added" });
      setNewName("");
      loadRetailers();
    }
    setAdding(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this retailer?")) return;
    const { error } = await supabase.from("retailers").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      loadRetailers();
    }
  }

  async function handleLogoUpload(retailerId: string, file: File) {
    const ext = file.name.split(".").pop();
    // Use a unique path each time to avoid browser caching issues
    const path = `${retailerId}_${Date.now()}.${ext}`;

    // Remove old logo first if it exists
    const retailer = retailers.find((r) => r.id === retailerId);
    if (retailer?.logo_path) {
      await supabase.storage.from("retailer-logos").remove([retailer.logo_path]);
    }

    const { error: uploadErr } = await supabase.storage.from("retailer-logos").upload(path, file);
    if (uploadErr) {
      toast({ title: "Upload failed", description: uploadErr.message, variant: "destructive" });
      return;
    }

    const { error } = await supabase.from("retailers").update({ logo_path: path }).eq("id", retailerId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Logo updated" });
      loadRetailers();
    }
  }

  function getLogoUrl(logoPath: string | null) {
    if (!logoPath) return null;
    const { data } = supabase.storage.from("retailer-logos").getPublicUrl(logoPath);
    return data.publicUrl;
  }

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Store className="h-4 w-4" /> Manage Retailers
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Retailer name"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button onClick={handleAdd} disabled={adding || !newName.trim()} size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>

        <div className="space-y-2">
          {retailers.map((r) => {
            const logoUrl = getLogoUrl(r.logo_path);
            return (
              <div key={r.id} className="flex items-center gap-3 rounded-md border p-2">
                <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded bg-muted">
                  {logoUrl ? (
                    <img src={logoUrl} alt={r.name} className="h-full w-full object-contain" />
                  ) : (
                    <Store className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <span className="flex-1 text-sm font-medium">{r.name}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  ref={(el) => { fileInputRefs.current[r.id] = el; }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleLogoUpload(r.id, file);
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => fileInputRefs.current[r.id]?.click()}
                >
                  <Upload className="h-3 w-3 mr-1" /> Logo
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => handleDelete(r.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
          {retailers.length === 0 && (
            <p className="text-sm text-muted-foreground">No retailers added yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
