import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PendingUpload } from "@/lib/offline-db";

export default function PendingUploadCard({ upload }: { upload: PendingUpload }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (upload.media_type === "video" || upload.file_blob.type.startsWith("video/")) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(upload.file_blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [upload.file_blob, upload.media_type]);

  const label = upload.status === "failed_needs_attention" ? "needs attention" : upload.status;

  return (
    <Card className="overflow-hidden border-dashed opacity-75">
      {previewUrl ? (
        <img src={previewUrl} alt="Pending" className="h-40 w-full object-cover" />
      ) : (
        <div className="flex h-40 w-full items-center justify-center bg-muted text-sm text-muted-foreground">
          Video pending
        </div>
      )}
      <CardContent className="p-3">
        <p className="truncate text-sm font-medium">{upload.metadata.product_name || upload.file_name || "Untitled"}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Badge variant="outline" className="text-xs">{label}</Badge>
          {upload.upload_stage && <Badge variant="secondary" className="text-xs">{upload.upload_stage.replace(/_/g, " ")}</Badge>}
        </div>
        {upload.last_error_message && (
          <p className="mt-2 line-clamp-2 text-xs text-destructive">{upload.last_error_message}</p>
        )}
      </CardContent>
    </Card>
  );
}
