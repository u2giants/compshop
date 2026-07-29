import { describe, expect, it } from "vitest";
import { pendingUploadMetadata, safeRecoveryExtension } from "./local-recovery";
import type { PendingUpload } from "./offline-db";

describe("local recovery helpers", () => {
  it("keeps blob facts in the manifest without serializing the blob", () => {
    const upload = {
      id: "upload-1",
      trip_id: "trip-1",
      file_blob: new Blob(["photo"], { type: "image/jpeg" }),
      file_name: "Walmart.JPG",
      metadata: {
        product_name: null,
        category: null,
        price: null,
        dimensions: null,
        country_of_origin: null,
        material: null,
        brand: null,
        notes: null,
      },
      user_id: "old-user",
      created_at: "2026-07-29T12:00:00Z",
      status: "pending",
      retry_count: 0,
    } satisfies PendingUpload;

    const result = pendingUploadMetadata(upload);

    expect(result).not.toHaveProperty("file_blob");
    expect(result.local_blob).toEqual({
      size: 5,
      type: "image/jpeg",
      file_name: "Walmart.JPG",
    });
  });

  it("uses a safe extension when the original name has none", () => {
    expect(safeRecoveryExtension("camera-file", "image/jpeg")).toBe(".jpg");
    expect(safeRecoveryExtension("clip", "video/quicktime")).toBe(".mp4");
    expect(safeRecoveryExtension("scan.PnG", "image/png")).toBe(".png");
  });
});
