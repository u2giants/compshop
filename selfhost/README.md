# CompShop self-hosting kit

Everything you need to migrate CompShop from Lovable Cloud to a self-hosted
Supabase + frontend on your Coolify VPS.

**You should never need to touch the terminal directly. The runbook tells you
exactly what to click in Coolify and what to copy-paste.**

## What's in this folder

```
selfhost/
├── README.md                  ← you are here
├── runbook.md                 ← step-by-step Coolify clicks (start here)
├── compose.supabase.yml       ← Docker Compose for self-hosted Supabase
├── Dockerfile.frontend        ← builds the React app into an Nginx container
├── nginx.conf                 ← SPA routing + cache headers
├── .env.example               ← every env var with explanations
├── .env.frontend.example      ← frontend build-time env vars
└── scripts/
    ├── 01-export-schema.sh    ← copies the 30 DB migrations
    ├── 02-export-data.sh      ← exports table rows from Lovable Cloud
    ├── 03-export-storage.sh   ← downloads photos + retailer-logos buckets
    ├── 04-export-auth-users.sh← exports users + Google OAuth identities
    ├── 05-import-all.sh       ← runs everything against your new DB
    └── 06-incremental-sync.sh ← copies rows changed since timestamp
```

## High-level migration timeline

1. **DNS** — add A records for `comp`, `api.comp`, `db.comp`, `comp-staging` (5 min, then wait for propagation)
2. **Coolify** — create `compshop` project, deploy Supabase stack from `compose.supabase.yml` (~30 min)
3. **Migrate data** — run scripts 01-04 once, then 05 once (~1-3 hours depending on photo bucket size)
4. **Test on staging** — `comp-staging.designflow.app` runs the new backend; team verifies (1-2 days)
5. **Cutover** — run script 06 (incremental sync), then point `comp.designflow.app` at the new frontend
6. **Decommission Lovable Cloud** — after 2 weeks of stable self-hosting

Open `runbook.md` for the actual instructions.
