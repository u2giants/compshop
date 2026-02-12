
-- Drop all existing restrictive policies on shopping_trips
DROP POLICY IF EXISTS "Authenticated users can create trips" ON public.shopping_trips;
DROP POLICY IF EXISTS "Members and admins can view trips" ON public.shopping_trips;
DROP POLICY IF EXISTS "Members and admins can update trips" ON public.shopping_trips;
DROP POLICY IF EXISTS "Admins can delete trips" ON public.shopping_trips;

-- Recreate as permissive policies
CREATE POLICY "Authenticated users can create trips"
ON public.shopping_trips
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Members and admins can view trips"
ON public.shopping_trips
FOR SELECT
TO authenticated
USING (is_trip_member(id) OR is_admin());

CREATE POLICY "Members and admins can update trips"
ON public.shopping_trips
FOR UPDATE
TO authenticated
USING (is_trip_member(id) OR is_admin());

CREATE POLICY "Admins can delete trips"
ON public.shopping_trips
FOR DELETE
TO authenticated
USING (is_admin());

-- Also fix trip_members policies
DROP POLICY IF EXISTS "Trip creator or admin can add members" ON public.trip_members;
DROP POLICY IF EXISTS "Members can view trip members" ON public.trip_members;
DROP POLICY IF EXISTS "Admin can remove members" ON public.trip_members;

CREATE POLICY "Trip creator or admin can add members"
ON public.trip_members
FOR INSERT
TO authenticated
WITH CHECK (
  is_admin() OR 
  (EXISTS (
    SELECT 1 FROM shopping_trips
    WHERE shopping_trips.id = trip_members.trip_id
    AND shopping_trips.created_by = auth.uid()
  ))
);

CREATE POLICY "Members can view trip members"
ON public.trip_members
FOR SELECT
TO authenticated
USING (is_trip_member(trip_id) OR is_admin());

CREATE POLICY "Admin can remove members"
ON public.trip_members
FOR DELETE
TO authenticated
USING (
  is_admin() OR 
  (EXISTS (
    SELECT 1 FROM shopping_trips
    WHERE shopping_trips.id = trip_members.trip_id
    AND shopping_trips.created_by = auth.uid()
  ))
);
