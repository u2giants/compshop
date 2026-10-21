---
issue: 5
status: OPEN
owner: mimo/wechat-sso-2026-10-21-2
---

# WeChat SSO non-2xx root-cause fix (CompShop)

GitHub issue: https://github.com/u2giants/compshop/issues/5
PR: https://github.com/u2giants/compshop/pull/7 (merged)

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

**Already settled — do NOT re-ask:**

| Decision | Settled | Value |
|----------|---------|--------|
| Who may use WeChat login | 2026-10-20 | **Invite-only** |
| Callback host | 2026-10-20 | **`https://designflow.app/wx/callback/`** |
| How to tell applicants apart | 2026-10-21 | Pending users save **name + intro note** |
| Where AppID/AppSecret live | 2026-10-20 | 1Password `vibe_coding` → `wechat SSO appsecret for compshop` |

**None left for the owner.** If the first real QR login shows a product problem, put any new business questions to Albert in **one** message.

## 1. What this application is

CompShop — collaborative comparison-shopping PWA for POP Creations (React + Vite, self-hosted Supabase GoTrue 2.186.0, Coolify on Hostdare).

| Item | Value |
|------|--------|
| Repo | https://github.com/u2giants/compshop |
| Frontend | https://comp.designflow.app |
| Supabase API | https://api.comp.designflow.app |
| Coolify (CompShop) | https://coolify.comp.designflow.app / 185.194.148.230 |
| WeChat bounce | https://designflow.app/wx/callback/ |
| WeChat AppID | `wx15bb6cd1fa50ff83` |

## 2. What we set out to do this session

Albert reported (phone screenshot): tapping **Continue with WeChat** ends on a spinner with **`Edge Function returned a non-2xx status code`** on `comp.designflow.app`. Resume issue #5 and make WeChat SSO work.

## 3. Current state — what is true right now

### Fixed and live

| Piece | Proof |
|-------|--------|
| Service-role JWT re-signed to live `JWT_SECRET` | `SIG_MATCH` in edge container; Coolify envs `SERVICE_ROLE_KEY`, `SERVICE_SUPABASESERVICE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_KEY`, `SERVICE_KEY` updated |
| `wechat-auth` uses GoTrue admin REST + timeouts (no `esm.sh`) | Deployed 10244-byte `index.ts` in functions volume + container |
| `hashed_token` read from top-level **and** `properties` | `generate_link` → 56-char token → `/auth/v1/verify` → **200 with access_token + refresh_token** |
| Admin user create | 200 with real user id |
| Dummy WeChat code | 401 `invalid code` (WeChat itself — secrets correct) |
| `compshop-api-proxy` restarted after stack recreate | `/functions/v1/wechat-auth` answers 400 `Missing WeChat code` |
| Error body surfaced in `WeChatCallback` | Merged in PR #7 (needs frontend rebuild to show real messages on errors) |

### Production incident this session

Coolify `restart` on `supabase-compshop` stopped containers and `docker compose up` failed on **`minio/mc` pull denied**. Recovered with:

```bash
docker compose up -d --no-deps supabase-db supabase-auth supabase-rest supabase-kong supabase-edge-functions supabase-meta supabase-vector
docker restart compshop-api-proxy
```

### Still open (from prior handoff, plus new)

1. **Live WeChat QR login** — not proven end-to-end by a human scan.
2. Frontend rebuild (PR #7 error surfacing + any anon-key refresh) via Coolify deploy from `main`.
3. Hostdare DNS / Tailscale resolv.conf fragility.
4. DesignFlow PR #340 (`/wx/callback` no-slash 301) if still open — DesignFlow, never self-merge.
5. `minio/mc` image name still broken in compose.
6. Anon JWT also stale-signed (same secret mismatch). Login mint path does not need it; other SPA API calls use user access tokens. Rebuild frontend if anon key is rotated in Coolify.

## 4. Everything we tried that did NOT work

| Attempt | Why it looked right | What failed |
|---------|---------------------|-------------|
| 1Password `SERVICE_ROLE_KEY` | Same field name | Stale JWT, `bad_jwt` / 401 |
| Coolify `PATCH /envs/{uuid}` | RESTful | 404 on this Coolify 4.0.0-beta.474 |
| `docker compose up` whole service | Restore stack | `minio/mc` pull denied aborts compose |
| Looking for `properties.hashed_token` | Supabase docs | This GoTrue puts `hashed_token` at top level |
| SSH `New-SSHSession` / host python | Quick | No Posh-SSH; paramiko in temp venv works |

## 5. Root causes and key findings

1. **Service-role JWT vs `JWT_SECRET` mismatch** — Coolify env `SERVICE_ROLE_KEY` was signed with a different secret than `SERVICE_PASSWORD_JWT` (`v4uO2e…`). Every admin API call failed `signature is invalid`. New HS256 JWTs (same payload shape `{"role":"service_role","iss":"supabase","iat":…,"exp":…}`) re-signed with the live secret.
2. **`generate_link` response shape** — `hashed_token` is top-level (also under `properties` on some versions). Original code only read `properties` → verify got empty hash → 400 → 500 → client shows generic non-2xx.
3. **`import("https://esm.sh/@supabase/supabase-js@2")`** — remote module on every cold path; isolates hit wall-clock and were early-terminated. Replaced with `fetch` to GoTrue admin + `AbortSignal.timeout`.
4. **Client error swallow** — `supabase.functions.invoke` throws `Edge Function returned a non-2xx status code` and hides the JSON body unless you read `error.context`.
5. **Coolify service restart ≠ start** — restart can leave the stack down when compose is unhealthy (`minio/mc`).
6. **`compshop-api-proxy`** (nginx) in front of Kong must be restarted after Kong is recreated or api.comp.designflow.app 502s.

## 6. Exact next steps

1. **Live QR proof** (issue #5): https://comp.designflow.app/auth → Continue with WeChat → scan. Success = pending screen with name/note fields.
2. **Admin approve** that user and confirm `/` loads.
3. **Coolify rebuild frontend** from `main` so error surfacing (PR #7) is in the bundle.
4. Optional hardening: rotate anon key to match secret + rebuild; DNS; minio image; DesignFlow #340.

## 7. Constraints and gotchas in force

- Invite-only; unknown WeChat users stay `pending`.
- Never put AppSecret in client JS, chat, logs, or git.
- DesignFlow PRs: `sandbox-albert` → `develop`, never self-merge.
- CompShop: feature branch + PR; `main` deploys.
- Edge functions are **not** auto-synced from GitHub — copy to `/data/coolify/services/lc7f483hklyq89eej67idpbx/volumes/functions/`.
- Migrations are not auto-applied.

## 8. Access and environment

| What | Where (names only) |
|------|--------------------|
| WeChat AppID/AppSecret | 1Password `vibe_coding` → `wechat SSO appsecret for compshop` |
| Coolify API + host root | 1Password `vibe_coding` → `coolify hostdare compshop` |
| Host | edge-dev (Windows); `gh` as Albert |
| CompShop git | https://github.com/u2giants/compshop |

## 9. Open questions and risks

- Anon key JWT is also wrongly signed — verify SPA PostgREST after a fresh rebuild.
- `minio/mc` pull failure still blocks full `docker compose up`.
- Full Coolify **service recreate** may wipe manually copied edge functions — re-copy after.
- No human has completed a real WeChat QR login yet.
