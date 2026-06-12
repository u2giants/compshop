import { addPendingUpload, type PendingUpload } from "@/lib/offline-db";
import { buildStoragePath, buildThumbnailPath } from "@/lib/supabase-helpers";

type PendingUploadMetadata = PendingUpload["metadata"];

const EMPTY_METADATA: PendingUploadMetadata = {
  product_name: null,
  category: null,
  price: null,
  dimensions: null,
  country_of_origin: null,
  material: null,
  brand: null,
  notes: null,
};

export function emptyUploadMetadata(overrides: Partial<PendingUploadMetadata> = {}): PendingUploadMetadata {
  return { ...EMPTY_METADATA, ...overrides };
}

export async function queuePendingUpload(options: {
  file: File;
  userId: string;
  tripId: string;
  table?: "photos" | "china_photos";
  metadata?: Partial<PendingUploadMetadata>;
  extra?: Record<string, unknown>;
  mediaType?: "image" | "video";
  fileHash?: string;
}) {
  const id = crypto.randomUUID();
  const mediaType = options.mediaType ?? (options.file.type.startsWith("video/") ? "video" : "image");
  const upload: PendingUpload = {
    id,
    trip_id: options.tripId,
    file_blob: options.file,
    file_name: options.file.name,
    metadata: emptyUploadMetadata(options.metadata),
    user_id: options.userId,
    created_at: new Date().toISOString(),
    status: "pending",
    retry_count: 0,
    table: options.table,
    extra: options.extra,
    media_type: mediaType,
    storage_path: buildStoragePath(options.userId, options.tripId, options.file.name, id),
    thumbnail_path: buildThumbnailPath(options.userId, options.tripId, id, mediaType === "video" ? "jpg" : "webp"),
    file_hash: options.fileHash,
    upload_stage: "local_saved",
    last_error_message: null,
    last_attempt_at: null,
    next_retry_at: null,
  };

  await addPendingUpload(upload);
  return upload;
}
