
-- Factories table to store business card / contact info for suppliers
CREATE TABLE public.factories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  wechat TEXT,
  whatsapp TEXT,
  address TEXT,
  website TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add factory_id to china_trips to link trips to factories
ALTER TABLE public.china_trips ADD COLUMN factory_id UUID REFERENCES public.factories(id);

-- Enable RLS
ALTER TABLE public.factories ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "All authenticated can view factories" ON public.factories
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create factories" ON public.factories
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Creator or admin can update factories" ON public.factories
  FOR UPDATE TO authenticated USING (created_by = auth.uid() OR is_admin());

CREATE POLICY "Admin can delete factories" ON public.factories
  FOR DELETE TO authenticated USING (is_admin());

-- Trigger for updated_at
CREATE TRIGGER update_factories_updated_at
  BEFORE UPDATE ON public.factories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
