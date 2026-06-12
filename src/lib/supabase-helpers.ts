import { supabase } from "@/integrations/supabase/client";
import { createAndUploadThumbnail } from "@/lib/thumbnail-utils";
import { compressForUpload } from "@/lib/image-utils";

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getProfile(userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  return data;
}

export async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

export async function getUserRoles(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return (data ?? []).map((r) => r.role as string);
}

export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkDuplicatePhoto(fileHash: string): Promise<boolean> {
  const [{ data: d1 }, { data: d2 }] = await Promise.all([
    supabase.from("photos").select("id").eq("file_hash", fileHash).limit(1),
    supabase.from("china_photos").select("id").eq("file_hash", fileHash).limit(1),
  ]);
  return (d1?.length ?? 0) > 0 || (d2?.length ?? 0) > 0;
}

function extensionFromName(fileName: string, fallback: string) {
  return (fileName.split(".").pop() || fallback).toLowerCase().replace(/[^a-z0-9]/g, "") || fallback;
}

export function buildStoragePath(userId: string, tripId: string, fileName: string, id = crypto.randomUUID()) {
  const ext = extensionFromName(fileName, "jpg");
  return `${userId}/${tripId}/${id}.${ext}`;
}

export function buildThumbnailPath(userId: string, tripId: string, id = crypto.randomUUID(), ext = "webp") {
  return `${userId}/${tripId}/thumbs/${id}.${ext}`;
}

function isAlreadyStored(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { message?: string; statusCode?: string | number; error?: string };
  const text = `${maybe.message ?? ""} ${maybe.error ?? ""}`.toLowerCase();
  return maybe.statusCode === 409 || maybe.statusCode === "409" || text.includes("already exists") || text.includes("duplicate");
}

async function uploadWithResume(path: string, body: Blob, options?: { contentType?: string }) {
  const { error } = await supabase.storage.from("photos").upload(path, body, {
    ...(options?.contentType ? { contentType: options.contentType } : {}),
    upsert: false,
  });
  if (error && !isAlreadyStored(error)) throw error;
}

export async function uploadPhoto(
  file: File,
  userId: string,
  tripId: string,
  options: { filePath?: string; thumbnailPath?: string | null } = {}
): Promise<{ filePath: string; thumbnailPath: string | null }> {
  const compressed = await compressForUpload(file);
  const filePath = options.filePath ?? buildStoragePath(userId, tripId, compressed.name);

  const uploadPromise = uploadWithResume(filePath, compressed, { contentType: compressed.type || file.type });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Upload timed out after 90s")), 90_000)
  );
  await Promise.race([uploadPromise, timeout]);

  // Generate WebP thumbnail in parallel (non-blocking on failure)
  let thumbnailPath: string | null = null;
  try {
    thumbnailPath = await createAndUploadThumbnail(file, userId, tripId, options.thumbnailPath ?? undefined);
  } catch (e) {
    console.warn("Thumbnail generation failed, using original:", e);
  }

  return { filePath, thumbnailPath };
}

export const MAX_VIDEO_BYTES = 30 * 1024 * 1024; // 30MB

/** Generate a JPEG poster from the first frame of a video file. */
async function generateVideoPoster(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    const cleanup = () => URL.revokeObjectURL(url);
    video.onloadeddata = () => {
      // Seek slightly in to avoid black frame
      try { video.currentTime = Math.min(0.1, (video.duration || 1) / 2); } catch { /* noop */ }
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        const w = video.videoWidth || 640;
        const h = video.videoHeight || 480;
        // Cap thumbnail at 800px wide
        const scale = Math.min(1, 800 / w);
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) { cleanup(); resolve(null); return; }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => { cleanup(); resolve(b); }, "image/jpeg", 0.78);
      } catch {
        cleanup();
        resolve(null);
      }
    };
    video.onerror = () => { cleanup(); resolve(null); };
    // Safety timeout: 8 seconds
    setTimeout(() => { cleanup(); resolve(null); }, 8000);
  });
}

export async function uploadVideo(
  file: File,
  userId: string,
  tripId: string,
  options: { filePath?: string; thumbnailPath?: string | null } = {}
): Promise<{ filePath: string; thumbnailPath: string | null }> {
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error(`Video is ${(file.size / 1024 / 1024).toFixed(1)}MB. Max allowed is 30MB.`);
  }
  const filePath = options.filePath ?? buildStoragePath(userId, tripId, file.name);

  await uploadWithResume(filePath, file, { contentType: file.type || "video/mp4" });

  // Generate poster thumbnail (best-effort)
  let thumbnailPath: string | null = null;
  try {
    const poster = await generateVideoPoster(file);
    if (poster) {
      thumbnailPath = options.thumbnailPath ?? buildThumbnailPath(userId, tripId, crypto.randomUUID(), "jpg");
      await uploadWithResume(thumbnailPath, poster, { contentType: "image/jpeg" });
    }
  } catch (e) {
    console.warn("Video poster generation failed:", e);
  }

  return { filePath, thumbnailPath };
}

export function getPhotoUrl(filePath: string) {
  const { data } = supabase.storage.from("photos").getPublicUrl(filePath);
  return data.publicUrl;
}

export async function getSignedPhotoUrl(filePath: string) {
  const { data, error } = await supabase.storage
    .from("photos")
    .createSignedUrl(filePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

/** @deprecated Use useCategories() hook instead */
export const PRODUCT_CATEGORIES = [] as const;

/** @deprecated Use useImageTypes() hook instead */
export const IMAGE_TYPES = [] as const;
