---
issue: 5
status: OPEN
owner: mimo/wechat-sso-2026-10-21-wrap
---

# Wrap-up — CompShop WeChat SSO fix + cross-app docs (2026-10-21)

GitHub issue: https://github.com/u2giants/compshop/issues/5

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

**Already settled — do NOT re-ask:**

| Decision | Settled | Value |
|----------|---------|--------|
| WeChat login access | 2026-10-20 | Invite-only |
| Callback host | 2026-10-20 | `https://designflow.app/wx/callback/` |
| Pending applicants | 2026-10-21 | name + intro note |
| Secrets home | 2026-10-20 | 1Password `vibe_coding` |

**One owner decision still needed (not technical approval):** none for login.
Optional product: link WeChat identity to an existing email user — only if
Albert wants it.

**JWT_SECRET rotation** is a technical production action (see §6/§9): schedule
a maintenance window; do not ask Albert to "approve" — put the window as a
business timing question only.

## 1. What this application is

CompShop — comparison-shopping PWA (React + Vite), self-hosted Supabase on
Coolify/Hostdare. WeChat SSO is a bridge edge function, not GoTrue custom OAuth.

| Item | Value |
|------|--------|
| Repo | https://github.com/u2giants/compshop |
| Frontend | https://comp.designflow.app |
| API | https://api.comp.designflow.app |
| Coolify | https://coolify.comp.designflow.app (185.194.148.230) |
| Supabase service | `lc7f483hklyq89eej67idpbx` (`supabase-compshop`) |

## 2. What we set out to do this session

1. Fix WeChat login spinner + `Edge Function returned a non-2xx status code`
   (issue #5).
2. Write the lessons into `popcre/designflow-backend` and this repo.
3. Rebuild frontend for clear error text; push handoff.

## 3. Current state — what is true right now

### Done and proven

| Piece | Proof |
|-------|--------|
| Root causes fixed (JWT, hashed_token shape, esm.sh hang) | PR #7 merged |
| Session mint works live | generate_link → verify → access+refresh tokens |
| WeChat secrets reach token API | dummy code → WeChat `invalid code` |
| Error text in SPA | deploy `asvwn2h0y3de754wq9z2e6n0` healthy; bundle has new copy |
| Handoff landed | PR #8 merged |
| CompShop postmortem + README/AGENTS router | PR #9 merged |
| DesignFlow guide on sandbox-albert | commit `6d26dcb`, in PR #180 (not merged) |

### Open

1. **Human QR login proof** (issue #5) — scan on https://comp.designflow.app/auth
   → pending screen with name/note → admin approve → home.
2. **DesignFlow PR #180** — Albert/Uma merge (DesignFlow never self-merged).
   Doc: https://github.com/popcre/designflow-backend/blob/sandbox-albert/docs/wechat-sso-integration.md
3. **JWT_SECRET rotation** after transcript leak (see §9).
4. Anon JWT is also stale-signed (same secret mismatch). User access tokens are
   issued by GoTrue and fine; rotate anon when rebuilding frontend after a
   secret change.
5. `minio/mc` pull still blocks full `docker compose up`.
6. Hostdare DNS/Tailscale resolv.conf fragility.
7. DesignFlow frontend PR #340 (nginx `/wx/callback` no-slash) if still open.

## 4. Everything we tried that did NOT work

See https://github.com/u2giants/compshop/blob/main/docs/wechat-sso-postmortem.md
and https://github.com/u2giants/compshop/blob/main/docs/wechat-sso-playbook.md
(especially Coolify PATCH `/envs/{uuid}` 404; use collection PATCH with
`[{key,value,uuid}]`; and `minio/mc` pull denial).

## 5. Root causes and key findings

Same as postmortem: (A) service-role JWT ≠ live JWT_SECRET, (B) `hashed_token`
top-level vs `properties`, (C) remote esm.sh import. Client hid all three
behind one generic string. Ops: Coolify restart can leave compose down;
`compshop-api-proxy` nginx must restart after Kong recreate.

## 6. Exact next steps

1. Albert: scan WeChat QR and confirm pending screen (issue #5 live proof).
2. Albert/Uma: review/merge designflow-backend PR #180.
3. Plan JWT_SECRET rotation window; re-sign service_role + anon; update Coolify;
   rebuild frontend with new anon key; verify admin createUser + login.
4. Optionally fix minio image name; DesignFlow #340.

## 7. Constraints and gotchas in force

- Invite-only; AppSecret server-only; DesignFlow PRs sandbox-albert → develop,
  never self-merge; CompShop feature branch + PR (self-merge allowed).
- Edge functions are not auto-synced from GitHub into the Coolify volume.
- Coolify PATCH env responses echo full JWTs — never paste them.
- Git push via HTTPS hung several times; GitHub git-data API via `gh api` works.

## 8. Access and environment

| What | Where (names only) |
|------|--------------------|
| WeChat AppID/Secret | 1Password `vibe_coding` → `wechat SSO appsecret for compshop` |
| Coolify + Hostdare root + JWT/keys | 1Password `vibe_coding` → `coolify hostdare compshop` |
| Docs (compshop) | https://github.com/u2giants/compshop/blob/main/docs/wechat-sso-postmortem.md |
| Docs (designflow-backend) | https://github.com/popcre/designflow-backend/blob/sandbox-albert/docs/wechat-sso-integration.md |

## 9. Open questions and risks

- **Transcript leak 2026-10-21:** the live service-role JWT was echoed in tool
  output when Coolify returned env PATCH results. JWT expires year 2092 while
  JWT_SECRET is unchanged, so that token still works. Only JWT_SECRET rotation
  retires it (all sessions drop — needs a window). Put this on the next
  production-maintenance task list. Also sweep any local temp copies (removed
  this session: `new_service_role.txt` / `new_anon.txt`).
- Anon key same signature mismatch — fix in the same rotation.
- Full Coolify service recreate may wipe manually copied edge functions.
