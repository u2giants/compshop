ALTER TABLE public.china_photos
ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image';

CREATE INDEX IF NOT EXISTS idx_china_photos_media_type ON public.china_photos(media_type);