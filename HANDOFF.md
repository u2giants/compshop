# HANDOFF — July 29 CompShop production outage and stale-data discovery (2026-07-29)

## 1. What this application is

CompShop is POP Creations' comparison-shopping photo app. Buyers use its installed
Progressive Web App (PWA) during store visits and sourcing trips to make store/trip cards,
take photos, annotate products, and work when the network is weak.

- Repository: `https://github.com/u2giants/compshop`
- Local checkout used this session: `/root/compshop-review`
- Branch policy: `main` only
- Frontend: React + TypeScript PWA at `https://comp.designflow.app`
- Public Supabase API: `https://api.comp.designflow.app`
- Production host: SSH alias `comp`, Hostdare/Hong Kong VPS
- Coolify service: `supabase-compshop`, UUID `lc7f483hklyq89eej67idpbx`
- Frontend container: `frontend-uuid-comp-shop-prod-2026`
- Production DB container: `supabase-db-lc7f483hklyq89eej67idpbx`
- Production DB volume: `lc7f483hklyq89eej67idpbx_supabase-db-data`

## 2. What we set out to do this session, and why

Elizabeth Parkin reported that Microsoft sign-in returned HTTP 500 with GoTrue's public
message `Error creating flow state`. The prior handoff predicted a stale
`auth.flow_state` table and supplied
`supabase/migrations/20260729000000_repair_auth_flow_state.sql`, but explicitly required
reading the live GoTrue error before applying it.

The live log contradicted that prediction. The real incident expanded into:

1. restore a missing production database container and other containers removed by a
   failed Coolify run;
2. verify Microsoft and Google OAuth;
3. investigate why production data stops in mid-May even though users had newer cards;
4. attempt to preserve newer cards still visible in user `jchaffier`'s installed PWA;
5. remove the temporary recovery feature when Albert chose to stop recovery work.

## 3. Current state — what is true right now

### Production services

- Microsoft OAuth returns `302` to `login.microsoftonline.com`.
- Google OAuth returns `302` to `accounts.google.com`.
- Elizabeth confirmed she can sign in.
- `https://comp.designflow.app` returns HTTP 200.
- `https://api.comp.designflow.app/storage/v1/status` returns HTTP 200.
- Database, MinIO, imgproxy, analytics, vector, auth, REST, storage, and realtime are
  running. DB, MinIO, imgproxy, analytics, vector, and auth show healthy where they have
  Docker health checks.
- Root disk is 71% used: 66 GB of 99 GB, 28 GB free.

### Data actually in production

The current production DB and every server-side copy examined contain only:

| Table | Rows | Newest record |
|---|---:|---|
| `public.shopping_trips` | 72 | created 2026-05-14 16:07 UTC |
| `public.china_trips` | 92 | created 2026-04-30 03:35 UTC |
| `public.photos` | 420 | created 2026-05-14 16:09 UTC |
| `public.china_photos` | 546 | created 2026-04-30 03:35 UTC |

The newest active domestic trip date is 2026-05-13. This is not a UI filter problem;
the newer rows do not exist in the restored server DB.

User `jchaffier` still showed local cards in the installed PWA after the server restore.
A photo supplied in chat showed:

- Walmart, July 28, 2026, 15 photos;
- Burlington, July 28, 2026, 0 photos;
- Dollar Tree, July 28, 2026, 0 photos.

Those rows are not in production. `src/pages/NewTrip.tsx:102-145` explains how a trip can
be saved to IndexedDB as `pending_trips` after an eight-second network timeout.
`src/lib/offline-db.ts` stores cached trips, photo metadata, local image blobs, pending
trips, and pending uploads. `src/lib/sync-service.ts:158-201` later tries to send pending
trips.

Albert decided on 2026-07-29 to stop the device recovery attempt and accept the lost
data. Do not restart recovery work unless he explicitly changes that decision.

### Code, GitHub, and deploy state

- Branch: `main`
- Current commit: `71b1669235e17121e0b2596c571d8796d1e05fde`
- GitHub Actions run `30468629750`: success
- Live frontend build stamp: `Commit 71b1669`
- The temporary local-recovery screen from commit `4222162` was completely removed by
  commits `0f9d5b2` and `71b1669`.
