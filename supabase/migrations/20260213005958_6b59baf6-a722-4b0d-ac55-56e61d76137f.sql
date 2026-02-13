
-- Retailers table with logo support
CREATE TABLE public.retailers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  logo_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

ALTER TABLE public.retailers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view retailers"
  ON public.retailers FOR SELECT
  USING (true);

CREATE POLICY "Admins can create retailers"
  ON public.retailers FOR INSERT
  WITH CHECK (is_admin() AND auth.uid() = created_by);

CREATE POLICY "Admins can update retailers"
  ON public.retailers FOR UPDATE
  USING (is_admin());

CREATE POLICY "Admins can delete retailers"
  ON public.retailers FOR DELETE
  USING (is_admin());

-- Countries table
CREATE TABLE public.countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view countries"
  ON public.countries FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage countries"
  ON public.countries FOR ALL
  USING (is_admin());

-- Storage bucket for retailer logos (public)
INSERT INTO storage.buckets (id, name, public) VALUES ('retailer-logos', 'retailer-logos', true);

CREATE POLICY "Anyone can view retailer logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'retailer-logos');

CREATE POLICY "Admins can upload retailer logos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'retailer-logos' AND (SELECT is_admin()));

CREATE POLICY "Admins can update retailer logos"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'retailer-logos' AND (SELECT is_admin()));

CREATE POLICY "Admins can delete retailer logos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'retailer-logos' AND (SELECT is_admin()));
