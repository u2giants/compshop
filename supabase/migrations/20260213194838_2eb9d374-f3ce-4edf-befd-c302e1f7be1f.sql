-- Allow all authenticated users to view display_name and email from profiles (needed for photo attribution)
CREATE POLICY "All authenticated can view profiles"
ON public.profiles
FOR SELECT
USING (auth.uid() IS NOT NULL);
