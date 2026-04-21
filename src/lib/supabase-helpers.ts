import { supabase } from "@/integrations/supabase/client";
import { createAndUploadThumbnail } from "@/lib/thumbnail-utils";

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

export async function uploadPhoto(file: File, userId: string, tripId: string): Promise<{ filePath: string; thumbnailPath: string | null }> {
  const fileExt = file.name.split(".").pop();
  const filePath = `${userId}/${tripId}/${crypto.randomUUID()}.${fileExt}`;

  const { error } = await supabase.storage
    .from("photos")
    .upload(filePath, file);

  if (error) throw error;

  // Generate WebP thumbnail in parallel (non-blocking on failure)
  let thumbnailPath: string | null = null;
  try {
    thumbnailPath = await createAndUploadThumbnail(file, userId, tripId);
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
  tripId: string
): Promise<{ filePath: string; thumbnailPath: string | null }> {
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error(`Video is ${(file.size / 1024 / 1024).toFixed(1)}MB. Max allowed is 30MB.`);
  }
  const fileExt = (file.name.split(".").pop() || "mp4").toLowerCase();
  const filePath = `${userId}/${tripId}/${crypto.randomUUID()}.${fileExt}`;

  const { error } = await supabase.storage.from("photos").upload(filePath, file, {
    contentType: file.type || "video/mp4",
  });
  if (error) throw error;

  // Generate poster thumbnail (best-effort)
  let thumbnailPath: string | null = null;
  try {
    const poster = await generateVideoPoster(file);
    if (poster) {
      thumbnailPath = `${userId}/${tripId}/${crypto.randomUUID()}.jpg`;
      const { error: thumbErr } = await supabase.storage
        .from("photos")
        .upload(thumbnailPath, poster, { contentType: "image/jpeg" });
      if (thumbErr) {
        console.warn("Video poster upload failed:", thumbErr);
        thumbnailPath = null;
      }
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
