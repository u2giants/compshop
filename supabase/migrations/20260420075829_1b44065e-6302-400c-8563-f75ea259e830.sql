
-- 1. Extend the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'store_readonly';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'china_readonly';
