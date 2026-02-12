
-- Fix: Drop restrictive INSERT policy and create a permissive one
DROP POLICY IF EXISTS "Authenticated users can create trips" ON public.shopping_trips;

CREATE POLICY "Authenticated users can create trips"
ON public.shopping_trips
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

-- Also fix trip_members INSERT so creator can auto-add themselves
DROP POLICY IF EXISTS "Trip creator or admin can add members" ON public.trip_members;

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
