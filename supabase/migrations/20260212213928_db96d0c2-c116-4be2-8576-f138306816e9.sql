
-- Fix user_roles policies: drop restrictive, create permissive
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

CREATE POLICY "Users can view own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can manage roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (is_admin());

-- Fix remaining tables with restrictive policies
-- comments
DROP POLICY IF EXISTS "Members can create comments" ON public.comments;
DROP POLICY IF EXISTS "Members can view comments" ON public.comments;
DROP POLICY IF EXISTS "Owner or admin can delete comments" ON public.comments;
DROP POLICY IF EXISTS "Owner or admin can update comments" ON public.comments;

CREATE POLICY "Members can create comments" ON public.comments FOR INSERT TO authenticated
WITH CHECK ((auth.uid() = user_id) AND (EXISTS (SELECT 1 FROM photos p WHERE p.id = comments.photo_id AND is_trip_member(p.trip_id))));

CREATE POLICY "Members can view comments" ON public.comments FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM photos p WHERE p.id = comments.photo_id AND (is_trip_member(p.trip_id) OR is_admin())));

CREATE POLICY "Owner or admin can delete comments" ON public.comments FOR DELETE TO authenticated
USING ((user_id = auth.uid()) OR is_admin());

CREATE POLICY "Owner or admin can update comments" ON public.comments FOR UPDATE TO authenticated
USING ((user_id = auth.uid()) OR is_admin());

-- photos
DROP POLICY IF EXISTS "Members can upload photos" ON public.photos;
DROP POLICY IF EXISTS "Members can view photos" ON public.photos;
DROP POLICY IF EXISTS "Owner or admin can delete photos" ON public.photos;
DROP POLICY IF EXISTS "Owner or admin can update photos" ON public.photos;

CREATE POLICY "Members can upload photos" ON public.photos FOR INSERT TO authenticated
WITH CHECK ((auth.uid() = user_id) AND is_trip_member(trip_id));

CREATE POLICY "Members can view photos" ON public.photos FOR SELECT TO authenticated
USING (is_trip_member(trip_id) OR is_admin());

CREATE POLICY "Owner or admin can delete photos" ON public.photos FOR DELETE TO authenticated
USING ((user_id = auth.uid()) OR is_admin());

CREATE POLICY "Owner or admin can update photos" ON public.photos FOR UPDATE TO authenticated
USING ((user_id = auth.uid()) OR is_admin());

-- profiles
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- photo_annotations
DROP POLICY IF EXISTS "Members can create annotations" ON public.photo_annotations;
DROP POLICY IF EXISTS "Members can view annotations" ON public.photo_annotations;
DROP POLICY IF EXISTS "Owner or admin can delete annotations" ON public.photo_annotations;
DROP POLICY IF EXISTS "Owner or admin can update annotations" ON public.photo_annotations;

CREATE POLICY "Members can create annotations" ON public.photo_annotations FOR INSERT TO authenticated
WITH CHECK ((auth.uid() = created_by) AND (EXISTS (SELECT 1 FROM photos p WHERE p.id = photo_annotations.photo_id AND is_trip_member(p.trip_id))));

CREATE POLICY "Members can view annotations" ON public.photo_annotations FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM photos p WHERE p.id = photo_annotations.photo_id AND (is_trip_member(p.trip_id) OR is_admin())));

CREATE POLICY "Owner or admin can delete annotations" ON public.photo_annotations FOR DELETE TO authenticated
USING ((created_by = auth.uid()) OR is_admin());

CREATE POLICY "Owner or admin can update annotations" ON public.photo_annotations FOR UPDATE TO authenticated
USING ((created_by = auth.uid()) OR is_admin());
