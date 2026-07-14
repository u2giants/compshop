import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCachedImageBlob, cacheImageBlob, getCachedSignedUrl, cacheSignedUrls } from "@/lib/offline-db";

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
const blobCacheWrites = new Map<string, Promise<void>>();
const SIGNED_URL_TTL = 86400;
const SIGNED_URL_TTL_MS = SIGNED_URL_TTL * 1000;

function cacheImageFromUrl(filePath: string, url: string) {
  if (blobCacheWrites.has(filePath)) return blobCacheWrites.get(filePath)!;

  const write = (async () => {
    try {
      const existing = await getCachedImageBlob(filePath);
      if (existing && (existing.type.startsWith("image/") || existing.type.startsWith("video/"))) return;
      const res = await fetch(url);
      if (!res.ok) return;
      const blob = await res.blob();
      if (!blob.type.startsWith("image/") && !blob.type.startsWith("video/")) return;
      await cacheImageBlob(filePath, blob);
      if (!memBlobUrlCache.has(filePath)) {
        memBlobUrlCache.set(filePath, URL.createObjectURL(blob));
      }
    } catch {
      // Background cache writes must never disrupt the visible image.
    } finally {
      blobCacheWrites.delete(filePath);
    }
  })();

  blobCacheWrites.set(filePath, write);
  return write;
}

/**
 * An <img> that checks IndexedDB blob cache first, then falls back to the
 * signed URL directly (letting the browser handle loading). After the image
 * loads successfully from a URL, the blob is cached in the background for
 * offline use — no eager fetch on mount to avoid thundering-herd blinking.
 */
export default function CachedImage({ filePath, signedUrl, fallback, ...imgProps }: CachedImageProps) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | undefined>(() => memBlobUrlCache.get(filePath));
  const [blobUrl, setBlobUrl] = useState<string | undefined>(() => memBlobUrlCache.get(filePath));
  const [failed, setFailed] = useState(false);
  const [inView, setInView] = useState(() => imgProps.loading !== "lazy" || memBlobUrlCache.has(filePath));
  const lastFilePathRef = useRef<string | null>(null);

  useEffect(() => {
    setInView(imgProps.loading !== "lazy" || memBlobUrlCache.has(filePath));
  }, [filePath, imgProps.loading]);

  useEffect(() => {
    if (inView) return;
    const el = placeholderRef.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin: "700px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  useEffect(() => {
    if (!inView) return;

    // A re-signed URL for the SAME image (same filePath, new token) must never
    // reset what's already on screen — otherwise re-renders that hand us a fresh
    // signed URL (e.g. realtime-driven refetches) make the grid blink. Only adopt
    // the new URL if we currently have nothing to show.
    if (lastFilePathRef.current === filePath) {
      // Don't re-adopt after a real load failure, or churn would retry-blink it.
      if (signedUrl && !failed) setSrc((prev) => prev ?? signedUrl);
      return;
    }
    lastFilePathRef.current = filePath;

    setFailed(false);

    // Already have a blob URL in memory for this path — nothing to do.
    if (memBlobUrlCache.has(filePath)) {
      const cached = memBlobUrlCache.get(filePath)!;
      setSrc(cached);
      setBlobUrl(cached);
      return;
    }

    setBlobUrl(undefined);
    setSrc(undefined);

    let cancelled = false;

    (async () => {
      // 1. Check blob cache first (skip corrupted non-image entries). This is
      // the fastest path for revisiting expanded trip groups, and avoids
      // re-decoding already-cached covers from signed URLs.
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

      if (!resolvedUrl) {
        const { data } = await supabase.storage.from("photos").createSignedUrl(filePath, SIGNED_URL_TTL);
        if (data?.signedUrl) {
          resolvedUrl = data.signedUrl;
          cacheSignedUrls([{
            file_path: filePath,
            url: data.signedUrl,
            expires_at: Date.now() + SIGNED_URL_TTL_MS,
          }]).catch(() => {});
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
  }, [filePath, signedUrl, failed, inView, imgProps.loading]);

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
          await cacheImageFromUrl(filePath, imgSrc);
        } catch {
          // Background cache writes must never disrupt the visible image.
        }
      })();

      if (imgProps.onLoad) imgProps.onLoad(e);
    },
    [filePath, blobUrl, imgProps.onLoad]
  );

  if ((!inView || !src) && !failed) {
    return (
      <>
        {fallback ?? (
          <div
            ref={placeholderRef}
            className={imgProps.className + " bg-muted animate-pulse"}
          />
        )}
      </>
    );
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
