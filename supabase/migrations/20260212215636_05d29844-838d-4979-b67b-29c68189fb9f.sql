
-- Allow trip creators to also view their own trips
DROP POLICY IF EXISTS "Members and admins can view trips" ON public.shopping_trips;

CREATE POLICY "Members and admins can view trips"
ON public.shopping_trips
FOR SELECT
TO authenticated
USING (is_trip_member(id) OR is_admin() OR created_by = auth.uid());
