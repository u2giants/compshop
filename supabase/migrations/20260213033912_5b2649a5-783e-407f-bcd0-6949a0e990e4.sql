
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

CREATE POLICY "Users can view own profile or admin"
ON public.profiles
FOR SELECT
USING (id = auth.uid() OR public.is_admin());
