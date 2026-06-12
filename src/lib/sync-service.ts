import { supabase } from "@/integrations/supabase/client";
import { uploadPhoto, uploadVideo, hashFile, checkDuplicatePhoto, buildStoragePath, buildThumbnailPath } from "@/lib/supabase-helpers";
import {
  getPendingUploads,
  updatePendingUploadStatus,
  updatePendingUpload,
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
const MAX_AUTOMATIC_RETRIES = 5;

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
    const file = new File([upload.file_blob], upload.file_name, { type: upload.file_blob.type });
    const mediaType = upload.media_type ?? (file.type.startsWith("video/") ? "video" : "image");
    const storedPath = upload.storage_path ?? buildStoragePath(upload.user_id, upload.trip_id, upload.file_name, upload.id);
    const thumbPath = upload.thumbnail_path ?? buildThumbnailPath(
      upload.user_id,
      upload.trip_id,
      upload.id,
      mediaType === "video" ? "jpg" : "webp"
    );

    await updatePendingUpload(upload.id, {
      status: "uploading",
      media_type: mediaType,
      storage_path: storedPath,
      thumbnail_path: thumbPath,
      upload_stage: "hashing",
      last_attempt_at: new Date().toISOString(),
      last_error_message: null,
    });

    const fileHash = upload.file_hash ?? await hashFile(file);
    if (!upload.file_hash) {
      await updatePendingUpload(upload.id, { file_hash: fileHash });
    }

    if (await checkDuplicatePhoto(fileHash)) {
      await removePendingUpload(upload.id);
      return true;
    }

    await updatePendingUpload(upload.id, { upload_stage: "uploading_storage" });
    const { filePath, thumbnailPath } = mediaType === "video"
      ? await uploadVideo(file, upload.user_id, upload.trip_id, { filePath: storedPath, thumbnailPath: thumbPath })
      : await uploadPhoto(file, upload.user_id, upload.trip_id, { filePath: storedPath, thumbnailPath: thumbPath });

    await updatePendingUpload(upload.id, { upload_stage: "inserting_db_row", storage_path: filePath, thumbnail_path: thumbnailPath });

    const row = {
      id: upload.id,
      trip_id: upload.trip_id,
      user_id: upload.user_id,
      file_path: filePath,
      thumbnail_path: thumbnailPath,
      file_hash: fileHash,
      ...upload.metadata,
      ...(upload.extra ?? {}),
    };
    const table = upload.table ?? "photos";
    const insertRow = upload.table === "china_photos" ? { ...row, media_type: mediaType } : row;
    const { error } = await supabase.from(table).insert(insertRow as never);

    if (error && !error.message.includes("duplicate key")) throw error;

    await removePendingUpload(upload.id);
    return true;
  } catch (err) {
    console.error("[Sync] Failed to sync upload", upload.id, err);
    const retryCount = upload.retry_count + 1;
    const retryDelayMs = Math.min(30 * 60_000, 2 ** retryCount * 15_000);
    const needsAttention = retryCount >= MAX_AUTOMATIC_RETRIES;
    await updatePendingUpload(upload.id, {
      status: needsAttention ? "failed_needs_attention" : "failed",
      retry_count: retryCount,
      upload_stage: "failed",
      last_error_message: err instanceof Error ? err.message : String(err),
      last_attempt_at: new Date().toISOString(),
      next_retry_at: needsAttention ? null : new Date(Date.now() + retryDelayMs).toISOString(),
    });
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

    const now = Date.now();
    const retryable = pending.filter((u) => (
      u.status !== "failed_needs_attention"
      && (!u.next_retry_at || Date.parse(u.next_retry_at) <= now)
    ));

    if (retryable.length === 0) {
      setStatus(pending.some((u) => u.status === "failed_needs_attention") ? "error" : "idle");
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
      await updatePendingUploadStatus(u.id, "failed", u.retry_count);
      await updatePendingUpload(u.id, {
        upload_stage: "failed",
        last_error_message: "Upload was interrupted before the app closed.",
        next_retry_at: new Date().toISOString(),
      });
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
