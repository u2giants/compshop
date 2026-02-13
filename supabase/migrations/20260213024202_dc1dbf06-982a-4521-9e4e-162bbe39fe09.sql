
-- Add soft-delete column
ALTER TABLE public.shopping_trips ADD COLUMN deleted_at timestamp with time zone DEFAULT NULL;

-- Update RLS: allow all authenticated to see deleted trips (for recycle bin)
-- No policy changes needed since existing SELECT policy already covers it

-- Create index for efficient filtering
CREATE INDEX idx_shopping_trips_deleted_at ON public.shopping_trips (deleted_at);
