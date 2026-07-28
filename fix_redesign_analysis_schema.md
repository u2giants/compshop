# Implementation Plan: Redesign CompShop Photo Analysis Schema

> This file is the complete handoff and build specification for a brand-new
> implementation session. Read the STATUS table first, then read the entire plan
> before changing code. When any implementation step is completed, update this
> file in the same commit so its current-state statements do not become stale.

## STATUS

| Step | Status | Last updated | Evidence / next action |
|---|---|---|---|
| 0. Prove the shared-module and Qwen structured-output assumptions | ⬜ open | 2026-07-28 | Run the synthetic live spike and dual-runtime import proof before migration or UI work. |
| 1. Add the versioned analysis persistence schema | ⬜ open | 2026-07-28 | Start with the migration and generated database types described in §9. |
| 2. Define and validate the v2 analysis contract | ⬜ open | 2026-07-28 | Create the shared pure TypeScript contract and its tests. |
| 3. Rebuild `analyze-photo` around Qwen, validation, and durable persistence | ⬜ open | 2026-07-28 | Implement only after Steps 0-2 pass. |
| 4. Centralize frontend analysis requests and OCR retry | ⬜ open | 2026-07-28 | Replace direct edge-function calls with one typed service; edge owns row persistence. |
| 5. Integrate automatic incoming-photo analysis | ⬜ open | 2026-07-28 | Preserve upload durability and user-entered metadata. |
| 6. Update manual, grouped, and bulk analysis flows | ⬜ open | 2026-07-28 | Remove first-non-null merging and use the shared service. |
| 7. Present tags and analysis state in the UI | ⬜ open | 2026-07-28 | Add compact tags/status without redesigning photo cards. |
| 8. Complete verification, documentation, migration, and deployment | ⬜ open | 2026-07-28 | Run all gates, land on `main`, apply migration, and verify live SHA. |

**Fresh-session starting point:** Step 0. Nothing in this implementation plan has
been implemented. The only work completed was read-only investigation and creation
of this plan. The plan was amended on 2026-07-28 after an independent Grok review
identified the shared-module boundary, structured-output compatibility, misleading
model-picker, and client-side persistence risks.

---

## Part 1 — Why

## 1. The ultimate goal

CompShop should automatically understand each newly uploaded sourcing photo once,
store useful and consistent tags for it, and fill trustworthy product metadata
without forcing employees to manually classify hundreds of trade-show and store
photos. The result must work for the images CompShop actually contains: individual
products, crowded product displays, business cards, packaging and labels, phone
screenshots, and visual references.

The implementation must make AI results predictable enough for application code to
consume safely. Every successful analysis must conform to one versioned schema,
retain the full result for future use, expose normalized searchable tags, record how
and when the result was produced, and continue respecting metadata that a user
already entered.

The production model is locked to the existing OpenRouter selection
`qwen/qwen3-vl-32b-instruct`. This project is not a model-selection exercise.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

CompShop is POP Creations' React/TypeScript photo-management application for product
sourcing trips. Employees photograph merchandise in domestic stores, at Canton Fair,
in China/Hong Kong showrooms, and during factory or booth visits. The app organizes
photos into trips, groups related images, supports bulk metadata editing, and uses an
offline-first upload queue because network quality can be poor during sourcing travel.

Repository and branch:

- GitHub: `https://github.com/u2giants/compshop`
- Local checkout used to write this plan: `/root/compshop-review`
- Normal integration branch: `main`
- Baseline when this plan was written: commit `dcd6836`
  (`Automate photo detection and explain uploads`)

Stack and runtime:

- React 18, TypeScript, Vite, Tailwind, and shadcn/ui
- Self-hosted Supabase: Postgres, Auth, private Storage, and Deno Edge Functions
- Production Storage is backed by MinIO
- OpenRouter supplies vision inference
- IndexedDB preserves pending uploads and offline data
- GitHub Actions triggers Coolify deployments

Production endpoints:

- Primary frontend: `https://comp.designflow.app`
- Alternate frontend: `https://compshop.designflow.app`
- Supabase/Kong API: `https://api.comp.designflow.app`
- Supabase Studio: `https://db.comp.designflow.app`
- Coolify: `https://coolify.comp.designflow.app`

Production resource identifiers:

- Supabase Coolify service: `supabase-compshop`
- Supabase service UUID: `lc7f483hklyq89eej67idpbx`
- Frontend resource: `compshop-frontend:main`
- Frontend UUID/container name: `frontend-uuid-comp-shop-prod-2026`
- Private Storage bucket: `photos`

Read `AGENTS.md` first in an implementing session. Then read this plan,
`docs/architecture.md`, `docs/development.md`, and `docs/deployment.md`. The plan is
authoritative for this feature; repository rules remain authoritative for operations
and safety.

## 3. What triggered this work

The business wants all incoming photos automatically AI-tagged at a reasonable price.
A production-image review on 2026-07-28 established that the current analysis response
is not a tagging schema. It only divides images into `BUSINESS CARD` or `PRODUCT PHOTO`
and returns a few flat fields. It cannot accurately represent shelf-wide displays,
packaging, screenshots, or design references, even though those are normal CompShop
inputs.

The review used direct, read-only access to the current production database and private
MinIO bucket. At that time:

- `public.photos` contained 420 records.
- `public.china_photos` contained 546 records.
- 60 randomly selected images (30 from each table) were visually inspected.
- The images included home décor, frames, wall art, storage, furniture, children's
  products, seasonal merchandise, crowded store/showroom displays, packaging, labels,
  business cards, and phone screenshots.
- 889 of 966 records had a blank category.
- 945 of 966 records had a blank `image_type`.
- `public.app_settings.ai_model` was already
  `qwen/qwen3-vl-32b-instruct`.

This is a feature redesign, not a single reproducible bug. To observe the current
limitation in production, upload or open any shelf-wide photo, screenshot, packaging
photo, or business card and run **AI Detect**. The response has no normalized `tags`,
no general content classification, no schema version/provenance, and no durable full
analysis record.

No production data was modified during the investigation. A temporary sample was copied
outside the repository to `/root/compshop-photo-sample.YHTDYo`; it is private operational
data, must never be committed, and may be deleted after implementation evaluation.

## 4. Scope — in and out

### In scope

- Introduce one versioned v2 analysis contract covering the actual production content
  types.
- Keep `qwen/qwen3-vl-32b-instruct` as the production model through OpenRouter.
- Require structured JSON output and validate/normalize it before returning it to the
  frontend.
- Prove Qwen/OpenRouter JSON Schema support and the shared-module import boundary before
  creating the migration or building UI consumers.
- Derive the category taxonomy server-side instead of trusting every caller to send it.
- Persist normalized tags, content type, confidence, status, provenance, timestamps,
  and the full versioned analysis for both `photos` and `china_photos`.
- For row-backed analysis, persist the paid validated result inside the authenticated
  edge-function request before returning success to the browser.
- Preserve the current flat product metadata fields for backward compatibility.
- Never overwrite non-empty user-entered product metadata during automatic analysis.
- Centralize all automatic, manual, grouped, and bulk analysis calls behind a typed
  frontend service.
- Replace the misleading admin model selector with a read-only locked-model explanation.
- Make tags and analysis status visible on existing photo cards/details.
- Add focused contract, normalization, persistence, merge, and workflow tests.
- Apply and verify the database migration, deploy through the documented GitHub/Coolify
  pipeline, and verify the live commit.

### NOT in this plan

- Comparing or selecting other vision models. Qwen is locked.
- OpenRouter response caching or duplicate-image caching. Incoming images are unique and
  every new image needs a fresh vision pass.
- Reprocessing all 966 historical photos. The schema must support a future backfill, but
  executing a bulk historical backfill is a separate, explicitly authorized operation.
- Semantic image embeddings, vector search, or near-duplicate detection.
- A global tag-search/filter interface. Store/index tags now; search UX is a later feature.
- Replacing OpenRouter with Alibaba's direct API or another provider.
- Redesigning trip pages, photo cards, bulk editing, or the admin panel beyond the
  minimal tag/status presentation required here.
- Changing video behavior. Videos remain excluded from image analysis.
- Automatically extracting contacts into a separate CRM/contact table. Business-card
  details live inside the full analysis JSON in this phase.
- Altering authentication, RLS policy semantics, Storage layout, offline queue retry
  policy, or deployment architecture.
