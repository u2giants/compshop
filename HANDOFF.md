# HANDOFF: Microsoft/Google OAuth sign-in returns 500 `Error creating flow state`

**Status:** diagnosed and fixed in the repo; **not yet applied to production.**
**Repo commit:** `d6fb85b` on `main`.
**You need server access to finish this. That is the only reason this is still open.**

This handoff is written for an agent session running on the production host. The session
that wrote it had repo access only — the network policy blocked `api.comp.designflow.app`,
so **the diagnosis below is inferred from source code and config, not confirmed against a
live system.** Step 1 is the confirming step. Do not skip it.

---

## 1. Symptom

Elizabeth Parkin reported she cannot sign in with Microsoft. Her phone showed raw JSON,
not the app UI:

```json
{"code":500,"error_code":"unexpected_failure","msg":"Error creating flow state","error_id":"2b6e0a26-5e79-4bcf-8e4a-e7d1744b31f7"}
```

Reported 2026-07-29 ~10:04 (device clock, timezone unconfirmed — treat as approximate when
grepping logs).

Three inferences worth carrying into the investigation:

- **This is GoTrue answering `/auth/v1/authorize`**, i.e. the redirect that fires the
  instant she taps "Continue with Microsoft" — *before* Microsoft is ever contacted. It
  renders as raw JSON because `signInWithOAuth` does a full-page navigation to
  `api.comp.designflow.app`. The app never gets a chance to show a toast.
- **It is almost certainly not specific to Elizabeth.** Nothing user-identifying reaches
  that endpoint yet — no email, no account, no cookie that matters. She is simply the
  person who reported it. Expect it to reproduce for anyone.
- **Google sign-in is broken too.** Both providers share the identical code path up to the
  failure point. Email/password sign-in is unaffected, because it never touches
  `auth.flow_state` — which is why the outage looked like a one-person Microsoft problem.

Confirm this breadth early; it changes the urgency.

---

## 2. Cause

Production runs `supabase/gotrue:v2.186.0` (pinned in `selfhost/compose.supabase.yml:50`).

In that version, `internal/api/external.go` creates a row in `auth.flow_state` for **every**
OAuth sign-in and uses the row's id as the OAuth `state` parameter:

```go
// Always create flow state for all flows (both PKCE and implicit)
// The flow state ID is used as the state parameter instead of JWT
flowState, err := models.NewFlowState(flowParams)
...
if err := db.Create(flowState); err != nil {
    return "", apierrors.NewInternalServerError("Error creating flow state").WithInternalError(err)
}
```

That `db.Create` is the failing statement, and that error string is the one in the
screenshot. It is a plain database insert failure.

The insert requires the table shape from GoTrue migration
`20260115000000_add_flow_state_oauth_context`, which does two things:

```sql
ALTER TABLE auth.flow_state
    ADD COLUMN IF NOT EXISTS invite_token TEXT NULL,
    ADD COLUMN IF NOT EXISTS referrer TEXT NULL,
    ADD COLUMN IF NOT EXISTS oauth_client_state_id UUID NULL,
    ADD COLUMN IF NOT EXISTS linking_target_id UUID NULL,
    ADD COLUMN IF NOT EXISTS email_optional BOOLEAN NOT NULL DEFAULT FALSE;

-- Make PKCE fields nullable to support implicit flow
ALTER TABLE auth.flow_state
    ALTER COLUMN code_challenge DROP NOT NULL,
    ALTER COLUMN code_challenge_method DROP NOT NULL,
    ALTER COLUMN auth_code DROP NOT NULL;
```

Both halves matter here. The frontend uses `@supabase/supabase-js` ^2.95.3 with default
options (`src/integrations/supabase/client.ts`), so the flow type is **implicit** — which
means GoTrue writes `NULL` into `auth_code`, `code_challenge` and `code_challenge_method`.
On the pre-`20260115000000` schema those three columns are `NOT NULL`, and the five new
columns do not exist at all. Either condition alone is fatal to the insert.

**Most likely trigger:** the 2026-06-14 production migration into the current Coolify
Supabase service (`lc7f483hklyq89eej67idpbx`). Restoring the `auth` schema from the older
stack brings `auth.schema_migrations` back with the migrations marked as applied, so GoTrue
skips them on boot and the table silently stays behind the running image. A second, less
likely variant with the same symptom: the restore left `auth.flow_state` owned by
`postgres` rather than `supabase_auth_admin`, so GoTrue's own role gets `permission denied`.
The proposed fix covers both.

**Ruled out during investigation** — don't re-litigate these:

