-- Allow any authenticated user to add THEMSELVES as a trip member
-- This enables auto-joining when viewing a trip
DROP POLICY IF EXISTS "Trip creator or admin can add members" ON public.trip_members;

CREATE POLICY "Authenticated users can add themselves as members"
ON public.trip_members
FOR INSERT
WITH CHECK (auth.uid() = user_id);