- Guaranteeing durable persistence for preview analysis performed before a photo database
  row exists. Preview mode is an explicit best-effort exception; automatic incoming-photo
  analysis is row-backed and server-persisted.
- Prompt caching. The repeated prompt/taxonomy is small relative to unique image input,
  so caching is not a design dependency.

---

## Part 2 — What we already know

## 5. Current state of the code

All line references in this section are against baseline commit `dcd6836`; use symbol
names rather than blindly trusting line numbers after edits.

### Existing edge function

`supabase/functions/analyze-photo/index.ts`:

- Lines 9-16 support OpenRouter or the legacy Lovable gateway and default to
  `google/gemini-2.5-flash` when configuration is absent.
- Lines 24-45 authenticate the caller with its Supabase bearer token.
- Lines 52-74 select the provider and read `app_settings.ai_model`.
- Lines 76-81 accept optional client-supplied categories.
- Lines 83-135 call OpenRouter Chat Completions.
- Lines 98-124 contain the binary business-card/product-photo prompt and flat result.
- Line 133 allows up to 500 output tokens.
- Lines 154-163 strip optional Markdown fences, parse JSON, and silently replace invalid
  JSON with `{}`.
- Lines 165-175 return the parsed object or an HTTP error.

What works: authenticated requests, OpenRouter invocation, admin-configured model lookup,
basic rate/payment error handling, and base64 image submission.

What is incomplete: no schema enforcement, no contract version, no response provenance,
no validation, no tags, no general content classification, no server-owned category
taxonomy, and silent loss of malformed output.

### Existing image preprocessing

`src/lib/image-utils.ts:46-84` defines `resizeToBase64`. It rotates through browser image
decoding/canvas behavior, resizes the longest side to 1024 pixels, re-encodes JPEG at
quality 0.85, and returns base64. This is a good cost/latency baseline for product photos.
Dense business cards and small shelf labels may need a higher-detail pass, but sending
all original 3-8 MB photos is explicitly rejected in §7.

### Existing automatic upload analysis

`src/lib/sync-service.ts`:

- Lines 26-34 list the seven legacy flat metadata fields.
- Lines 36-75 define `autoDetectPhoto`, a best-effort operation that never blocks a
  completed upload.
- Lines 45-48 resize the image and invoke `analyze-photo` without categories.
- Line 50 discards all business-card responses.
- Lines 52-70 fill only empty legacy fields.
- Lines 93-166 implement durable upload processing and retries.
- Lines 132-149 insert the photo row, invoke automatic analysis, then remove the pending
  upload.

The best-effort and user-values-win semantics are correct and must remain. The missing
taxonomy, discarded business cards, lack of tags/full analysis, and untyped response are
not correct for the new goal.

### Existing manual and bulk callers

Direct `supabase.functions.invoke("analyze-photo")` calls currently exist in:

- `src/lib/sync-service.ts:41-75` — automatic post-upload detection.
- `src/pages/TripDetail.tsx:228-275` — domestic bulk detection.
- `src/pages/TripDetail.tsx:620-670` — domestic single/new-file detection.
- `src/pages/ChinaTripDetail.tsx:200-240` — China bulk detection.
- `src/pages/ChinaTripDetail.tsx:565-610` — China single/new-file detection.
- `src/components/trip/PhotoCard.tsx:193-265` — per-card and grouped-image detection.

`PhotoCard.handleAnalyze` analyzes grouped images separately and then chooses the first
non-null value for each field (`PhotoCard.tsx:227-257`). This can combine attributes from
different products and discards tags/context from all but the first usable response.

### Existing model administration

`src/components/admin/AiModelManager.tsx` allows an admin to select a model stored under
`app_settings.ai_model`. Production already contains
`qwen/qwen3-vl-32b-instruct`. A functional picker is misleading once the analysis
contract is locked to Qwen: it currently permits an admin to select a value the new
function would reject. Step 3 replaces that control with a read-only locked-model
display and clear explanation.

### Existing runtime boundary for shared code

`selfhost/compose.supabase.yml:197-217` mounts only `../supabase/functions` into the edge
runtime at `/home/deno/functions`. A new root-level `shared/` package would not be
available to the deployed edge runtime without changing deployment architecture.
`tsconfig.app.json` currently includes `src`, while Vite can follow imported repository
modules outside that include in many configurations. That cross-boundary behavior must
be proven, not assumed. Step 0 therefore tests one pure canonical module at
`supabase/functions/_shared/photo-analysis-v2.ts` through Deno, Vitest, lint, and the
Vite production build before implementation depends on it.

### Existing database

The two independent photo tables are defined initially in:

- `supabase/migrations/20260212171102_f2d23603-0096-45ea-9e16-872e9d50c65b.sql`
  (`photos`)
- `supabase/migrations/20260213182137_6dfcf745-8c0e-4c11-9c03-ffec0facaff4.sql`
  (`china_photos`)

Both already hold legacy fields such as `product_name`, `category`, `price`,
`dimensions`, `country_of_origin`, `material`, `brand`, `notes`, `image_type`, and
`file_hash`. Neither table has a tag array or durable full AI result.

RLS already permits authorized owners/admins to update photo records. Do not broaden
those policies for AI analysis.

`src/integrations/supabase/types.ts` is generated database metadata and must be
regenerated or updated through the repository's established Supabase type workflow
after the migration.

### Existing tests and CI/deploy state

- Vitest is configured through `npm run test`.
- Existing tests are `src/components/CachedImage.test.tsx` and
  `src/test/example.test.ts`.
- Standard checks are `npm run test`, `npm run lint`, and `npm run build`.
- `.github/workflows/deploy.yml` deploys relevant `main` changes through Coolify.
- Database migrations are **not** automatically applied by that workflow.
- At plan creation, `main`, `origin/main`, and `origin/HEAD` all pointed to `dcd6836`;
  the worktree was clean.
- The original plan and its documentation links were pushed to `origin/main` at
  `e3bd330` on 2026-07-28. This amendment follows an independent Grok review. No feature
  code, Step 0 spike, migration, or deployment described here has been executed.

## 6. Key findings and root cause

1. **The current prompt models the wrong domain.**
   `analyze-photo/index.ts:98-124` assumes every image is either a business card or
   product photo. Production contains multi-product displays, packaging, screenshots,
   and design references. A binary discriminator cannot represent those inputs.

2. **There is no tag output at all.**
   The existing response only has flat metadata. The business request is automatic
   AI tagging, so the contract itself—not just the prompt wording—must change.

3. **JSON is requested but not enforced.**
   `analyze-photo/index.ts:154-163` accepts arbitrary text and silently maps malformed
   output to `{}`. Callers can report apparent success with no data.

4. **Callers disagree about the response.**
   Six workflows across five source files invoke and interpret the raw edge response.
   Any schema edit made only in the edge function would break or partially update those
   consumers.

5. **Automatic analysis lacks the configured categories.**
   `sync-service.ts:45-48` invokes the function without `categories`; manual page flows
   send categories. Incoming photos therefore receive different model instructions
   based solely on how analysis started. Category lookup belongs server-side.

6. **Useful non-product analysis is thrown away.**
   `sync-service.ts:50` returns immediately for a business card. With a durable JSON
   analysis column, business-card OCR can be retained without forcing it into product
   fields.

7. **Grouped-image merging is unsafe.**
   `PhotoCard.tsx:227-257` combines the first non-null value from independently analyzed
   images. A price from one product can be combined with a brand/material from another.

8. **Existing metadata must remain compatible.**
   Many components read flat fields directly. Replacing them with JSON-only storage
   would create a broad and unnecessary refactor. The full v2 result should be stored
   alongside normalized/indexable columns and projected into existing empty legacy
   fields.

9. **The app already performs the important image-size optimization.**
   `resizeToBase64` uses 1024 pixels. Unique photos still require unique vision inference;
   response caching does not solve this workload. Resolution should only increase
   selectively when text requires it.

10. **Qwen matches the observed workload.**
    The inspected photos require OCR, multi-object scene handling, and fine product
    recognition. `qwen/qwen3-vl-32b-instruct` was chosen and is already configured in
    production. Do not spend implementation time reopening model selection.

11. **A paid result can currently be lost between inference and client persistence.**
    The browser invokes the edge function, receives the result, then separately updates
    the photo row. Closing the tab or losing connectivity after inference but before the
    update can discard tags that were already paid for. Row-backed analysis should
    authorize, infer, validate, and persist within one edge request.

