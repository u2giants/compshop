import { useState, useEffect, useCallback } from "react";
import { getCachedImageBlob, cacheImageBlob, getCachedSignedUrl } from "@/lib/offline-db";

interface CachedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  filePath: string;
  signedUrl?: string;
  /** Fallback content when no image is available */
  fallback?: React.ReactNode;
}

// Module-level cache: filePath → blob URL created from IndexedDB blob.
// Keeps the URL alive across component unmounts so remounting the same image
// is instant (no IndexedDB round-trip, no fallback flash).
const memBlobUrlCache = new Map<string, string>();

/**
 * An <img> that checks IndexedDB blob cache first, then falls back to the
 * signed URL directly (letting the browser handle loading). After the image
 * loads successfully from a URL, the blob is cached in the background for
 * offline use — no eager fetch on mount to avoid thundering-herd blinking.
 */
export default function CachedImage({ filePath, signedUrl, fallback, ...imgProps }: CachedImageProps) {
  const [src, setSrc] = useState<string | undefined>(() => memBlobUrlCache.get(filePath) ?? signedUrl);
  const [blobUrl, setBlobUrl] = useState<string | undefined>(() => memBlobUrlCache.get(filePath));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);

    // Already have a blob URL in memory for this path — nothing to do.
    if (memBlobUrlCache.has(filePath)) {
      const cached = memBlobUrlCache.get(filePath)!;
      setSrc(cached);
      setBlobUrl(cached);
      return;
    }

    let cancelled = false;

    (async () => {
      // 1. Check blob cache (skip corrupted non-image entries)
      const blob = await getCachedImageBlob(filePath);
      if (cancelled) return;
      if (blob && (blob.type.startsWith("image/") || blob.type.startsWith("video/"))) {
        const url = URL.createObjectURL(blob);
        memBlobUrlCache.set(filePath, url);
        setBlobUrl(url);
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

      // 3. Set src directly — let the browser/img tag handle fetching.
      //    Blob caching happens lazily in onLoad to avoid thundering-herd fetches.
      if (resolvedUrl && !cancelled) {
        setSrc(resolvedUrl);
      } else if (!cancelled) {
        setSrc(undefined);
      }
    })();

    return () => {
      cancelled = true;
      // Don't revoke blob URLs — memBlobUrlCache keeps them alive for instant remounts.
    };
  }, [filePath, signedUrl]);

  const handleLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      setFailed(false);

      // Only cache if we're not already showing a blob URL (blob already cached)
      if (blobUrl) return;
      const imgSrc = (e.currentTarget as HTMLImageElement).src;
      if (!imgSrc || imgSrc.startsWith("blob:")) return;

      // Cache blob in background — fire and forget
      (async () => {
        try {
          const existing = await getCachedImageBlob(filePath);
          if (existing && (existing.type.startsWith("image/") || existing.type.startsWith("video/"))) return;
          const res = await fetch(imgSrc);
          if (!res.ok) return;
          const b = await res.blob();
          await cacheImageBlob(filePath, b);
        } catch {}
      })();

      if (imgProps.onLoad) imgProps.onLoad(e);
    },
    [filePath, blobUrl, imgProps.onLoad]
  );

  if (!src && !failed) {
    return <>{fallback ?? <div className={imgProps.className + " bg-muted animate-pulse"} />}</>;
  }

  if (!src) {
    return <>{fallback ?? <div className={imgProps.className + " bg-muted"} />}</>;
  }

  return (
    <img
      {...imgProps}
      src={src}
      onLoad={handleLoad}
      onError={() => {
        setFailed(true);
        setSrc(undefined);
      }}
    />
  );
}
