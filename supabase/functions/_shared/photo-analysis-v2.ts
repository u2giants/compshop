/**
 * Minimal Step 0 boundary proof.
 *
 * Keep this module free of Deno globals, URL imports, DOM types, and provider
 * SDKs. Step 2 expands it only after the live structured-output gate passes.
 */
export const PHOTO_ANALYSIS_SCHEMA_VERSION = 2 as const;
export const LOCKED_PHOTO_ANALYSIS_MODEL = "qwen/qwen3-vl-32b-instruct" as const;

export const PHOTO_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: "string" },
  },
  required: ["label"],
} as const;
