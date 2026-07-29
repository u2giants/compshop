-- Repair auth.flow_state so GoTrue v2.186.0 can start OAuth sign-ins.
--
-- Symptom:
--   Clicking "Continue with Microsoft" (or Google) lands on
--   https://api.comp.designflow.app/auth/v1/authorize?... and renders raw JSON:
--     {"code":500,"error_code":"unexpected_failure","msg":"Error creating flow state",...}
--   Email/password sign-in keeps working.
--
-- Cause:
--   GoTrue v2.186.0 creates a row in auth.flow_state for EVERY OAuth sign-in --
--   PKCE and implicit alike -- and uses that row id as the OAuth `state` parameter
--   (internal/api/external.go, "Always create flow state for all flows"). The insert
--   writes columns added by GoTrue migration 20260115000000 and writes NULL into
--   auth_code / code_challenge / code_challenge_method for implicit-flow logins,
--   which the same migration made nullable.
--
--   If auth.flow_state is still on the pre-20260115000000 shape -- which is what an
--   auth-schema restore from the older stack leaves behind, since auth.schema_migrations
--   comes back marked as applied and GoTrue then skips the migration on boot -- the
--   insert fails and GoTrue returns "Error creating flow state" for every OAuth attempt.
--
-- This migration re-applies the upstream shape idempotently and re-asserts ownership
-- and grants for supabase_auth_admin, which a restore can also leave pointing at the
-- wrong role. It is safe to run on an already-correct database: every statement is a
-- no-op there, and GoTrue's own migrator can still run 20260115000000 afterwards
-- because that migration is itself idempotent.
--
-- Run as postgres/supabase_admin against the production DB, then restart the auth
-- container so GoTrue reloads its prepared statements:
--   docker restart supabase-auth-lc7f483hklyq89eej67idpbx
--
-- Verification query is at the bottom of this file.

-- 1. Enum used by flow_state.code_challenge_method (GoTrue 20230322519590).
DO $$
BEGIN
  CREATE TYPE auth.code_challenge_method AS ENUM ('s256', 'plain');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- 2. Base table (GoTrue 20230322519590 / 20230402418590 / 20240306115329).
CREATE TABLE IF NOT EXISTS auth.flow_state (
  id uuid PRIMARY KEY,
  user_id uuid NULL,
  auth_code text NULL,
  code_challenge_method auth.code_challenge_method NULL,
  code_challenge text NULL,
  provider_type text NOT NULL,
  provider_access_token text NULL,
  provider_refresh_token text NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL
);

ALTER TABLE auth.flow_state
  ADD COLUMN IF NOT EXISTS authentication_method text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS auth_code_issued_at timestamptz NULL;

-- Upstream declares authentication_method without a default; GoTrue always supplies it.
-- The default above only exists so ADD COLUMN succeeds on a table with existing rows.
ALTER TABLE auth.flow_state ALTER COLUMN authentication_method DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_auth_code ON auth.flow_state (auth_code);
CREATE INDEX IF NOT EXISTS idx_user_id_auth_method ON auth.flow_state (user_id, authentication_method);

-- 3. OAuth context columns (GoTrue 20260115000000). These are the columns the
--    v2.186.0 insert writes and a stale auth schema does not have.
ALTER TABLE auth.flow_state
  ADD COLUMN IF NOT EXISTS invite_token text NULL,
  ADD COLUMN IF NOT EXISTS referrer text NULL,
  ADD COLUMN IF NOT EXISTS oauth_client_state_id uuid NULL,
  ADD COLUMN IF NOT EXISTS linking_target_id uuid NULL,
  ADD COLUMN IF NOT EXISTS email_optional boolean NOT NULL DEFAULT false;

-- 4. Implicit-flow logins insert NULL here. This is the constraint that turns a
--    normal "Continue with Microsoft" click into a 500.
ALTER TABLE auth.flow_state
  ALTER COLUMN auth_code DROP NOT NULL,
  ALTER COLUMN code_challenge DROP NOT NULL,
  ALTER COLUMN code_challenge_method DROP NOT NULL;

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';

-- 5. Companion table for providers that require PKCE on their own end
--    (GoTrue 20251201000000). Azure does not use it, Google/others may.
CREATE TABLE IF NOT EXISTS auth.oauth_client_states (
  id uuid PRIMARY KEY,
  provider_type text NOT NULL,
  code_verifier text,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_client_states_created_at
  ON auth.oauth_client_states (created_at);

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';

-- 6. GoTrue connects as supabase_auth_admin. A restored auth schema can come back
--    owned by postgres, which fails the same insert with "permission denied".
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    EXECUTE 'ALTER TABLE auth.flow_state OWNER TO supabase_auth_admin';
    EXECUTE 'ALTER TABLE auth.oauth_client_states OWNER TO supabase_auth_admin';
    EXECUTE 'ALTER TYPE auth.code_challenge_method OWNER TO supabase_auth_admin';
    EXECUTE 'GRANT USAGE ON SCHEMA auth TO supabase_auth_admin';
    EXECUTE 'GRANT ALL ON TABLE auth.flow_state TO supabase_auth_admin';
    EXECUTE 'GRANT ALL ON TABLE auth.oauth_client_states TO supabase_auth_admin';
  END IF;
END
$$;

-- 7. Fail loudly if GoTrue's own role still cannot insert the row it inserts on
--    every OAuth click, so the operator does not walk away thinking the repair
--    landed when it did not.
DO $$
DECLARE
  probe_id uuid := gen_random_uuid();
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    SET LOCAL ROLE supabase_auth_admin;
  END IF;

  INSERT INTO auth.flow_state (
    id, provider_type, authentication_method, email_optional, created_at, updated_at
  )
  VALUES (probe_id, 'azure', 'oauth', false, now(), now());

  DELETE FROM auth.flow_state WHERE id = probe_id;

  RESET ROLE;

  RAISE NOTICE 'auth.flow_state accepts implicit-flow OAuth rows as supabase_auth_admin';
END
$$;

-- Verification (run separately after the migration):
--
--   SELECT column_name, is_nullable, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'auth' AND table_name = 'flow_state'
--   ORDER BY ordinal_position;
--
-- Expect auth_code, code_challenge and code_challenge_method to be nullable, and
-- invite_token, referrer, oauth_client_state_id, linking_target_id, email_optional
-- to be present.
--
--   SELECT tableowner FROM pg_tables
--   WHERE schemaname = 'auth' AND tablename = 'flow_state';
--
-- Expect supabase_auth_admin.
