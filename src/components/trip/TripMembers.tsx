import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Users, UserPlus, X } from "lucide-react";

interface Member {
  id: string;
  user_id: string;
  profile?: { display_name: string | null; email: string | null };
}

interface Props {
  tripId: string;
  createdBy: string | null;
}

export default function TripMembers({ tripId, createdBy }: Props) {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  const canManage = isAdmin || user?.id === createdBy;

  useEffect(() => {
    loadMembers();
  }, [tripId]);

  async function loadMembers() {
    const { data } = await supabase.from("trip_members").select("*").eq("trip_id", tripId);
    if (data) {
      const userIds = data.map((m) => m.user_id);
      const { data: profiles } = await supabase.from("profiles").select("id, display_name, email").in("id", userIds);
      const profileMap = new Map(profiles?.map((p) => [p.id, p]) ?? []);
      setMembers(data.map((m) => ({ ...m, profile: profileMap.get(m.user_id) })));
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setAdding(true);

    try {
      // Find user by email (case-insensitive)
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", email.trim())
        .single();

      if (!profile) {
        toast({ title: "User not found", description: "No account exists with that email.", variant: "destructive" });
        return;
      }

      const { error } = await supabase.from("trip_members").insert({ trip_id: tripId, user_id: profile.id });
      if (error) {
        if (error.code === "23505") {
          toast({ title: "Already a member" });
        } else {
          throw error;
        }
      } else {
        toast({ title: "Member added!" });
        setEmail("");
        loadMembers();
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(memberId: string) {
    const { error } = await supabase.from("trip_members").delete().eq("id", memberId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      loadMembers();
    }
  }

  return (
    <div className="mb-6">
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogTrigger asChild>
          <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <Users className="h-4 w-4" />
            {members.length} team member{members.length !== 1 ? "s" : ""}
          </button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-sans">Trip Members</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{m.profile?.display_name || "Unknown"}</span>
                  <span className="ml-2 text-muted-foreground">{m.profile?.email}</span>
                </div>
                {canManage && m.user_id !== user?.id && (
                  <button onClick={() => handleRemove(m.id)} className="text-destructive hover:text-destructive/80">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {canManage && (
            <form onSubmit={handleAdd} className="mt-4 flex gap-2">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="team@company.com"
                type="email"
              />
              <Button type="submit" size="sm" disabled={adding} className="gap-1">
                <UserPlus className="h-4 w-4" /> Add
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
