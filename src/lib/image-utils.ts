/**
 * Compress an image File/Blob before upload.
 * Resizes to at most maxPx on the longest side and re-encodes as JPEG.
 * Videos and already-small images are returned unchanged.
 * Typical result: 8 MB iPhone JPEG → ~1.5 MB (5× smaller, 5× faster upload).
 */
export async function compressForUpload(
  file: File,
  maxPx = 2048,
  quality = 0.88
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  const blobUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = blobUrl;
    });

    // Already small enough — skip recompression
    if (img.naturalWidth <= maxPx && img.naturalHeight <= maxPx) return file;

    const scale = maxPx / Math.max(img.naturalWidth, img.naturalHeight);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);

    const compressed = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", quality)
    );

    const ext = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([compressed], ext, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Resize an image blob to at most maxPx on its longest side and return a
 * base64-encoded JPEG string (no data-URL prefix) plus the effective MIME type.
 *
 * Sending full-resolution photos (often 3–8 MB) to the AI is the main source
 * of slow AI detect calls. 1024 px is more than enough for product/business-card
 * recognition and cuts payload size by 10–50×.
 */
export async function resizeToBase64(
  blob: Blob,
  maxPx = 1024,
  quality = 0.85
): Promise<{ base64: string; mimeType: string }> {
  const blobUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = blobUrl;
    });

    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);

    // toDataURL returns "data:image/jpeg;base64,<data>" — strip the prefix
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const base64 = dataUrl.split(",")[1];
    return { base64, mimeType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