12. **Strict structured output is an unproven external dependency.**
    OpenRouter advertises `response_format` for the selected Qwen endpoint, but the exact
    JSON Schema and `provider.require_parameters` combination must be exercised against
    the live account/provider before database and UI work are built around it.

## 7. Approaches considered and rejected

### Rejected: keep the flat schema and merely add a `tags` field

Why: this would still treat screenshots, business cards, packaging, and display scenes
as product photos; it would not add provenance, confidence, validation, or durable OCR.
The application would immediately need another breaking schema change.

### Rejected: replace legacy product columns with a JSON-only result

Why: existing photo cards, edit dialogs, bulk editing, reports, and queries already use
the flat columns. A JSON-only rewrite expands scope and makes ordinary product fields
harder to query. Store the full analysis and project safe values into existing columns.

### Rejected: trust every frontend caller to supply categories and normalize output

Why: automatic analysis already omits categories, and six workflows interpret results
differently. Taxonomy lookup and response validation must have one server-owned source
of truth.

### Rejected: continue parsing arbitrary model text with fence stripping

Why: malformed output currently becomes `{}` and appears successful. Use OpenRouter
structured output (`response_format` JSON schema), require parameter support, then
validate again in application code because provider output must never be trusted solely
on declaration.

### Rejected: send full-resolution originals for every analysis

Why: inspected originals are often 3-10 MB and several thousand pixels. This increases
latency, bandwidth, and image-token cost. Keep 1024 pixels for the initial pass. Only
use a 1600-pixel text-detail retry when the first result classifies the image as a
business card/packaging or reports unreadable important text.

### Rejected: use OpenRouter response caching

Why: incoming images are unique and should never be submitted identically twice.
Response-cache hits would be negligible. Prompt caching is also not a required
optimization because the stable prompt/taxonomy is small.

### Rejected: use a cheaper vision model or a multi-model escalation router

Why: the owner explicitly locked `qwen/qwen3-vl-32b-instruct` on 2026-07-28. Model
comparison is outside scope.

### Rejected: reprocess all historical photos as part of rollout

Why: that is a potentially expensive, high-volume production mutation and was not
authorized. New uploads and user-triggered analysis use v2. A separately approved,
rate-limited backfill can use the same service later.

### Rejected: make AI failure fail or retry the whole offline upload

Why: the durable image upload is the primary business operation. The current best-effort
behavior intentionally prevents an OpenRouter outage from trapping photos in the
offline queue. Persist AI failure status on the inserted row, but complete the upload.

### Rejected: keep paid-result persistence entirely in the browser

Why: a successful inference followed by a tab close or network loss can lose tags and
provenance after cost has already been incurred. For an existing photo row, the edge
function must persist through the authenticated request before returning success.
Client-only persistence remains acceptable only for explicitly labeled preview analysis
before a row exists.

### Rejected: create a new root-level shared package without proving deployment

Why: the current edge container mounts only `supabase/functions`; a root `shared/`
directory would be absent at runtime unless deployment architecture changed. Keep the
pure canonical contract in `supabase/functions/_shared` and prove frontend/tooling
imports in Step 0. If that proof fails, use generated frontend types as the fallback
described in Step 0 rather than silently changing the production mount.

### Rejected: leave the admin model picker active while rejecting non-Qwen choices

Why: this creates a UI trap where an apparently valid admin action breaks analysis.
Display the locked model read-only. A future model change must deliberately update the
contract, tests, and locked constant.

## 8. Design decisions already made

All decisions are dated 2026-07-28.

### Locked decisions — do not relitigate

1. **Model:** use `qwen/qwen3-vl-32b-instruct` through OpenRouter.
2. **One inference per unique image:** no duplicate-response cache design.
3. **Contract version:** the redesigned response is schema version `2`.
4. **Persistence:** keep legacy columns and add full analysis plus indexed summary
   columns to both photo tables.
5. **User values win:** automatic AI may fill empty legacy fields but may never
   overwrite a non-empty user-entered value.
6. **Upload durability wins:** AI failure never converts a successful Storage/DB upload
   into a failed pending upload.
7. **Server owns taxonomy:** the edge function loads active categories from the
   `categories` table; callers do not define the authoritative taxonomy.
8. **Tags are normalized:** lowercase, trimmed, unique, 2-40 characters each, maximum
   12, ordered most-specific/useful first. Do not include empty/generic tags such as
   `photo`, `image`, `product`, `store`, `display`, `unknown`, or `miscellaneous`.
9. **No historical backfill in this implementation.**
10. **Videos remain excluded.**
11. **Canonical contract location:** the source of truth is the pure, Deno-global-free
    module `supabase/functions/_shared/photo-analysis-v2.ts`, because the deployed edge
    runtime mounts `supabase/functions`. Step 0 must prove frontend build/test imports.
12. **Durable row-backed results:** when `photoId` and `table` are supplied, the edge
    function authorizes the row, validates Qwen output, and persists analysis before
    returning HTTP 200.
13. **Preview is explicitly non-durable:** analysis without a row is allowed only with
    `mode: "preview"` for existing pre-insert UI flows; the response may be lost if the
    browser exits.
14. **Admin model UI:** replace the selector/save action with a read-only display saying
    photo analysis is locked to Qwen3-VL-32B-Instruct.
15. **OCR retry owner:** `src/lib/photo-analysis.ts` alone decides whether to submit one
    1600-pixel retry. The edge function performs exactly one inference per request and
    persists each valid row-backed result; it never loops.

### Locked v2 response contract

The edge function returns this top-level shape. Optional textual values use `null`;
arrays use `[]`, never `null`.

```ts
interface PhotoAnalysisV2 {
  schema_version: 2;
  model: "qwen/qwen3-vl-32b-instruct";
  content_type:
    | "single_product"
    | "multi_product"
    | "product_display"
    | "business_card"
    | "packaging_or_label"
    | "screenshot_or_reference"
    | "non_product";
  summary: string;
  primary_product: {
    name: string | null;
    category: string | null;
    brand: string | null;
    price: {
      value: number | null;
      currency: string | null;
      source_text: string | null;
    };
    dimensions: string | null;
    materials: string[];
    colors: string[];
    country_of_origin: string | null;
  } | null;
  tags: string[];
  visible_text: string[];
  business_card: {
    company_name: string | null;
    contact_person: string | null;
    phones: string[];
    emails: string[];
    wechat: string | null;
    whatsapp: string | null;
    address: string | null;
    website: string | null;
  } | null;
  confidence: {
    overall: number;
    product_identity: number | null;
    text_extraction: number | null;
  };
  warnings: Array<
    | "multiple_products"
    | "important_text_unreadable"
    | "category_uncertain"
    | "partial_view"
    | "low_image_quality"
  >;
}
```

Contract semantics:

- Confidence values are finite numbers from `0` through `1`.
- `summary` is one concise factual sentence, maximum 240 characters.
- `primary_product` is the dominant merchandise item or product family. It is `null`
  for business cards and genuinely non-product images.
- For `multi_product`/`product_display`, describe the dominant product family; add the
  `multiple_products` warning rather than inventing a precise single SKU.
- `category`, when non-null, must exactly match an active `categories.name` value,
  case-insensitively normalized to the stored spelling. If none fits, return `null` and
  add `category_uncertain`.
- `visible_text` contains at most 20 useful strings, preserves original spelling/case,
  excludes duplicate decorative repetitions, and must not hallucinate unreadable text.
- Business-card values are retained only in `business_card` and `visible_text`; do not
  force the card/table underneath it into product metadata.
- `model` and `schema_version` are authoritative server-added provenance, not trusted
  from model-generated text.

### Locked database additions

Add the following columns to **both** `public.photos` and `public.china_photos`:

```sql
ai_analysis jsonb;
ai_tags text[] NOT NULL DEFAULT '{}';
ai_content_type text;
ai_analysis_status text;
ai_analysis_confidence real;
ai_analysis_model text;
ai_analysis_schema_version integer;
ai_analyzed_at timestamptz;
ai_analysis_error text;
```

Constraints:

- `ai_content_type` is null or one of the seven v2 content types.
- `ai_analysis_status` is null or one of `pending`, `complete`, `needs_review`, `failed`.
- `ai_analysis_confidence` is null or between 0 and 1.
- `ai_analysis_schema_version` is null or positive.
- Create GIN indexes on `ai_tags` for both tables.
- Do not default status to `pending`; legacy rows must remain distinguishable as
  “never analyzed under v2” (`NULL`).
- Do not backfill existing rows during the migration.
- Do not change RLS policies.

