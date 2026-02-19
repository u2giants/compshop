import { supabase } from "@/integrations/supabase/client";
import { uploadPhoto, hashFile, checkDuplicatePhoto } from "@/lib/supabase-helpers";
import {
  getPendingUploads,
  updatePendingUploadStatus,
  removePendingUpload,
  type PendingUpload,
} from "@/lib/offline-db";

type SyncListener = (status: SyncStatus) => void;

export type SyncStatus = "idle" | "syncing" | "error";

let listeners: SyncListener[] = [];
let currentStatus: SyncStatus = "idle";
let syncInterval: ReturnType<typeof setInterval> | null = null;

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
    const filePath = await uploadPhoto(file, upload.user_id, upload.trip_id);

    const { error } = await supabase.from("photos").insert({
      trip_id: upload.trip_id,
      user_id: upload.user_id,
      file_path: filePath,
      file_hash: fileHash,
      ...upload.metadata,
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

export async function runSync() {
  // Don't rely on navigator.onLine — it's unreliable on iOS
  // Instead, just try to sync and let individual uploads fail gracefully
  const pending = await getPendingUploads();
  if (pending.length === 0) {
    setStatus("idle");
    return;
  }

  setStatus("syncing");
  let allOk = true;

  const retryable = pending.filter((u) => u.retry_count < 5);
  const abandoned = pending.filter((u) => u.retry_count >= 5);

  // Remove permanently failed uploads so they stop blocking status
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
}

export function startSyncService() {
  if (syncInterval) return;

  // Sync whenever we come back online
  window.addEventListener("online", () => runSync());

  // Periodic check every 30s
  syncInterval = setInterval(() => {
    if (navigator.onLine) runSync();
  }, 30_000);

  // Initial sync
  if (navigator.onLine) runSync();
}

export function getPendingCount(): Promise<number> {
  return getPendingUploads().then((p) => p.length);
}
