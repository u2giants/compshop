import { supabase } from "@/integrations/supabase/client";
import { uploadPhoto, hashFile, checkDuplicatePhoto } from "@/lib/supabase-helpers";
import {
  getPendingUploads,
  updatePendingUploadStatus,
  removePendingUpload,
  type PendingUpload,
  getPendingTrips,
  removePendingTrip,
  getPendingChinaTrips,
  removePendingChinaTrip,
} from "@/lib/offline-db";

type SyncListener = (status: SyncStatus) => void;

export type SyncStatus = "idle" | "syncing" | "error";

let listeners: SyncListener[] = [];
let currentStatus: SyncStatus = "idle";
let syncInterval: ReturnType<typeof setInterval> | null = null;
let syncing = false;

function setStatus(s: SyncStatus) {
  currentStatus = s;
  listeners.forEach((fn) => fn(s));
}

export function getSyncStatus() {
  return currentStatus;
}

export function onSyncStatusChange(fn: SyncListener) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

async function syncOne(upload: PendingUpload): Promise<boolean> {
  try {
    await updatePendingUploadStatus(upload.id, "uploading");

    const file = new File([upload.file_blob], upload.file_name, { type: upload.file_blob.type });
    const fileHash = await hashFile(file);
    if (await checkDuplicatePhoto(fileHash)) {
      await removePendingUpload(upload.id);
      return true;
    }
    const { filePath, thumbnailPath } = await uploadPhoto(file, upload.user_id, upload.trip_id);

    const { error } = await supabase.from(upload.table ?? "photos").insert({
      trip_id: upload.trip_id,
      user_id: upload.user_id,
      file_path: filePath,
      thumbnail_path: thumbnailPath,
      file_hash: fileHash,
      ...upload.metadata,
      ...(upload.extra ?? {}),
    });

    if (error) throw error;

    await removePendingUpload(upload.id);
    return true;
  } catch (err) {
    console.error("[Sync] Failed to sync upload", upload.id, err);
    await updatePendingUploadStatus(upload.id, "failed", upload.retry_count + 1);
    return false;
  }
}

async function syncPendingTrips() {
  const trips = await getPendingTrips();
  for (const t of trips) {
    try {
      const { error } = await supabase.from("shopping_trips").insert({
        id: t.id, name: t.name, store: t.store, date: t.date,
        location: t.location, notes: t.notes, created_by: t.created_by, created_at: t.created_at,
      });
      // Ignore duplicate key — already synced (e.g. by another device)
      if (error && !error.message.includes("duplicate key")) throw error;
      await supabase.from("trip_members").insert({ trip_id: t.id, user_id: t.user_id }).catch(() => {});
      await removePendingTrip(t.id);
    } catch (err) {
      console.error("[Sync] Failed to sync pending trip", t.id, err);
    }
  }

  const chinaTrips = await getPendingChinaTrips();
  for (const t of chinaTrips) {
    try {
      const { error } = await supabase.from("china_trips").insert({
        id: t.id, name: t.name, supplier: t.supplier, venue_type: t.venue_type,
        date: t.date, end_date: t.end_date, location: t.location, notes: t.notes,
        parent_id: t.parent_id, created_by: t.created_by, created_at: t.created_at,
      });
      if (error && !error.message.includes("duplicate key")) throw error;
      await supabase.from("china_trip_members").insert({ trip_id: t.id, user_id: t.user_id }).catch(() => {});
      await removePendingChinaTrip(t.id);
    } catch (err) {
      console.error("[Sync] Failed to sync pending china trip", t.id, err);
    }
  }
}

export async function runSync() {
  if (syncing) return;
  syncing = true;

  try {
    await syncPendingTrips();

    const pending = await getPendingUploads();
    if (pending.length === 0) {
      setStatus("idle");
      return;
    }

    setStatus("syncing");
    let allOk = true;

    const retryable = pending.filter((u) => u.retry_count < 5);
    const abandoned = pending.filter((u) => u.retry_count >= 5);

    for (const u of abandoned) {
      console.warn("[Sync] Removing permanently failed upload", u.id);
      await removePendingUpload(u.id);
    }

    if (retryable.length === 0) {
      setStatus("idle");
      return;
    }

    for (const upload of retryable) {
      const ok = await syncOne(upload);
      if (!ok) allOk = false;
    }

    setStatus(allOk ? "idle" : "error");
  } finally {
    syncing = false;
  }
}

async function resetStuckUploads() {
  const pending = await getPendingUploads();
  for (const u of pending) {
    // Uploads stuck as "uploading" mean the tab was closed or crashed mid-upload
    if (u.status === "uploading") {
      await updatePendingUploadStatus(u.id, "failed", u.retry_count + 1);
    }
  }
}

export function startSyncService() {
  if (syncInterval) return;

  // Reset any uploads stuck in "uploading" from a previous session, then sync
  resetStuckUploads().then(() => runSync());

  // Sync when network comes back (reliable on Android/desktop; iOS sometimes
  // misses this, which is why the interval below doesn't check navigator.onLine)
  window.addEventListener("online", () => runSync());

  // Sync when app comes back to foreground — critical for iOS PWA where the
  // online event often doesn't fire after regaining connectivity
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") runSync();
  });

  // Poll every 30s without navigator.onLine check — that flag is unreliable on
  // iOS. Uploads that fail due to no connectivity fail fast (90s timeout in
  // uploadPhoto) and retry next cycle rather than hanging indefinitely.
  syncInterval = setInterval(() => runSync(), 30_000);
}

export function getPendingCount(): Promise<number> {
  return getPendingUploads().then((p) => p.length);
}
