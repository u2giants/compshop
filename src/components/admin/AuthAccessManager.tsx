import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Trash2 } from "lucide-react";

type RuleType = "email" | "domain" | "microsoft_tenant";
type RuleProvider = "*" | "email" | "google" | "azure" | "microsoft";
type RuleStatus = "approved" | "blocked";
type SupabaseError = { message: string; code?: string };
type QueryResult<T> = PromiseLike<{ data: T | null; error: SupabaseError | null }>;

interface AccessRule {
  id: string;
  rule_type: RuleType;
  value: string;
  provider: RuleProvider;
  status: RuleStatus;
  notes: string | null;
  created_at: string;
}

interface AuthAccessSupabaseClient {
  from(table: "auth_access_rules"): {
    select(columns: string): {
      order(column: string, options?: { ascending?: boolean }): QueryResult<AccessRule[]>;
    };
    insert(values: Record<string, unknown>): QueryResult<unknown>;
    delete(): {
      eq(column: string, value: string): QueryResult<unknown>;
    };
  };
}

export default function AuthAccessManager() {
  const { isAdmin, user } = useAuth();
  const { toast } = useToast();
  const [rules, setRules] = useState<AccessRule[]>([]);
  const [ruleType, setRuleType] = useState<RuleType>("email");
  const [provider, setProvider] = useState<RuleProvider>("*");
  const [status, setStatus] = useState<RuleStatus>("approved");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await (supabase as unknown as AuthAccessSupabaseClient)
      .from("auth_access_rules")
      .select("id, rule_type, value, provider, status, notes, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Access rules failed to load", description: error.message, variant: "destructive" });
      return;
    }
    setRules(data ?? []);
  }, [toast]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (!isAdmin) return null;

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || !user) return;
    setLoading(true);
    const normalizedValue = value.trim().toLowerCase().replace(/^@/, "");
    const { error } = await (supabase as unknown as AuthAccessSupabaseClient).from("auth_access_rules").insert({
      rule_type: ruleType,
      value: normalizedValue,
      provider,
      status,
      notes: notes.trim() || null,
      created_by: user.id,
    });
    setLoading(false);

    if (error) {
      toast({ title: "Could not add access rule", description: error.message, variant: "destructive" });
      return;
    }

    setValue("");
    setNotes("");
    toast({ title: "Access rule added" });
    load();
  }

  async function deleteRule(id: string) {
    const { error } = await (supabase as unknown as AuthAccessSupabaseClient).from("auth_access_rules").delete().eq("id", id);
    if (error) {
      toast({ title: "Could not delete access rule", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Access rule deleted" });
    load();
  }

  return (
    <Card className="md:col-span-2 xl:col-span-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-sans text-lg">
          <KeyRound className="h-5 w-5" /> Sign-in Access Rules
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={addRule} className="grid gap-3 md:grid-cols-[140px_140px_140px_1fr_1fr_auto]">
          <div className="space-y-2">
            <Label>Rule</Label>
            <Select value={ruleType} onValueChange={(next) => setRuleType(next as RuleType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="domain">Domain</SelectItem>
                <SelectItem value="microsoft_tenant">MS Tenant</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={(next) => setProvider(next as RuleProvider)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="*">Any</SelectItem>
                <SelectItem value="azure">Microsoft</SelectItem>
                <SelectItem value="google">Google</SelectItem>
                <SelectItem value="email">Email</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(next) => setStatus(next as RuleStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">Approve</SelectItem>
                <SelectItem value="blocked">Block</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ruleValue">Value</Label>
            <Input
              id="ruleValue"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={ruleType === "microsoft_tenant" ? "tenant-id-guid" : ruleType === "domain" ? "company.com" : "person@example.com"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ruleNotes">Notes</Label>
            <Input id="ruleNotes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={loading || !value.trim()} className="w-full">
              Add
            </Button>
          </div>
        </form>

        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-[120px_120px_120px_1fr_auto] md:items-center">
              <span className="font-medium capitalize">{rule.rule_type.replace("_", " ")}</span>
              <span className="capitalize text-muted-foreground">{rule.provider === "*" ? "any" : rule.provider === "azure" ? "microsoft" : rule.provider}</span>
              <span className={rule.status === "blocked" ? "font-medium text-destructive" : "font-medium text-primary"}>{rule.status}</span>
              <span className="min-w-0 truncate">
                {rule.value}
                {rule.notes ? <span className="ml-2 text-muted-foreground">· {rule.notes}</span> : null}
              </span>
              <Button variant="ghost" size="icon" onClick={() => deleteRule(rule.id)} aria-label="Delete access rule">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {rules.length === 0 && <p className="text-sm text-muted-foreground">No access rules yet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