- The source tree is back to its pre-recovery-feature state.
- The auth repair migration remains checked in but was **not** applied to production,
  because the table was already correct and the live error had another cause.

### Unfinished production drift

The production service is usable, but four live containers are outside Docker Compose
tracking because they have no `com.docker.compose.project` label:

- `realtime-dev-lc7f483hklyq89eej67idpbx`
- `supabase-kong-lc7f483hklyq89eej67idpbx`
- `supabase-storage-lc7f483hklyq89eej67idpbx`
- `supabase-rest-lc7f483hklyq89eej67idpbx`

This drift caused the July 28 Coolify run to fail on a container-name conflict. A future
full Coolify service deploy can fail again and can remove tracked containers before it
hits the conflict. This is the main unresolved engineering risk.

## 4. Everything we tried that did NOT work

### Applying the predicted `auth.flow_state` repair

It was not attempted, by design. A fresh Azure `/authorize` request returned HTTP 500
with error ID `a9021222-a12a-4a2e-b9e9-67bd48f60e0e`. The matching GoTrue log said:

`lookup supabase-db on 127.0.0.11:53: no such host`

The log did not mention `flow_state` columns, null constraints, or permissions. Applying
the migration would have ignored the actual outage and could not run while the DB
container was absent.

### Looking only on the usual Hetzner VPS

SSH alias `vps` reaches `178.156.180.212`, but CompShop production is on the Hostdare
server reached by SSH alias `comp` (`100.127.128.110` over Tailscale; public app IP
`185.194.148.230`). The Hetzner server correctly had none of the CompShop containers.

### Treating the July 28 SQL dump as a newer recovery source

`/opt/backrest/db-dumps/compshop-supabase-20260728_150000.sql` looked promising because it
was made before the outage. Direct inspection of its PostgreSQL `COPY` blocks showed the
same 72 domestic and 92 Asia trips, with the same May/April newest timestamps. It was
already stale.

### Treating the pre-outage Docker-volume snapshot as a newer recovery source

Backrest/restic snapshot `3a2e95e3` was taken at 2026-07-28 15:05 EDT, about two minutes
before the failed Coolify operation. It was restored to an isolated temporary Postgres
container. It also had exactly 72 domestic trips, 92 Asia trips, 420 domestic photos, and
546 Asia photos with the same May/April cutoffs. The temporary container and restored
files were deleted after the audit.

### Checking the historical rescue database

`compshop-old-db-rescue` and volume `h8nwhgk682eedokx8nh2eg1q_db-data` contain the same
stale rows and timestamps. They are not the missing newer database.

### Assuming Lovable Cloud held the missing rows

That was an incorrect lead. CompShop has long been off Lovable. The old project URL still
responds, but its saved test login is invalid and anonymous REST access returns no rows.
More importantly, the verified operating history and Albert's correction make it the
wrong recovery source. Do not repeat this assumption.

### Updating the installed iPhone PWA

A temporary recovery screen was built, tested, deployed at commit `4222162`, and added to
Profile for all approved users. User `jchaffier` never received that build:

- closing and reopening the PWA did not update it;
- waiting between launches did not update it;
- restarting the iPhone did not update it;
- the global build stamp and recovery link never appeared.

CompShop's service worker uses `registerType: "autoUpdate"`, `clientsClaim: true`, and
`skipWaiting: true` in `vite.config.ts`, but this installed PWA remained pinned to an old
cached shell. Albert stated that users previously had to uninstall/reinstall the PWA to
receive updates. Uninstalling was rejected because it would likely erase the only local
copy of the missing cards and photo blobs.

### Temporary recovery feature

The feature could read all IndexedDB stores and upload a protected manifest plus local
blobs under the authenticated user's `photos` bucket prefix. It passed eight tests and a
production build. It was never seen or used on `jchaffier`'s phone. Albert then asked to
remove it. It is no longer in the code or live app.

## 5. Root causes and key findings

### OAuth outage root cause

At 2026-07-28 19:07 UTC, Coolify activity log entry `155` attempted to recreate the
Supabase service. It recreated/removes several core containers, then failed because
`supabase-rest-lc7f483hklyq89eej67idpbx` already existed without normal Compose labels:

