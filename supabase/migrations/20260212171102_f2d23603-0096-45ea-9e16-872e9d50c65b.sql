
-- Roles enum and table (per security guidelines, roles in separate table)
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Shopping trips
CREATE TABLE public.shopping_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  store TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  location TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shopping_trips ENABLE ROW LEVEL SECURITY;

-- Trip members (junction)
CREATE TABLE public.trip_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES public.shopping_trips(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id, user_id)
);
ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;

-- Photo entries
CREATE TABLE public.photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES public.shopping_trips(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  product_name TEXT,
  category TEXT,
  price NUMERIC,
  dimensions TEXT,
  country_of_origin TEXT,
  material TEXT,
  brand TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;

-- Annotations (stored as JSON overlay data)
CREATE TABLE public.photo_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID REFERENCES public.photos(id) ON DELETE CASCADE NOT NULL,
  annotation_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.photo_annotations ENABLE ROW LEVEL SECURITY;

-- Comments
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID REFERENCES public.photos(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- Storage bucket for photos (private)
INSERT INTO storage.buckets (id, name, public) VALUES ('photos', 'photos', false);

-- ========================
-- HELPER FUNCTIONS
-- ========================

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_trip_member(_trip_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = _trip_id AND user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
$$;

-- ========================
-- TRIGGERS
-- ========================

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)));
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_shopping_trips_updated_at BEFORE UPDATE ON public.shopping_trips FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_photos_updated_at BEFORE UPDATE ON public.photos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_photo_annotations_updated_at BEFORE UPDATE ON public.photo_annotations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ========================
-- RLS POLICIES
-- ========================

-- user_roles: users can read their own, admins read all
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL USING (public.is_admin());

-- profiles
CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- shopping_trips
CREATE POLICY "Members and admins can view trips" ON public.shopping_trips FOR SELECT TO authenticated
  USING (public.is_trip_member(id) OR public.is_admin());
CREATE POLICY "Authenticated users can create trips" ON public.shopping_trips FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Members and admins can update trips" ON public.shopping_trips FOR UPDATE TO authenticated
  USING (public.is_trip_member(id) OR public.is_admin());
CREATE POLICY "Admins can delete trips" ON public.shopping_trips FOR DELETE TO authenticated
  USING (public.is_admin());

-- trip_members
CREATE POLICY "Members can view trip members" ON public.trip_members FOR SELECT TO authenticated
  USING (public.is_trip_member(trip_id) OR public.is_admin());
CREATE POLICY "Trip creator or admin can add members" ON public.trip_members FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin() OR 
    EXISTS (SELECT 1 FROM public.shopping_trips WHERE id = trip_id AND created_by = auth.uid())
  );
CREATE POLICY "Admin can remove members" ON public.trip_members FOR DELETE TO authenticated
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.shopping_trips WHERE id = trip_id AND created_by = auth.uid()));

-- photos
CREATE POLICY "Members can view photos" ON public.photos FOR SELECT TO authenticated
  USING (public.is_trip_member(trip_id) OR public.is_admin());
CREATE POLICY "Members can upload photos" ON public.photos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_trip_member(trip_id));
CREATE POLICY "Owner or admin can update photos" ON public.photos FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Owner or admin can delete photos" ON public.photos FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- photo_annotations
CREATE POLICY "Members can view annotations" ON public.photo_annotations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.photos p WHERE p.id = photo_id AND (public.is_trip_member(p.trip_id) OR public.is_admin())));
CREATE POLICY "Members can create annotations" ON public.photo_annotations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND EXISTS (SELECT 1 FROM public.photos p WHERE p.id = photo_id AND public.is_trip_member(p.trip_id)));
CREATE POLICY "Owner or admin can update annotations" ON public.photo_annotations FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.is_admin());
CREATE POLICY "Owner or admin can delete annotations" ON public.photo_annotations FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.is_admin());

-- comments
CREATE POLICY "Members can view comments" ON public.comments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.photos p WHERE p.id = photo_id AND (public.is_trip_member(p.trip_id) OR public.is_admin())));
CREATE POLICY "Members can create comments" ON public.comments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.photos p WHERE p.id = photo_id AND public.is_trip_member(p.trip_id)));
CREATE POLICY "Owner or admin can update comments" ON public.comments FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "Owner or admin can delete comments" ON public.comments FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- Storage policies for photos bucket
CREATE POLICY "Authenticated users can upload photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Trip members can view photos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'photos');

CREATE POLICY "Photo owners can delete their files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'photos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Enable realtime for comments (live collaboration)
ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.photos;
