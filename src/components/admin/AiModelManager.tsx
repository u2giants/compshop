import { useCallback, useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Bot, RefreshCw } from "lucide-react";

interface OpenRouterModel {
  id: string;
  name: string;
}

interface AppSettingRow {
  value: string | null;
}

export default function AiModelManager() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [currentModel, setCurrentModel] = useState<string>("");
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadCurrentModel = useCallback(async () => {
    const { data } = await supabase
      .from("app_settings" as never)
      .select("value")
      .eq("key", "ai_model")
      .maybeSingle();
    const setting = data as AppSettingRow | null;
    if (setting) setCurrentModel(setting.value ?? "");
  }, []);

  const fetchAvailableModels = useCallback(async ({ showToast = true }: { showToast?: boolean } = {}) => {
    setLoadingModels(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.functions.invoke("list-openrouter-models");
      if (error) throw error;
      const raw: OpenRouterModel[] = (data?.data ?? []).filter(
        (m: OpenRouterModel) => m.id && m.name
      );
      // Sort: vision-capable models first (heuristic: name contains Flash/Pro/Vision/GPT/Claude)
      raw.sort((a, b) => a.name.localeCompare(b.name));
      setModels(raw);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load models";
      setLoadError(msg);
      if (showToast) {
        toast({ title: "Couldn't load models", description: msg, variant: "destructive" });
      }
    } finally {
      setLoadingModels(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isAdmin) {
      loadCurrentModel();
      fetchAvailableModels({ showToast: false });
    }
  }, [fetchAvailableModels, isAdmin, loadCurrentModel]);

  if (!isAdmin) return null;

  async function handleSave() {
    if (!currentModel) return;
    setSaving(true);
    const { error } = await supabase
      .from("app_settings" as never)
      .upsert({ key: "ai_model", value: currentModel, updated_at: new Date().toISOString() } as never);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "AI model updated", description: currentModel });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-sans text-lg">
          <Bot className="h-5 w-5" /> AI Model
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Model used for AI Detect on all photos. Only models enabled on your OpenRouter account appear here.
        </p>

        <div className="flex gap-2 items-center">
          <Select value={currentModel} onValueChange={setCurrentModel} disabled={loadingModels}>
            <SelectTrigger className="flex-1 text-xs h-8">
              <SelectValue placeholder={loadingModels ? "Loading models…" : "Select a model"} />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  {m.name}
                </SelectItem>
              ))}
              {models.length === 0 && !loadingModels && (
                currentModel ? (
                  <SelectItem value={currentModel} className="text-xs">
                    {currentModel}
                  </SelectItem>
                ) : (
                  <SelectItem value="no-models-found" disabled className="text-xs">
                    No models found
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => fetchAvailableModels()}
            disabled={loadingModels}
            title="Refresh model list"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingModels ? "animate-spin" : ""}`} />
          </Button>
        </div>
        {loadError && (
          <p className="text-xs text-muted-foreground">
            Model list unavailable. The saved model can still be used.
          </p>
        )}

        <Button size="sm" onClick={handleSave} disabled={saving || !currentModel} className="w-full h-8 text-xs">
          {saving ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
