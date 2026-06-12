# CompShop — AI Session Guide

## What is this project?

CompShop is a React + TypeScript PWA for managing wholesale shopping trips in China/Hong Kong. Teams use it to photograph and annotate products, track prices, and collaborate in real-time. It uses Supabase (auth, database, realtime, storage, edge functions) as the backend.

## Key files to understand first

| File | Purpose |
|---|---|
| `src/integrations/supabase/client.ts` | Supabase client init — reads `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` from env |
| `src/integrations/supabase/types.ts` | Auto-generated DB types from schema |
| `src/contexts/AuthContext.tsx` | Auth state management |
| `src/pages/Auth.tsx` | Sign-in page — three login paths: Microsoft/Authentik via Supabase `keycloak` provider, Google OAuth direct, and email/password |
| `supabase/migrations/` | 35 SQL migrations defining the full schema |
| `supabase/functions/` | 7 Deno edge functions |
| `selfhost/` | Docker Compose stack, Dockerfile, nginx config, env examples — see `selfhost/README.md` |

## Current deployment status

The app runs on a **self-hosted Coolify VPS** in Hong Kong (CN2 GIA, 185.194.148.230). The migration from Lovable Cloud is complete. Production URLs:

| URL | Purpose |
|---|---|
| `https://comp.designflow.app` | Frontend |
| `https://api.comp.designflow.app` | Kong API gateway |
| `https://db.comp.designflow.app` | Supabase Studio |
| `https://coolify.comp.designflow.app` | Coolify dashboard |

## Development setup

```bash
# Install dependencies
npm install

# Start dev server (root .env points to Lovable Cloud — usable for local dev)
npm run dev

# To develop against the self-hosted backend instead, create .env.local:
# VITE_SUPABASE_URL=https://api.comp.designflow.app
# VITE_SUPABASE_PUBLISHABLE_KEY=<anon key from Coolify>
# VITE_SUPABASE_PROJECT_ID=selfhosted

# Run tests
npm test
```

## Important rules (from docs/ai-operating-rules.md)

- **Never enable anonymous users** (`ENABLE_ANONYMOUS_USERS=false` always)
- This is an **invite-only** system — `public.is_email_invited()` gates all signups
- All tables have RLS enabled; never disable RLS in migrations
- Role system: `admin`, `user`, `store_readonly`, `china_readonly`
- The `photos` storage bucket is **private** (signed URLs only)
- Edge functions use Gemini API directly (not Lovable's AI gateway)

## Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | Frontend (build-time) | Kong gateway URL, e.g. `https://api.comp.designflow.app` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend (build-time) | Anon key — safe to expose in bundle |
| `VITE_SUPABASE_PROJECT_ID` | Frontend (build-time) | Set to `selfhosted`; used only for storage URL construction |
| `OPENROUTER_API_KEY` | Edge functions | Used by `analyze-photo` and `parse-teams-conversation` |
| `GOOGLE_MAPS_API_KEY` | Edge functions | Used by `reverse-geocode` and `nearby-stores` |
| `BREVO_API_KEY` | Edge functions | Used by `send-invite-email` |

Full env var reference: `selfhost/.env.example` (Supabase stack) and `selfhost/.env.frontend.example` (frontend build args).

## Ops reference

| Doc | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | System design, Kong quirks, data flow |
| [docs/deployment.md](docs/deployment.md) | Deploy workflow, migrations, Coolify settings |
| [docs/configuration.md](docs/configuration.md) | All env vars with explanations |
| [selfhost/README.md](selfhost/README.md) | Self-hosting kit files and ops notes |
