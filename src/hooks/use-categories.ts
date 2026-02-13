import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useCategories() {
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    supabase
      .from("categories")
      .select("name")
      .order("name")
      .then(({ data }) => {
        if (data) setCategories(data.map((d) => d.name));
      });
  }, []);

  return categories;
}
