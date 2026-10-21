import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Clock, LogOut, ShieldAlert } from "lucide-react";

export default function PendingApproval() {
  const { approvalStatus, approvalReason, signOut, user } = useAuth();
  const isBlocked = approvalStatus === "blocked";
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function saveIntro() {
    if (!user) return;
    setSaving(true);
    try {
      await supabase
        .from("profiles")
        .update({
          display_name: name.trim() || undefined,
          intro_note: note.trim() || null,
        })
        .eq("id", user.id);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            {isBlocked ? <ShieldAlert className="h-6 w-6 text-destructive" /> : <Clock className="h-6 w-6 text-muted-foreground" />}
          </div>
          <CardTitle>{isBlocked ? "Account access blocked" : "Approval needed"}</CardTitle>
          <CardDescription>
            {isBlocked
              ? "This account cannot access CompShop."
              : "Your sign-in worked, but an admin needs to approve this account before the app opens."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{user?.email}</p>
            <p className="mt-1 text-muted-foreground">
              {approvalReason || (isBlocked ? "Contact an admin if this looks wrong." : "Ask a CompShop admin to approve your account.")}
            </p>
          </div>

          {!isBlocked && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="intro-name">Your name</Label>
                <Input
                  id="intro-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="So the admin knows who you are"
                  maxLength={80}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="intro-note">Note for the admin (optional)</Label>
                <Textarea
                  id="intro-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Factory rep from Guangzhou, met at the fair"
                  maxLength={200}
                  rows={3}
                />
              </div>
              <Button className="w-full" onClick={saveIntro} disabled={saving || saved || (!name.trim() && !note.trim())}>
                {saved ? "Saved for the admin" : saving ? "Saving..." : "Save note for admin"}
              </Button>
            </div>
          )}

          <Button variant="outline" className="w-full gap-2" onClick={signOut}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
