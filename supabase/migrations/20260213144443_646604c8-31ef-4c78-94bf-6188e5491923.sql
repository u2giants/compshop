
-- Add file_hash column to photos table for duplicate detection
ALTER TABLE public.photos ADD COLUMN file_hash text;

-- Create index for fast duplicate lookups
CREATE INDEX idx_photos_file_hash ON public.photos (file_hash);
