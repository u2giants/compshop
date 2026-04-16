import { useState, useEffect } from "react";
import { getCachedImageBlob, cacheImageBlob } from "@/lib/offline-db";

interface CachedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  filePath: string;
  signedUrl?: string;
  /** Fallback content when no image is available */
  fallback?: React.ReactNode;
}

/**
 * An <img> that checks IndexedDB blob cache first, falling back to signedUrl.
 * Automatically caches fetched images for offline use.
 */
export default function CachedImage({ filePath, signedUrl, fallback, ...imgProps }: CachedImageProps) {
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoke: string | undefined;
    let cancelled = false;

    (async () => {
      // 1. Check blob cache
      const blob = await getCachedImageBlob(filePath);
      if (cancelled) return;
      if (blob) {
        const url = URL.createObjectURL(blob);
        revoke = url;
        setSrc(url);
        return;
      }
      // 2. Fetch from signed URL and cache
      if (signedUrl) {
        try {
          const res = await fetch(signedUrl);
          if (!res.ok) throw new Error("fetch failed");
          const b = await res.blob();
          await cacheImageBlob(filePath, b);
          if (cancelled) return;
          const url = URL.createObjectURL(b);
          revoke = url;
          setSrc(url);
        } catch {
          if (!cancelled) {
            // Fall back to direct signed URL
            setSrc(signedUrl);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [filePath, signedUrl]);

  if (!src && !failed) {
    return <>{fallback ?? <div className={imgProps.className + " bg-muted animate-pulse"} />}</>;
  }

  return <img {...imgProps} src={src} onError={() => setFailed(true)} />;
}
