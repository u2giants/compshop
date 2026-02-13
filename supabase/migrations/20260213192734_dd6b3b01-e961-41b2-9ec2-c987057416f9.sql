
-- Add section column to china_photos for booth/factory grouping within a trip
ALTER TABLE public.china_photos ADD COLUMN section text DEFAULT null;

-- Index for efficient grouping queries
CREATE INDEX idx_china_photos_section ON public.china_photos(trip_id, section);