Status rules:

- Set `pending` immediately before an existing row starts analysis.
- Set `complete` when validation succeeds and `confidence.overall >= 0.65` without
  `important_text_unreadable` or `category_uncertain`.
- Set `needs_review` when validation succeeds but confidence is below 0.65 or either
  of those warnings is present.
- Set `failed` with a safe, concise `ai_analysis_error` when all analysis attempts fail.
- Clear `ai_analysis_error` on a later successful analysis.

### Open implementation judgments

These do not change the locked behavior:

- The compact placement of tag chips/status within existing photo cards may be chosen
  to avoid crowding. Do not redesign cards.
- The test fixture images may be synthetic/tiny checked-in fixtures or mocked base64.
  Never commit production photos or business-card data.
- If Step 0 proves Vite cannot safely import the canonical `_shared` module, the locked
  fallback is to generate a frontend type-only artifact from that canonical schema using
  a checked-in deterministic script and verify it is current in tests/CI. Do not
  hand-maintain two contracts or move the edge contract outside its deployed mount.

---

## Part 3 — How to build it

## 9. The plan

### Phase 0 — Prove external and cross-runtime assumptions

### Step 0. Prove the shared-module and Qwen structured-output assumptions

**Dependencies:** none. This is a mandatory stop/go gate before the migration, contract,
edge-function rewrite, or UI work. Use synthetic/non-sensitive data only. Do not change
production rows.

**Change/spike artifacts:**

1. Create the smallest temporary/check-in-ready pure module at
   `supabase/functions/_shared/photo-analysis-v2.ts` exporting a minimal version constant,
   locked model constant, and tiny placeholder JSON Schema. It must use no Deno globals,
   URL imports, DOM types, or provider SDK.
2. Add a minimal temporary/final Vitest import test under
   `src/test/photo-analysis-shared-boundary.test.ts`.
3. Import the same module from a minimal edge-function test or the existing
   `analyze-photo` module without yet replacing production behavior.
4. Run:

   ```bash
   npm run test
   npm run lint
   npm run build
   deno check supabase/functions/analyze-photo/index.ts
   ```

5. Confirm the deployed runtime boundary described in §5 still mounts
   `supabase/functions/_shared`. If local/reference compose and live Coolify behavior
   differ, stop and document the actual deployment packaging before continuing.
6. Using the existing edge-runtime `OPENROUTER_API_KEY` without printing or copying it,
   make one controlled live OpenRouter call with:
   - model `qwen/qwen3-vl-32b-instruct`
   - a tiny synthetic, non-sensitive product image
   - `temperature: 0`
   - the proposed `response_format: { type: "json_schema", ... }`
   - `provider: { require_parameters: true }`
7. Record only safe evidence in this plan: date, HTTP success/failure, resolved provider,
   request/generation ID if non-sensitive, whether schema conformance passed, token/cost
   usage, and latency. Never record the key, base64, authorization header, or raw
   provider request.
8. If strict JSON Schema succeeds, expand the canonical module in Step 2.
9. If OpenRouter/Qwen rejects strict JSON Schema or no eligible provider supports the
   parameters, stop before Step 1 and amend the plan. The permitted fallback design is
   JSON-object mode or plain JSON plus the same strict server validator and at most one
   corrective retry; it must be explicitly documented and cost-tested before proceeding.
   Do not silently remove `require_parameters` or route to a different model.
10. If Vite/Vitest cannot safely import the canonical `_shared` file, implement the
    locked generated-type fallback from §8:
    - canonical runtime schema/validator remains in `_shared`
    - add a deterministic generator script under `scripts/`
    - generate a type-only frontend artifact under `src/types/`
    - add a test/CI command that fails when the artifact is stale
    - document the generator command in `docs/development.md`

**Behavior when done:** the two highest-risk assumptions are evidence-backed before the
schema and callers depend on them: the same contract can serve the edge and frontend
toolchains, and the live OpenRouter Qwen endpoint honors the proposed structured output.

**Verification gate — you'll know it worked when:**

- The same version/model/schema definition passes Deno checking and either imports
  directly through Vitest/Vite or has a deterministic verified generated-type fallback.
- `npm run test`, `npm run lint`, and `npm run build` pass.
- The live synthetic Qwen call returns valid schema-conforming JSON with
  `require_parameters: true`.
- Safe provider/generation/cost/latency evidence is recorded in this STATUS row.
- No database migration, UI work, production image use, production row write, or model
  fallback occurred.

**Stop condition:** do not start Step 1 if any verification bullet fails. Amend this plan
with the proven alternative first.

### Phase A — Contract and persistence

### Step 1. Add the versioned analysis persistence schema

**Dependencies:** Step 0 must pass. Do this before row-backed persistence code.

**Change:**

1. Add one new timestamped migration under `supabase/migrations/`, after the current
   latest migration. Use a descriptive name such as
   `20260728000000_photo_analysis_v2.sql`.
2. Add the nine locked columns and constraints from §8 to both `photos` and
   `china_photos`.
3. Add `CREATE INDEX ... USING gin (ai_tags)` for both tables with distinct,
   descriptive names.
4. Make the migration idempotent where repository conventions support it
   (`ADD COLUMN IF NOT EXISTS`, named constraints guarded appropriately), but do not
   hide a partially incompatible schema.
5. Add comments explaining that `NULL ai_analysis_status` means not analyzed under the
   v2 contract.
6. Update/regenerate `src/integrations/supabase/types.ts` so both Row/Insert/Update
   types contain the new fields.
7. Do not apply the migration to production until Step 8's deployment sequence.

**Behavior when done:** legacy rows remain untouched; new code can store a full v2 result,
query tags efficiently, and distinguish complete/review/failed/unprocessed states.

**Verification gate — you'll know it worked when:**

- Applying the migration to an isolated/local Postgres succeeds twice without creating
  duplicate columns/indexes or weakening constraints.
- `\d+ public.photos` and `\d+ public.china_photos` show all nine columns, content/status/
  confidence constraints, and GIN tag indexes.
- A SQL test proves invalid status, invalid content type, and confidence `1.1` are
  rejected.
- Existing rows retain `NULL ai_analysis_status` and empty/default tags only as defined;
  no historical row receives fabricated analysis.
- `npm run build` typechecks all updated Supabase usages.

### Step 2. Define and validate the v2 analysis contract

**Dependencies:** contract is independent of Step 1 and may be developed in parallel,
but both must finish before Steps 3-6.

**Change:**

1. Expand the Step 0 canonical pure TypeScript module at
   `supabase/functions/_shared/photo-analysis-v2.ts`. It must remain free of Deno-only
   globals, URL imports, and DOM types. Use the proven direct frontend import or the
   generated-type fallback selected and recorded in Step 0; do not create a second
   hand-maintained interface.
2. Export:
   - `PHOTO_ANALYSIS_SCHEMA_VERSION = 2`
   - `LOCKED_PHOTO_ANALYSIS_MODEL = "qwen/qwen3-vl-32b-instruct"`
   - content type, warning, status, and `PhotoAnalysisV2` types
   - the OpenRouter JSON Schema object used by `response_format`
   - `normalizeAndValidatePhotoAnalysis(raw, activeCategories)`
   - `deriveLegacyMetadata(analysis)`
   - `deriveAnalysisStatus(analysis)`
3. Validation must reject, not silently erase:
   - missing/incorrect required fields
   - extra top-level/nested fields when JSON Schema declares
     `additionalProperties: false`
   - non-finite/out-of-range confidence or price values
   - invalid enums
   - a business card without a `business_card` object
   - a non-business-card result with an unexpected business-card object
4. Normalization must:
   - add trusted model/schema provenance server-side
   - trim strings and convert blank strings to `null` where allowed
   - normalize/dedupe/cap tags using §8 rules
   - cap summary and visible text
   - map category case-insensitively to exact stored spelling or null it with
     `category_uncertain`
   - never invent a currency from a bare number
5. `deriveLegacyMetadata` maps only:
   - `primary_product.name` → `product_name`
   - exact category → `category`
   - price value → `price`
   - dimensions → `dimensions`
   - brand → `brand`
   - materials joined with `", "` → `material`
   - country → `country_of_origin`
   It returns no legacy fields for a business card/non-product image.

**Behavior when done:** every caller and persistence path shares one explicit definition
of valid analysis and backward-compatible product metadata.

**Verification gate — you'll know it worked when:**

