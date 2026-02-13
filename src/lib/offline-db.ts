import { openDB, DBSchema, IDBPDatabase } from "idb";
import { getStorageQuotaMB } from "@/components/settings/StorageQuotaManager";

export interface CachedTrip {
  id: string;
  name: string;
  store: string;
  date: string;
  location: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  photo_count?: number;
  member_count?: number;
}

export interface CachedPhoto {
  id: string;
  trip_id: string;
  file_path: string;
  product_name: string | null;
  category: string | null;
  price: number | null;
  dimensions: string | null;
  country_of_origin: string | null;
  material: string | null;
  brand: string | null;
  notes: string | null;
  user_id: string | null;
  created_at: string;
  signed_url?: string;
}

export interface PendingUpload {
  id: string;
  trip_id: string;
  file_blob: Blob;
  file_name: string;
  metadata: {
    product_name: string | null;
    category: string | null;
    price: number | null;
    dimensions: string | null;
    country_of_origin: string | null;
    material: string | null;
    brand: string | null;
    notes: string | null;
  };
  user_id: string;
  created_at: string;
  status: "pending" | "uploading" | "failed";
  retry_count: number;
}

interface CompShopDB extends DBSchema {
  trips: {
    key: string;
    value: CachedTrip;
  };
  photos: {
    key: string;
    value: CachedPhoto;
    indexes: { "by-trip": string };
  };
  image_blobs: {
    key: string;
    value: { file_path: string; blob: Blob; cached_at: number };
  };
  pending_uploads: {
    key: string;
    value: PendingUpload;
    indexes: { "by-trip": string; "by-status": string };
  };
}

let dbPromise: Promise<IDBPDatabase<CompShopDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<CompShopDB>("compshop-offline", 1, {
      upgrade(db) {
        db.createObjectStore("trips", { keyPath: "id" });
        const photoStore = db.createObjectStore("photos", { keyPath: "id" });
        photoStore.createIndex("by-trip", "trip_id");
        db.createObjectStore("image_blobs", { keyPath: "file_path" });
        const pendingStore = db.createObjectStore("pending_uploads", { keyPath: "id" });
        pendingStore.createIndex("by-trip", "trip_id");
        pendingStore.createIndex("by-status", "status");
      },
    });
  }
  return dbPromise;
}

// --- Trips ---
export async function cacheTrips(trips: CachedTrip[]) {
  const db = await getDB();
  const tx = db.transaction("trips", "readwrite");
  await Promise.all(trips.map((t) => tx.store.put(t)));
  await tx.done;
}

export async function getCachedTrips(): Promise<CachedTrip[]> {
  const db = await getDB();
  return db.getAll("trips");
}

export async function clearCachedTrips() {
  const db = await getDB();
  const tx = db.transaction("trips", "readwrite");
  await tx.store.clear();
  await tx.done;
}

export async function getCachedTrip(id: string): Promise<CachedTrip | undefined> {
  const db = await getDB();
  return db.get("trips", id);
}

// --- Photos ---
export async function cachePhotos(photos: CachedPhoto[]) {
  const db = await getDB();
  const tx = db.transaction("photos", "readwrite");
  await Promise.all(photos.map((p) => tx.store.put(p)));
  await tx.done;
}

export async function getCachedPhotos(tripId: string): Promise<CachedPhoto[]> {
  const db = await getDB();
  return db.getAllFromIndex("photos", "by-trip", tripId);
}

// --- Image blobs (with quota enforcement) ---
export async function cacheImageBlob(filePath: string, blob: Blob) {
  const db = await getDB();

  // Check quota before caching
  await enforceStorageQuota(db, blob.size);

  await db.put("image_blobs", { file_path: filePath, blob, cached_at: Date.now() });
}

export async function getCachedImageBlob(filePath: string): Promise<Blob | undefined> {
  const db = await getDB();
  const entry = await db.get("image_blobs", filePath);
  return entry?.blob;
}

async function enforceStorageQuota(db: IDBPDatabase<CompShopDB>, incomingBytes: number) {
  const quotaBytes = getStorageQuotaMB() * 1024 * 1024;

  // Estimate current cache size
  const allBlobs = await db.getAll("image_blobs");
  let totalSize = allBlobs.reduce((sum, entry) => sum + (entry.blob?.size || 0), 0);

  if (totalSize + incomingBytes <= quotaBytes) return; // within quota

  // Sort by oldest first, prune until under quota
  allBlobs.sort((a, b) => a.cached_at - b.cached_at);

  const tx = db.transaction("image_blobs", "readwrite");
  for (const entry of allBlobs) {
    if (totalSize + incomingBytes <= quotaBytes) break;
    totalSize -= entry.blob?.size || 0;
    await tx.store.delete(entry.file_path);
  }
  await tx.done;
}

// --- Pending uploads ---
export async function addPendingUpload(upload: PendingUpload) {
  const db = await getDB();
  await db.put("pending_uploads", upload);
}

export async function getPendingUploads(): Promise<PendingUpload[]> {
  const db = await getDB();
  return db.getAll("pending_uploads");
}

export async function getPendingUploadsByTrip(tripId: string): Promise<PendingUpload[]> {
  const db = await getDB();
  return db.getAllFromIndex("pending_uploads", "by-trip", tripId);
}

export async function updatePendingUploadStatus(id: string, status: PendingUpload["status"], retryCount?: number) {
  const db = await getDB();
  const upload = await db.get("pending_uploads", id);
  if (upload) {
    upload.status = status;
    if (retryCount !== undefined) upload.retry_count = retryCount;
    await db.put("pending_uploads", upload);
  }
}

export async function removePendingUpload(id: string) {
  const db = await getDB();
  await db.delete("pending_uploads", id);
}
