import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Globe } from "lucide-react";

interface Country {
  id: string;
  name: string;
  code: string | null;
}

export default function CountryManager() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [countries, setCountries] = useState<Country[]>([]);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    loadCountries();
  }, [isAdmin]);

  async function loadCountries() {
    const { data } = await supabase.from("countries").select("*").order("name");
    if (data) setCountries(data);
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    const { error } = await supabase.from("countries").insert({ name: newName.trim(), code: newCode.trim() || null });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Country added" });
      setNewName("");
      setNewCode("");
      loadCountries();
    }
    setAdding(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this country?")) return;
    const { error } = await supabase.from("countries").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      loadCountries();
    }
  }

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Globe className="h-4 w-4" /> Manage Countries
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Country name"
            className="flex-1"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="Code"
            className="w-20"
          />
          <Button onClick={handleAdd} disabled={adding || !newName.trim()} size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>

        <div className="space-y-1">
          {countries.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
              <span className="flex-1 text-sm">{c.name}</span>
              {c.code && <span className="text-xs text-muted-foreground">{c.code}</span>}
              <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive" onClick={() => handleDelete(c.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          {countries.length === 0 && (
            <p className="text-sm text-muted-foreground">No countries added yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
