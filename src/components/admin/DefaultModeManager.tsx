import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Settings2 } from "lucide-react";
import type { AppMode } from "@/contexts/AppModeContext";

interface UserProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  default_mode: string;
}

export default function DefaultModeManager() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (isAdmin) loadProfiles();
  }, [isAdmin]);

  if (!isAdmin) return null;

  async function loadProfiles() {
    const { data } = await supabase
      .from("profiles")
      .select("id, email, display_name, default_mode")
      .order("display_name");
    if (data) setProfiles(data as UserProfile[]);
  }

  async function handleChange(userId: string, mode: AppMode) {
    const { error } = await supabase
      .from("profiles")
      .update({ default_mode: mode } as any)
      .eq("id", userId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setProfiles((prev) =>
        prev.map((p) => (p.id === userId ? { ...p, default_mode: mode } : p))
      );
      toast({ title: "Default mode updated" });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-sans text-lg">
          <Settings2 className="h-5 w-5" /> Default Module
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Set the default module each user sees on login.
        </p>
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className="flex items-center justify-between gap-2 rounded-md border p-2"
          >
            <span className="truncate text-sm">
              {profile.display_name || profile.email || "Unknown"}
            </span>
            <Select
              value={profile.default_mode}
              onValueChange={(v) => handleChange(profile.id, v as AppMode)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="store_shopping">Shopping</SelectItem>
                <SelectItem value="china_trip">Asia Trips</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
