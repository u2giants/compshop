import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!apiKey) {
      throw new Error("GOOGLE_MAPS_API_KEY is not configured");
    }

    const { latitude, longitude } = await req.json();
    if (!latitude || !longitude) {
      throw new Error("latitude and longitude are required");
    }

    // Use Places API (New) - Nearby Search
    const url = "https://places.googleapis.com/v1/places:searchNearby";
    const body = {
      includedTypes: ["furniture_store", "home_goods_store", "department_store", "store"],
      maxResultCount: 5,
      locationRestriction: {
        circle: {
          center: { latitude, longitude },
          radius: 5000.0,
        },
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.rating,places.types",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Places API (New) error:", JSON.stringify(data));
      throw new Error(`Places API error [${res.status}]: ${JSON.stringify(data)}`);
    }

    const stores = (data.places || []).map((place: any) => ({
      name: place.displayName?.text || "",
      address: place.formattedAddress || "",
      rating: place.rating || null,
    }));

    return new Response(JSON.stringify({ stores }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
