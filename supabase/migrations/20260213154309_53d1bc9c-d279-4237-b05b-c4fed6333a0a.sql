
CREATE TABLE public.categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view categories"
ON public.categories FOR SELECT USING (true);

CREATE POLICY "Admins can manage categories"
ON public.categories FOR ALL USING (is_admin());

-- Seed with existing hardcoded values
INSERT INTO public.categories (name) VALUES
  ('Wall art'),
  ('Tabletop'),
  ('Workspace'),
  ('Clocks'),
  ('Storage'),
  ('Floor'),
  ('Furniture'),
  ('Garden');
