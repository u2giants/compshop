import type { Photo } from "@/types/models";
import { supabase } from "@/integrations/supabase/client";
import { getCachedSignedUrls, cacheSignedUrls, type CachedSignedUrl } from "@/lib/offline-db";

/** Group photos: primary photos (no group_id) with their children */
export function groupPhotos(photos: Photo[]): { primary: Photo; extras: Photo[] }[] {
  const grouped = new Map<string, Photo[]>();
  const primaries: Photo[] = [];

  for (const p of photos) {
    if (p.group_id) {
      const list = grouped.get(p.group_id) || [];
      list.push(p);
      grouped.set(p.group_id, list);
    } else {
      primaries.push(p);
    }
  }

  return primaries.map((p) => ({
    primary: p,
    extras: grouped.get(p.id) || [],
  }));
}

/** Group photo cards by section, preserving order (null/unsectioned first) */
export function groupBySection(groups: { primary: Photo; extras: Photo[] }[]): { section: string | null; items: { primary: Photo; extras: Photo[] }[] }[] {
  const sectionOrder: (string | null)[] = [];
  const map = new Map<string | null, { primary: Photo; extras: Photo[] }[]>();
  for (const g of groups) {
    const sec = g.primary.section ?? null;
    if (!map.has(sec)) {
      sectionOrder.push(sec);
      map.set(sec, []);
    }
    map.get(sec)!.push(g);
  }
  const nullIdx = sectionOrder.indexOf(null);
  if (nullIdx > 0) {
    sectionOrder.splice(nullIdx, 1);
    sectionOrder.unshift(null);
  }
  return sectionOrder.map((sec) => ({ section: sec, items: map.get(sec)! }));
}

const SIGNED_URL_TTL = 86400; // 24 hours
const SIGNED_URL_TTL_MS = SIGNED_URL_TTL * 1000;

/**
 * Batch-generate signed URLs for an array of photos.
 * Also signs thumbnail_path when available.
 * Checks IndexedDB cache first — only requests URLs for uncached/expired paths.
 * Falls back to individual requests if the batch API fails.
 */
export async function batchSignedUrls(photos: { file_path: string; thumbnail_path?: string | null }[]): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>();
  if (photos.length === 0) return urlMap;

  // Collect all paths (originals + thumbnails)
  const allPaths: string[] = [];
  for (const p of photos) {
    allPaths.push(p.file_path);
    if (p.thumbnail_path) allPaths.push(p.thumbnail_path);
  }

  // Check cache first
  const cached = await getCachedSignedUrls(allPaths);
  cached.forEach((url, path) => urlMap.set(path, url));

  // Determine which paths still need fetching
  const uncachedPaths = allPaths.filter((p) => !urlMap.has(p));
  if (uncachedPaths.length === 0) return urlMap;

  try {
    const { data, error } = await supabase.storage
      .from("photos")
      .createSignedUrls(uncachedPaths, SIGNED_URL_TTL);

    if (!error && data) {
      const toCache: CachedSignedUrl[] = [];
      for (const item of data) {
        if (item.signedUrl && item.path) {
          urlMap.set(item.path, item.signedUrl);
          toCache.push({
            file_path: item.path,
            url: item.signedUrl,
            expires_at: Date.now() + SIGNED_URL_TTL_MS,
          });
        }
      }
      // Cache in background — don't block
      cacheSignedUrls(toCache).catch(() => {});
    }
  } catch {
    // Fallback: individual requests
    for (const path of uncachedPaths) {
      try {
        const { data } = await supabase.storage
          .from("photos")
          .createSignedUrl(path, SIGNED_URL_TTL);
        if (data?.signedUrl) {
          urlMap.set(path, data.signedUrl);
          cacheSignedUrls([{ file_path: path, url: data.signedUrl, expires_at: Date.now() + SIGNED_URL_TTL_MS }]).catch(() => {});
        }
      } catch {}
    }
  }

  return urlMap;
}