- *Azure-specific provider config.* `azureProvider.RequiresPKCE()` returns `false` in
  v2.186.0, so the Microsoft path and the Google path are byte-for-byte identical up to the
  failing insert. Nothing about the Azure app registration, tenant, secret or redirect URI
  can produce this error — those failures surface later, at `/auth/v1/callback`, and are
  redirected back to the app rather than rendered as raw JSON.
- *The `scopes: "email profile"` option in `src/pages/Auth.tsx`.* GoTrue prepends `openid`
  and the oauth2 library joins on spaces, yielding a valid `scope=openid email profile`.
  Harmless.
- *The Authentik `keycloak` fallback in `handleMicrosoftSignIn`.* Never reached — it only
  triggers on "provider is not enabled", and this is a 500.

---

## 3. Proposed fix

`supabase/migrations/20260729000000_repair_auth_flow_state.sql` (already in the repo at
`d6fb85b`). It re-applies the upstream `auth.flow_state` and `auth.oauth_client_states`
shape, re-asserts `supabase_auth_admin` ownership and grants, and ends with a probe insert
executed **as `supabase_auth_admin`** so it fails loudly rather than half-fixing things.

Every statement is idempotent and safe on an already-correct database.

Two deliberate design notes:

- **It does not touch `auth.schema_migrations`.** If GoTrue later decides to run
  `20260115000000` itself, that upstream migration is idempotent and will succeed against
  the repaired table. Hand-editing the migrations ledger risks desyncing GoTrue's migrator
  permanently — don't.
- **It does not change the frontend.** Switching `flowType` to `'pkce'` in
  `src/integrations/supabase/client.ts` would also populate the three NOT-NULL columns and
  might appear to fix this, but it does **not** help if the five new columns are missing
  (the far more likely state), and it breaks cross-device password-reset links, since PKCE
  requires the `code_verifier` from the originating browser's localStorage. Do not make
  this change as a workaround.

---

## 4. Work already completed

- Root-caused from the GoTrue v2.186.0 source (`internal/api/external.go`,
  `internal/models/flow_state.go`, `internal/api/provider/azure.go`) and the upstream
  migration files at that exact tag.
- Wrote `supabase/migrations/20260729000000_repair_auth_flow_state.sql`.
- **Verified the migration against a local PostgreSQL 16 instance**, not just by
  inspection: built the stale pre-`20260115000000` schema owned by the wrong role,
  reproduced the insert failure (`column "email_optional" of relation "flow_state" does not
  exist`), applied the repair, and confirmed afterwards that all 17 columns match upstream
  with correct nullability, ownership is `supabase_auth_admin`, and both implicit-flow and
  PKCE-flow inserts succeed. Re-ran it to confirm idempotency.
- Documented the symptom, log-based diagnosis and fix in `docs/deployment.md`
  ("OAuth sign-in fails with `Error creating flow state`").
- Recorded the incident in `AGENTS.md` under Critical incidents, with the recurrence rule:
  after any `auth` schema restore, re-run this repair and test a real Microsoft sign-in.
- Pushed to `main` as `d6fb85b`. (The commit shows as Unverified on GitHub — the sandbox
  had no usable SSH signing key. Content is unaffected.)

---

## 5. What is left for you to do

### Step 1 — Confirm the diagnosis before changing anything

Pull the repo first so you have the migration file:

```bash
git -C <repo> pull origin main   # need d6fb85b
```

Find the internal error behind her `error_id`. GoTrue logs the real database error; the
HTTP response deliberately hides it:

```bash
docker logs supabase-auth-lc7f483hklyq89eej67idpbx 2>&1 \
  | grep -A5 '2b6e0a26-5e79-4bcf-8e4a-e7d1744b31f7'
```

If the log has rotated past it, trigger a fresh one — this is a public endpoint and a
failed call is harmless:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://api.comp.designflow.app/auth/v1/authorize?provider=azure&redirect_to=https://comp.designflow.app"
```

`302` means OAuth start is healthy (and you should re-open the diagnosis — see Step 5).
`500` reproduces the bug; grab the new `error_id` from the body and grep for it.

Then inspect the table directly:

```bash
docker exec -it supabase-db-lc7f483hklyq89eej67idpbx psql -U postgres -d postgres -c \
  "SELECT column_name, is_nullable FROM information_schema.columns
   WHERE table_schema='auth' AND table_name='flow_state' ORDER BY ordinal_position;"

docker exec -it supabase-db-lc7f483hklyq89eej67idpbx psql -U postgres -d postgres -c \
  "SELECT tablename, tableowner FROM pg_tables WHERE schemaname='auth' AND tablename IN ('flow_state','oauth_client_states');"
