import { useEffect, useRef, useState } from "react";
import { Factory, Play, Video } from "lucide-react";
import { getCachedImageBlob } from "@/lib/offline-db";

/**
 * A single thumbnail in a fair/factory photo stream.
 *
 * Designed for grids of hundreds–thousands of images, where the naive
 * "render every <img> at once" approach blinks and drops images:
 *
 * - Windowing: the <img> is only mounted once the cell scrolls near the
 *   viewport (IntersectionObserver). This bounds the number of concurrent
 *   network requests so the storage/transform layer is never stampeded.
 * - Sticky: once a cell has entered view it stays mounted, so scrolling back
 *   up never re-requests an image that already loaded.
 * - Stable src: the signed URL is set once and never swapped, so the browser
 *   never discards an already-decoded bitmap (the cause of mid-scroll blinking).
 * - Non-destructive: a failed load is not turned into a permanent blank cell.
 * - Offline: when there is no signed URL (offline), the IndexedDB blob cache is
 *   read lazily, and only for cells that are actually shown.
 */

// Keep offline blob URLs alive across remounts. Only populated for cells that
// have no signed URL (offline browsing), so it never grows on the online path.
const offlineBlobUrls = new Map<string, string>();

export interface StreamThumbPhoto {
  display_path: string;
  display_url?: string;
  product_name?: string | null;
  media_type?: string | null;
}

export default function StreamThumb({
  photo,
  priority,
  onClick,
}: {
  photo: StreamThumbPhoto;
  priority: boolean;
  onClick?: () => void;
}) {
  const isVideo = photo.media_type === "video";
  const ref = useRef<HTMLButtonElement>(null);
  const [inView, setInView] = useState(priority);
  const [loaded, setLoaded] = useState(false);
  const [src, setSrc] = useState<string | undefined>(
    () => offlineBlobUrls.get(photo.display_path) ?? photo.display_url
  );

  // Windowing — mount the image only when the cell is near the viewport.
  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin: "800px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  // Resolve the src. Prefer the signed URL (online). When absent (offline),
  // fall back to the IndexedDB blob — but only for cells we actually show.
  useEffect(() => {
    if (photo.display_url) {
      setSrc(photo.display_url);
      return;
    }
    const existing = offlineBlobUrls.get(photo.display_path);
    if (existing) {
      setSrc(existing);
      return;
    }
    if (!inView) return;
    let cancelled = false;
    getCachedImageBlob(photo.display_path)
      .then((blob) => {
        if (cancelled || !blob) return;
        if (blob.type.startsWith("image/") || blob.type.startsWith("video/")) {
          const url = URL.createObjectURL(blob);
          offlineBlobUrls.set(photo.display_path, url);
          setSrc(url);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [photo.display_url, photo.display_path, inView]);

  const showImg = inView && Boolean(src);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="group relative aspect-square cursor-pointer overflow-hidden rounded-md bg-muted text-left focus:outline-none focus:ring-2 focus:ring-primary"
      aria-label={photo.product_name ?? (isVideo ? "Video" : "Photo")}
    >
      {showImg && (
        <img
          src={src}
          alt={photo.product_name ?? (isVideo ? "Video" : "Photo")}
          className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
        />
      )}
      {(!showImg || !loaded) && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          {isVideo ? (
            <Video className="h-6 w-6 text-muted-foreground/40" />
          ) : (
            <Factory className="h-6 w-6 text-muted-foreground/30" />
          )}
        </div>
      )}
      {isVideo && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-black/60 p-2 backdrop-blur-sm">
            <Play className="h-4 w-4 fill-white text-white" />
          </div>
        </div>
      )}
      {photo.product_name && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-5">
          <p className="truncate text-[10px] leading-tight text-white">{photo.product_name}</p>
        </div>
      )}
    </button>
  );
}