`Conflict. The container name "/supabase-rest-lc7f483hklyq89eej67idpbx" is already in use`

The failed operation did not roll back. It left the production DB, MinIO, imgproxy,
analytics, and vector containers absent. GoTrue stayed running and reported a misleading
public `Error creating flow state` because it could not resolve the missing DB hostname.
PostgREST and realtime logged the same `supabase-db` DNS failure.

Recovery performed this session:

1. Recreated only `supabase-db` from the saved Coolify Compose file with `--no-deps`,
   preserving named volume `lc7f483hklyq89eej67idpbx_supabase-db-data`.
2. Verified the DB healthy.
3. Recreated missing imgproxy, vector, analytics, and MinIO services individually.
4. Pulled and ran the MinIO one-time `minio-createbucket` helper successfully.
5. Verified Microsoft and Google OAuth redirects, frontend, storage, and table shape.

### Auth schema finding

`auth.flow_state` already has all 17 expected columns. `auth_code`,
`code_challenge_method`, and `code_challenge` are nullable. `flow_state` and
`oauth_client_states` are owned by `supabase_auth_admin`. The schema repair migration was
not needed for this incident.

### Missing-data finding

The May cutoff predates this session and predates the July 28 outage. The live volume,
the old rescue volume, the July 28 SQL dump, and the 15:05 raw-volume snapshot all have
the same cutoff. Yet an installed PWA held July 28 cards, proving device-local state can
be newer than every server copy. The exact history of the missing server DB or why months
of device-local work never reached the surviving volume remains unknown.

### PWA update finding

The installed iPhone PWA can remain on an old cached shell despite forced close/reopen,
time online, and phone restart. Do not use uninstall/reinstall as an update fix while
unsynced IndexedDB data may exist. Uninstall can destroy that data.

## 6. Exact next steps

Albert chose to stop data recovery. The only active engineering follow-up is preventing
another failed Coolify service run.

1. **Do not trigger a full Supabase Coolify deploy yet.** First record current container
   names, images, networks, mounts, environment hashes, health, and Compose labels for
   every `lc7f483hklyq89eej67idpbx` container. Verification gate: a saved audit identifies
   which containers are Compose-tracked and which four are not, without printing secret
   environment values.

2. **Read the saved service definition and Coolify resource state.** Compare
   `/data/coolify/services/lc7f483hklyq89eej67idpbx/docker-compose.yml` with live
   containers. Determine why REST, storage, realtime, and Kong lost Compose labels.
   Verification gate: the cause is backed by Coolify activity history and Docker
   inspection, not inference alone.

3. **Write a zero-data-loss reconciliation plan before changing containers.** The plan
   must preserve named DB and MinIO volumes, retain the current public proxy path, define
   the exact stop/remove/recreate order for only the four untracked containers, and
   include rollback commands. Verification gate: another developer can review the exact
   container targets and volume mounts before execution.

4. **Get Albert's explicit approval for the exact production reconciliation.** Production
   is read-only by default. Verification gate: the current chat names the four exact
   containers and approved actions.

5. **After approval, reconcile one service at a time.** Start with a non-routing
   dependency if possible; leave Kong until the backend services are verified.
   Verification gate after each container: expected Compose labels exist, health/logs are
   clean, and its public or internal endpoint works.

6. **Run a dry full-service validation without destructive flags.** Confirm
   `docker compose ... config` is valid and `docker compose ... ps -a` recognizes every
   live service. Verification gate: no `Creating` action would collide with an existing
   untracked name.

7. **Verify production end to end.** Require frontend HTTP 200, storage status 200,
   database row counts unchanged, Azure and Google `/authorize` returning 302, and a real
   browser sign-in. Verification gate: all checks pass and the counts remain 72/92/420/546
   unless Albert separately authorizes data recovery.

8. **Only if Albert reverses the July 29 decision, restart device recovery.** Preserve the
   iPhone PWA installation and use Safari Web Inspector from a connected Mac to export
   IndexedDB before any reinstall. Verification gate: local records and blobs exist in a
   second verified location before touching the PWA.

## 7. Constraints and gotchas in force

