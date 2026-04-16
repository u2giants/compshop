import { useState, useEffect } from "react";
import { getCachedImageBlob, cacheImageBlob, getCachedSignedUrl } from "@/lib/offline-db";

interface CachedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  filePath: string;
  signedUrl?: string;
  /** Fallback content when no image is available */
  fallback?: React.ReactNode;
}

/**
 * An <img> that checks IndexedDB blob cache first, then signed URL cache,
 * falling back to the provided signedUrl prop.
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

      // 2. Resolve the best URL: prop > IndexedDB signed URL cache
      let resolvedUrl = signedUrl;
      if (!resolvedUrl) {
        const cached = await getCachedSignedUrl(filePath);
        if (cached && cached.expires_at > Date.now()) {
          resolvedUrl = cached.url;
        }
      }

      // 3. Fetch from URL and cache blob
      if (resolvedUrl) {
        try {
          const res = await fetch(resolvedUrl);
          if (!res.ok) throw new Error("fetch failed");
          const b = await res.blob();
          await cacheImageBlob(filePath, b);
          if (cancelled) return;
          const url = URL.createObjectURL(b);
          revoke = url;
          setSrc(url);
        } catch {
          if (!cancelled) {
            setSrc(resolvedUrl);
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
