import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Layers } from "lucide-react";

interface Category {
  id: string;
  name: string;
}

export default function CategoryManager() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    loadCategories();
  }, [isAdmin]);

  async function loadCategories() {
    const { data } = await supabase.from("categories").select("id, name").order("name");
    if (data) setCategories(data);
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    const { error } = await supabase.from("categories").insert({ name: newName.trim() });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Category added" });
      setNewName("");
      loadCategories();
    }
    setAdding(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this category?")) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      loadCategories();
    }
  }

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Layers className="h-4 w-4" /> Manage Categories
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Category name"
            className="flex-1"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button onClick={handleAdd} disabled={adding || !newName.trim()} size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>

        <div className="space-y-1">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
              <span className="flex-1 text-sm">{c.name}</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive" onClick={() => handleDelete(c.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          {categories.length === 0 && (
            <p className="text-sm text-muted-foreground">No categories added yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
