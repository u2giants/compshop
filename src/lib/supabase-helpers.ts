import { supabase } from "@/integrations/supabase/client";

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

export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkDuplicatePhoto(fileHash: string): Promise<boolean> {
  const { data } = await supabase
    .from("photos")
    .select("id")
    .eq("file_hash", fileHash)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function uploadPhoto(file: File, userId: string, tripId: string) {
  const fileExt = file.name.split(".").pop();
  const filePath = `${userId}/${tripId}/${crypto.randomUUID()}.${fileExt}`;

  const { error } = await supabase.storage
    .from("photos")
    .upload(filePath, file);

  if (error) throw error;
  return filePath;
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

export const PRODUCT_CATEGORIES = [
  "Wall art",
  "Tabletop",
  "Workspace",
  "Clocks",
  "Storage",
  "Floor",
  "Furniture",
  "Garden",
] as const;

/** @deprecated Use useImageTypes() hook instead */
export const IMAGE_TYPES = [
  "Product Format",
  "Design Idea",
] as const;
