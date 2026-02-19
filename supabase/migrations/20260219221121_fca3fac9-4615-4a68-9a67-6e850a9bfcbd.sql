
-- Add latitude and longitude columns to photos table for GPS capture
ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS longitude double precision;

-- Add latitude and longitude columns to china_photos table too for consistency
ALTER TABLE public.china_photos ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.china_photos ADD COLUMN IF NOT EXISTS longitude double precision;