- `src/test/photo-analysis-v2.test.ts` passes all cases listed in §10.
- TypeScript compiles without `any` in the contract/normalizer.
- A frozen representative response validates to the exact expected normalized object.
- Malformed JSON, unknown fields/enums, invalid confidence, and mismatched content/card
  shapes produce explicit validation errors rather than `{}`.

### Step 3. Rebuild `analyze-photo` around Qwen and structured output

**Dependencies:** Steps 0-2.

**Change `supabase/functions/analyze-photo/index.ts`:**

1. Import the locked schema/model and normalization helpers from
   `../_shared/photo-analysis-v2.ts`.
2. Retain authenticated-user verification and OpenRouter error mapping.
3. Remove the legacy Lovable-provider branch for this function. This feature is locked
   to OpenRouter; retaining an untested alternate output path undermines the contract.
   Do not remove unrelated `LOVABLE_API_KEY` configuration used by other functions.
4. Resolve the model from `app_settings.ai_model`, but require it to equal the locked
   Qwen slug. If absent, use the locked slug. If it contains another model, return a
   clear server configuration error rather than silently changing model behavior.
5. In the same step, update `src/components/admin/AiModelManager.tsx` to remove/disable
   the selector, refresh button, and save action. Render a read-only message:
   “Photo analysis is locked to Qwen3-VL-32B-Instruct.” It may show the stored setting
   for diagnostics but must not offer an action that creates a rejected configuration.
6. Load active category names from `public.categories` inside the authenticated
   Supabase context. Sort and dedupe them. Treat a database lookup error as a server
   error; do not fall back to model-invented categories. Ignore/remove client-supplied
   `categories` from the authoritative prompt.
7. Define and validate two explicit request modes:
   - row-backed mode (default): requires `photoId`, `table` (`photos` or
     `china_photos`), `imageBase64`, MIME type, and `applyLegacyMetadata`
   - preview mode: requires `mode: "preview"` and image data; rejects row-persistence
     fields and is explicitly non-durable
   Common validation:
   - `imageBase64` required and non-empty
   - MIME restricted to supported image types
   - decoded payload capped to a documented safe maximum
8. In row-backed mode, use the caller-authenticated Supabase client to select the target
   row before inference. If RLS denies it, the row/table pair is invalid, or the target
   is not an image, return 403/404/400 as appropriate without calling OpenRouter.
9. Set the row's analysis status to `pending` before inference. If that update fails,
   do not incur inference cost.
10. Replace the current prompt with domain-specific instructions matching §8. Include
   the active category list. Explicitly distinguish merchandise from imagery printed
   on merchandise (for example, “elephant wall art,” not simply “elephant”).
11. Send exactly one OpenRouter inference per edge request:
   - locked model
   - `temperature: 0`
   - a tight output limit sufficient for the v2 schema (start at 900 tokens; adjust only
     from measured valid output)
   - `response_format: { type: "json_schema", json_schema: ... }`
   - `provider: { require_parameters: true }`
12. Parse JSON once; pass it through `normalizeAndValidatePhotoAnalysis`.
13. For row-backed mode, before returning success:
    - derive one database update containing all AI persistence columns
    - include derived legacy fields only when `applyLegacyMetadata: true` and the
      corresponding authorized row values are null/blank
    - update through the caller-authenticated client so existing RLS remains authoritative
    - return non-2xx if durable persistence fails
    - return the normalized analysis only after the update succeeds
14. Support an optional `replaceOnlyIfTextConfidenceImproves: true` on a row-backed
    request. After inference/validation, compare the new text confidence with the
    currently persisted v2 result. If it did not improve, keep the existing persisted
    result and return it with `retry_replaced: false`; otherwise persist the new result
    with `retry_replaced: true`. This makes Step 4's OCR retry safe.
15. On provider/validation failure in row-backed mode, best-effort update the row to
    `failed` with a safe concise error. Preserve useful 402/429 status mapping. Never
    store raw provider output.
16. In preview mode, return the validated result without persistence in an envelope
    containing `durable: false`, so callers cannot mistake it for a saved result.
17. Return a non-2xx validation/provider error with a
    safe message and log diagnostic detail server-side. Never return `{}` as success.
18. Include OpenRouter request/generation identifiers in server logs where available,
    but never log image base64, full business-card text, credentials, or authorization
    headers.
19. Do not implement an inference loop or OCR retry in the edge function. Each request
    performs one inference. Step 4's frontend service is the sole retry owner.

**Behavior when done:** Qwen returns one enforceable, domain-appropriate v2 result;
taxonomy/provenance are consistent; paid row-backed results are saved before HTTP 200;
malformed responses are visible failures.

**Verification gate — you'll know it worked when:**

- An authenticated row-backed call returns HTTP 200 only after the target row contains
  schema version 2, locked model, normalized tags, and an exact category or null.
- Representative mocked business-card, display, packaging, screenshot, and non-product
  outputs validate correctly.
- Missing auth returns 401; wrong configured model returns a clear 500/configuration
  error; malformed model output returns non-2xx, not `{}`.
- Unauthorized/nonexistent targets produce no OpenRouter call.
- Simulated persistence failure never returns a false HTTP 200.
- Preview responses are explicitly `durable: false`.
- A conditional retry with worse text confidence cannot overwrite the better stored
  first result.
- OpenRouter request inspection confirms `response_format`, `temperature: 0`, and
  `require_parameters: true`.
- The admin panel displays the locked Qwen model and offers no conflicting save action.
- Logs contain no base64 or extracted personal contact details.

**Natural context cut point:** after Phase A passes. Before starting Phase B in a fresh
session, re-read Steps 4-8 and compare their assumptions against the now-implemented
contract.

### Phase B — One client service and every workflow

### Step 4. Centralize frontend analysis requests and OCR retry

**Dependencies:** Steps 1-3.

**Change:**

1. Create `src/lib/photo-analysis.ts`.
2. Consume the canonical v2 types using the direct import or generated-type path proven
   in Step 0. Do not choose a new module location here.
3. Export a typed `analyzePhotoBlob` that:
   - accepts a `Blob` plus either a row-backed target (`photoId`, table,
     `applyLegacyMetadata`) or explicit preview mode
   - creates the normal 1024-pixel base64 using `resizeToBase64`
   - invokes `analyze-photo`
   - verifies the returned schema/model
   - treats a row-backed HTTP 200 as durably saved by the edge function
   - performs one optional 1600-pixel retry only when the first valid result is
     `business_card`/`packaging_or_label` with `important_text_unreadable`
   - sends `replaceOnlyIfTextConfidenceImproves: true` on that second request
   - never retries an ordinary product or provider failure
   - throws a typed/safe error for invalid responses
4. Do not persist paid row-backed results from the browser. Refresh/read the saved row
   after edge success.
5. In explicit preview mode, return the non-durable analysis only to the existing
   pre-insert prefill/edit flow; never label it saved.
6. Add a per-photo in-memory lock so simultaneous automatic/manual attempts from one
   browser do not double-submit the same photo. This is concurrency protection, not a
   durable duplicate cache.

**Behavior when done:** all UI and sync workflows use one typed implementation for image
preparation, endpoint invocation, the sole conditional OCR retry, and saved-row refresh;
the edge function owns durable row-backed persistence.

**Verification gate — you'll know it worked when:**

- `rg -n 'functions\\.invoke\\(\"analyze-photo\"' src` returns exactly one result, in
  `src/lib/photo-analysis.ts`.
- Edge/service tests prove automatic persistence preserves non-empty user fields, fills
  empty ones, and stores analysis metadata before success.
- Edge/service tests prove business cards persist full analysis/tags but do not populate
  product columns.
- A simulated duplicate in-flight request for one photo issues one endpoint call.
- A qualifying unreadable card/label issues exactly one 1600-pixel retry.
- A worse OCR retry leaves the better first persisted result intact.

### Step 5. Integrate automatic incoming-photo analysis

**Dependencies:** Step 4.

**Change `src/lib/sync-service.ts`:**

1. Remove the local `AI_METADATA_FIELDS` and raw response interpretation.
2. Refactor `autoDetectPhoto` to call the shared service in row-backed mode after the
   database row exists, passing `applyLegacyMetadata: true`.
3. Let the edge function mark pending, analyze, preserve non-empty row metadata, and
   persist the v2 result before returning. The browser must not duplicate those writes.
4. Refresh/read the returned saved result only as needed for local UI state.
5. Retain:
   - image-only guard
   - best-effort error handling
   - no retry/failure of the completed upload
   - removal of the pending upload after AI finishes or records failure
