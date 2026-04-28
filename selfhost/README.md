# CompShop self-hosting kit

This folder contains everything needed to run CompShop on a self-hosted Coolify VPS.
**The migration from Lovable Cloud is complete** — the production instance is live at
`https://comp.designflow.app`.

## Files

```
selfhost/
├── compose.supabase.yml       ← Docker Compose for the Supabase stack (authoritative)
├── Dockerfile.frontend        ← Builds the React app into an Nginx container
├── nginx.conf                 ← SPA routing + asset cache headers
├── .env.example               ← Every env var with explanations (set these in Coolify)
├── .env.frontend.example      ← Frontend build-time env vars (VITE_*)
└── scripts/
    ├── 01-export-schema.sh    ← Bundles migrations into a single bootstrap SQL
    ├── 02-export-data.sh      ← Exports table rows from the old Lovable Cloud DB
    ├── 03-export-storage.sh   ← Downloads photo + retailer-logos buckets
    ├── 04-export-auth-users.sh← Exports users + Google OAuth identities
    ├── 05-import-all.sh       ← Imports everything into the new DB
    └── 06-incremental-sync.sh ← Delta export since a given timestamp (used at cutover)
```

`runbook.md` at the root of this folder is the original step-by-step migration guide.
It is preserved as reference but describes a completed one-time process.

## Running in production

See [docs/deployment.md](../docs/deployment.md) for the normal deploy workflow.

The Supabase stack is deployed as Coolify application `h8nwhgk682eedokx8nh2eg1q`. All
runtime env vars are configured in Coolify — use `.env.example` as the reference for
what must be set.

## If you need to re-run the migration

The scripts in `scripts/` require the `LOVABLE_PG_*` and `LOVABLE_SUPABASE_URL` /
`LOVABLE_SERVICE_ROLE_KEY` vars from the old Lovable Cloud project. Copy
`.env.example` and fill in those values before running any script.
