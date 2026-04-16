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

export interface CachedChinaTrip {
  id: string;
  name: string;
  supplier: string;
  venue_type: string;
  date: string;
  end_date: string | null;
  location: string | null;
  notes: string | null;
  parent_id: string | null;
  factory_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  photo_count?: number;
  cover_url?: string;
  cover_file_path?: string;
  photographer?: string | null;
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

export interface CachedChinaPhoto {
  id: string;
  trip_id: string;
  file_path: string;
  thumbnail_path: string | null;
  product_name: string | null;
  category: string | null;
  price: number | null;
  dimensions: string | null;
  country_of_origin: string | null;
  material: string | null;
  brand: string | null;
  notes: string | null;
  section: string | null;
  image_type: string | null;
  group_id: string | null;
  user_id: string | null;
  created_at: string;
}

export interface CachedSignedUrl {
  file_path: string;
  url: string;
  expires_at: number;
}

export interface SyncMeta {
  key: string;
  timestamp: number;
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
  china_trips: {
    key: string;
    value: CachedChinaTrip;
  };
  china_photos: {
    key: string;
    value: CachedChinaPhoto;
    indexes: { "by-trip": string };
  };
  signed_urls: {
    key: string;
    value: CachedSignedUrl;
  };
  sync_meta: {
    key: string;
    value: SyncMeta;
  };
}

let dbPromise: Promise<IDBPDatabase<CompShopDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<CompShopDB>("compshop-offline", 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("trips", { keyPath: "id" });
          const photoStore = db.createObjectStore("photos", { keyPath: "id" });
          photoStore.createIndex("by-trip", "trip_id");
          db.createObjectStore("image_blobs", { keyPath: "file_path" });
          const pendingStore = db.createObjectStore("pending_uploads", { keyPath: "id" });
          pendingStore.createIndex("by-trip", "trip_id");
          pendingStore.createIndex("by-status", "status");
        }
        if (oldVersion < 2) {
          db.createObjectStore("china_trips", { keyPath: "id" });
          const chinaPhotoStore = db.createObjectStore("china_photos", { keyPath: "id" });
          chinaPhotoStore.createIndex("by-trip", "trip_id");
          db.createObjectStore("signed_urls", { keyPath: "file_path" });
          db.createObjectStore("sync_meta", { keyPath: "key" });
        }
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

// --- China Trips ---
export async function cacheChinaTrips(trips: CachedChinaTrip[]) {
  const db = await getDB();
  const tx = db.transaction("china_trips", "readwrite");
  await Promise.all(trips.map((t) => tx.store.put(t)));
  await tx.done;
}

export async function getCachedChinaTrips(): Promise<CachedChinaTrip[]> {
  const db = await getDB();
  return db.getAll("china_trips");
}

export async function clearCachedChinaTrips() {
  const db = await getDB();
  const tx = db.transaction("china_trips", "readwrite");
  await tx.store.clear();
  await tx.done;
}

export async function getCachedChinaTrip(id: string): Promise<CachedChinaTrip | undefined> {
  const db = await getDB();
  return db.get("china_trips", id);
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

// --- China Photos ---
export async function cacheChinaPhotos(photos: CachedChinaPhoto[]) {
  const db = await getDB();
  const tx = db.transaction("china_photos", "readwrite");
  await Promise.all(photos.map((p) => tx.store.put(p)));
  await tx.done;
}

export async function getCachedChinaPhotos(tripId: string): Promise<CachedChinaPhoto[]> {
  const db = await getDB();
  return db.getAllFromIndex("china_photos", "by-trip", tripId);
}

// --- Signed URLs cache ---
export async function cacheSignedUrls(entries: CachedSignedUrl[]) {
  if (entries.length === 0) return;
  const db = await getDB();
  const tx = db.transaction("signed_urls", "readwrite");
  await Promise.all(entries.map((e) => tx.store.put(e)));
  await tx.done;
}

export async function getCachedSignedUrl(filePath: string): Promise<CachedSignedUrl | undefined> {
  const db = await getDB();
  return db.get("signed_urls", filePath);
}

export async function getCachedSignedUrls(filePaths: string[]): Promise<Map<string, string>> {
  const db = await getDB();
  const result = new Map<string, string>();
  const now = Date.now();
  for (const fp of filePaths) {
    const entry = await db.get("signed_urls", fp);
    if (entry && entry.expires_at > now) {
      result.set(fp, entry.url);
    }
  }
  return result;
}

// --- Sync Meta ---
export async function setSyncTimestamp(key: string) {
  const db = await getDB();
  await db.put("sync_meta", { key, timestamp: Date.now() });
}

export async function getSyncTimestamp(key: string): Promise<number | undefined> {
  const db = await getDB();
  const entry = await db.get("sync_meta", key);
  return entry?.timestamp;
}

// --- Image blobs (with quota enforcement) ---
export async function cacheImageBlob(filePath: string, blob: Blob) {
  const db = await getDB();
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
  const allBlobs = await db.getAll("image_blobs");
  let totalSize = allBlobs.reduce((sum, entry) => sum + (entry.blob?.size || 0), 0);
  if (totalSize + incomingBytes <= quotaBytes) return;
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