6. On AI failure, rely on the edge function's best-effort failed-status update. Log the
   safe client error and still finish the upload queue item; do not make a second
   browser-side status write race the server.
7. Do not analyze videos or already-duplicate uploads rejected by existing hash logic.
8. Ensure every upload entry point still converges through `syncOne`; do not add parallel
   page-specific automatic analysis paths.

**Behavior when done:** every successfully uploaded unique image gets one v2 analysis
attempt, while a provider outage cannot lose or strand the image.

**Verification gate — you'll know it worked when:**

- A new online image upload produces a stored photo with `ai_analysis_status` complete
  or needs_review, tags, model, schema version 2, and timestamp.
- A queued/offline image later synchronized produces the same fields.
- A mocked OpenRouter failure leaves the uploaded photo accessible, marks analysis
  failed when possible, and removes the upload from the pending queue.
- Existing user metadata in a pending upload remains unchanged.
- Videos produce no analysis request and retain null analysis status.
- Existing upload/retry tests remain green and new cases in §10 pass.

### Step 6. Update manual, grouped, and bulk analysis flows

**Dependencies:** Steps 4-5.

**Change these functions/call sites:**

- `src/pages/TripDetail.tsx`
  - `handleBulkAiDetect`
  - the single/new-file AI detection flow near the existing second invocation
- `src/pages/ChinaTripDetail.tsx`
  - `handleBulkAiDetect`
  - the single/new-file AI detection flow
- `src/components/trip/PhotoCard.tsx`
  - `handleAnalyze`

Required behavior:

1. Replace direct function invocation with `src/lib/photo-analysis.ts`.
2. Use row-backed mode for every existing photo ID. Use explicit preview mode only for
   a genuine pre-insert selected file, surface that it is a preview internally, and
   preserve the existing user-confirmed save/prefill semantics.
3. Bulk eligibility is based on v2 status:
   - include rows with null/failed analysis status
   - allow an explicit future “reanalyze” action for complete rows, but do not reanalyze
     complete rows by default
4. Keep sequential/concurrency-limited bulk requests. Use a maximum concurrency of 2 to
   avoid browser, edge-function, and OpenRouter bursts. Show completed/total progress.
5. Continue processing other rows after an individual failure; summarize successes,
   needs-review, and failures at the end.
6. For a grouped card, analyze each physical image and persist each image's own result.
   Do **not** synthesize one result by taking first non-null fields. The lead card may
   display the lead image's analysis; extra images retain their own tags/results.
7. A manual row-backed analysis persists AI provenance/tags inside the edge request but
   passes `applyLegacyMetadata: false`; detected legacy fields remain prefill suggestions
   until the user saves through the existing edit flow. Automatic upload analysis alone
   passes `applyLegacyMetadata: true`.
8. Refresh local page state after edge persistence so chips/status appear without reload.

**Behavior when done:** all manual and bulk paths produce the same stored contract as
automatic uploads; grouped images can no longer contaminate one another's metadata.

**Verification gate — you'll know it worked when:**

- The `rg` gate in Step 4 confirms no direct invocation remains outside the service.
- Domestic and China single-image **AI Detect** both store schema v2 and show prefilled
  product fields.
- Bulk analysis handles a mixed complete/unprocessed/failed set and does not re-bill
  complete rows by default.
- A forced failure in one bulk item does not stop later items; final counts are correct.
- A two-image group with different products stores two independent analyses and never
  combines price/brand/material across images.

### Step 7. Present tags and analysis state in the UI

**Dependencies:** Steps 4-6.

**Change:**

1. Extend shared photo types used by `PhotoCard`, domestic trip pages, and China trip
   pages with the new analysis fields. Prefer generated Supabase types and narrow view
   types; do not add broad `any`.
2. In `src/components/trip/PhotoCard.tsx`, render:
   - up to five tag chips in model priority order
   - a `+N` overflow indicator
   - a subtle needs-review/failed state
   - no empty placeholder for legacy/unprocessed rows
3. In the existing detail dialog, show all tags, content type, confidence as a percent,
   warnings, and visible text. Business-card contact data may be shown only in the
   already-authenticated detail view; avoid exposing it in list-card text.
4. Reuse existing shadcn badge/tooltip primitives. Maintain mobile layout and touch
   targets.
5. Use user-friendly language:
   - `needs_review` → “AI review suggested”
   - `failed` → “AI analysis failed”
   - do not expose raw provider errors in normal cards
6. Do not add tag editing/search/filtering in this phase.

**Behavior when done:** users can immediately see how a photo was categorized and whether
AI needs review, without losing the existing product-editing workflow.

**Verification gate — you'll know it worked when:**

- Desktop and mobile screenshots show tag chips without clipping primary controls.
- Long tags, 12 tags, zero tags, failed state, needs-review state, and business-card
  detail all render safely.
- Contact details do not appear on list cards.
- Keyboard focus and screen-reader labels remain usable.
- `npm run test`, `npm run lint`, and `npm run build` pass.

**Natural context cut point:** after Phase B passes. Before Phase C, re-read Step 8 and
§13, then inspect the actual git diff and deployed-state rules rather than relying on
memory.

### Phase C — Verify and land

### Step 8. Complete verification, documentation, migration, and deployment

**Dependencies:** Steps 1-7.

**Change/process:**

1. Update durable documentation:
   - `docs/architecture.md`: v2 schema, analysis flow, persistence/status semantics,
     Qwen/OpenRouter, and no-block upload rule
   - `docs/configuration.md`: locked model/config expectations and OpenRouter secret
     names only
   - `docs/development.md`: contract tests and local edge-function testing
   - this plan's STATUS/current-state sections
2. Run every test/check in §10.
3. Use a non-production fixture set first. Then perform a controlled production smoke
   test on newly uploaded test photos representing:
   single product, multi-product display, business card with non-sensitive dummy data,
   packaging/label, screenshot/reference, and low-quality/unreadable text.
4. Review actual OpenRouter usage/cost and latency for the smoke set. Confirm exactly
   one initial request per photo plus only justified OCR retries.
5. Commit focused changes on `main`, push to `origin/main`, and verify the remote SHA.
6. Apply the migration manually to the current production DB as documented in
   `docs/deployment.md`; migrations are not applied by GitHub Actions. Before applying:
   - capture schema/row-count evidence
   - verify a current backup exists
   - use the exact reviewed migration file
7. Push/deploy ordering:
   - migration first because old code ignores additive nullable columns
   - then code deploy
   - do not deploy code that writes columns before migration completion
8. Watch the GitHub `Deploy to Coolify` workflow and Coolify service/frontend deploys.
9. Verify production:
   - frontend live build SHA matches the pushed commit via the documented `build-sha`
     mechanism
   - edge function is running the new code
   - one new image completes automatic analysis
   - one provider-failure test or safe mock confirms uploads remain durable
   - database constraints/indexes exist and RLS behavior is unchanged
10. Mark each STATUS row with date, commit SHA, command/test evidence, migration evidence,
    and live verification. Do not mark complete based only on a successful push.

**Behavior when done:** the additive schema, contract, all callers, UI, and production
runtime agree; new photos are automatically tagged; failures remain visible but never
lose uploads.

**Verification gate — you'll know it worked when:**

- All §10 commands pass from a clean checkout.
- GitHub shows the implementation commit on `main`.
- GitHub Actions/Coolify are green for that SHA.
- Production frontend reports that SHA.
- SQL confirms v2 columns, constraints, and indexes.
- The controlled smoke matrix produces valid stored v2 objects and expected statuses.
- No production historical backfill occurred.
- This plan accurately records every completed/remaining item.

## 10. Tests required

### Unit tests: `src/test/photo-analysis-v2.test.ts`

Add named cases for:

1. `normalizes valid single-product analysis`
2. `normalizes category to stored taxonomy spelling`
3. `nulls unknown category and adds category_uncertain`
4. `normalizes deduplicates filters and caps tags`
5. `rejects unknown content types and warnings`
6. `rejects missing required fields and extra properties`
7. `rejects confidence outside zero-to-one`
8. `rejects non-finite or negative price`
9. `requires business_card payload for business_card content`
10. `rejects business_card payload for unrelated content`
11. `caps summary and visible_text safely`
12. `derives legacy fields from primary product`
13. `does not derive product fields from business card or non-product`
14. `derives complete versus needs_review status at the locked threshold`

### Unit tests: `src/test/photo-analysis-service.test.ts`

