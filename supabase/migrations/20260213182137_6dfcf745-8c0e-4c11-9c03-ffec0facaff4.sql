
-- Create tables first without RLS policies that need the function

-- China trip members (created first so function can reference it)
-- But it references china_trips, so we need china_trips first without the member-dependent policy

-- China Trips table
CREATE TABLE public.china_trips (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  supplier text NOT NULL,
  venue_type text NOT NULL DEFAULT 'canton_fair' CHECK (venue_type IN ('canton_fair', 'factory_visit')),
  date date NOT NULL DEFAULT CURRENT_DATE,
  location text,
  notes text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  is_draft boolean NOT NULL DEFAULT false
);

ALTER TABLE public.china_trips ENABLE ROW LEVEL SECURITY;

-- China trip members
CREATE TABLE public.china_trip_members (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES public.china_trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  added_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.china_trip_members ENABLE ROW LEVEL SECURITY;

-- Now create the function
CREATE OR REPLACE FUNCTION public.is_china_trip_member(_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.china_trip_members
    WHERE trip_id = _trip_id AND user_id = auth.uid()
  )
$$;

-- China photos
CREATE TABLE public.china_photos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES public.china_trips(id) ON DELETE CASCADE,
  user_id uuid,
  file_path text NOT NULL,
  file_hash text,
  product_name text,
  category text,
  price numeric,
  dimensions text,
  country_of_origin text,
  material text,
  brand text,
  notes text,
  image_type text,
  group_id uuid REFERENCES public.china_photos(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.china_photos ENABLE ROW LEVEL SECURITY;

-- Now add all RLS policies
CREATE POLICY "All authenticated can view china trips" ON public.china_trips FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can create china trips" ON public.china_trips FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Members and admins can update china trips" ON public.china_trips FOR UPDATE USING (is_china_trip_member(id) OR is_admin());
CREATE POLICY "Admins can delete china trips" ON public.china_trips FOR DELETE USING (is_admin());

CREATE POLICY "All authenticated can view china trip members" ON public.china_trip_members FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Trip creator or admin can add china members" ON public.china_trip_members FOR INSERT WITH CHECK (
  is_admin() OR (EXISTS (SELECT 1 FROM china_trips WHERE china_trips.id = china_trip_members.trip_id AND china_trips.created_by = auth.uid()))
);
CREATE POLICY "Admin can remove china members" ON public.china_trip_members FOR DELETE USING (
  is_admin() OR (EXISTS (SELECT 1 FROM china_trips WHERE china_trips.id = china_trip_members.trip_id AND china_trips.created_by = auth.uid()))
);

CREATE POLICY "All authenticated can view china photos" ON public.china_photos FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Members can upload china photos" ON public.china_photos FOR INSERT WITH CHECK (auth.uid() = user_id AND is_china_trip_member(trip_id));
CREATE POLICY "Owner or admin can delete china photos" ON public.china_photos FOR DELETE USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "Owner or admin can update china photos" ON public.china_photos FOR UPDATE USING (user_id = auth.uid() OR is_admin());

-- Updated_at triggers
CREATE TRIGGER update_china_trips_updated_at BEFORE UPDATE ON public.china_trips FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_china_photos_updated_at BEFORE UPDATE ON public.china_photos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.china_trips;
