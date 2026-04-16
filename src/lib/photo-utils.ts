import type { Photo } from "@/types/models";
import { supabase } from "@/integrations/supabase/client";

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

/**
 * Batch-generate signed URLs for an array of photos.
 * Also signs thumbnail_path when available.
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

  try {
    const { data, error } = await supabase.storage
      .from("photos")
      .createSignedUrls(allPaths, 3600);

    if (!error && data) {
      for (const item of data) {
        if (item.signedUrl && item.path) {
          urlMap.set(item.path, item.signedUrl);
        }
      }
    }
  } catch {
    // Fallback: individual requests
    for (const path of allPaths) {
      try {
        const { data } = await supabase.storage
          .from("photos")
          .createSignedUrl(path, 3600);
        if (data?.signedUrl) urlMap.set(path, data.signedUrl);
      } catch {}
    }
  }

  return urlMap;
}
