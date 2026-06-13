-- Direct OAuth access control for CompShop.
--
-- Supabase GoTrue can authenticate Microsoft, Google, and email users, but
-- CompShop authorization is decided here: invited/allowlisted users are
-- approved, company Microsoft tenant users can be auto-approved, and unknown
-- OAuth users remain pending until an admin approves them.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'auth_access_status') THEN
    CREATE TYPE public.auth_access_status AS ENUM ('approved', 'pending', 'blocked');
  END IF;
END
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS approval_status public.auth_access_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approval_reason text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auth_provider text,
  ADD COLUMN IF NOT EXISTS auth_provider_id text,
  ADD COLUMN IF NOT EXISTS auth_tenant_id text;

CREATE TABLE IF NOT EXISTS public.auth_access_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type text NOT NULL CHECK (rule_type IN ('email', 'domain', 'microsoft_tenant')),
  value text NOT NULL,
  provider text NOT NULL DEFAULT '*' CHECK (provider IN ('*', 'email', 'google', 'azure', 'microsoft')),
  status public.auth_access_status NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'blocked')),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auth_access_rules ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS auth_access_rules_unique
  ON public.auth_access_rules (rule_type, lower(value), provider);

DROP POLICY IF EXISTS "Admins can view auth access rules" ON public.auth_access_rules;
CREATE POLICY "Admins can view auth access rules"
ON public.auth_access_rules FOR SELECT TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can create auth access rules" ON public.auth_access_rules;
CREATE POLICY "Admins can create auth access rules"
ON public.auth_access_rules FOR INSERT TO authenticated
WITH CHECK (public.is_admin() AND auth.uid() = created_by);

