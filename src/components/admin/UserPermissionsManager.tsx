import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Shield, ShieldOff } from "lucide-react";

type Role = "admin" | "user" | "store_readonly" | "china_readonly";

interface UserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  roles: Role[];
}

export default function UserPermissionsManager() {
  const { isAdmin, user: me } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (!isAdmin) return null;

  async function load() {
    setLoading(true);
    const [{ data: profiles }, { data: roleRows }] = await Promise.all([
      supabase.from("profiles").select("id, email, display_name").order("display_name"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    const rolesByUser = new Map<string, Role[]>();
    (roleRows ?? []).forEach((r: any) => {
      const list = rolesByUser.get(r.user_id) ?? [];
      list.push(r.role);
      rolesByUser.set(r.user_id, list);
    });
    const rows: UserRow[] = (profiles ?? []).map((p: any) => ({
      id: p.id,
      email: p.email,
      display_name: p.display_name,
      roles: rolesByUser.get(p.id) ?? [],
    }));
    setUsers(rows);
    setLoading(false);
  }

  async function toggleRole(userId: string, role: "store_readonly" | "china_readonly", enabled: boolean) {
    if (enabled) {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error && error.code !== "23505") {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }
    } else {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", role);
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }
    }
    toast({ title: "Permissions updated" });
    load();
  }

  return (
    <Card className="md:col-span-2 xl:col-span-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-sans text-lg">
          <Shield className="h-5 w-5" /> User Permissions
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-2">
            <div className="hidden grid-cols-[1fr_auto_auto] gap-4 px-3 pb-1 text-xs font-medium text-muted-foreground sm:grid">
              <span>User</span>
              <span className="w-32 text-center">Read-only Store</span>
              <span className="w-32 text-center">Read-only Asia</span>
            </div>
            {users.map((u) => {
              const isStoreRO = u.roles.includes("store_readonly");
              const isChinaRO = u.roles.includes("china_readonly");
              const isAdminRow = u.roles.includes("admin");
              const isMe = u.id === me?.id;
              return (
                <div
                  key={u.id}
                  className="grid grid-cols-1 items-center gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto_auto] sm:gap-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {u.display_name || u.email || u.id.slice(0, 8)}
                      {isMe && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      {isAdminRow && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          <Shield className="h-2.5 w-2.5" /> Admin
                        </span>
                      )}
                    </p>
                    {u.email && u.display_name && (
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    )}
                  </div>
                  <div className="flex w-32 items-center justify-between sm:justify-center">
                    <span className="text-xs text-muted-foreground sm:hidden">Read-only Store</span>
                    <Switch
                      checked={isStoreRO}
                      disabled={isAdminRow}
                      onCheckedChange={(checked) => toggleRole(u.id, "store_readonly", checked)}
                    />
                  </div>
                  <div className="flex w-32 items-center justify-between sm:justify-center">
                    <span className="text-xs text-muted-foreground sm:hidden">Read-only Asia</span>
                    <Switch
                      checked={isChinaRO}
                      disabled={isAdminRow}
                      onCheckedChange={(checked) => toggleRole(u.id, "china_readonly", checked)}
                    />
                  </div>
                </div>
              );
            })}
            {users.length === 0 && (
              <p className="text-sm text-muted-foreground">No users found.</p>
            )}
            <p className="pt-2 text-xs text-muted-foreground">
              <ShieldOff className="mr-1 inline h-3 w-3" />
              Admins always have full access and cannot be restricted.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
