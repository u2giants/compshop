-- Add group_id to photos so multiple photos can be grouped under one "card"
-- group_id references another photo's id (the "primary" photo of the group)
ALTER TABLE public.photos ADD COLUMN group_id uuid REFERENCES public.photos(id) ON DELETE SET NULL;

-- Index for fast lookups
CREATE INDEX idx_photos_group_id ON public.photos(group_id);