Mock Supabase function/database calls and test:

1. `invokes row-backed analyze-photo with target and resized image through one service`
2. `rejects wrong schema version or model`
3. `treats row-backed success as durable and refreshes saved state`
4. `marks preview analysis as non-durable`
5. `deduplicates simultaneous in-flight analysis for one photo`
6. `performs one higher-resolution retry only for unreadable card or label`
7. `sends replace-only-if-improved on the OCR retry`
8. `does not retry ordinary products or provider failures`

### Sync-service tests

Add or extend a focused test file, preferably `src/lib/sync-service.test.ts`, covering:

1. successful image upload followed by v2 analysis
2. OpenRouter failure does not fail/remove the stored photo
3. failure status persistence failure still does not strand the pending upload
4. queued user metadata is not overwritten
5. video uploads skip analysis
6. existing file-hash duplicate detection skips both upload and analysis as before

If current module side effects make direct testing impractical, extract the smallest
pure/orchestrator functions required. Do not weaken assertions or skip the workflow.

### Component/workflow tests

Add:

- `src/components/trip/PhotoCard.analysis.test.tsx`
  - renders five tags plus overflow
  - renders needs-review/failed labels
  - does not expose business-card contacts on the list card
  - grouped analysis calls/persists each photo independently
- Page-level or extracted bulk-runner tests:
  - skips complete rows by default
  - concurrency never exceeds two
  - one failure does not stop remaining work
  - progress/final counts are correct

### Edge-function contract tests

Mock OpenRouter and Supabase dependencies or test extracted request/response helpers:

- authentication required
- locked model enforced
- row-backed target is authorized before inference
- unauthorized or missing target incurs no OpenRouter request
- categories loaded server-side
- client categories cannot override server taxonomy
- structured-output request contains JSON schema, temperature 0, and
  `require_parameters: true`
- malformed provider JSON/contract returns non-2xx
- row-backed result persists before HTTP 200
- automatic persistence fills only empty legacy values
- manual row-backed persistence leaves legacy values as user-confirmed prefill
- business-card analysis persists without product metadata
- persistence failure never returns false success
- pending, complete, needs-review, and failed transitions are correct
- worse OCR retry cannot replace a better stored first result
- preview mode returns `durable: false` and writes no row
- provider 402/429 mappings remain intact
- no sensitive request/image payload appears in logs

### Mandatory Step 0 live compatibility spike

Before the database migration or UI implementation, record in the Step 0 STATUS evidence:

- the exact safe test date and selected model
- direct-import versus generated-type boundary result
- Deno check, Vitest, lint, and Vite build result
- OpenRouter HTTP result and schema-conformance result
- resolved provider/request ID only if safe
- prompt/completion token counts, request cost, and latency

This is a one-request synthetic compatibility test, not a model benchmark or production
data analysis. It must pass before Step 1 begins.

### Existing suite and manual gates

Run from repository root:

```bash
npm run test
npm run lint
npm run build
```

Also run any Deno tests added for edge-function code:

```bash
deno test supabase/functions --allow-env
```

Do not add broad network/filesystem permissions unless a specific test needs them.

Manual smoke matrix:

| Fixture | Expected content type | Critical assertions |
|---|---|---|
| One decorative photo frame | `single_product` | Product is “photo frame,” not merely its printed motif; useful tags/category |
| Shelf with mixed décor | `product_display` or `multi_product` | `multiple_products`; no invented SKU/price |
| Dummy English/Chinese business card | `business_card` | OCR retained; no product-field projection |
| Product packaging/label | `packaging_or_label` | visible text; OCR retry only if justified |
| Phone screenshot/reference image | `screenshot_or_reference` | not misclassified as physical product |
| Blurry/cropped product | applicable type | warning and needs-review status |

Use synthetic or approved non-sensitive fixtures. Production business cards must not be
copied into the repository or test logs.

## 11. Constraints, standing rules, and gotchas

- Read and obey `AGENTS.md`; project-owned code boundaries apply.
- Work on `main` for this `u2giants` repository unless repository policy changes before
  implementation. Pull/rebase safely and preserve concurrent work.
- Never overwrite unrelated dirty-worktree changes. Stage only implementation-plan
  hunks and feature files owned by this task.
- Use `apply_patch` for deliberate source edits.
- Database changes belong in a new migration. Never edit an already-applied migration.
- CompShop's self-hosted database is app-specific; the separate “shared supabase.com
  backend” workflow does not apply. Still review and apply production SQL deliberately.
- Production migrations are manual and additive-first. Code must not deploy before the
  new columns exist.
- Do not weaken or broaden RLS.
- Do not log image base64, bearer tokens, API keys, business-card contents, or provider
  raw payloads containing extracted PII.
- `OPENROUTER_API_KEY` stays only in edge-function/Coolify secrets. Never expose it via
  `VITE_*` or commit it.
- Do not hard-code the category list. Query `categories`.
- The locked model slug may be a constant; credentials, URLs that already have config,
  categories, and user data may not be hard-coded.
- The admin UI must not offer a model choice that the edge function rejects.
- Row-backed inference success means server-persisted success. The browser must not be
  the sole owner of paid-result persistence.
- Preview mode is the only non-durable path and must be explicit in request/response/UI
  handling.
- Preserve the offline-first queue. Analysis is subordinate to durable photo capture.
- Preserve file-hash duplicate detection. It is upload integrity, even though caching is
  outside scope.
- Keep normal image analysis at 1024 pixels. Higher-resolution OCR is conditional and
  capped at one 1600-pixel retry.
- `src/lib/photo-analysis.ts` is the sole OCR retry owner. The edge function performs
  exactly one inference per request and conditionally replaces persisted analysis only
  when retry text confidence improves.
- The canonical contract stays under `supabase/functions/_shared` because that directory
  is inside the deployed edge mount. Use only the Step 0-proven frontend import/generation
  path.
- Avoid `any` in the new contract/service. Existing `any` is not permission to spread it.
- Invalid model output is an explicit failure, never silent `{}`.
- Tags describe the merchandise and useful attributes, not incidental people,
  shelving, flooring, or generic “product/photo” concepts.
- Do not infer price currency from locale or trip. Only use visible evidence.
- Do not present AI tags as user-verified truth. Needs-review status must remain visible.
- Do not run a historical backfill without separate user authorization, spend estimate,
  rate limit, resumability, and rollback plan.
- UI changes require desktop and mobile visual verification.
- Documentation-only pushes do not deploy under current path filters; implementation
  changes under `src/**` and `supabase/functions/**` do.
- Whoever implements any step owns updating this plan's STATUS and current-state text in
  the same commit.

## 12. Access and environment

### Known working access when the plan was written

- Local Git checkout: `/root/compshop-review`
- Git remote: `origin` → `https://github.com/u2giants/compshop.git`
- Git branch: `main`
- Docker access to current production containers was available from the host.
- Production DB container:
  `supabase-db-lc7f483hklyq89eej67idpbx`
- Production MinIO container:
  `supabase-minio-lc7f483hklyq89eej67idpbx`
- GitHub credentials were sufficient to fetch/push this repository; reverify before
  implementation.
- Coolify access and deployment expectations are documented in `docs/deployment.md`.

Do not assume credentials remain valid. Verify non-destructively.

### Secrets

Never put values in this plan or source control.

Expected secret/config names:

- Edge runtime: `OPENROUTER_API_KEY`, `OPENROUTER_HTTP_REFERER`,
  `OPENROUTER_APP_TITLE`, Supabase runtime keys/URL
- Frontend: browser-safe `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
- GitHub Actions: `COOLIFY_BASE_URL`, `COOLIFY_TOKEN`

Consult `docs/1password.md` for authenticated 1Password access and repository-specific
item discovery. This planning session did not establish a verified vault/item title for
CompShop/OpenRouter, so do not invent one. Use existing runtime secrets when possible;
if a secret must be retrieved, locate it by documented service/resource name and record
only the vault/item title in the updated plan.

### Local setup

Requirements:

- Node.js 20+
- npm
- Docker only for production-host inspection; ordinary frontend development does not
  require production Docker access
- Supabase CLI/Deno when serving or testing edge functions

Commands:

```bash
cd /root/compshop-review
npm install
npm run dev
```

Vite serves `http://localhost:8080`. Create an uncommitted `.env.local` from
`.env.example` using browser-safe Supabase configuration. OAuth against production
Supabase requires `http://localhost:8080` in allowed redirect URLs.

