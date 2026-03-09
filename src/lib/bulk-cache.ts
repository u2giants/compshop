import { supabase } from "@/integrations/supabase/client";
import { cacheImageBlob, getCachedImageBlob } from "@/lib/offline-db";
import { batchSignedUrls } from "@/lib/photo-utils";

export interface BulkCacheProgress {
  total: number;
  done: number;
  failed: number;
}

type ProgressCallback = (p: BulkCacheProgress) => void;

/**
 * Cache images for a specific set of photo file_paths.
 * Skips already-cached images.
 */
export async function cachePhotoImages(
  photos: { file_path: string; signed_url?: string }[],
  onProgress?: ProgressCallback
): Promise<BulkCacheProgress> {
  const progress: BulkCacheProgress = { total: photos.length, done: 0, failed: 0 };
  onProgress?.(progress);

  // Filter out already-cached
  const toCache: { file_path: string; url: string }[] = [];
  for (const p of photos) {
    const existing = await getCachedImageBlob(p.file_path);
    if (existing) {
      progress.done++;
      onProgress?.(progress);
      continue;
    }
    if (p.signed_url) {
      toCache.push({ file_path: p.file_path, url: p.signed_url });
    }
  }

  // If some photos don't have signed URLs, generate them
  const needUrls = photos.filter(
    (p) => !p.signed_url && !toCache.find((c) => c.file_path === p.file_path)
  );
  if (needUrls.length > 0) {
    const urlMap = await batchSignedUrls(needUrls);
    for (const p of needUrls) {
      const url = urlMap.get(p.file_path);
      if (url) toCache.push({ file_path: p.file_path, url });
      else {
        progress.done++;
        progress.failed++;
        onProgress?.(progress);
      }
    }
  }

  // Download and cache concurrently (max 4 at a time)
  const concurrency = 4;
  let idx = 0;

  async function worker() {
    while (idx < toCache.length) {
      const item = toCache[idx++];
      try {
        const res = await fetch(item.url);
        const blob = await res.blob();
        await cacheImageBlob(item.file_path, blob);
      } catch {
        progress.failed++;
      }
      progress.done++;
      onProgress?.({ ...progress });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, toCache.length) }, () => worker());
  await Promise.all(workers);

  return progress;
}

/**
 * Cache all photos for given shopping trip IDs.
 */
export async function cacheTripPhotos(
  tripIds: string[],
  onProgress?: ProgressCallback
): Promise<BulkCacheProgress> {
  if (tripIds.length === 0) return { total: 0, done: 0, failed: 0 };

  const { data: photos } = await supabase
    .from("photos")
    .select("file_path")
    .in("trip_id", tripIds);

  if (!photos || photos.length === 0) return { total: 0, done: 0, failed: 0 };

  const urlMap = await batchSignedUrls(photos);
  const withUrls = photos.map((p) => ({
    file_path: p.file_path,
    signed_url: urlMap.get(p.file_path),
  }));

  return cachePhotoImages(withUrls, onProgress);
}

/**
 * Cache all photos for given china trip IDs.
 */
export async function cacheChinaTripPhotos(
  tripIds: string[],
  onProgress?: ProgressCallback
): Promise<BulkCacheProgress> {
  if (tripIds.length === 0) return { total: 0, done: 0, failed: 0 };

  const { data: photos } = await supabase
    .from("china_photos")
    .select("file_path")
    .in("trip_id", tripIds);

  if (!photos || photos.length === 0) return { total: 0, done: 0, failed: 0 };

  const urlMap = await batchSignedUrls(photos);
  const withUrls = photos.map((p) => ({
    file_path: p.file_path,
    signed_url: urlMap.get(p.file_path),
  }));

  return cachePhotoImages(withUrls, onProgress);
}

/**
 * Fetch all photos from the last N months across both tables and cache their images.
 */
export async function cacheRecentPhotos(
  months: number,
  onProgress?: ProgressCallback
): Promise<BulkCacheProgress> {
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const sinceStr = since.toISOString();

  // Fetch photo paths from both tables
  const [{ data: storePhotos }, { data: chinaPhotos }] = await Promise.all([
    supabase
      .from("photos")
      .select("file_path")
      .gte("created_at", sinceStr)
      .order("created_at", { ascending: false }),
    supabase
      .from("china_photos")
      .select("file_path")
      .gte("created_at", sinceStr)
      .order("created_at", { ascending: false }),
  ]);

  const allPhotos = [
    ...(storePhotos || []),
    ...(chinaPhotos || []),
  ];

  if (allPhotos.length === 0) {
    return { total: 0, done: 0, failed: 0 };
  }

  // Generate signed URLs in batch
  const urlMap = await batchSignedUrls(allPhotos);
  const withUrls = allPhotos.map((p) => ({
    file_path: p.file_path,
    signed_url: urlMap.get(p.file_path),
  }));

  return cachePhotoImages(withUrls, onProgress);
}
