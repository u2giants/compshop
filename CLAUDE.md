# CompShop — AI Session Guide

## What is this project?

CompShop is a React + TypeScript PWA for managing wholesale shopping trips in China/Hong Kong. Teams use it to photograph and annotate products, track prices, and collaborate in real-time. It uses Supabase (auth, database, realtime, storage, edge functions) as the backend.

## Key files to understand first

| File | Purpose |
|---|---|
| `src/integrations/supabase/client.ts` | Supabase client init — reads `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` from env |
| `src/integrations/supabase/types.ts` | Auto-generated DB types from schema |
| `src/contexts/AuthContext.tsx` | Auth state management |
| `src/pages/Auth.tsx` | Sign-in page — uses direct `supabase.auth.signInWithOAuth` |
| `supabase/migrations/` | 29 SQL migrations defining the full schema |
| `supabase/functions/` | 5 Deno edge functions |
| `selfhost.md` | **Complete runbook for migrating off Lovable Cloud → self-hosted Coolify VPS** |

## Current deployment status

The app currently runs on **Lovable Cloud** (frontend + Supabase backend at `aqbyrzknbhyshjzlfsyv.supabase.co`). A migration to a self-hosted Coolify VPS in Hong Kong is planned — see `selfhost.md` for the full runbook.

## Development setup

```bash
# Install dependencies
npm install

# Start local Supabase stack (Postgres, GoTrue, Storage, Edge Functions, Studio)
supabase start

# Create .env.local pointing at local Supabase (don't edit .env — that's Lovable Cloud)
# VITE_SUPABASE_URL=http://127.0.0.1:54321
# VITE_SUPABASE_PUBLISHABLE_KEY=<local anon key from supabase start output>

# Start dev server
npm run dev

# Apply all migrations to local DB
supabase db reset

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
| `VITE_SUPABASE_URL` | Frontend | Set in `.env` (Lovable Cloud) or `.env.local` (local dev) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend | Anon key |
| `VITE_SUPABASE_PROJECT_ID` | Frontend | Used for config.toml linking |
| `GEMINI_API_KEY` | Edge functions | Google AI Studio key |
| `GOOGLE_MAPS_API_KEY` | Edge functions | For reverse-geocode + nearby-stores |
| `BREVO_API_KEY` | Edge functions | For send-invite-email |

## Ops reference

For server provisioning, deployment, database migration, storage migration, and ongoing ops — see **`selfhost.md`**. It is the authoritative runbook for this application's infrastructure.