Local function command:

```bash
supabase functions serve analyze-photo
```

Be aware that `supabase/config.toml` still references the historical Lovable project for
CLI context; production is the self-hosted Coolify stack. Do not deploy production
functions with an assumed `supabase functions deploy`. Follow `docs/deployment.md`.

---

## Part 4 — Landing it

## 13. Definition of done, risks, rollback, and open questions

### Definition of done

The work is complete only when every item is true:

- [ ] All nine STATUS steps (Step 0 through Step 8) are marked complete with dates and
      evidence.
- [ ] Step 0 recorded a successful synthetic live Qwen strict-JSON-Schema request and a
      proven Deno/Vite/Vitest shared-contract boundary before migration/UI work.
- [ ] Both photo tables contain the locked additive v2 columns, constraints, and GIN
      indexes; no historical backfill occurred.
- [ ] `PhotoAnalysisV2` is the single source of truth with schema version 2.
- [ ] Qwen3-VL-32B-Instruct is enforced and OpenRouter structured output is used.
- [ ] The admin panel presents Qwen as locked and cannot save a conflicting model.
- [ ] Categories are loaded server-side and exact-taxonomy normalization works.
- [ ] Every successful analysis stores full JSON, tags, type, status, confidence, model,
      schema version, and timestamp.
- [ ] Every row-backed HTTP 200 is returned only after authenticated server-side
      persistence; only explicit preview mode is non-durable.
- [ ] Automatic AI fills only empty legacy metadata and never compromises upload
      durability.
- [ ] Business-card/screenshot/display results are retained without being forced into
      product fields.
- [ ] All direct frontend calls were replaced by one typed service.
- [ ] Grouped images retain independent analyses; first-non-null merging is gone.
- [ ] Tags/status render safely on desktop and mobile.
- [ ] Every test in §10 exists and passes.
- [ ] `npm run test`, `npm run lint`, `npm run build`, and applicable Deno tests pass.
- [ ] Durable docs and this plan reflect the implemented state.
- [ ] Only task-owned changes are committed with the configured author.
- [ ] The implementation commit is pushed to `origin/main` and verified on GitHub.
- [ ] The production migration is applied and verified with SQL evidence.
- [ ] GitHub Actions and Coolify deploy the exact implementation SHA successfully.
- [ ] The live frontend build SHA matches the pushed SHA.
- [ ] Controlled production smoke tests cover all six fixture classes and prove provider
      failure does not lose an upload.

### Principal risks and mitigations

1. **Qwen/provider structured-output incompatibility**
   Mitigation: mandatory Step 0 live spike, `require_parameters: true`, contract tests,
   explicit non-2xx validation failures, and no silent fallback to another provider/model.

2. **Migration/code ordering outage**
   Mitigation: additive nullable migration first, verify it, then deploy code. Old code
   ignores the new columns.

3. **PII exposure from business cards**
   Mitigation: keep details in authenticated full analysis only; never show them on list
   cards or logs; preserve existing RLS.

4. **Incorrect AI overwrites trusted user data**
   Mitigation: automatic projection fills empty legacy fields only; unit-test atomic
   persistence.

5. **Extra inference cost from retries or duplicate workflows**
   Mitigation: one 1024-pixel pass, at most one conditional OCR retry, per-photo in-flight
   lock, and bulk skipping complete rows.

6. **Upload queue regression**
   Mitigation: preserve best-effort semantics and explicitly test provider and status-
   persistence failures.

7. **Crowded displays produce false specificity**
   Mitigation: separate multi-product/display types, warnings, confidence threshold, and
   needs-review state.

8. **Plan staleness during multi-session implementation**
   Mitigation: STATUS/current-state updates are part of every implementation commit and
   fresh-session cut points require a downstream drift reread.

9. **Paid result lost after browser interruption**
   Mitigation: row-backed authorization, inference, validation, and persistence occur
   inside one edge request before HTTP 200. Preview mode is explicitly non-durable.

10. **Shared module works in one runtime but not the other**
    Mitigation: Step 0 proves Deno plus Vite/Vitest imports before implementation; a
    deterministic generated frontend type artifact is the locked fallback.

### Rollback

1. Stop new code deployment by reverting/fix-forwarding the implementation commit on
   `main`; let GitHub/Coolify deploy the revert.
2. The database migration is additive. Leave its nullable columns/indexes in place during
   application rollback; old code ignores them. Do not drop data during an incident.
3. If AI analysis itself is harmful but uploads are healthy, temporarily disable the
   automatic call with a reviewed code/config change while retaining manual analysis and
   stored results. Do not disable uploads.
4. If OpenRouter/Qwen fails, allow rows to record `failed`; do not route silently to a
   different model.
5. Any later column removal requires a separate forward migration only after all code and
   retained data dependencies are audited.

### Open questions with decision criteria

No owner decision is required before implementation. The following are measured rollout
questions, with predetermined criteria:

1. **Is the 0.65 needs-review threshold well calibrated?**
   Keep 0.65 for launch. After at least 100 new analyses have human outcomes, adjust only
   if false-confidence review shows a materially better threshold; document the sample
   and change it in code/tests.

2. **Is the conditional 1600-pixel OCR retry worth its cost?**
   Enable it only as specified. During the smoke matrix, keep it if it materially
   improves business-card/label text confidence or recovers important text in at least
   two representative failures. Otherwise ship without the retry and record that result
   in STATUS/architecture docs.

3. **Is 12 the right maximum tag count?**
   Ship with 12. Revisit only after tag-search UX is designed and observed data shows
   truncation removing useful product concepts.

4. **Should historical photos be backfilled?**
   Not in this plan. A future plan must estimate OpenRouter cost from a representative
   batch, obtain explicit authorization, use rate-limited resumable processing, and
   exclude already-complete schema-v2 rows.

---

## Mandatory implementation-plan self-audit

### Objective checklist

- [x] All 13 required sections are present.
- [x] The ultimate goal is stated first in plain business language and includes the
      “goal wins” instruction.
- [x] A fresh session can implement without this conversation or unanswered owner input.
- [x] Rejected approaches and failed/dead-end designs are documented with reasons.
- [x] Every implementation step names files/functions and has a verification gate.
- [x] Locked and open decisions are explicitly separated.
- [x] Scope and out-of-scope work are explicit.
- [x] Tests are specified by file, name, and behavior.
- [x] Repository, branch, baseline, URLs, runtime resources, terms, and identifiers are
      defined.
- [x] Secrets are referenced only by environment-variable name or documentation path;
      no secret values are included.
- [x] Definition of done includes focused commit, push, CI, migration, deployment, and
      live-SHA verification.

### Required self-audit questions

1. **Could a brand-new AI session with no project knowledge and no context from the
   planning conversation execute this plan to perfection without asking the owner
   anything?**
   **Yes.** Sections 1-4 define the business goal, application, trigger, and boundaries;
   §§5-8 capture the exact current implementation, investigation, rejected approaches,
   locked contract/database decisions, and bounded judgment calls; §9 begins with a
   mandatory shared-runtime/live-provider stop/go gate and then names ordered
   files/functions and verification gates; §§10-12 specify tests, operating constraints,
   access, secrets handling, and local commands; §13 defines landing, rollback, and
   predetermined criteria for remaining measured questions. Shared-module failure and
   strict-schema failure both have explicit stop/fallback rules, so no owner choice is
   silently deferred.

2. **Does the plan carry every piece of background, nuance, and reasoning currently
   known, including what was ruled out and why?**
   **Yes.** §§3, 5, and 6 preserve the production sample/count findings and exact code
   evidence; §7 records why flat-only, JSON-only, client-taxonomy, arbitrary parsing,
   full-resolution, caching, alternate-model, historical-backfill, upload-failing,
   browser-only persistence, unproven root-shared-package, and misleading model-picker
   approaches were rejected; §8 records the chosen contract, canonical module boundary,
   server-side row persistence, preview exception, OCR-retry owner, locked admin UI,
   normalization, status, provenance, and compatibility semantics.

3. **Is the ultimate goal clear enough for the implementer to make a correct judgment
   call if a step proves wrong?**
   **Yes.** §1 says what business outcome must become true and explicitly says the goal
   wins over a conflicting step. §4 prevents scope drift, §8 distinguishes locked
   behavior from implementation judgment, and §13 gives risk/decision criteria and a
   rollback that prioritizes durable photo capture over AI availability.

**Self-audit result: PASS.** No checklist gap remains.
