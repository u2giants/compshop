import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Retailer {
  id: string;
  name: string;
  logo_path: string | null;
}

export function useRetailers() {
  const [retailers, setRetailers] = useState<Retailer[]>([]);

  useEffect(() => {
    supabase.from("retailers").select("id, name, logo_path").order("name")
      .then(({ data }) => { if (data) setRetailers(data); });
  }, []);

  function normalize(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function getLogoUrl(name: string): string | null {
    const norm = normalize(name);
    const r = retailers.find((r) => normalize(r.name) === norm);
    if (!r?.logo_path) return null;
    const { data } = supabase.storage.from("retailer-logos").getPublicUrl(r.logo_path);
    return data.publicUrl;
  }

  return { retailers, retailerNames: retailers.map((r) => r.name), getLogoUrl };
}
