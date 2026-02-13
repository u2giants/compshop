-- Add is_draft flag to shopping_trips for Smart Upload drafts
ALTER TABLE public.shopping_trips 
ADD COLUMN is_draft boolean NOT NULL DEFAULT false;