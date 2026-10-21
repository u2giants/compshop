# WeChat SSO postmortem — “Edge Function returned a non-2xx status code”

**Date:** 2026-10-21 · **Issue:** [#5](https://github.com/u2giants/compshop/issues/5) · **Fix:** [PR #7](https://github.com/u2giants/compshop/pull/7) · **Handoff:** [PR #8](https://github.com/u2giants/compshop/pull/8)

A user tapped **Continue with WeChat**, scanned the QR, and landed on a spinner
with Supabase’s generic `Edge Function returned a non-2xx status code`. Three
stacked failures were hiding behind that one string.

Companion guide for DesignFlow and other apps:
`popcre/designflow-backend` → `docs/wechat-sso-integration.md`
(also listed in that repo’s `docs/INDEX.md`). Repeatable steps live in
[`wechat-sso-playbook.md`](./wechat-sso-playbook.md).

---

## What actually broke

### 1. Service-role JWT no longer matched the live JWT secret

Coolify’s `SERVICE_ROLE_KEY` (and aliases) was an HS256 JWT signed with a
previous `JWT_SECRET`. Every GoTrue admin call failed
(`403 bad_jwt` / `signature is invalid`). The edge function returned 500; the
SPA hid the body.

### 2. `generate_link` token field location

The bridge read `linkData.properties.hashed_token`. This GoTrue returns
`hashed_token` at the **top level**. Verify received an empty hash → 400 → 500.

### 3. Remote import at request time

`await import("https://esm.sh/@supabase/supabase-js@2")` could hang on cold
start until the isolate was wall-clock killed (user sees a long spinner, then
the same generic error).

---

## What we changed

| Change | Where |
|--------|--------|
| GoTrue admin REST + `AbortSignal.timeout` (no CDN import) | `supabase/functions/wechat-auth/index.ts` |
| `hashed_token` read from top-level **and** `properties` | same |
| Clear per-step error strings (lookup / create / session) | same |
| SPA prints the function JSON `error` (`error.context`) | `src/pages/WeChatCallback.tsx` |
| Service-role JWT re-signed to live `JWT_SECRET` | Coolify env + stack restart |

## Proof (production)

- `POST /functions/v1/wechat-auth` with `{}` → `400 {"error":"Missing WeChat code"}`
- Dummy code → WeChat `401 invalid code` (secrets correct)
- Admin `createUser` → 200
- `generate_link` → top-level `hashed_token` → `POST /auth/v1/verify` →
  **`access_token` + `refresh_token`**
- Live bundle includes the new callback error path

## What to do next time (short list)

1. Re-sign service-role/anon JWTs whenever `JWT_SECRET` changes; verify with a
   real admin `createUser`.
2. Never import remote JS in the edge function.
3. Handle both `hashed_token` shapes.
4. Always surface `fnError.context` JSON in the UI.
5. After Coolify service recreate: re-copy `supabase/functions/*` into the
   functions volume and restart any `*-api-proxy` nginx.

## What not to do

- Do not use `signInWithOAuth` against WeChat (non-standard token API; GoTrue
  too old).
- Do not set WeChat callback to `comp.designflow.app` (unauthorized subdomain).
- Do not show only the generic non-2xx message.
- Do not assume Coolify env JWTs verify — compare signatures.
