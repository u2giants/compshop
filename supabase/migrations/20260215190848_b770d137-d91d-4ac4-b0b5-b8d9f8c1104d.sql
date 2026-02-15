
ALTER TABLE public.profiles ADD COLUMN default_mode text NOT NULL DEFAULT 'store_shopping';

-- Allow admins to update any profile's default_mode
CREATE POLICY "Admins can update all profiles"
ON public.profiles
FOR UPDATE
USING (is_admin());
