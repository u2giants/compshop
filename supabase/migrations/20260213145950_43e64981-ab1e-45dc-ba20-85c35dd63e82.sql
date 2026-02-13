
-- Create image_types table
CREATE TABLE public.image_types (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.image_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view image types"
ON public.image_types FOR SELECT
USING (true);

CREATE POLICY "Admins can manage image types"
ON public.image_types FOR ALL
USING (is_admin());

-- Seed with existing values
INSERT INTO public.image_types (name) VALUES ('Product Format'), ('Design Idea');
