-- Generic key/value store for app-level configuration (non-sensitive).
-- Publicly readable so edge functions can query without service role.
-- Admin-write only via RLS.

CREATE TABLE public.app_settings (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON public.app_settings
  FOR SELECT USING (true);

CREATE POLICY "Admin write" ON public.app_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

INSERT INTO public.app_settings (key, value)
VALUES ('ai_model', 'google/gemini-2.5-flash');
