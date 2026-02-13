import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useImageTypes() {
  const [imageTypes, setImageTypes] = useState<string[]>([]);

  useEffect(() => {
    supabase
      .from("image_types")
      .select("name")
      .order("name")
      .then(({ data }) => {
        if (data) setImageTypes(data.map((d) => d.name));
      });
  }, []);

  return imageTypes;
}
