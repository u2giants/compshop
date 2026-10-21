-- Let applicants leave a short note so admins can tell WeChat users apart.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS intro_note text;
