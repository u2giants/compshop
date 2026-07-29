import type { PendingUpload } from "@/lib/offline-db";

export function pendingUploadMetadata(upload: PendingUpload) {
  const { file_blob: _fileBlob, ...metadata } = upload;
  return {
    ...metadata,
    local_blob: {
      size: upload.file_blob.size,
      type: upload.file_blob.type,
      file_name: upload.file_name,
    },
  };
}

export function safeRecoveryExtension(name: string, type: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  if (match) return `.${match[1]}`;
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/png") return ".png";
  if (type === "image/webp") return ".webp";
  if (type.startsWith("video/")) return ".mp4";
  return ".bin";
}
