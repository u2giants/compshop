import { supabase } from "@/integrations/supabase/client";

const THUMB_MAX_WIDTH = 400;
const THUMB_QUALITY = 0.75;

/**
 * Generate a WebP thumbnail blob from a File using canvas.
 * Falls back to JPEG if WebP is unsupported.
 */
export async function generateThumbnail(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, THUMB_MAX_WIDTH / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  // Try WebP first, fall back to JPEG
  let blob = await canvas.convertToBlob({ type: "image/webp", quality: THUMB_QUALITY });
  if (blob.type !== "image/webp") {
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality: THUMB_QUALITY });
  }
  return blob;
}

/**
 * Upload a thumbnail blob to storage and return the path.
 */
export async function uploadThumbnail(
  thumbnailBlob: Blob,
  userId: string,
  tripId: string
): Promise<string> {
  const ext = thumbnailBlob.type === "image/webp" ? "webp" : "jpg";
  const thumbPath = `${userId}/${tripId}/thumbs/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from("photos")
    .upload(thumbPath, thumbnailBlob, {
      contentType: thumbnailBlob.type,
    });

  if (error) throw error;
  return thumbPath;
}

/**
 * Generate and upload a thumbnail for a file in one call.
 */
export async function createAndUploadThumbnail(
  file: File,
  userId: string,
  tripId: string
): Promise<string> {
  const blob = await generateThumbnail(file);
  return uploadThumbnail(blob, userId, tripId);
}
