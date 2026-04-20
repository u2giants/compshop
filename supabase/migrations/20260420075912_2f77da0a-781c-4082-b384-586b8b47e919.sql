
-- 2. Helper functions
CREATE OR REPLACE FUNCTION public.is_store_readonly()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'store_readonly')
$$;

CREATE OR REPLACE FUNCTION public.is_china_readonly()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'china_readonly')
$$;

-- 3. Update RLS policies on STORE side
-- shopping_trips
DROP POLICY IF EXISTS "Authenticated users can create trips" ON public.shopping_trips;
CREATE POLICY "Authenticated users can create trips"
ON public.shopping_trips FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by AND (NOT public.is_store_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Members and admins can update trips" ON public.shopping_trips;
CREATE POLICY "Members and admins can update trips"
ON public.shopping_trips FOR UPDATE TO authenticated
USING ((public.is_trip_member(id) OR public.is_admin()) AND (NOT public.is_store_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Admins can delete trips" ON public.shopping_trips;
CREATE POLICY "Admins can delete trips"
ON public.shopping_trips FOR DELETE TO authenticated
USING (public.is_admin());

-- photos
DROP POLICY IF EXISTS "Members can upload photos" ON public.photos;
CREATE POLICY "Members can upload photos"
ON public.photos FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND public.is_trip_member(trip_id) AND (NOT public.is_store_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Owner or admin can update photos" ON public.photos;
CREATE POLICY "Owner or admin can update photos"
ON public.photos FOR UPDATE TO authenticated
USING (((user_id = auth.uid()) OR public.is_admin()) AND (NOT public.is_store_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Owner or admin can delete photos" ON public.photos;
CREATE POLICY "Owner or admin can delete photos"
ON public.photos FOR DELETE TO authenticated
USING (((user_id = auth.uid()) OR public.is_admin()) AND (NOT public.is_store_readonly() OR public.is_admin()));

-- comments
DROP POLICY IF EXISTS "Members can create comments" ON public.comments;
CREATE POLICY "Members can create comments"
ON public.comments FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.photos p WHERE p.id = comments.photo_id AND public.is_trip_member(p.trip_id))
  AND (NOT public.is_store_readonly() OR public.is_admin())
);

DROP POLICY IF EXISTS "Owner or admin can update comments" ON public.comments;
CREATE POLICY "Owner or admin can update comments"
ON public.comments FOR UPDATE TO authenticated
USING (((user_id = auth.uid()) OR public.is_admin()) AND (NOT public.is_store_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Owner or admin can delete comments" ON public.comments;
CREATE POLICY "Owner or admin can delete comments"
ON public.comments FOR DELETE TO authenticated
USING (((user_id = auth.uid()) OR public.is_admin()) AND (NOT public.is_store_readonly() OR public.is_admin()));

-- photo_annotations
DROP POLICY IF EXISTS "Members can create annotations" ON public.photo_annotations;
CREATE POLICY "Members can create annotations"
ON public.photo_annotations FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = created_by
  AND EXISTS (SELECT 1 FROM public.photos p WHERE p.id = photo_annotations.photo_id AND public.is_trip_member(p.trip_id))
  AND (NOT public.is_store_readonly() OR public.is_admin())
);

DROP POLICY IF EXISTS "Owner or admin can update annotations" ON public.photo_annotations;
CREATE POLICY "Owner or admin can update annotations"
ON public.photo_annotations FOR UPDATE TO authenticated
USING (((created_by = auth.uid()) OR public.is_admin()) AND (NOT public.is_store_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Owner or admin can delete annotations" ON public.photo_annotations;
CREATE POLICY "Owner or admin can delete annotations"
ON public.photo_annotations FOR DELETE TO authenticated
USING (((created_by = auth.uid()) OR public.is_admin()) AND (NOT public.is_store_readonly() OR public.is_admin()));

-- trip_members (store)
DROP POLICY IF EXISTS "Authenticated users can add themselves as members" ON public.trip_members;
CREATE POLICY "Authenticated users can add themselves as members"
ON public.trip_members FOR INSERT
WITH CHECK (auth.uid() = user_id AND (NOT public.is_store_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Admin can remove members" ON public.trip_members;
CREATE POLICY "Admin can remove members"
ON public.trip_members FOR DELETE TO authenticated
USING (
  (public.is_admin() OR EXISTS (SELECT 1 FROM public.shopping_trips WHERE shopping_trips.id = trip_members.trip_id AND shopping_trips.created_by = auth.uid()))
  AND (NOT public.is_store_readonly() OR public.is_admin())
);

-- 4. Update RLS policies on CHINA side
-- china_trips
DROP POLICY IF EXISTS "Authenticated users can create china trips" ON public.china_trips;
CREATE POLICY "Authenticated users can create china trips"
ON public.china_trips FOR INSERT
WITH CHECK (auth.uid() = created_by AND (NOT public.is_china_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Members and admins can update china trips" ON public.china_trips;
CREATE POLICY "Members and admins can update china trips"
ON public.china_trips FOR UPDATE
USING ((public.is_china_trip_member(id) OR public.is_admin()) AND (NOT public.is_china_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Admins can delete china trips" ON public.china_trips;
CREATE POLICY "Admins can delete china trips"
ON public.china_trips FOR DELETE
USING (public.is_admin());

-- china_photos
DROP POLICY IF EXISTS "Members can upload china photos" ON public.china_photos;
CREATE POLICY "Members can upload china photos"
ON public.china_photos FOR INSERT
WITH CHECK (auth.uid() = user_id AND public.is_china_trip_member(trip_id) AND (NOT public.is_china_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Owner or admin can update china photos" ON public.china_photos;
CREATE POLICY "Owner or admin can update china photos"
ON public.china_photos FOR UPDATE
USING (((user_id = auth.uid()) OR public.is_admin()) AND (NOT public.is_china_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Owner or admin can delete china photos" ON public.china_photos;
CREATE POLICY "Owner or admin can delete china photos"
ON public.china_photos FOR DELETE
USING (((user_id = auth.uid()) OR public.is_admin()) AND (NOT public.is_china_readonly() OR public.is_admin()));

-- china_trip_members
DROP POLICY IF EXISTS "Trip creator or admin can add china members" ON public.china_trip_members;
CREATE POLICY "Trip creator or admin can add china members"
ON public.china_trip_members FOR INSERT
WITH CHECK (
  (public.is_admin() OR EXISTS (SELECT 1 FROM public.china_trips WHERE china_trips.id = china_trip_members.trip_id AND china_trips.created_by = auth.uid()))
  AND (NOT public.is_china_readonly() OR public.is_admin())
);

DROP POLICY IF EXISTS "Admin can remove china members" ON public.china_trip_members;
CREATE POLICY "Admin can remove china members"
ON public.china_trip_members FOR DELETE
USING (
  (public.is_admin() OR EXISTS (SELECT 1 FROM public.china_trips WHERE china_trips.id = china_trip_members.trip_id AND china_trips.created_by = auth.uid()))
  AND (NOT public.is_china_readonly() OR public.is_admin())
);

-- factories
DROP POLICY IF EXISTS "Authenticated users can create factories" ON public.factories;
CREATE POLICY "Authenticated users can create factories"
ON public.factories FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by AND (NOT public.is_china_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Creator or admin can update factories" ON public.factories;
CREATE POLICY "Creator or admin can update factories"
ON public.factories FOR UPDATE TO authenticated
USING (((created_by = auth.uid()) OR public.is_admin()) AND (NOT public.is_china_readonly() OR public.is_admin()));

DROP POLICY IF EXISTS "Admin can delete factories" ON public.factories;
CREATE POLICY "Admin can delete factories"
ON public.factories FOR DELETE TO authenticated
USING (public.is_admin());
