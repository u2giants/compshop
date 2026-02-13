-- Create invitations table for invite-only registration
CREATE TABLE public.invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  invited_by UUID NOT NULL,
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(email)
);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Only admins can view invitations
CREATE POLICY "Admins can view invitations"
  ON public.invitations FOR SELECT
  USING (is_admin());

-- Only admins can create invitations
CREATE POLICY "Admins can create invitations"
  ON public.invitations FOR INSERT
  WITH CHECK (is_admin() AND auth.uid() = invited_by);

-- Only admins can delete invitations
CREATE POLICY "Admins can delete invitations"
  ON public.invitations FOR DELETE
  USING (is_admin());

-- Only admins can update invitations (mark as accepted)
CREATE POLICY "Admins can update invitations"
  ON public.invitations FOR UPDATE
  USING (is_admin());

-- Function to check if an email was invited (used during signup validation)
CREATE OR REPLACE FUNCTION public.is_email_invited(_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.invitations
    WHERE email = lower(_email) AND accepted_at IS NULL
  )
$$;

-- Function to mark invitation as accepted (called after signup)
CREATE OR REPLACE FUNCTION public.mark_invitation_accepted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.invitations
  SET accepted_at = now()
  WHERE email = lower(NEW.email);
  RETURN NEW;
END;
$$;

-- Trigger to auto-mark invitation as accepted when user signs up
CREATE TRIGGER on_auth_user_created_mark_invitation
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_invitation_accepted();
