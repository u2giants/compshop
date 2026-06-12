CREATE OR REPLACE VIEW public.shopping_trips_with_stats
WITH (security_invoker = true)
AS
SELECT
  t.*,
  COALESCE(photo_counts.photo_count, 0)::bigint AS photo_count,
  COALESCE(member_counts.member_count, 0)::bigint AS member_count,
  cover.file_path AS cover_file_path
FROM public.shopping_trips t
LEFT JOIN LATERAL (
  SELECT count(*) AS photo_count
  FROM public.photos p
  WHERE p.trip_id = t.id
) photo_counts ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS member_count
  FROM public.trip_members tm
  WHERE tm.trip_id = t.id
) member_counts ON true
LEFT JOIN LATERAL (
  SELECT p.file_path
  FROM public.photos p
  WHERE p.trip_id = t.id
  ORDER BY p.created_at ASC
  LIMIT 1
) cover ON true;

CREATE OR REPLACE VIEW public.china_trips_with_stats
WITH (security_invoker = true)
AS
SELECT
  t.*,
  COALESCE(photo_counts.photo_count, 0)::bigint AS photo_count,
  cover.file_path AS cover_file_path,
  cover.user_id AS cover_user_id,
  creator.display_name AS photographer
FROM public.china_trips t
LEFT JOIN LATERAL (
  SELECT count(*) AS photo_count
  FROM public.china_photos p
  WHERE p.trip_id = t.id
) photo_counts ON true
LEFT JOIN LATERAL (
  SELECT p.file_path, p.user_id
  FROM public.china_photos p
  WHERE p.trip_id = t.id
  ORDER BY p.created_at ASC
  LIMIT 1
) cover ON true
LEFT JOIN public.profiles creator ON creator.id = t.created_by;

GRANT SELECT ON public.shopping_trips_with_stats TO authenticated;
GRANT SELECT ON public.china_trips_with_stats TO authenticated;
