import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CachedImage from "./CachedImage";

const {
  getCachedImageBlob,
  cacheImageBlob,
  getCachedSignedUrl,
  cacheSignedUrls,
  createSignedUrl,
} = vi.hoisted(() => ({
  getCachedImageBlob: vi.fn(),
  cacheImageBlob: vi.fn(),
  getCachedSignedUrl: vi.fn(),
  cacheSignedUrls: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("@/lib/offline-db", () => ({
  getCachedImageBlob,
  cacheImageBlob,
  getCachedSignedUrl,
  cacheSignedUrls,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({ createSignedUrl }),
    },
  },
}));

describe("CachedImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCachedImageBlob.mockResolvedValue(undefined);
    getCachedSignedUrl.mockResolvedValue(undefined);
    cacheSignedUrls.mockResolvedValue(undefined);
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://example.test/recovered.jpg" } });
  });

  it("paints an available signed URL immediately without waiting for IndexedDB", () => {
    render(
      <CachedImage
        filePath="photos/original.jpg"
        signedUrl="https://example.test/thumbnail.jpg"
        alt="cover"
        loading="lazy"
        cacheAfterLoad={false}
      />,
    );

    expect(screen.getByRole("img", { name: "cover" })).toHaveAttribute(
      "src",
      "https://example.test/thumbnail.jpg",
    );
    expect(getCachedImageBlob).not.toHaveBeenCalled();
  });

  it("keeps the displayed source stable when the same photo is re-signed", () => {
    const { rerender } = render(
      <CachedImage
        filePath="photos/original.jpg"
        signedUrl="https://example.test/first-token.jpg"
        alt="cover"
      />,
    );

    rerender(
      <CachedImage
        filePath="photos/original.jpg"
        signedUrl="https://example.test/second-token.jpg"
        alt="cover"
      />,
    );

    expect(screen.getByRole("img", { name: "cover" })).toHaveAttribute(
      "src",
      "https://example.test/first-token.jpg",
    );
  });

  it("does not cache a derived cover thumbnail under the original photo path", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <CachedImage
        filePath="photos/original.jpg"
        signedUrl="https://example.test/thumbnail.jpg"
        alt="cover"
        cacheAfterLoad={false}
      />,
    );

    fireEvent.load(screen.getByRole("img", { name: "cover" }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(cacheImageBlob).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("re-signs and retries once instead of leaving a failed image blank", async () => {
    render(
      <CachedImage
        filePath="photos/original.jpg"
        signedUrl="https://example.test/expired.jpg"
        alt="cover"
        cacheAfterLoad={false}
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "cover" }));

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "cover" })).toHaveAttribute(
        "src",
        "https://example.test/recovered.jpg",
      );
    });
    expect(createSignedUrl).toHaveBeenCalledWith("photos/original.jpg", 86400);
  });
});
