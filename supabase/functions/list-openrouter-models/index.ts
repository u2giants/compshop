import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Prefer models enabled on the OpenRouter account. Fall back to the public catalog
// so admins can still pick a model when account-scoped model listing is unavailable.
const OPENROUTER_USER_MODELS_URL = "https://openrouter.ai/api/v1/models/user";
const OPENROUTER_PUBLIC_MODELS_URL = "https://openrouter.ai/api/v1/models";

async function fetchOpenRouterModels(url: string, apiKey?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error [${response.status}]: ${err}`);
  }

  return await response.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Admin-only: this endpoint exposes account-level model availability.
    const userId = userData.user.id;

    const { data: isAdmin, error: roleError } = await supabaseClient.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleError || !isAdmin) {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    let warning: string | undefined;
    let data: unknown;

    if (apiKey) {
      try {
        data = await fetchOpenRouterModels(OPENROUTER_USER_MODELS_URL, apiKey);
      } catch (error: unknown) {
        warning = "Account-specific OpenRouter models are unavailable; showing public models.";
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("list-openrouter-models account fetch failed:", message);
      }
    } else {
      warning = "OPENROUTER_API_KEY is not configured; showing public OpenRouter models.";
    }

    if (!data) {
      data = await fetchOpenRouterModels(OPENROUTER_PUBLIC_MODELS_URL);
    }

    return new Response(JSON.stringify({ ...(data as Record<string, unknown>), warning }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("list-openrouter-models error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
