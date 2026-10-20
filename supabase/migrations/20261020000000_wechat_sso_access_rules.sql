-- Allow WeChat as an auth provider in CompShop access rules.
-- Invite-only is unchanged: unknown WeChat users still land in pending.

ALTER TABLE public.auth_access_rules
  DROP CONSTRAINT IF EXISTS auth_access_rules_provider_check;

ALTER TABLE public.auth_access_rules
  ADD CONSTRAINT auth_access_rules_provider_check
  CHECK (provider IN ('*', 'email', 'google', 'azure', 'microsoft', 'wechat'));
