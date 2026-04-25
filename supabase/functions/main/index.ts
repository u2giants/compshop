// Edge function router for self-hosted Supabase edge runtime.
// The runtime's --main-service flag points here; it dispatches every
// /functions/v1/<name> request to the matching sub-function.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Each sub-function calls Deno.serve() at module load, which registers its handler
// with the runtime. We just need to import them so they get registered.
const functions: Record<string, () => Promise<unknown>> = {
  "analyze-photo": () => import("../analyze-photo/index.ts"),
  "parse-teams-conversation": () => import("../parse-teams-conversation/index.ts"),
  "list-openrouter-models": () => import("../list-openrouter-models/index.ts"),
  "nearby-stores": () => import("../nearby-stores/index.ts"),
  "reverse-geocode": () => import("../reverse-geocode/index.ts"),
  "send-invite-email": () => import("../send-invite-email/index.ts"),
};

serve(async (req: Request) => {
  const url = new URL(req.url);
  // Strip /functions/v1/ prefix if present (Kong forwards the full path)
  const name = url.pathname.replace(/^\/functions\/v1\//, "").split("/")[0];

  const loader = functions[name];
  if (!loader) {
    return new Response(JSON.stringify({ error: `Function '${name}' not found` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const mod = await loader();
    return await mod.default(req);
  } catch (err) {
    console.error(`[main] Error in function '${name}':`, err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
