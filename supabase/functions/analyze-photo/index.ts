import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

    const model = Deno.env.get("OPENROUTER_VISION_MODEL") || "google/gemini-2.0-flash-001";

    const { imageBase64, mimeType, categories } = await req.json();
    if (!imageBase64) throw new Error("No image provided");

    const categoryInstruction = categories && categories.length > 0
      ? `\n  "category": "one of these categories that best fits: [${categories.join(", ")}]",`
      : `\n  "category": "general product category if identifiable",`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://comp.designflow.app",
        "X-Title": "CompShop",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this image. First determine if this is a BUSINESS CARD or a PRODUCT PHOTO.

If it is a BUSINESS CARD, return a JSON object with:
{
  "is_business_card": true,
  "company_name": "company/factory name",
  "contact_person": "person's name",
  "phone": "phone number(s)",
  "email": "email address",
  "wechat": "WeChat ID if present",
  "whatsapp": "WhatsApp number if present",
  "address": "physical address",
  "website": "website URL"
}

If it is a PRODUCT PHOTO, return a JSON object with:
{
  "is_business_card": false,
  "product_name": "name of the product if visible",${categoryInstruction}
  "price": numeric price value only (no currency symbol),
  "dimensions": "size/dimensions if shown on label",
  "brand": "brand name if visible",
  "material": "material if labeled",
  "country_of_origin": "country if shown (e.g. Made in China)"
}

Use null for any field not found. Return ONLY the JSON, no markdown, no explanation.`,
              },
              {
                type: "image_url",
                image_url: { url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}` },
              },
            ],
          },
        ],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const err = await response.text();
      throw new Error(`OpenRouter API error [${response.status}]: ${err}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {};
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("analyze-photo error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