```

Diagnosis is **confirmed** if any of these hold:

| Observation | Meaning |
|---|---|
| `email_optional` / `referrer` / `invite_token` / `oauth_client_state_id` / `linking_target_id` absent | Migration `20260115000000` never applied — primary hypothesis |
| `auth_code`, `code_challenge` or `code_challenge_method` shows `is_nullable = NO` | Not-null half missing — implicit flow cannot insert |
| `flow_state` owner is not `supabase_auth_admin` | Permission variant |
| Log shows `permission denied for table flow_state` | Permission variant |
| `oauth_client_states` missing entirely | Auth schema is stale generally |

If the log instead shows something unrelated — disk full, connection refused, a
constraint on a different table — **stop and re-diagnose.** Report what you found rather
than applying a fix that doesn't match.

### Step 2 — Apply the repair

Migrations here are **not** applied on deploy; this is manual (`docs/deployment.md`).

```bash
docker exec -i supabase-db-lc7f483hklyq89eej67idpbx \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/migrations/20260729000000_repair_auth_flow_state.sql
```

Expected tail: `NOTICE: auth.flow_state accepts implicit-flow OAuth rows as supabase_auth_admin`.
`NOTICE: ... already exists, skipping` lines are normal and expected.

If the closing probe **errors**, the repair did not land — that is the migration doing its
job. Capture the error and stop.

### Step 3 — Restart auth

Required: GoTrue caches prepared statements and will keep failing against the repaired
table until it reconnects.

```bash
docker restart supabase-auth-lc7f483hklyq89eej67idpbx
docker logs --tail 50 supabase-auth-lc7f483hklyq89eej67idpbx
```

Watch startup for migration errors. GoTrue may now run `20260115000000` itself; it is
idempotent against the repaired table and should succeed.

### Step 4 — Verify

```bash
# 17 columns, correct nullability
docker exec -it supabase-db-lc7f483hklyq89eej67idpbx psql -U postgres -d postgres -c \
  "SELECT column_name, is_nullable FROM information_schema.columns
   WHERE table_schema='auth' AND table_name='flow_state' ORDER BY ordinal_position;"

# both providers must now 302 to their identity provider
for p in azure google; do
  echo -n "$p: "
  curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' \
    "https://api.comp.designflow.app/auth/v1/authorize?provider=$p&redirect_to=https://comp.designflow.app"
done
```

Expect `302` to `login.microsoftonline.com` and `accounts.google.com` respectively. Each
successful probe writes a throwaway `flow_state` row; GoTrue expires them, no cleanup needed.

**Then complete a real end-to-end sign-in in a browser** at
`https://comp.designflow.app` — the probes only prove the `/authorize` half. The callback,
`handle_new_user()` trigger and the CompShop approval gate all run afterwards.

Finally, confirm with Elizabeth directly. If she now reaches the app but is told she is
awaiting approval, that is a *different, expected* gate — see
`supabase/migrations/20260613000000_auth_access_approval.sql`; her profile needs
`approval_status = 'approved'`, via an admin in the app or `public.approve_user(<uuid>)`.
Don't mistake that for the bug returning.

### Step 5 — If `/authorize` already returns 302

Then this specific failure has self-resolved (e.g. someone restarted auth and GoTrue
applied its migrations). Still apply the repair — it is a no-op on a correct schema and it
closes the permission/ownership variant. Then hunt the actual failure at
`/auth/v1/callback` instead: reproduce a real sign-in and read
`docker logs supabase-auth-lc7f483hklyq89eej67idpbx` during it.

### Step 6 — Report back

Post the confirming log line, the before/after column listing, and the result of the real
browser sign-in. If the diagnosis turned out to be wrong, say so plainly and describe what
you actually found — the repo-side write-up in `AGENTS.md` and `docs/deployment.md` will
need correcting.

---

## 6. Reference

| Thing | Value |
|---|---|
| Auth container | `supabase-auth-lc7f483hklyq89eej67idpbx` (`supabase/gotrue:v2.186.0`) |
| DB container | `supabase-db-lc7f483hklyq89eej67idpbx` (`supabase/postgres:15.8.1.085`) |
| Supabase service | `lc7f483hklyq89eej67idpbx` (Coolify: `supabase-compshop`) |
| Public API | `https://api.comp.designflow.app` |
| Frontend | `https://comp.designflow.app` |
| Repair migration | `supabase/migrations/20260729000000_repair_auth_flow_state.sql` |
| Reported `error_id` | `2b6e0a26-5e79-4bcf-8e4a-e7d1744b31f7` |

**Scope discipline:** this is a database-shape repair. It needs no frontend change, no
Coolify redeploy, no env var change, and no change to the Azure app registration. If you
find yourself editing `src/`, re-read section 3 — you have probably found a different
problem, and it should be handled as such rather than folded into this one.

Delete this file once production is verified fixed.
