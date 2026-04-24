import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_PROVIDER = (Deno.env.get("AI_PROVIDER") ?? "openrouter").toLowerCase();
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = Deno.env.get("AI_MODEL") ?? "google/gemini-2.5-flash";

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

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let aiUrl: string;
    let aiKey: string | undefined;
    const extraHeaders: Record<string, string> = {};

    if (AI_PROVIDER === "openrouter") {
      aiUrl = OPENROUTER_URL;
      aiKey = Deno.env.get("OPENROUTER_API_KEY");
      if (!aiKey) throw new Error("OPENROUTER_API_KEY is not configured");
      const referer = Deno.env.get("OPENROUTER_HTTP_REFERER");
      const title = Deno.env.get("OPENROUTER_APP_TITLE") ?? "CompShop";
      if (referer) extraHeaders["HTTP-Referer"] = referer;
      extraHeaders["X-Title"] = title;
    } else {
      aiUrl = LOVABLE_AI_URL;
      aiKey = Deno.env.get("LOVABLE_API_KEY");
      if (!aiKey) throw new Error("LOVABLE_API_KEY is not configured");
    }

    const { text } = await req.json();
    if (!text) throw new Error("No conversation text provided");

    const response = await fetch(aiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiKey}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "user",
            content: `Analyze this Microsoft Teams conversation. The conversation title or first lines usually contain a store/retailer name and a date (sometimes in various formats). Extract:

1. "store" - the retail store name mentioned
2. "date" - the date in YYYY-MM-DD format (if relative dates like "last Tuesday", estimate based on today being ${new Date().toISOString().split("T")[0]})
3. "notes" - a brief summary of product observations mentioned in the conversation (max 200 chars)

Return ONLY a JSON object with these 3 fields. If you can't find a field, use null.

Conversation:
${text.slice(0, 4000)}`,
          },
        ],
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`AI provider error [${response.status}]: ${err}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { store: null, date: null, notes: text.slice(0, 200) };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("parse-teams error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
