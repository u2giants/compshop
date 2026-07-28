import { describe, expect, it } from "vitest";
import { LOCKED_PHOTO_ANALYSIS_MODEL, PHOTO_ANALYSIS_SCHEMA_VERSION } from "../../supabase/functions/_shared/photo-analysis-v2";

describe("photo analysis shared boundary", () => {
  it("uses the same locked contract in the browser build", () => {
    expect(PHOTO_ANALYSIS_SCHEMA_VERSION).toBe(2);
    expect(LOCKED_PHOTO_ANALYSIS_MODEL).toBe("qwen/qwen3-vl-32b-instruct");
  });
});
