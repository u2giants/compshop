
-- Drop the existing combined policy
DROP POLICY IF EXISTS "Users can view own profile or admin" ON public.profiles;

-- Separate permissive policies
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
USING (id = auth.uid());

CREATE POLICY "Admins can view all profiles"
ON public.profiles FOR SELECT
USING (is_admin());