- `main` only for this `u2giants` app repository.
- Git author must be `Albert Hazan <u2giants@users.noreply.github.com>`.
- Production/shared infrastructure is read-only unless Albert explicitly approves the
  exact mutation in the current chat.
- Never run `docker compose down -v`; it can remove the DB and MinIO named volumes.
- Never remove or recreate a production container until its mounts, networks, image,
  labels, and rollback path are recorded.
- Do not apply `20260729000000_repair_auth_flow_state.sql` merely because the public error
  says `Error creating flow state`; always read the matching GoTrue internal error first.
- Do not uninstall `jchaffier`'s PWA if recovery is resumed before IndexedDB is exported.
- Do not assume cached cards equal server rows. The UI can show IndexedDB data that the
  server has never received or no longer has.
- The temporary recovery feature is intentionally removed. Do not quietly reintroduce it
  after Albert's 2026-07-29 decision.
- Backrest raw Docker-volume snapshots of a running Postgres instance are not a substitute
  for a verified logical DB dump. This session used one only in an isolated audit copy.

## 8. Access and environment

- GitHub CLI `gh` is authenticated for `u2giants/compshop`.
- SSH alias `comp` works as root through key `/root/.ssh/916-alien`.
- SSH alias `vps` is the separate Hetzner host and is not CompShop production.
- Docker access on `comp` is available directly.
- Coolify internal Postgres can be read with:
  `docker exec coolify-db psql -U coolify -d coolify`
- Backrest container is named `backrest`; restic binary is `/bin/restic`.
- Backrest config is `/opt/backrest/config/config.json`; never print repository passwords
  or S3 keys from it.
- Durable secrets belong in 1Password vault `vibe_coding`.
- 1Password CLI `op` is authenticated with service-account access to `vibe_coding`.
- Production URLs: frontend `https://comp.designflow.app`, API
  `https://api.comp.designflow.app`, Coolify `https://coolify.comp.designflow.app`.
- No new credentials were created or changed this session.

## 9. Open questions and risks

- Why four core containers lost Compose project labels is not yet proven.
- A future full Coolify service deploy is likely to hit the same container-name conflict
  and can again leave core services absent.
- The server-side location of post-May work is unknown. Every known DB/backup copy is
  stale, while at least one PWA held newer local state.
- The installed PWA update mechanism is unreliable on at least `jchaffier`'s iPhone.
- Device-local data may disappear if the PWA is uninstalled, Safari site data is cleared,
  or iOS evicts storage.
- Albert accepted the missing-data loss on 2026-07-29. That is a business decision, not
  proof the data is unrecoverable.

## Handoff self-audit

1. **Could a street-new developer continue without asking a question? Yes.** Sections 1
   and 8 define the app, repo, hosts, identifiers, URLs, access, and secret locations.
   Sections 3 and 6 state the current state and executable next steps.
2. **Could they continue as effectively as this session? Yes.** Sections 4 and 5 preserve
   the failed hypotheses, exact live error, Coolify failure, backup/snapshot findings,
   data counts, PWA behavior, and recovery decisions.
3. **Are failed attempts included with why they failed? Yes.** Section 4 covers the auth
   migration hypothesis, wrong server, SQL dump, raw snapshot, rescue DB, Lovable lead,
   stuck PWA update, and removed temporary feature.
4. **Is every next step concrete and verifiable? Yes.** Every numbered item in Section 6
   ends with an explicit verification gate.
5. **Are unfamiliar terms, paths, IDs, and URLs explained? Yes.** Sections 1, 3, 7, and 8
   define the PWA, Coolify service, containers, volumes, branches, paths, and endpoints.

Final synthesis:

1. **Is `HANDOFF.md` comprehensive enough for a brand-new developer to continue without
   missing a beat? Yes.** Supported by Sections 1 through 9 and the five evidence checks
   above; no gap remains.
2. **Can that developer continue as well as this session could right now? Yes.** Sections
   3 through 6 contain all observed evidence, decisions, failed work, and ordered gates;
   no gap remains.
3. **Is every relevant background, goal, state, failure, decision, constraint, risk, next
   action, and verification result present? Yes.** Sections 2 through 9 cover each required
   category; no gap remains.