DROP POLICY IF EXISTS "Admins can delete auth access rules" ON public.auth_access_rules;
CREATE POLICY "Admins can delete auth access rules"
ON public.auth_access_rules FOR DELETE TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update auth access rules" ON public.auth_access_rules;
CREATE POLICY "Admins can update auth access rules"
ON public.auth_access_rules FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.auth_provider_matches(_rule_provider text, _provider text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(COALESCE(_rule_provider, '*')) = '*'
    OR lower(COALESCE(_rule_provider, '*')) = lower(COALESCE(_provider, 'email'))
    OR (
      lower(COALESCE(_rule_provider, '*')) = 'microsoft'
      AND lower(COALESCE(_provider, '')) IN ('azure', 'microsoft')
    )
$$;

CREATE OR REPLACE FUNCTION public.auth_user_provider(_app_meta jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(COALESCE(_app_meta ->> 'provider', 'email'))
$$;

CREATE OR REPLACE FUNCTION public.auth_user_tenant_id(_app_meta jsonb, _user_meta jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  issuer text;
  tenant text;
BEGIN
  tenant := COALESCE(
    _user_meta ->> 'tid',
    _user_meta ->> 'tenant_id',
    _user_meta ->> 'tenantId',
    _app_meta ->> 'tid',
    _app_meta ->> 'tenant_id'
  );

  IF tenant IS NOT NULL AND tenant <> '' THEN
    RETURN lower(tenant);
  END IF;

  issuer := COALESCE(_user_meta ->> 'iss', _app_meta ->> 'iss');
  IF issuer IS NULL THEN
    RETURN NULL;
  END IF;

  tenant := substring(issuer from 'login\.microsoftonline\.com/([^/]+)');
  IF tenant IS NULL THEN
    tenant := substring(issuer from 'sts\.windows\.net/([^/]+)');
  END IF;

  RETURN lower(NULLIF(tenant, ''));
END;
$$;

CREATE OR REPLACE FUNCTION public.auth_access_decision(
  _email text,
  _provider text,
  _tenant_id text
)
RETURNS TABLE(status public.auth_access_status, reason text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_email text := lower(trim(COALESCE(_email, '')));
  normalized_provider text := lower(COALESCE(_provider, 'email'));
  normalized_tenant text := lower(NULLIF(trim(COALESCE(_tenant_id, '')), ''));
  email_domain text := lower(split_part(normalized_email, '@', 2));
  matched_status public.auth_access_status;
  matched_rule text;
BEGIN
  SELECT r.status, r.rule_type || ':' || r.value
  INTO matched_status, matched_rule
  FROM public.auth_access_rules r
  WHERE public.auth_provider_matches(r.provider, normalized_provider)
    AND (
      (r.rule_type = 'email' AND lower(r.value) = normalized_email)
      OR (r.rule_type = 'domain' AND lower(r.value) = email_domain)
      OR (
        r.rule_type = 'microsoft_tenant'
        AND normalized_provider IN ('azure', 'microsoft')
        AND lower(r.value) = normalized_tenant
      )
    )
    AND r.status = 'blocked'
  ORDER BY
    CASE r.rule_type WHEN 'email' THEN 1 WHEN 'microsoft_tenant' THEN 2 ELSE 3 END
  LIMIT 1;

  IF matched_status = 'blocked' THEN
    RETURN QUERY SELECT 'blocked'::public.auth_access_status, 'Blocked by access rule ' || matched_rule;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.invitations i WHERE lower(i.email) = normalized_email) THEN
    RETURN QUERY SELECT 'approved'::public.auth_access_status, 'Approved by invitation';
    RETURN;
  END IF;

  SELECT r.status, r.rule_type || ':' || r.value
  INTO matched_status, matched_rule
  FROM public.auth_access_rules r
  WHERE public.auth_provider_matches(r.provider, normalized_provider)
    AND (
      (r.rule_type = 'email' AND lower(r.value) = normalized_email)
      OR (r.rule_type = 'domain' AND lower(r.value) = email_domain)
      OR (
        r.rule_type = 'microsoft_tenant'
        AND normalized_provider IN ('azure', 'microsoft')
        AND lower(r.value) = normalized_tenant
      )
    )
    AND r.status = 'approved'
  ORDER BY
    CASE r.rule_type WHEN 'email' THEN 1 WHEN 'microsoft_tenant' THEN 2 ELSE 3 END
  LIMIT 1;

  IF matched_status = 'approved' THEN
    RETURN QUERY SELECT 'approved'::public.auth_access_status, 'Approved by access rule ' || matched_rule;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'pending'::public.auth_access_status, 'Waiting for admin approval';
END;
$$;

CREATE OR REPLACE FUNCTION public.is_approved_user(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.has_role(_user_id, 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = _user_id
        AND p.approval_status = 'approved'
    ),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.approve_user(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve users';
  END IF;

  UPDATE public.profiles
  SET approval_status = 'approved',
      approval_reason = 'Approved by admin',
      approved_at = now(),
      approved_by = auth.uid()
  WHERE id = _user_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_user_id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_user(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can block users';
  END IF;

  UPDATE public.profiles
  SET approval_status = 'blocked',
      approval_reason = 'Blocked by admin',
      approved_at = NULL,
      approved_by = auth.uid()
  WHERE id = _user_id;

  DELETE FROM public.user_roles
  WHERE user_id = _user_id
    AND role <> 'admin';
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  provider text := public.auth_user_provider(NEW.raw_app_meta_data);
  tenant_id text := public.auth_user_tenant_id(NEW.raw_app_meta_data, NEW.raw_user_meta_data);
  decision public.auth_access_status;
  decision_reason text;
BEGIN
  SELECT d.status, d.reason
  INTO decision, decision_reason
  FROM public.auth_access_decision(NEW.email, provider, tenant_id) d
  LIMIT 1;

  INSERT INTO public.profiles (
    id,
    email,
    display_name,
    avatar_url,
    approval_status,
    approval_reason,
    approved_at,
    auth_provider,
    auth_provider_id,
    auth_tenant_id
  )
  VALUES (
    NEW.id,
    lower(NEW.email),
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data ->> 'avatar_url',
    decision,
    decision_reason,
    CASE WHEN decision = 'approved' THEN now() ELSE NULL END,
    provider,
    COALESCE(NEW.raw_app_meta_data ->> 'provider_id', NEW.raw_user_meta_data ->> 'provider_id', NEW.raw_user_meta_data ->> 'sub'),
    tenant_id
  );

  IF decision = 'approved' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

UPDATE public.profiles p
SET approval_status = 'approved',
    approval_reason = COALESCE(p.approval_reason, 'Approved before access-control migration'),
    approved_at = COALESCE(p.approved_at, now())
WHERE EXISTS (
  SELECT 1
  FROM public.user_roles ur
  WHERE ur.user_id = p.id
    AND ur.role IN ('admin', 'user')
);

DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile or admin" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "All authenticated can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Profiles visible to self approved users and admins" ON public.profiles;
CREATE POLICY "Profiles visible to self approved users and admins"
ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR public.is_approved_user() OR public.is_admin());

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid() AND approval_status <> 'blocked')
WITH CHECK (id = auth.uid() AND approval_status <> 'blocked');

DROP POLICY IF EXISTS "Authenticated users can create trips" ON public.shopping_trips;
CREATE POLICY "Authenticated users can create trips"
ON public.shopping_trips FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by AND public.is_approved_user() AND (NOT public.is_store_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Authenticated users can add themselves as members" ON public.trip_members;
CREATE POLICY "Authenticated users can add themselves as members"
ON public.trip_members FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND public.is_approved_user() AND (NOT public.is_store_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Members can upload photos" ON public.photos;
CREATE POLICY "Members can upload photos"
ON public.photos FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND public.is_approved_user() AND public.is_trip_member(trip_id) AND (NOT public.is_store_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Members can create comments" ON public.comments;
CREATE POLICY "Members can create comments"
ON public.comments FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND public.is_approved_user()
  AND EXISTS (SELECT 1 FROM public.photos p WHERE p.id = comments.photo_id AND public.is_trip_member(p.trip_id))
  AND (NOT public.is_store_readonly() OR public.is_admin())
);

DROP POLICY IF EXISTS "Members can create annotations" ON public.photo_annotations;
CREATE POLICY "Members can create annotations"
ON public.photo_annotations FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = created_by
  AND public.is_approved_user()
  AND EXISTS (SELECT 1 FROM public.photos p WHERE p.id = photo_annotations.photo_id AND public.is_trip_member(p.trip_id))
  AND (NOT public.is_store_readonly() OR public.is_admin())
);

DROP POLICY IF EXISTS "Authenticated users can upload photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'photos' AND auth.uid()::text = (storage.foldername(name))[1] AND public.is_approved_user());

DROP POLICY IF EXISTS "All authenticated can view china trips" ON public.china_trips;
CREATE POLICY "All authenticated can view china trips"
ON public.china_trips FOR SELECT TO authenticated
USING (public.is_approved_user());

DROP POLICY IF EXISTS "Authenticated users can create china trips" ON public.china_trips;
CREATE POLICY "Authenticated users can create china trips"
ON public.china_trips FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by AND public.is_approved_user() AND (NOT public.is_china_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "All authenticated can view china trip members" ON public.china_trip_members;
CREATE POLICY "All authenticated can view china trip members"
ON public.china_trip_members FOR SELECT TO authenticated
USING (public.is_approved_user());

DROP POLICY IF EXISTS "Trip creator or admin can add china members" ON public.china_trip_members;
CREATE POLICY "Trip creator or admin can add china members"
ON public.china_trip_members FOR INSERT TO authenticated
WITH CHECK (
  public.is_approved_user()
  AND (NOT public.is_china_readonly() OR public.is_admin())
  AND (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM public.china_trips WHERE china_trips.id = china_trip_members.trip_id AND china_trips.created_by = auth.uid())
  )
);

DROP POLICY IF EXISTS "All authenticated can view china photos" ON public.china_photos;
CREATE POLICY "All authenticated can view china photos"
ON public.china_photos FOR SELECT TO authenticated
USING (public.is_approved_user());

DROP POLICY IF EXISTS "Members can upload china photos" ON public.china_photos;
CREATE POLICY "Members can upload china photos"
ON public.china_photos FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND public.is_approved_user() AND public.is_china_trip_member(trip_id) AND (NOT public.is_china_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "All authenticated can view factories" ON public.factories;
CREATE POLICY "All authenticated can view factories"
ON public.factories FOR SELECT TO authenticated
USING (public.is_approved_user());

DROP POLICY IF EXISTS "Authenticated users can create factories" ON public.factories;
CREATE POLICY "Authenticated users can create factories"
ON public.factories FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by AND public.is_approved_user() AND (NOT public.is_china_readonly() OR public.is_admin()));
