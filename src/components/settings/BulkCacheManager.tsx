import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cacheRecentPhotos, type BulkCacheProgress } from "@/lib/bulk-cache";

export default function BulkCacheManager() {
  const { toast } = useToast();
  const [months, setMonths] = useState("3");
  const [caching, setCaching] = useState(false);
  const [progress, setProgress] = useState<BulkCacheProgress | null>(null);

  async function handleCache() {
    setCaching(true);
    setProgress({ total: 0, done: 0, failed: 0 });
    try {
      const result = await cacheRecentPhotos(Number(months), setProgress);
      toast({
        title: "Bulk cache complete",
        description: `${result.done - result.failed} of ${result.total} images cached${result.failed > 0 ? ` (${result.failed} failed)` : ""}.`,
      });
    } catch (err: any) {
      toast({ title: "Cache failed", description: err.message, variant: "destructive" });
    } finally {
      setCaching(false);
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-sans text-lg">
          <Download className="h-5 w-5" /> Bulk Offline Cache
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Download images from all trips for offline access. Useful before clearing browser data or traveling without internet.
        </p>

        <div className="flex items-center gap-3">
          <Select value={months} onValueChange={setMonths} disabled={caching}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 month</SelectItem>
              <SelectItem value="3">3 months</SelectItem>
              <SelectItem value="6">6 months</SelectItem>
              <SelectItem value="12">12 months</SelectItem>
              <SelectItem value="24">24 months</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={handleCache} disabled={caching} className="gap-2">
            {caching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {caching ? "Caching..." : "Cache Images"}
          </Button>
        </div>

        {caching && progress && progress.total > 0 && (
          <div className="space-y-2">
            <Progress value={pct} className="h-2" />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{progress.done} / {progress.total}</span>
              {progress.failed > 0 && (
                <Badge variant="destructive" className="text-[10px] py-0">{progress.failed} failed</Badge>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
