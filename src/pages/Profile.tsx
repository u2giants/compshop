import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { LogOut, Shield, FileDown } from "lucide-react";
import InviteManager from "@/components/admin/InviteManager";
import RetailerManager from "@/components/admin/RetailerManager";
import CountryManager from "@/components/admin/CountryManager";
import StorageQuotaManager from "@/components/settings/StorageQuotaManager";

export default function Profile() {
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data?.display_name) setDisplayName(data.display_name);
      });
  }, [user]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);

    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", user.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Profile updated!" });
    }
    setSaving(false);
  }

  return (
    <div className="container max-w-lg py-6 space-y-6">
      <h1 className="font-serif text-3xl">Profile</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Your Account</CardTitle>
            {isAdmin && (
              <Badge className="gap-1 bg-primary/10 text-primary">
                <Shield className="h-3 w-3" /> Admin
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user?.email || ""} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </form>
          <Button variant="outline" className="mt-4 w-full gap-2" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign Out
          </Button>
        </CardContent>
      </Card>

      {/* Data import */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <FileDown className="h-5 w-5" /> Import Data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button variant="outline" className="w-full gap-2" onClick={() => navigate("/import/keep")}>
            Import from Google Keep
          </Button>
          <Button variant="outline" className="w-full gap-2" onClick={() => navigate("/import/teams")}>
            Import from Microsoft Teams
          </Button>
        </CardContent>
      </Card>

      {/* Admin panels */}
      <InviteManager />
      <RetailerManager />
      <CountryManager />

      {/* Storage quota settings */}
      <StorageQuotaManager />
    </div>
  );
}
