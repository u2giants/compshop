import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useCountries() {
  const [countries, setCountries] = useState<string[]>([]);

  useEffect(() => {
    supabase.from("countries").select("name").order("name")
      .then(({ data }) => { if (data) setCountries(data.map((c) => c.name)); });
  }, []);

  return countries;
}
