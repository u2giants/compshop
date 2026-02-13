
-- Drop restrictive SELECT policies and replace with open ones for all authenticated users

-- shopping_trips
DROP POLICY IF EXISTS "Members and admins can view trips" ON public.shopping_trips;
CREATE POLICY "All authenticated can view trips"
  ON public.shopping_trips FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- photos
DROP POLICY IF EXISTS "Members can view photos" ON public.photos;
CREATE POLICY "All authenticated can view photos"
  ON public.photos FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- comments
DROP POLICY IF EXISTS "Members can view comments" ON public.comments;
CREATE POLICY "All authenticated can view comments"
  ON public.comments FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- photo_annotations
DROP POLICY IF EXISTS "Members can view annotations" ON public.photo_annotations;
CREATE POLICY "All authenticated can view annotations"
  ON public.photo_annotations FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- trip_members
DROP POLICY IF EXISTS "Members can view trip members" ON public.trip_members;
CREATE POLICY "All authenticated can view trip members"
  ON public.trip_members FOR SELECT
  USING (auth.uid() IS NOT NULL);
